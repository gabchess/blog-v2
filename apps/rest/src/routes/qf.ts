/**
 * QF Simulation Routes
 *
 * REST endpoints for Quadratic Funding round management.
 * Implements Capital Constrained Liberal Radicalism (CLR) algorithm.
 *
 * Endpoints:
 * - POST /qf/rounds - Create new round
 * - GET /qf/rounds/current - Get current round
 * - POST /qf/rounds/current/projects - Add project
 * - POST /qf/rounds/current/codes - Generate voter codes
 * - POST /qf/rounds/current/status - Change round status
 * - POST /qf/rounds/current/votes - Submit vote
 * - POST /qf/rounds/current/preview - Preview CLR with hypothetical vote
 * - POST /qf/rounds/current/close - Close round and calculate final results
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  CreateRoundInputSchema,
  AddProjectInputSchema,
  GenerateCodesInputSchema,
  SubmitVoteInputSchema,
  PreviewVoteInputSchema,
  RoundStatusSchema,
} from '@octant/validation';
import {
  getRound,
  createRound,
  addProject,
  addVoterCodes,
  updateRoundStatus,
  upsertVote,
  closeRound,
  clearRound,
  getActiveVotingRound,
  getVoterVisibleRounds,
  findRoundByVoterCode,
  type Round,
  type CLRResults,
  type ProjectResult,
} from '../state/qf-state.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router: ReturnType<typeof Router> = Router();

/**
 * Calculate CLR matching for a round.
 * Implements: match = (sum of sqrt(contributions))^2 - sum of contributions
 * With capital constraint: scale if total raw match exceeds pool.
 */
function calculateCLR(round: Round): CLRResults {
  const projectResults: ProjectResult[] = [];
  let totalRawMatch = 0;

  for (const project of round.projects) {
    // Sum of direct contributions to this project
    let directSum = 0;
    // Sum of square roots
    let sqrtSum = 0;

    for (const vote of round.votes) {
      const amount = vote.allocations[project.id] ?? 0;
      if (amount > 0) {
        directSum += amount;
        sqrtSum += Math.sqrt(amount);
      }
    }

    // CLR formula: (sum of sqrt)^2 - direct sum
    const rawMatch = Math.max(0, sqrtSum * sqrtSum - directSum);
    totalRawMatch += rawMatch;

    projectResults.push({
      projectId: project.id,
      projectName: project.name,
      directContributions: directSum,
      rawMatch,
      scaledMatch: 0, // Will be set after scaling
      total: 0,
    });
  }

  // Apply capital constraint: scale if needed
  const scalingFactor =
    totalRawMatch > round.matchingPool ? round.matchingPool / totalRawMatch : 1;

  for (const result of projectResults) {
    result.scaledMatch = result.rawMatch * scalingFactor;
    result.total = result.directContributions + result.scaledMatch;
  }

  return {
    projects: projectResults,
    totalRawMatch,
    scalingFactor,
    matchingPoolUsed: Math.min(totalRawMatch, round.matchingPool),
  };
}

/**
 * Generate a short, readable voter code.
 * Format: XXXX-XXXX (8 alphanumeric chars)
 */
function generateVoterCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded I, O, 0, 1 for readability
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// === Round Management ===

/**
 * POST /qf/rounds - Create new round
 */
router.post('/rounds', requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateRoundInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  const round = await createRound({
    id: randomUUID(),
    name: parsed.data.name,
    matchingPool: parsed.data.matchingPool,
    voterBudget: parsed.data.voterBudget,
    adminId: req.userId!,
  });

  return res.status(201).json({ data: round });
});

/**
 * GET /qf/rounds/active - Get all voter-visible rounds (voting + closed)
 * Returns minimal info for display (no voter codes exposed)
 */
router.get('/rounds/active', async (req: Request, res: Response) => {
  const rounds = await getVoterVisibleRounds();
  const summary = rounds.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    matchingPool: r.matchingPool,
    voterBudget: r.voterBudget,
    projectCount: r.projects.length,
  }));
  return res.json({ data: summary });
});

/**
 * GET /qf/rounds/current - Get current round
 * - With auth: returns admin's own round
 * - Without auth: returns any active voting round (for voters)
 */
router.get('/rounds/current', optionalAuth, async (req: Request, res: Response) => {
  // If authenticated, return admin's own round
  if (req.userId) {
    const round = await getRound(req.userId);
    if (!round) {
      return res.status(404).json({ error: 'No active round' });
    }
    return res.json({ data: round });
  }

  // Otherwise, return any active voting round for voters
  const activeRound = await getActiveVotingRound();
  if (!activeRound) {
    return res.status(404).json({ error: 'No active round' });
  }
  return res.json({ data: activeRound });
});

/**
 * DELETE /qf/rounds/current - Delete current round (allows starting fresh)
 */
router.delete('/rounds/current', requireAuth, async (req: Request, res: Response) => {
  const round = await getRound(req.userId);
  if (!round) {
    return res.status(404).json({ error: 'No active round' });
  }
  await clearRound(req.userId);
  return res.json({ data: { deleted: true } });
});

/**
 * GET /qf/rounds/:id - Get a specific round by ID
 * Returns full round data (without voter codes for security)
 * NOTE: This route MUST come after /rounds/current to avoid matching "current" as an ID
 */
router.get('/rounds/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const allRounds = await getVoterVisibleRounds();
  const round = allRounds.find((r) => r.id === id);

  if (!round) {
    return res.status(404).json({ error: 'Round not found' });
  }

  // Return round without exposing voter codes
  const { voterCodes, ...safeRound } = round;
  return res.json({ data: safeRound });
});

// === Project Management ===

/**
 * POST /qf/rounds/current/projects - Add project to round
 */
router.post('/rounds/current/projects', requireAuth, async (req: Request, res: Response) => {
  const round = await getRound(req.userId);
  if (!round) {
    return res.status(404).json({ error: 'No active round' });
  }
  if (round.status !== 'setup') {
    return res.status(400).json({ error: 'Can only add projects during setup' });
  }

  const parsed = AddProjectInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  const project = {
    id: randomUUID(),
    name: parsed.data.name,
    description: parsed.data.description ?? '',
  };
  await addProject(round.id, project);

  const updated = await getRound(req.userId);
  return res.status(201).json({ data: updated });
});

// === Voter Code Management ===

/**
 * POST /qf/rounds/current/codes - Generate voter codes
 */
router.post('/rounds/current/codes', requireAuth, async (req: Request, res: Response) => {
  const round = await getRound(req.userId);
  if (!round) {
    return res.status(404).json({ error: 'No active round' });
  }
  if (round.status !== 'setup') {
    return res.status(400).json({ error: 'Can only generate codes during setup' });
  }

  const parsed = GenerateCodesInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  const newCodes = [];
  for (let i = 0; i < parsed.data.count; i++) {
    newCodes.push({ code: generateVoterCode(), used: false });
  }
  await addVoterCodes(round.id, newCodes);

  const updated = await getRound(req.userId);
  return res.status(201).json({ data: updated });
});

// === Round Status Management ===

/**
 * POST /qf/rounds/current/status - Change round status
 */
router.post('/rounds/current/status', requireAuth, async (req: Request, res: Response) => {
  const round = await getRound(req.userId);
  if (!round) {
    return res.status(404).json({ error: 'No active round' });
  }

  const parsed = RoundStatusSchema.safeParse(req.body?.status);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid status. Must be: setup, voting, or closed' });
  }

  const newStatus = parsed.data;

  // Validate status transitions
  if (round.status === 'setup' && newStatus === 'voting') {
    if (round.projects.length === 0) {
      return res.status(400).json({ error: 'Cannot start voting with no projects' });
    }
    if (round.voterCodes.length === 0) {
      return res.status(400).json({ error: 'Cannot start voting with no voter codes' });
    }
  } else if (round.status === 'voting' && newStatus === 'closed') {
    // This is valid - use the close endpoint for final calculation
    return res.status(400).json({ error: 'Use POST /qf/rounds/current/close to close the round' });
  } else if (newStatus === 'setup') {
    return res.status(400).json({ error: 'Cannot return to setup status' });
  }

  await updateRoundStatus(round.id, newStatus);

  const updated = await getRound(req.userId);
  return res.json({ data: updated });
});

// === Voting ===

/**
 * POST /qf/rounds/current/votes - Submit or update vote
 */
router.post('/rounds/current/votes', async (req: Request, res: Response) => {
  const parsed = SubmitVoteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  const { voterCode, allocations } = parsed.data;

  // Find round by voter code
  const round = await findRoundByVoterCode(voterCode);
  if (!round) {
    return res.status(401).json({ error: 'Invalid voter code' });
  }
  if (round.status !== 'voting') {
    return res.status(400).json({ error: 'Voting is not open' });
  }

  // Validate allocations - all project IDs must exist
  const projectIds = new Set(round.projects.map((p) => p.id));
  for (const projectId of Object.keys(allocations)) {
    if (!projectIds.has(projectId)) {
      return res.status(400).json({ error: `Invalid project ID: ${projectId}` });
    }
  }

  // Validate budget
  const totalAllocated = Object.values(allocations).reduce((sum, amt) => sum + amt, 0);
  if (totalAllocated > round.voterBudget) {
    return res.status(400).json({
      error: `Total allocation ${totalAllocated} exceeds budget ${round.voterBudget}`,
    });
  }

  const isUpdate = await upsertVote(round.id, voterCode, allocations);
  const vote = { voterCode, allocations };

  return res.status(isUpdate ? 200 : 201).json({ data: vote });
});

// === CLR Calculation ===

/**
 * POST /qf/rounds/current/preview - Preview CLR with hypothetical vote
 * Finds round by any active voting round (for voters)
 */
router.post('/rounds/current/preview', async (req: Request, res: Response) => {
  const round = await getActiveVotingRound();
  if (!round) {
    return res.status(400).json({ error: 'Round not in voting state' });
  }

  const parsed = PreviewVoteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  // Create temp round with hypothetical vote
  const tempVote = { voterCode: 'preview', allocations: parsed.data.allocations };
  const tempRound = { ...round, votes: [...round.votes, tempVote] };
  const results = calculateCLR(tempRound);

  return res.json({ data: results });
});

/**
 * POST /qf/rounds/current/close - Close round and calculate final results
 */
router.post('/rounds/current/close', requireAuth, async (req: Request, res: Response) => {
  const round = await getRound(req.userId);
  if (!round) {
    return res.status(404).json({ error: 'No active round' });
  }
  if (round.status !== 'voting') {
    return res.status(400).json({ error: 'Round must be in voting state to close' });
  }

  const results = calculateCLR(round);
  await closeRound(round.id, results);

  const updated = await getRound(req.userId);
  return res.json({ data: updated });
});

export { router as qfRouter };

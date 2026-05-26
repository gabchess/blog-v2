/**
 * QF Simulation Persistent State (PostgreSQL via Prisma)
 *
 * Provides type definitions and state management for quadratic funding rounds.
 * Implements Capital Constrained Liberal Radicalism (CLR) data structures.
 *
 * State is persisted to PostgreSQL — survives server restarts.
 */

import { prisma, Prisma } from '@octant/db-postgres';

// === Type Definitions ===

export interface Project {
  id: string;
  name: string;
  description: string;
}

export interface Vote {
  voterCode: string; // The code used by voter
  allocations: Record<string, number>; // projectId -> amount
}

export interface VoterCode {
  code: string;
  used: boolean;
}

export type RoundStatus = 'setup' | 'voting' | 'closed';

export interface Round {
  id: string;
  name: string;
  matchingPool: number;
  voterBudget: number;
  status: RoundStatus;
  projects: Project[];
  voterCodes: VoterCode[];
  votes: Vote[];
  results?: CLRResults;
  adminId?: string; // Associates round with creating admin for data isolation
}

export interface ProjectResult {
  projectId: string;
  projectName: string;
  directContributions: number;
  rawMatch: number;
  scaledMatch: number;
  total: number;
}

export interface CLRResults {
  projects: ProjectResult[];
  totalRawMatch: number;
  scalingFactor: number;
  matchingPoolUsed: number;
}

// === Prisma include for full round loading ===

const roundInclude = {
  projects: true,
  voterCodes: true,
  votes: { include: { allocations: true } },
  projectResults: true,
} satisfies Prisma.QfRoundInclude;

type DbRoundWithRelations = Prisma.QfRoundGetPayload<{ include: typeof roundInclude }>;

/**
 * Map a Prisma QfRound (with relations) to the application Round type.
 */
function toRound(db: DbRoundWithRelations): Round {
  return {
    id: db.id,
    name: db.name,
    matchingPool: db.matchingPool,
    voterBudget: db.voterBudget,
    status: db.status as RoundStatus,
    adminId: db.adminId,
    results:
      db.totalRawMatch != null
        ? {
            totalRawMatch: db.totalRawMatch,
            scalingFactor: db.scalingFactor!,
            matchingPoolUsed: db.matchingPoolUsed!,
            projects: db.projectResults.map((pr) => ({
              projectId: pr.projectId,
              projectName:
                db.projects.find((p) => p.id === pr.projectId)?.name ?? '',
              directContributions: pr.directContributions,
              rawMatch: pr.rawMatch,
              scaledMatch: pr.scaledMatch,
              total: pr.total,
            })),
          }
        : undefined,
    projects: db.projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    voterCodes: db.voterCodes.map((vc) => ({
      code: vc.code,
      used: vc.used,
    })),
    votes: db.votes.map((v) => ({
      voterCode: v.voterCode,
      allocations: Object.fromEntries(
        v.allocations.map((a) => [a.projectId, a.amount])
      ),
    })),
  };
}

// === Read Functions ===

/**
 * Get a round by admin ID.
 * Returns null if no round exists for that admin.
 */
export async function getRound(adminId?: string): Promise<Round | null> {
  if (!adminId) return null;
  const db = await prisma.qfRound.findFirst({
    where: { adminId },
    include: roundInclude,
  });
  return db ? toRound(db) : null;
}

/**
 * Get any active voting round (for voters who don't know which admin).
 * Returns first round in 'voting' status, or null if none.
 */
export async function getActiveVotingRound(): Promise<Round | null> {
  const db = await prisma.qfRound.findFirst({
    where: { status: 'voting' },
    include: roundInclude,
  });
  return db ? toRound(db) : null;
}

/**
 * Get ALL active voting rounds (for round selector when multiple admins have concurrent rounds).
 * Returns array of rounds in 'voting' status.
 */
export async function getActiveVotingRounds(): Promise<Round[]> {
  const dbs = await prisma.qfRound.findMany({
    where: { status: 'voting' },
    include: roundInclude,
  });
  return dbs.map(toRound);
}

/**
 * Get all voter-visible rounds (voting + closed).
 * Voters need to see closed rounds to view results.
 */
export async function getVoterVisibleRounds(): Promise<Round[]> {
  const dbs = await prisma.qfRound.findMany({
    where: { status: { in: ['voting', 'closed'] } },
    include: roundInclude,
  });
  return dbs.map(toRound);
}

/**
 * Find a round by voter code.
 * Searches all rounds for one containing the given voter code.
 */
export async function findRoundByVoterCode(code: string): Promise<Round | null> {
  const db = await prisma.qfRound.findFirst({
    where: { voterCodes: { some: { code } } },
    include: roundInclude,
  });
  return db ? toRound(db) : null;
}

// === Granular Mutations ===

/**
 * Create a new round.
 */
export async function createRound(data: {
  id: string;
  name: string;
  matchingPool: number;
  voterBudget: number;
  adminId: string;
}): Promise<Round> {
  const db = await prisma.qfRound.create({
    data: {
      id: data.id,
      name: data.name,
      matchingPool: data.matchingPool,
      voterBudget: data.voterBudget,
      status: 'setup',
      adminId: data.adminId,
    },
    include: roundInclude,
  });
  return toRound(db);
}

/**
 * Add a project to a round.
 */
export async function addProject(
  roundId: string,
  project: { id: string; name: string; description: string }
): Promise<void> {
  await prisma.qfProject.create({
    data: {
      id: project.id,
      name: project.name,
      description: project.description,
      roundId,
    },
  });
}

/**
 * Add voter codes to a round.
 */
export async function addVoterCodes(
  roundId: string,
  codes: { code: string; used: boolean }[]
): Promise<void> {
  await prisma.qfVoterCode.createMany({
    data: codes.map((vc) => ({
      code: vc.code,
      used: vc.used,
      roundId,
    })),
  });
}

/**
 * Update the status of a round.
 */
export async function updateRoundStatus(
  roundId: string,
  status: RoundStatus
): Promise<void> {
  await prisma.qfRound.update({
    where: { id: roundId },
    data: { status },
  });
}

/**
 * Upsert a vote with allocations.
 * Returns true if the vote was an update, false if it was a new vote.
 */
export async function upsertVote(
  roundId: string,
  voterCode: string,
  allocations: Record<string, number>
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    // Find existing vote
    const existing = await tx.qfVote.findUnique({
      where: { roundId_voterCode: { roundId, voterCode } },
      select: { id: true },
    });

    if (existing) {
      // Update: upsert each allocation, delete orphans
      const newProjectIds = Object.keys(allocations);

      for (const [projectId, amount] of Object.entries(allocations)) {
        await tx.qfAllocation.upsert({
          where: { voteId_projectId: { voteId: existing.id, projectId } },
          create: { voteId: existing.id, projectId, amount },
          update: { amount },
        });
      }

      // Delete allocations for projects no longer in the new set
      await tx.qfAllocation.deleteMany({
        where: {
          voteId: existing.id,
          projectId: { notIn: newProjectIds },
        },
      });

      return true; // isUpdate
    }

    // New vote
    await tx.qfVote.create({
      data: {
        voterCode,
        roundId,
        allocations: {
          create: Object.entries(allocations).map(([projectId, amount]) => ({
            projectId,
            amount,
          })),
        },
      },
    });

    // Mark voter code as used
    await tx.qfVoterCode.updateMany({
      where: { roundId, code: voterCode },
      data: { used: true },
    });

    return false; // isNew
  });
}

/**
 * Close a round: update status + scalar result columns + upsert project results.
 */
export async function closeRound(
  roundId: string,
  results: CLRResults
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.qfRound.update({
      where: { id: roundId },
      data: {
        status: 'closed',
        totalRawMatch: results.totalRawMatch,
        scalingFactor: results.scalingFactor,
        matchingPoolUsed: results.matchingPoolUsed,
      },
    });

    // Delete existing project results then recreate
    await tx.qfProjectResult.deleteMany({ where: { roundId } });

    if (results.projects.length > 0) {
      await tx.qfProjectResult.createMany({
        data: results.projects.map((pr) => ({
          roundId,
          projectId: pr.projectId,
          directContributions: pr.directContributions,
          rawMatch: pr.rawMatch,
          scaledMatch: pr.scaledMatch,
          total: pr.total,
        })),
      });
    }
  });
}

/**
 * Clear a round for a specific admin.
 */
export async function clearRound(adminId?: string): Promise<void> {
  if (adminId) {
    await prisma.qfRound.deleteMany({ where: { adminId } });
  }
}

/**
 * Clear all rounds. Used for testing.
 */
export async function clearAllRounds(): Promise<void> {
  await prisma.qfRound.deleteMany({});
}

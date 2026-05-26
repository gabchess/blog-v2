/**
 * QF Simulation API End-to-End Tests
 *
 * Self-contained tests that start their own server instance.
 * Tests the Capital Constrained Liberal Radicalism (CLR) algorithm.
 *
 * Run with: pnpm --filter @octant/rest test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '@octant/db-postgres';
import { createApp } from './app.js';
import { clearAllRounds } from './state/qf-state.js';

// Test JWT configuration matching apps/rest/src/config/auth.ts
const TEST_JWT_SECRET = 'dev-secret-only-for-local-development-not-for-production';
let TEST_ADMIN_ID: string;
let TEST_ADMIN_B_ID: string;

function generateTestToken(userId: string = TEST_ADMIN_ID): string {
  return jwt.sign(
    { sub: userId },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: 'octant-api', audience: 'octant-client', expiresIn: '15m' }
  );
}

const TEST_PORT = 14001;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server: Server;

/**
 * Helper to make API requests.
 */
async function qfRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    token?: string;
  } = {}
): Promise<{ data?: T; error?: string; status: number }> {
  const headers: Record<string, string> = {};

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await response.json()) as { data?: T; error?: string };

  return { ...json, status: response.status };
}

describe('QF API E2E', () => {
  beforeAll(async () => {
    // Create real User rows for FK integrity (upsert for idempotency)
    const passwordHash = await bcrypt.hash('test-password', 4);

    const adminA = await prisma.user.upsert({
      where: { email: 'qf-test-admin-a@test.local' },
      create: {
        email: 'qf-test-admin-a@test.local',
        name: 'QF Test Admin A',
        passwordHash,
      },
      update: {},
    });
    const adminB = await prisma.user.upsert({
      where: { email: 'qf-test-admin-b@test.local' },
      create: {
        email: 'qf-test-admin-b@test.local',
        name: 'QF Test Admin B',
        passwordHash,
      },
      update: {},
    });
    TEST_ADMIN_ID = adminA.id;
    TEST_ADMIN_B_ID = adminB.id;

    const app = createApp();
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await clearAllRounds();
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'qf-test-' } },
    });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(async () => {
    await clearAllRounds(); // Reset state between tests
  });

  describe('Round Management', () => {
    it('GET /qf/rounds/current returns 404 when no round exists', async () => {
      const { error, status } = await qfRequest('/qf/rounds/current');
      expect(status).toBe(404);
      expect(error).toBe('No active round');
    });

    it('POST /qf/rounds creates a new round', async () => {
      const { data, status } = await qfRequest<{
        id: string;
        name: string;
        matchingPool: number;
        voterBudget: number;
        status: string;
        adminId: string;
      }>('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });

      expect(status).toBe(201);
      expect(data?.id).toBeDefined();
      expect(data?.name).toBe('Test Round');
      expect(data?.matchingPool).toBe(1000);
      expect(data?.voterBudget).toBe(100);
      expect(data?.status).toBe('setup');
      expect(data?.adminId).toBe(TEST_ADMIN_ID);
    });

    it('GET /qf/rounds/current returns round after creation (with auth)', async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });

      // Admin's view (with auth) returns their round regardless of status
      const { data, status } = await qfRequest<{ name: string }>('/qf/rounds/current', {
        token: generateTestToken(),
      });
      expect(status).toBe(200);
      expect(data?.name).toBe('Test Round');
    });

    it('rejects invalid round creation', async () => {
      const { error, status } = await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: '', matchingPool: -1, voterBudget: 100 },
        token: generateTestToken(),
      });

      expect(status).toBe(400);
      expect(error).toBeDefined();
    });

    it('returns 403 on unauthenticated POST /qf/rounds', async () => {
      const { error, status } = await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        // No token
      });

      expect(status).toBe(403);
      expect(error).toBe('Forbidden');
    });

    it('returns 404 when Admin B tries to modify without their own round', async () => {
      // Admin A creates a round
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin A Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Admin B tries to add a project but has no round of their own
      const { error, status } = await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project' },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });

      expect(status).toBe(404);
      expect(error).toBe('No active round');
    });

    it('Admin A and Admin B can have separate isolated rounds', async () => {
      // Admin A creates a round
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin A Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Alpha' },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Admin B creates their own round
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin B Round', matchingPool: 2000, voterBudget: 200 },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Beta' },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });

      // Verify Admin A sees only their round
      const { data: roundA } = await qfRequest<{
        name: string;
        matchingPool: number;
        projects: { name: string }[];
      }>('/qf/rounds/current', { token: generateTestToken(TEST_ADMIN_ID) });
      expect(roundA?.name).toBe('Admin A Round');
      expect(roundA?.matchingPool).toBe(1000);
      expect(roundA?.projects).toHaveLength(1);
      expect(roundA?.projects[0]?.name).toBe('Project Alpha');

      // Verify Admin B sees only their round
      const { data: roundB } = await qfRequest<{
        name: string;
        matchingPool: number;
        projects: { name: string }[];
      }>('/qf/rounds/current', { token: generateTestToken(TEST_ADMIN_B_ID) });
      expect(roundB?.name).toBe('Admin B Round');
      expect(roundB?.matchingPool).toBe(2000);
      expect(roundB?.projects).toHaveLength(1);
      expect(roundB?.projects[0]?.name).toBe('Project Beta');
    });

    it('Admin A operations do not affect Admin B round', async () => {
      // Both admins create rounds
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin A Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin B Round', matchingPool: 2000, voterBudget: 200 },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });

      // Admin A adds project and codes
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project A' },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 5 },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Admin B's round should still be empty
      const { data: roundB } = await qfRequest<{
        projects: unknown[];
        voterCodes: unknown[];
      }>('/qf/rounds/current', { token: generateTestToken(TEST_ADMIN_B_ID) });
      expect(roundB?.projects).toHaveLength(0);
      expect(roundB?.voterCodes).toHaveLength(0);

      // Admin A deletes their round
      await qfRequest('/qf/rounds/current', {
        method: 'DELETE',
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Admin B's round should still exist
      const { data: roundBAfter, status } = await qfRequest<{ name: string }>(
        '/qf/rounds/current',
        { token: generateTestToken(TEST_ADMIN_B_ID) }
      );
      expect(status).toBe(200);
      expect(roundBAfter?.name).toBe('Admin B Round');
    });
  });

  describe('Project Management', () => {
    beforeEach(async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
    });

    it('POST /qf/rounds/current/projects adds a project', async () => {
      const { data, status } = await qfRequest<{
        projects: { id: string; name: string; description: string }[];
      }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Alpha', description: 'Test project' },
        token: generateTestToken(),
      });

      expect(status).toBe(201);
      const project = data?.projects.at(-1);
      expect(project?.id).toBeDefined();
      expect(project?.name).toBe('Project Alpha');
      expect(project?.description).toBe('Test project');
    });

    it('project appears in round data', async () => {
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Alpha' },
        token: generateTestToken(),
      });

      const { data } = await qfRequest<{ projects: { name: string }[] }>('/qf/rounds/current', {
        token: generateTestToken(),
      });
      expect(data?.projects).toHaveLength(1);
      expect(data?.projects[0]?.name).toBe('Project Alpha');
    });
  });

  describe('Voter Code Generation', () => {
    beforeEach(async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
    });

    it('POST /qf/rounds/current/codes generates voter codes', async () => {
      const { data, status } = await qfRequest<{
        voterCodes: { code: string; used: boolean }[];
      }>('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 3 },
        token: generateTestToken(),
      });

      expect(status).toBe(201);
      expect(data?.voterCodes).toHaveLength(3);
      expect(data?.voterCodes[0]?.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(data?.voterCodes[0]?.used).toBe(false);
    });

    it('codes appear in round data', async () => {
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 5 },
        token: generateTestToken(),
      });

      const { data } = await qfRequest<{ voterCodes: { code: string }[] }>('/qf/rounds/current', {
        token: generateTestToken(),
      });
      expect(data?.voterCodes).toHaveLength(5);
    });
  });

  describe('Round Status Transitions', () => {
    beforeEach(async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Test Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Alpha' },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 3 },
        token: generateTestToken(),
      });
    });

    it('transitions from setup to voting', async () => {
      const { data, status } = await qfRequest<{ status: string }>('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });

      expect(status).toBe(200);
      expect(data?.status).toBe('voting');
    });

    it('prevents voting without projects', async () => {
      await clearAllRounds();
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Empty Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 1 },
        token: generateTestToken(),
      });

      const { error, status } = await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });

      expect(status).toBe(400);
      expect(error).toContain('projects');
    });

    it('prevents voting without codes', async () => {
      await clearAllRounds();
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'No Codes Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project Alpha' },
        token: generateTestToken(),
      });

      const { error, status } = await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });

      expect(status).toBe(400);
      expect(error).toContain('codes');
    });
  });

  describe('Voting', () => {
    let projectAId: string;
    let projectBId: string;
    let voterCodes: string[];

    beforeEach(async () => {
      // Create round
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Voting Test', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });

      // Add projects (API returns full round, extract project from projects array)
      const projA = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project A' },
        token: generateTestToken(),
      });
      const projB = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project B' },
        token: generateTestToken(),
      });
      projectAId = projA.data!.projects.at(-1)!.id;
      projectBId = projB.data!.projects.at(-1)!.id;

      // Generate codes (API returns full round)
      const codes = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 5 },
          token: generateTestToken(),
        }
      );
      voterCodes = codes.data!.voterCodes.map((vc) => vc.code);

      // Start voting
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });
    });

    it('POST /qf/rounds/current/votes submits a vote', async () => {
      const { data, status } = await qfRequest<{
        voterCode: string;
        allocations: Record<string, number>;
      }>('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { [projectAId]: 50, [projectBId]: 30 },
        },
      });

      expect(status).toBe(201);
      expect(data?.voterCode).toBe(voterCodes[0]);
      expect(data?.allocations[projectAId]).toBe(50);
    });

    it('marks voter code as used after voting', async () => {
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { [projectAId]: 50 },
        },
      });

      const { data } = await qfRequest<{ voterCodes: { code: string; used: boolean }[] }>(
        '/qf/rounds/current'
      );
      const usedCode = data?.voterCodes.find((vc) => vc.code === voterCodes[0]);
      expect(usedCode?.used).toBe(true);
    });

    it('allows vote update (returns 200 instead of 201)', async () => {
      // First vote
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { [projectAId]: 50 },
        },
      });

      // Update vote
      const { status } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { [projectAId]: 30, [projectBId]: 40 },
        },
      });

      expect(status).toBe(200); // Updated, not created
    });

    it('rejects invalid voter code', async () => {
      const { error, status } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: 'FAKE-CODE',
          allocations: { [projectAId]: 50 },
        },
      });

      expect(status).toBe(401);
      expect(error).toContain('Invalid voter code');
    });

    it('rejects vote exceeding budget', async () => {
      const { error, status } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { [projectAId]: 80, [projectBId]: 80 }, // 160 > 100 budget
        },
      });

      expect(status).toBe(400);
      expect(error).toContain('exceeds budget');
    });

    it('rejects vote for invalid project', async () => {
      const { error, status } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[0],
          allocations: { 'fake-project-id': 50 },
        },
      });

      expect(status).toBe(400);
      expect(error).toContain('Invalid project ID');
    });
  });

  describe('CLR Calculation', () => {
    let projectAId: string;
    let projectBId: string;
    let voterCodes: string[];

    beforeEach(async () => {
      // Create round with 1000 pool, 100 budget per voter
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'CLR Test', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });

      // Add 2 projects (API returns full round, extract project from projects array)
      const projA = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project A' },
        token: generateTestToken(),
      });
      const projB = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project B' },
        token: generateTestToken(),
      });
      projectAId = projA.data!.projects.at(-1)!.id;
      projectBId = projB.data!.projects.at(-1)!.id;

      // Generate codes (API returns full round)
      const codes = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 3 },
          token: generateTestToken(),
        }
      );
      voterCodes = codes.data!.voterCodes.map((vc) => vc.code);

      // Start voting
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });
    });

    it('should calculate correct matching for simple case', async () => {
      // 3 voters: A gets $10 from 3 voters, B gets $30 from 1 voter
      // Manual calculation:
      // Project A: (sqrt(10)+sqrt(10)+sqrt(10))^2 - 30 = (3*3.162)^2 - 30 ≈ 90 - 30 = 60
      // Project B: sqrt(30)^2 - 30 = 30 - 30 = 0 (single donor = no matching)

      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: voterCodes[0], allocations: { [projectAId]: 10 } },
      });
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: voterCodes[1], allocations: { [projectAId]: 10 } },
      });
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: voterCodes[2],
          allocations: { [projectAId]: 10, [projectBId]: 30 },
        },
      });

      // Close round
      const { data: closedRound } = await qfRequest<{
        status: string;
        results: {
          projects: {
            projectId: string;
            directContributions: number;
            rawMatch: number;
            scaledMatch: number;
            total: number;
          }[];
          scalingFactor: number;
          matchingPoolUsed: number;
        };
      }>('/qf/rounds/current/close', { method: 'POST', token: generateTestToken() });

      expect(closedRound?.status).toBe('closed');
      expect(closedRound?.results).toBeDefined();

      const resultA = closedRound?.results.projects.find((p) => p.projectId === projectAId);
      const resultB = closedRound?.results.projects.find((p) => p.projectId === projectBId);

      // Verify CLR math
      expect(resultA?.directContributions).toBe(30);
      expect(resultA?.rawMatch).toBeCloseTo(60, 0); // ~60, allow rounding
      expect(resultB?.directContributions).toBe(30);
      expect(resultB?.rawMatch).toBe(0); // Single donor = no matching

      // No scaling needed (60 < 1000 pool)
      expect(closedRound?.results.scalingFactor).toBe(1);
    });

    it('should apply capital constraint when matching exceeds pool', async () => {
      // Create a scenario where raw matching exceeds the pool
      // 3 voters each contribute $100 to project A
      // sqrt(100) = 10, sum = 30, squared = 900, minus 300 = 600 raw match
      // With 1000 pool, no scaling needed

      // Let's make a smaller pool to trigger scaling
      await clearAllRounds();
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Small Pool', matchingPool: 30, voterBudget: 100 },
        token: generateTestToken(),
      });
      const projA = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Popular Project' },
        token: generateTestToken(),
      });
      const smallPoolProjectId = projA.data!.projects.at(-1)!.id;

      const codes = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 3 },
          token: generateTestToken(),
        }
      );
      const smallPoolCodes = codes.data!.voterCodes.map((vc) => vc.code);

      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });

      // 3 voters each give $10 = raw match of ~60
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: smallPoolCodes[0], allocations: { [smallPoolProjectId]: 10 } },
      });
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: smallPoolCodes[1], allocations: { [smallPoolProjectId]: 10 } },
      });
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: smallPoolCodes[2], allocations: { [smallPoolProjectId]: 10 } },
      });

      const { data: closedRound } = await qfRequest<{
        results: {
          scalingFactor: number;
          matchingPoolUsed: number;
          totalRawMatch: number;
          projects: { scaledMatch: number; rawMatch: number }[];
        };
      }>('/qf/rounds/current/close', { method: 'POST', token: generateTestToken() });

      // Raw match ~60 > 30 pool, so scaling should be applied
      expect(closedRound?.results.scalingFactor).toBeLessThan(1);
      expect(closedRound?.results.matchingPoolUsed).toBe(30); // Pool is fully used

      const project = closedRound?.results.projects[0];
      expect(project?.scaledMatch).toBeLessThan(project?.rawMatch ?? 0);
      expect(project?.scaledMatch).toBeCloseTo(30, 0); // Scaled to pool size
    });

    it('POST /qf/rounds/current/preview shows CLR with hypothetical vote', async () => {
      // Submit one real vote
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: { voterCode: voterCodes[0], allocations: { [projectAId]: 10 } },
      });

      // Preview with another hypothetical vote
      const { data: preview } = await qfRequest<{
        projects: { projectId: string; rawMatch: number }[];
      }>('/qf/rounds/current/preview', {
        method: 'POST',
        body: { allocations: { [projectAId]: 10 } },
      });

      // With 2 voters giving $10 each:
      // (sqrt(10) + sqrt(10))^2 - 20 = (2*3.162)^2 - 20 ≈ 40 - 20 = 20
      const resultA = preview?.projects.find((p) => p.projectId === projectAId);
      expect(resultA?.rawMatch).toBeCloseTo(20, 0);
    });
  });

  describe('Edge Cases', () => {
    it('handles round with no votes', async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'No Votes', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Lonely Project' },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 1 },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });

      const { data, status } = await qfRequest<{
        results: { projects: { rawMatch: number }[] };
      }>('/qf/rounds/current/close', { method: 'POST', token: generateTestToken() });

      expect(status).toBe(200);
      expect(data?.results.projects[0]?.rawMatch).toBe(0);
    });

    it('handles single voter (no matching for single contributor)', async () => {
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Single Voter', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(),
      });
      const proj = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Test Project' },
        token: generateTestToken(),
      });
      const projectId = proj.data!.projects.at(-1)!.id;
      const codes = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 1 },
          token: generateTestToken(),
        }
      );
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(),
      });
      await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: codes.data!.voterCodes[0]!.code,
          allocations: { [projectId]: 50 },
        },
      });

      const { data } = await qfRequest<{
        results: { projects: { rawMatch: number; directContributions: number }[] };
      }>('/qf/rounds/current/close', { method: 'POST', token: generateTestToken() });

      // Single donor: (sqrt(50))^2 - 50 = 50 - 50 = 0
      expect(data?.results.projects[0]?.rawMatch).toBeCloseTo(0, 10); // Floating point precision
      expect(data?.results.projects[0]?.directContributions).toBe(50);
    });
  });

  describe('Multi-Admin Voting Isolation', () => {
    it('voter can vote on correct admin round using voter code', async () => {
      // Admin A creates a round and starts voting
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin A Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      const projA = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project A' },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      const projectAId = projA.data!.projects.at(-1)!.id;
      const codesA = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 2 },
          token: generateTestToken(TEST_ADMIN_ID),
        }
      );
      const adminACode = codesA.data!.voterCodes[0]!.code;

      // Admin B creates a separate round (stays in setup)
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Admin B Round', matchingPool: 2000, voterBudget: 200 },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });
      const projB = await qfRequest<{ projects: { id: string }[] }>('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project B' },
        token: generateTestToken(TEST_ADMIN_B_ID),
      });
      const projectBId = projB.data!.projects.at(-1)!.id;
      const codesB = await qfRequest<{ voterCodes: { code: string }[] }>(
        '/qf/rounds/current/codes',
        {
          method: 'POST',
          body: { count: 2 },
          token: generateTestToken(TEST_ADMIN_B_ID),
        }
      );
      const adminBCode = codesB.data!.voterCodes[0]!.code;

      // Start voting on Admin A's round only
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Voter with Admin A's code can vote
      const { status: voteStatus } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: adminACode,
          allocations: { [projectAId]: 50 },
        },
      });
      expect(voteStatus).toBe(201);

      // Voter with Admin B's code gets error (Admin B's round not in voting)
      const { status: voteStatusB, error } = await qfRequest('/qf/rounds/current/votes', {
        method: 'POST',
        body: {
          voterCode: adminBCode,
          allocations: { [projectBId]: 50 },
        },
      });
      expect(voteStatusB).toBe(400);
      expect(error).toBe('Voting is not open');

      // Vote appears in Admin A's round only
      const { data: roundA } = await qfRequest<{ votes: { voterCode: string }[] }>(
        '/qf/rounds/current',
        { token: generateTestToken(TEST_ADMIN_ID) }
      );
      expect(roundA?.votes).toHaveLength(1);
      expect(roundA?.votes[0]?.voterCode).toBe(adminACode);

      // Admin B's round has no votes
      const { data: roundB } = await qfRequest<{ votes: unknown[] }>('/qf/rounds/current', {
        token: generateTestToken(TEST_ADMIN_B_ID),
      });
      expect(roundB?.votes).toHaveLength(0);
    });

    it('unauthenticated GET /qf/rounds/current returns active voting round', async () => {
      // Admin A creates a round in setup
      await qfRequest('/qf/rounds', {
        method: 'POST',
        body: { name: 'Setup Round', matchingPool: 1000, voterBudget: 100 },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // No voting round available yet
      const { status: noVotingStatus, error } = await qfRequest('/qf/rounds/current');
      expect(noVotingStatus).toBe(404);
      expect(error).toBe('No active round');

      // Add project and codes, then start voting
      await qfRequest('/qf/rounds/current/projects', {
        method: 'POST',
        body: { name: 'Project' },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      await qfRequest('/qf/rounds/current/codes', {
        method: 'POST',
        body: { count: 1 },
        token: generateTestToken(TEST_ADMIN_ID),
      });
      await qfRequest('/qf/rounds/current/status', {
        method: 'POST',
        body: { status: 'voting' },
        token: generateTestToken(TEST_ADMIN_ID),
      });

      // Now unauthenticated request returns the voting round
      const { data, status } = await qfRequest<{ name: string; status: string }>(
        '/qf/rounds/current'
      );
      expect(status).toBe(200);
      expect(data?.name).toBe('Setup Round');
      expect(data?.status).toBe('voting');
    });
  });
});

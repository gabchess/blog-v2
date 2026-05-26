import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransfersData, ApprovalsData, TokenStatsData } from './types.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getRecentTransfers', () => {
  it('sends the RECENT_TRANSFERS_QUERY with first variable', async () => {
    const transfers: TransfersData = {
      transfers: [
        {
          id: '0xabc-0',
          from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
          to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
          value: '1000000000000000000',
          blockNumber: '1',
          blockTimestamp: '1700000000',
          transactionHash: '0xdef123',
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: transfers }));

    // Dynamic import so the module picks up our mocked fetch
    const { getRecentTransfers } = await import('./queries.js');
    const result = await getRecentTransfers(5);

    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]!.from).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(result.transfers[0]!.value).toBe('1000000000000000000');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ first: 5 });
    expect(body.query).toContain('transfers(first: $first');
    expect(body.query).toContain('orderBy: blockTimestamp');
    expect(body.query).toContain('orderDirection: desc');
  });

  it('defaults to first=10 when no argument given', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { transfers: [] } }));

    const { getRecentTransfers } = await import('./queries.js');
    await getRecentTransfers();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ first: 10 });
  });

  it('requests all expected transfer fields', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { transfers: [] } }));

    const { getRecentTransfers } = await import('./queries.js');
    await getRecentTransfers(1);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const query = body.query as string;
    for (const field of ['id', 'from', 'to', 'value', 'blockNumber', 'blockTimestamp', 'transactionHash']) {
      expect(query).toContain(field);
    }
  });
});

describe('getRecentApprovals', () => {
  it('sends the RECENT_APPROVALS_QUERY with first variable', async () => {
    const approvals: ApprovalsData = {
      approvals: [
        {
          id: '0xabc-1',
          owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
          spender: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
          value: '5000000000000000000',
          blockNumber: '2',
          blockTimestamp: '1700000001',
          transactionHash: '0xghi456',
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: approvals }));

    const { getRecentApprovals } = await import('./queries.js');
    const result = await getRecentApprovals(3);

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]!.owner).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(result.approvals[0]!.spender).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ first: 3 });
    expect(body.query).toContain('approvals(first: $first');
    expect(body.query).toContain('orderBy: blockTimestamp');
  });

  it('defaults to first=10 when no argument given', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { approvals: [] } }));

    const { getRecentApprovals } = await import('./queries.js');
    await getRecentApprovals();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ first: 10 });
  });

  it('requests all expected approval fields', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { approvals: [] } }));

    const { getRecentApprovals } = await import('./queries.js');
    await getRecentApprovals(1);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const query = body.query as string;
    for (const field of ['id', 'owner', 'spender', 'value', 'blockNumber', 'blockTimestamp', 'transactionHash']) {
      expect(query).toContain(field);
    }
  });
});

describe('getTokenStats', () => {
  it('sends the TOKEN_STATS_QUERY with no variables', async () => {
    const tokenStats: TokenStatsData = {
      tokenStats: {
        id: 'token-stats',
        totalSupply: '1000000000000000000000000',
        decimals: 18,
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: tokenStats }));

    const { getTokenStats } = await import('./queries.js');
    const result = await getTokenStats();

    expect(result.tokenStats).not.toBeNull();
    expect(result.tokenStats!.totalSupply).toBe('1000000000000000000000000');
    expect(result.tokenStats!.decimals).toBe(18);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain('tokenStats(id: "token-stats")');
    expect(body.query).toContain('totalSupply');
    expect(body.query).toContain('decimals');
  });

  it('handles null tokenStats (no Transfer events yet)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { tokenStats: null } }));

    const { getTokenStats } = await import('./queries.js');
    const result = await getTokenStats();

    expect(result.tokenStats).toBeNull();
  });

  it('requests all expected tokenStats fields', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { tokenStats: null } }));

    const { getTokenStats } = await import('./queries.js');
    await getTokenStats();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const query = body.query as string;
    for (const field of ['id', 'totalSupply', 'decimals']) {
      expect(query).toContain(field);
    }
  });
});

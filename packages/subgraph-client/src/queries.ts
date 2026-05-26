import type { TransfersData, ApprovalsData, TokenStatsData } from './types.js';
import { getDefaultClient } from './client.js';

export const RECENT_TRANSFERS_QUERY = `
  query RecentTransfers($first: Int!) {
    transfers(first: $first, orderBy: blockTimestamp, orderDirection: desc) {
      id
      from
      to
      value
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

export const RECENT_APPROVALS_QUERY = `
  query RecentApprovals($first: Int!) {
    approvals(first: $first, orderBy: blockTimestamp, orderDirection: desc) {
      id
      owner
      spender
      value
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

export function getRecentTransfers(first: number = 10): Promise<TransfersData> {
  return getDefaultClient().query<TransfersData>(RECENT_TRANSFERS_QUERY, { first });
}

export function getRecentApprovals(first: number = 10): Promise<ApprovalsData> {
  return getDefaultClient().query<ApprovalsData>(RECENT_APPROVALS_QUERY, { first });
}

export const TOKEN_STATS_QUERY = `
  query TokenStats {
    tokenStats(id: "token-stats") {
      id
      totalSupply
      decimals
    }
  }
`;

export function getTokenStats(): Promise<TokenStatsData> {
  return getDefaultClient().query<TokenStatsData>(TOKEN_STATS_QUERY);
}

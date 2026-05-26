export interface Transfer {
  id: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface Approval {
  id: string;
  owner: string;
  spender: string;
  value: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface SubgraphResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export interface TransfersData {
  transfers: Transfer[];
}

export interface ApprovalsData {
  approvals: Approval[];
}

export interface TokenStats {
  id: string;
  totalSupply: string;
  decimals: number;
}

export interface TokenStatsData {
  tokenStats: TokenStats | null;
}

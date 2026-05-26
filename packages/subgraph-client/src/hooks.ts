import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { TransfersData, ApprovalsData, TokenStatsData } from './types.js';
import { getRecentTransfers, getRecentApprovals, getTokenStats } from './queries.js';

export const subgraphKeys = {
  all: ['subgraph'] as const,
  transfers: (first: number) => ['subgraph', 'transfers', first] as const,
  approvals: (first: number) => ['subgraph', 'approvals', first] as const,
  tokenStats: () => ['subgraph', 'tokenStats'] as const,
};

export function useRecentTransfers(first: number = 10) {
  return useQuery<TransfersData>({
    queryKey: subgraphKeys.transfers(first),
    queryFn: () => getRecentTransfers(first),
    refetchInterval: 5_000,
  });
}

export function useRecentApprovals(first: number = 10) {
  return useQuery<ApprovalsData>({
    queryKey: subgraphKeys.approvals(first),
    queryFn: () => getRecentApprovals(first),
    refetchInterval: 5_000,
  });
}

export function useTotalSupply() {
  return useQuery<TokenStatsData>({
    queryKey: subgraphKeys.tokenStats(),
    queryFn: () => getTokenStats(),
    refetchInterval: 5_000,
  });
}

export function useInvalidateTransfers() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: subgraphKeys.all }),
    [queryClient],
  );
}

export function useInvalidateApprovals() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['subgraph', 'approvals'],
      }),
    [queryClient],
  );
}

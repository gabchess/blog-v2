import { formatEther } from 'viem';
import { useTotalSupply } from '@octant/subgraph-client';

export function TotalSupply() {
  const { data, isLoading, error } = useTotalSupply();

  if (isLoading) {
    return <span style={{ color: '#888', fontSize: '0.875rem' }}>Loading supply...</span>;
  }

  if (error) {
    return (
      <span style={{ color: '#e53e3e', fontSize: '0.875rem' }}>
        Supply unavailable
      </span>
    );
  }

  if (!data?.tokenStats) {
    return (
      <span style={{ color: '#888', fontSize: '0.875rem' }}>
        No supply data
      </span>
    );
  }

  const { totalSupply } = data.tokenStats;
  const adjusted = Number(formatEther(BigInt(totalSupply)));
  const formatted = adjusted.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.25rem 0.75rem',
        backgroundColor: '#1a1a2e',
        border: '1px solid #333',
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
        fontFamily: 'monospace',
        color: '#e0e0e0',
      }}
    >
      Total Supply: {formatted} OCT
    </span>
  );
}

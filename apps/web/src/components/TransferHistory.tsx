import { formatEther } from 'viem';
import { useRecentTransfers } from '@octant/subgraph-client';

function truncateHex(hex: string): string {
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

export function TransferHistory() {
  const { data, isLoading, error } = useRecentTransfers(20);

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Transfer History</h2>
      {isLoading && <p>Loading transfers...</p>}
      {error && (
        <p style={{ color: '#e53e3e' }}>
          Failed to load transfers: {error.message}
        </p>
      )}
      {data && data.transfers.length === 0 && (
        <p style={{ color: '#888' }}>No transfers yet.</p>
      )}
      {data && data.transfers.length > 0 && (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>From</th>
              <th style={{ padding: '0.5rem' }}>To</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Amount (OCT)</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Block</th>
              <th style={{ padding: '0.5rem' }}>Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {data.transfers.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '0.5rem' }}>{truncateHex(t.from)}</td>
                <td style={{ padding: '0.5rem' }}>{truncateHex(t.to)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                  {formatEther(BigInt(t.value))}
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{t.blockNumber}</td>
                <td style={{ padding: '0.5rem' }}>{truncateHex(t.transactionHash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

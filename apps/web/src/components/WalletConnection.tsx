import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract } from 'wagmi';
import { useAutoConnect, USDC_ADDRESS, erc20Abi } from '@octant/web3';
import { OctBalance } from './OctBalance';
import { TransferOct } from './TransferOct';

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0');
  // Trim trailing zeros but keep at least 2 decimals
  const trimmed = fracStr.replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toLocaleString()}.${trimmed}`;
}

function UsdcBalance({ address }: { address: `0x${string}` }) {
  const { data, isLoading, error } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });

  if (isLoading) return <p>Loading USDC balance…</p>;
  if (error) return <p style={{ color: '#e53e3e' }}>Failed to read USDC balance: {error.message}</p>;
  if (data == null) return null;

  return (
    <p>
      <strong>USDC Balance:</strong> {formatUsdc(data as bigint)} USDC
    </p>
  );
}

function ApproveUsdc() {
  const [spender, setSpender] = useState('');
  const [amount, setAmount] = useState('');
  const { writeContract, data: txHash, isPending, error } = useWriteContract();

  const handleApprove = () => {
    const parsed = parseFloat(amount);
    if (!spender || isNaN(parsed) || parsed < 0) return;
    const rawAmount = BigInt(Math.round(parsed * 1e6));
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender as `0x${string}`, rawAmount],
    });
  };

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid #333', paddingTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Approve USDC Spender</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Spender address (0x…)"
          value={spender}
          onChange={(e) => setSpender(e.target.value)}
          style={{ padding: '0.4rem', fontFamily: 'monospace' }}
        />
        <input
          type="number"
          placeholder="Amount (USDC)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          step="0.01"
          style={{ padding: '0.4rem' }}
        />
        <button type="button" onClick={handleApprove} disabled={isPending || !spender || !amount}>
          {isPending ? 'Approving…' : 'Approve'}
        </button>
      </div>
      {txHash && (
        <p style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>
          Tx: <code>{txHash}</code>
        </p>
      )}
      {error && <p style={{ color: '#e53e3e', marginTop: '0.5rem' }}>{error.message}</p>}
    </div>
  );
}

export function WalletConnection() {
  useAutoConnect();

  const { address, isConnected, connector, chain } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect, isPending: isDisconnecting, error: disconnectError } = useDisconnect();

  const error = connectError || disconnectError;

  const isSafeProtocolKit = connector?.id === 'safeProtocolKit';

  if (isConnected && address) {
    return (
      <div>
        <p>
          {truncateAddress(address)}{' '}
          {isSafeProtocolKit && (
            <span style={{ color: '#4ade80', fontWeight: 600, marginRight: '0.25rem' }}>(Safe Multisig)</span>
          )}
          <span style={{ color: '#666' }}>via {connector?.name ?? 'Unknown'}</span>
        </p>
        {chain && (
          <p style={{ color: '#888' }}>
            Chain: {chain.name} (ID {chain.id})
          </p>
        )}

        {chain?.id === 1 && (
          <>
            <UsdcBalance address={address as `0x${string}`} />
            <ApproveUsdc />
          </>
        )}
        <OctBalance address={address as `0x${string}`} />
        <TransferOct />

        <button
          type="button"
          onClick={() => disconnect()}
          disabled={isDisconnecting}
          style={{ marginTop: '1rem' }}
        >
          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
        </button>
        {error && <p style={{ color: '#e53e3e' }}>{error.message}</p>}
      </div>
    );
  }

  return (
    <div>
      <p>Not Connected</p>
      {connectors
        .filter((c) => c.id !== 'safe')
        .map((c) => (
          <button
            type="button"
            key={c.uid}
            onClick={() => connect({ connector: c })}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting…' : `Connect ${c.name}`}
          </button>
        ))}
      {error && <p style={{ color: '#e53e3e' }}>{error.message}</p>}
    </div>
  );
}

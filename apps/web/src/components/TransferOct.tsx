import { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { OCTANT_TOKEN_ADDRESS, octantTokenAbi } from '@octant/web3';
import { useInvalidateTransfers } from '@octant/subgraph-client';

export function TransferOct() {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const invalidateTransfers = useInvalidateTransfers();

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isConfirmed) {
      invalidateTransfers();
    }
  }, [isConfirmed, invalidateTransfers]);

  const handleTransfer = () => {
    const parsed = parseFloat(amount);
    if (!recipient || isNaN(parsed) || parsed <= 0) return;
    reset();
    writeContract({
      address: OCTANT_TOKEN_ADDRESS,
      abi: octantTokenAbi,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, parseEther(amount)],
    });
  };

  const error = writeError || receiptError;

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid #333', paddingTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Transfer OCT</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Recipient address (0x...)"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          style={{ padding: '0.4rem', fontFamily: 'monospace' }}
        />
        <input
          type="number"
          placeholder="Amount (OCT)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          step="0.01"
          style={{ padding: '0.4rem' }}
        />
        <button
          type="button"
          onClick={handleTransfer}
          disabled={isPending || isConfirming || !recipient || !amount}
        >
          {isPending ? 'Sending...' : isConfirming ? 'Confirming...' : 'Transfer'}
        </button>
      </div>
      {txHash && (
        <p style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>
          Tx: <code>{txHash}</code>
        </p>
      )}
      {isConfirmed && (
        <p style={{ marginTop: '0.25rem', color: '#4ade80' }}>Transfer confirmed!</p>
      )}
      {error && <p style={{ color: '#e53e3e', marginTop: '0.5rem' }}>{error.message}</p>}
    </div>
  );
}

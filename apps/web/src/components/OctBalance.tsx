import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { OCTANT_TOKEN_ADDRESS, octantTokenAbi } from '@octant/web3';

export function OctBalance({ address }: { address: `0x${string}` }) {
  const { data, isLoading, error } = useReadContract({
    address: OCTANT_TOKEN_ADDRESS,
    abi: octantTokenAbi,
    functionName: 'balanceOf',
    args: [address],
  });

  if (isLoading) return <p>Loading OCT balance...</p>;
  if (error) return <p style={{ color: '#e53e3e' }}>Failed to read OCT balance: {error.message}</p>;
  if (data == null) return null;

  return (
    <p>
      <strong>OCT Balance:</strong> {formatEther(data as bigint)} OCT
    </p>
  );
}

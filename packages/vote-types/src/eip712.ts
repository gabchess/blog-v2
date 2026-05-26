import type { Address, TypedDataDomain } from 'viem';

// ─── EIP-712 Type Definitions ────────────────────────────────────────────────
// These are viem-compatible typed data definitions that match the Solidity
// structs in VoteRegistry.sol. Used by:
//   - Frontend: signTypedData() for voter wallets
//   - Relayer: verifyTypedData() for signature verification
//   - Contract: EIP712._hashTypedDataV4() for on-chain recovery (future)

/**
 * EIP-712 type definitions for Vote signing.
 *
 * Aligns with octant-v2-core naming:
 *   - Allocation.amount = votingPower spent on an option (contribution)
 *   - Vote.roundId = QF voting round identifier
 *
 * Note: Allocation uses uint256 for amount (not uint128) because
 * EIP-712 signing uses the Solidity struct types. The binary blob encoding
 * separately truncates to uint128 for space efficiency.
 */
export const VOTE_TYPES = {
  Allocation: [
    { name: 'optionId', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
  ],
  Vote: [
    { name: 'roundId', type: 'bytes32' },
    { name: 'allocations', type: 'Allocation[]' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** The primary EIP-712 type for signing */
export const VOTE_PRIMARY_TYPE = 'Vote' as const;

/**
 * Builds the EIP-712 domain separator for a specific chain + registry.
 *
 * Must match the domain used by VoteRegistry.sol's EIP712 constructor:
 *   EIP712("ZKVoteRegistry", "1")
 */
export function buildVoteDomain(
  chainId: number,
  registryAddress: Address,
): TypedDataDomain {
  return {
    name: 'ZKVoteRegistry',
    version: '1',
    chainId,
    verifyingContract: registryAddress,
  };
}

/**
 * Builds the EIP-712 message value from a vote, suitable for
 * `signTypedData({ types: VOTE_TYPES, message: buildVoteMessage(...) })`.
 *
 * Strips sqrtAmount since it's not part of the signed message
 * (it's computed by the relayer after signature verification).
 */
export function buildVoteMessage(vote: {
  roundId: `0x${string}`;
  allocations: readonly { optionId: number; amount: bigint }[];
  nonce: number;
}) {
  return {
    roundId: vote.roundId,
    allocations: vote.allocations.map((a) => ({
      optionId: a.optionId,
      amount: a.amount,
    })),
    nonce: BigInt(vote.nonce),
  } as const;
}

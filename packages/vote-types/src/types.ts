import type { Address, Hex } from 'viem';

// ─── Round ───────────────────────────────────────────────────────────────────
// A "Round" is a QF voting round. Within a round, voters allocate amounts
// to options (project proposals). Don't confuse with "Proposal" which in
// octant-v2-core refers to individual projects receiving funding.

/** On-chain round lifecycle states (matches VoteRegistry.sol Status enum) */
export enum RoundStatus {
  CREATED = 0,
  OPEN = 1,
  CLOSED = 2,
  VERIFIED = 3,
  PAID_OUT = 4,
  EXPIRED = 5,
}

/** Immutable round configuration set at creation time */
export interface RoundConfig {
  readonly roundId: Hex; // bytes32
  readonly votingOpensAt: bigint; // block number
  readonly votingClosesAt: bigint; // block number
  readonly proofDeadline: bigint; // block number
  readonly numOptions: number; // 1..25 (project proposals in this round)
  readonly payoutToken: Address;
}

// ─── Vote ────────────────────────────────────────────────────────────────────

/**
 * A single allocation within a vote — how much votingPower a voter
 * assigns to one option (project proposal).
 *
 * `amount` is the votingPower spent (quadratic cost).
 * `sqrtAmount` is the effective vote weight: floor(√amount).
 * The relayer computes sqrtAmount; the zkVM verifies it.
 *
 * Aligns with ProperQF.sol's contribution model:
 *   sumContributions += amount
 *   sumSquareRoots  += sqrtAmount
 */
export interface Allocation {
  readonly optionId: number; // uint8, 0..numOptions-1
  readonly amount: bigint; // uint128, votingPower allocated
  readonly sqrtAmount: bigint; // uint128, floor(√amount)
}

/**
 * A voter's allocation for a round, before signing.
 * This is the EIP-712 message that gets signed.
 *
 * Note: EIP-712 Vote struct uses uint256 for amount and nonce
 * (Solidity struct typing), but binary encoding uses uint128/uint32
 * for space efficiency.
 */
export interface Vote {
  readonly roundId: Hex; // bytes32
  readonly allocations: readonly Allocation[];
  readonly nonce: number; // uint32
}

/**
 * A vote with the voter's address and EIP-712 signature.
 * This is what the relayer stores and packs into blobs.
 */
export interface SignedVote extends Vote {
  readonly voter: Address;
  readonly signature: Hex; // 65 bytes (r + s + v)
}

// ─── Blob ────────────────────────────────────────────────────────────────────

/**
 * 128-byte blob header — serialized at the start of every blob.
 * Contains all metadata needed to interpret the vote records that follow.
 */
export interface BlobHeader {
  readonly magic: number; // uint32, must be BLOB_MAGIC
  readonly roundId: Hex; // bytes32
  readonly batchNonce: number; // uint32, sequential per round
  readonly voteCount: number; // uint16
  readonly chainId: bigint; // uint64
  readonly registryAddress: Address; // 20 bytes
  readonly numOptions: number; // uint8, 1..25
  readonly snapshotBlock: bigint; // uint64
  readonly balanceRoot: Hex; // bytes32
}

// ─── Balance Snapshot ────────────────────────────────────────────────────────

/** Entry in the balance Merkle tree: voter address → votingPower budget */
export interface BalanceEntry {
  readonly voter: Address;
  readonly balance: bigint; // uint256 (votingPower from deposits)
}

// ─── Relayer API ─────────────────────────────────────────────────────────────

/** Request body for POST /v1/rounds/:roundId/votes */
export interface VoteSubmission {
  readonly voter: Address;
  readonly allocations: readonly {
    readonly optionId: number;
    readonly amount: string; // bigint serialized as string for JSON
  }[];
  readonly nonce: number;
  readonly signature: Hex;
}

/** Successful acceptance response */
export interface VoteAccepted {
  readonly status: 'accepted';
  readonly nonce: number;
  readonly queuePosition: number;
}

/** Rejection response */
export interface VoteRejected {
  readonly status: 'rejected';
  readonly reason: string;
  readonly detail?: string;
}

export type VoteResponse = VoteAccepted | VoteRejected;

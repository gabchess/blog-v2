import { describe, it, expect } from 'vitest';
import type { BlobHeader, SignedVote, Allocation } from '@octant/vote-types';
import {
  BLOB_MAGIC,
  BLOB_HEADER_SIZE,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
} from '@octant/vote-types';
import { VoteBlobSerializer } from '@serialization/VoteBlobSerializer';
import { IntegerSqrt } from '@math/IntegerSqrt';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROUND_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const BALANCE_ROOT = ('0x' + 'bb'.repeat(32)) as `0x${string}`;
const REGISTRY =
  '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

function makeAllocation(optionId: number, amount: bigint): Allocation {
  return { optionId, amount, sqrtAmount: IntegerSqrt.compute(amount) };
}

function makeVote(overrides: Partial<SignedVote> = {}): SignedVote {
  return {
    voter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    roundId: ROUND_ID,
    allocations: [
      makeAllocation(0, 4900n),
      makeAllocation(1, 3600n),
      makeAllocation(2, 900n),
    ],
    nonce: 1,
    signature: ('0x' + 'ab'.repeat(65)) as `0x${string}`,
    ...overrides,
  };
}

function makeHeader(
  votes: readonly SignedVote[],
  overrides: Partial<BlobHeader> = {},
): BlobHeader {
  return {
    magic: BLOB_MAGIC,
    roundId: ROUND_ID,
    batchNonce: 0,
    voteCount: votes.length,
    chainId: 31337n,
    registryAddress: REGISTRY,
    numOptions: 5,
    snapshotBlock: 42000n,
    balanceRoot: BALANCE_ROOT,
    ...overrides,
  };
}

// ─── voteByteSize ────────────────────────────────────────────────────────────

describe('VoteBlobSerializer.voteByteSize', () => {
  it('computes correct size for 1 allocation', () => {
    expect(VoteBlobSerializer.voteByteSize(1)).toBe(
      VOTE_FIXED_SIZE + ALLOCATION_SIZE,
    );
    expect(VoteBlobSerializer.voteByteSize(1)).toBe(123);
  });

  it('computes correct size for max allocations', () => {
    expect(VoteBlobSerializer.voteByteSize(25)).toBe(
      VOTE_FIXED_SIZE + 25 * ALLOCATION_SIZE,
    );
    expect(VoteBlobSerializer.voteByteSize(25)).toBe(915);
  });
});

// ─── estimateSize ────────────────────────────────────────────────────────────

describe('VoteBlobSerializer.estimateSize', () => {
  it('returns header size for empty vote list', () => {
    expect(VoteBlobSerializer.estimateSize([])).toBe(BLOB_HEADER_SIZE);
  });

  it("adds each vote's size to header", () => {
    const votes = [makeVote(), makeVote()];
    const expected =
      BLOB_HEADER_SIZE + 2 * VoteBlobSerializer.voteByteSize(3);
    expect(VoteBlobSerializer.estimateSize(votes)).toBe(expected);
  });

  it('handles variable allocation counts', () => {
    const v1 = makeVote({ allocations: [makeAllocation(0, 100n)] });
    const v2 = makeVote({
      allocations: Array.from({ length: 10 }, (_, i) =>
        makeAllocation(i, BigInt((i + 1) * 100)),
      ),
    });
    const expected =
      BLOB_HEADER_SIZE +
      VoteBlobSerializer.voteByteSize(1) +
      VoteBlobSerializer.voteByteSize(10);
    expect(VoteBlobSerializer.estimateSize([v1, v2])).toBe(expected);
  });
});

// ─── serialize error handling ────────────────────────────────────────────────

describe('VoteBlobSerializer.serialize error handling', () => {
  it('throws if vote count mismatches header', () => {
    const votes = [makeVote()];
    const header = makeHeader(votes, { voteCount: 5 });
    expect(() => VoteBlobSerializer.serialize(header, votes)).toThrow(
      'Vote count mismatch',
    );
  });

  it('throws if total size exceeds blob capacity', () => {
    const bigVote = makeVote({
      allocations: Array.from({ length: 25 }, (_, i) =>
        makeAllocation(i, 100n),
      ),
    });
    const votes = Array.from({ length: 200 }, () => bigVote);
    const header = makeHeader(votes, { voteCount: 200 });
    expect(() => VoteBlobSerializer.serialize(header, votes)).toThrow(
      'Blob overflow',
    );
  });

  it('throws on invalid signature length', () => {
    const votes = [makeVote({ signature: '0xaabb' as `0x${string}` })];
    const header = makeHeader(votes);
    expect(() => VoteBlobSerializer.serialize(header, votes)).toThrow(
      'Hex length mismatch',
    );
  });
});

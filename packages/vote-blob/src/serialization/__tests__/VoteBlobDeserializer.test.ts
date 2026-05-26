import { describe, it, expect } from 'vitest';
import type { BlobHeader, SignedVote, Allocation } from '@octant/vote-types';
import { BLOB_MAGIC, BLOB_HEADER_SIZE } from '@octant/vote-types';
import { VoteBlobSerializer } from '@serialization/VoteBlobSerializer';
import { VoteBlobDeserializer } from '@serialization/VoteBlobDeserializer';
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

// ─── deserialize ─────────────────────────────────────────────────────────────

describe('VoteBlobDeserializer.deserialize', () => {
  it('roundtrips a single vote with 3 allocations', () => {
    const votes = [makeVote()];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { header: h, votes: v } = VoteBlobDeserializer.deserialize(serialized);

    expect(h).toEqual(header);
    expect(v).toHaveLength(1);
    expect(v[0]!.voter).toBe(votes[0]!.voter);
    expect(v[0]!.nonce).toBe(votes[0]!.nonce);
    expect(v[0]!.signature).toBe(votes[0]!.signature);
    expect(v[0]!.allocations).toEqual(votes[0]!.allocations);
  });

  it('roundtrips multiple votes', () => {
    const votes = [
      makeVote({
        voter: ('0x' + '11'.repeat(20)) as `0x${string}`,
        nonce: 0,
      }),
      makeVote({
        voter: ('0x' + '22'.repeat(20)) as `0x${string}`,
        nonce: 1,
      }),
      makeVote({
        voter: ('0x' + '33'.repeat(20)) as `0x${string}`,
        nonce: 2,
      }),
    ];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(decoded[i]!.voter).toBe(votes[i]!.voter);
      expect(decoded[i]!.nonce).toBe(votes[i]!.nonce);
      expect(decoded[i]!.allocations).toEqual(votes[i]!.allocations);
      expect(decoded[i]!.signature).toBe(votes[i]!.signature);
    }
  });

  it('roundtrips a single-allocation vote', () => {
    const votes = [makeVote({ allocations: [makeAllocation(0, 100n)] })];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded[0]!.allocations).toHaveLength(1);
    expect(decoded[0]!.allocations[0]!.optionId).toBe(0);
    expect(decoded[0]!.allocations[0]!.amount).toBe(100n);
    expect(decoded[0]!.allocations[0]!.sqrtAmount).toBe(10n);
  });

  it('roundtrips max allocations (25)', () => {
    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation(i, BigInt((i + 1) * 100)),
    );
    const votes = [makeVote({ allocations })];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded[0]!.allocations).toHaveLength(25);
    for (let i = 0; i < 25; i++) {
      expect(decoded[0]!.allocations[i]!.optionId).toBe(i);
      expect(decoded[0]!.allocations[i]!.amount).toBe(allocations[i]!.amount);
      expect(decoded[0]!.allocations[i]!.sqrtAmount).toBe(
        allocations[i]!.sqrtAmount,
      );
    }
  });

  it('preserves large amount values (near uint128 max)', () => {
    const largeAmount = 2n ** 128n - 1n;
    const votes = [
      makeVote({ allocations: [makeAllocation(0, largeAmount)] }),
    ];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded[0]!.allocations[0]!.amount).toBe(largeAmount);
  });

  it('preserves zero amount', () => {
    const votes = [makeVote({ allocations: [makeAllocation(0, 0n)] })];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded[0]!.allocations[0]!.amount).toBe(0n);
    expect(decoded[0]!.allocations[0]!.sqrtAmount).toBe(0n);
  });

  it('preserves max nonce (uint32 max)', () => {
    const votes = [makeVote({ nonce: 2 ** 32 - 1 })];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } = VoteBlobDeserializer.deserialize(serialized);

    expect(decoded[0]!.nonce).toBe(2 ** 32 - 1);
  });

  it('empty blob (zero votes)', () => {
    const header = makeHeader([]);
    const serialized = VoteBlobSerializer.serialize(header, []);
    const { header: h, votes: decoded } =
      VoteBlobDeserializer.deserialize(serialized);

    expect(h.voteCount).toBe(0);
    expect(decoded).toHaveLength(0);
  });
});

// ─── deserializeWithRound ────────────────────────────────────────────────────

describe('VoteBlobDeserializer.deserializeWithRound', () => {
  it('attaches roundId from header to each vote', () => {
    const votes = [makeVote(), makeVote()];
    const header = makeHeader(votes);
    const serialized = VoteBlobSerializer.serialize(header, votes);
    const { votes: decoded } =
      VoteBlobDeserializer.deserializeWithRound(serialized);

    for (const v of decoded) {
      expect(v.roundId).toBe(ROUND_ID);
    }
  });
});

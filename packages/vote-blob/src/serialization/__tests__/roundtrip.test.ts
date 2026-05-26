import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { BlobHeader, SignedVote } from '@octant/vote-types';
import {
  BLOB_MAGIC,
  BLOB_HEADER_SIZE,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
  BLOB_USABLE_BYTES,
} from '@octant/vote-types';
import { VoteBlobSerializer } from '@serialization/VoteBlobSerializer';
import { VoteBlobDeserializer } from '@serialization/VoteBlobDeserializer';
import { IntegerSqrt } from '@math/IntegerSqrt';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROUND_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const BALANCE_ROOT = ('0x' + 'bb'.repeat(32)) as `0x${string}`;
const REGISTRY =
  '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

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

function makeVote(overrides: Partial<SignedVote> = {}): SignedVote {
  return {
    voter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    roundId: ROUND_ID,
    allocations: [
      { optionId: 0, amount: 4900n, sqrtAmount: 70n },
      { optionId: 1, amount: 3600n, sqrtAmount: 60n },
    ],
    nonce: 1,
    signature: ('0x' + 'ab'.repeat(65)) as `0x${string}`,
    ...overrides,
  };
}

// ─── Property-based roundtrip ────────────────────────────────────────────────

describe('property-based serialize/deserialize roundtrip', () => {
  const arbAllocation = fc
    .record({
      optionId: fc.integer({ min: 0, max: 24 }),
      amount: fc.bigUintN(128),
    })
    .map(({ optionId, amount }) => ({
      optionId,
      amount,
      sqrtAmount: IntegerSqrt.compute(amount),
    }));

  const arbVote = fc
    .record({
      voter: fc
        .hexaString({ minLength: 40, maxLength: 40 })
        .map((h) => `0x${h}` as `0x${string}`),
      allocations: fc.array(arbAllocation, { minLength: 1, maxLength: 10 }),
      nonce: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
      signature: fc
        .hexaString({ minLength: 130, maxLength: 130 })
        .map((h) => `0x${h}` as `0x${string}`),
    })
    .map(({ voter, allocations, nonce, signature }) => ({
      voter,
      roundId: ROUND_ID,
      allocations,
      nonce,
      signature,
    }));

  it('deserialize(serialize(votes)) preserves all vote data', () => {
    fc.assert(
      fc.property(
        fc.array(arbVote, { minLength: 1, maxLength: 20 }),
        (votes) => {
          const size =
            BLOB_HEADER_SIZE +
            votes.reduce(
              (sum, v) =>
                sum +
                VOTE_FIXED_SIZE +
                v.allocations.length * ALLOCATION_SIZE,
              0,
            );
          if (size > BLOB_USABLE_BYTES) return true;

          const header = makeHeader(votes);
          const serialized = VoteBlobSerializer.serialize(header, votes);
          const { header: h, votes: decoded } =
            VoteBlobDeserializer.deserialize(serialized);

          if (h.voteCount !== votes.length) return false;

          for (let i = 0; i < votes.length; i++) {
            const original = votes[i]!;
            const result = decoded[i]!;

            if (result.voter !== original.voter) return false;
            if (result.nonce !== original.nonce) return false;
            if (result.signature !== original.signature) return false;
            if (result.allocations.length !== original.allocations.length)
              return false;

            for (let j = 0; j < original.allocations.length; j++) {
              const oa = original.allocations[j]!;
              const ra = result.allocations[j]!;
              if (ra.optionId !== oa.optionId) return false;
              if (ra.amount !== oa.amount) return false;
              if (ra.sqrtAmount !== oa.sqrtAmount) return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('serialized blob size matches estimate', () => {
    fc.assert(
      fc.property(
        fc.array(arbVote, { minLength: 1, maxLength: 10 }),
        (votes) => {
          const size =
            BLOB_HEADER_SIZE +
            votes.reduce(
              (sum, v) =>
                sum +
                VOTE_FIXED_SIZE +
                v.allocations.length * ALLOCATION_SIZE,
              0,
            );
          if (size > BLOB_USABLE_BYTES) return true;

          const header = makeHeader(votes);
          const serialized = VoteBlobSerializer.serialize(header, votes);
          return serialized.length === VoteBlobSerializer.estimateSize(votes);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Binary determinism ──────────────────────────────────────────────────────

describe('deterministic encoding', () => {
  it('same votes produce identical bytes', () => {
    const votes = [
      makeVote({ voter: ('0x' + '11'.repeat(20)) as `0x${string}` }),
      makeVote({ voter: ('0x' + '22'.repeat(20)) as `0x${string}` }),
    ];
    const header = makeHeader(votes);

    const s1 = VoteBlobSerializer.serialize(header, votes);
    const s2 = VoteBlobSerializer.serialize(header, votes);
    expect(s1).toEqual(s2);
  });

  it('different vote order produces different bytes', () => {
    const v1 = makeVote({
      voter: ('0x' + '11'.repeat(20)) as `0x${string}`,
      nonce: 0,
    });
    const v2 = makeVote({
      voter: ('0x' + '22'.repeat(20)) as `0x${string}`,
      nonce: 1,
    });

    const header1 = makeHeader([v1, v2]);
    const header2 = makeHeader([v2, v1]);

    const s1 = VoteBlobSerializer.serialize(header1, [v1, v2]);
    const s2 = VoteBlobSerializer.serialize(header2, [v2, v1]);

    const voteData1 = s1.slice(BLOB_HEADER_SIZE);
    const voteData2 = s2.slice(BLOB_HEADER_SIZE);
    expect(voteData1).not.toEqual(voteData2);
  });
});

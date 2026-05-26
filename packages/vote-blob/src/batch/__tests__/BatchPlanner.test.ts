import { describe, it, expect } from 'vitest';
import type { SignedVote, Allocation } from '@octant/vote-types';
import {
  BLOB_HEADER_SIZE,
  BLOB_USABLE_BYTES,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
} from '@octant/vote-types';
import { BatchPlanner } from '@batch/BatchPlanner';
import { IntegerSqrt } from '@math/IntegerSqrt';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAlloc(id: number, amount: bigint): Allocation {
  return { optionId: id, amount, sqrtAmount: IntegerSqrt.compute(amount) };
}

function makeVote(numAllocs: number): SignedVote {
  return {
    voter: ('0x' + '11'.repeat(20)) as `0x${string}`,
    roundId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    allocations: Array.from({ length: numAllocs }, (_, i) =>
      makeAlloc(i, 100n),
    ),
    nonce: 0,
    signature: ('0x' + 'ab'.repeat(65)) as `0x${string}`,
  };
}

// ─── maxVotesPerBlob ─────────────────────────────────────────────────────────

describe('BatchPlanner.maxVotesPerBlob', () => {
  it('matches plan table for 1 allocation', () => {
    const result = BatchPlanner.maxVotesPerBlob(1);
    expect(result).toBe(
      Math.floor((BLOB_USABLE_BYTES - BLOB_HEADER_SIZE) / 123),
    );
  });

  it('matches plan table for 5 allocations', () => {
    const result = BatchPlanner.maxVotesPerBlob(5);
    expect(result).toBe(
      Math.floor((BLOB_USABLE_BYTES - BLOB_HEADER_SIZE) / 255),
    );
  });

  it('matches plan table for 25 allocations', () => {
    const result = BatchPlanner.maxVotesPerBlob(25);
    expect(result).toBe(
      Math.floor((BLOB_USABLE_BYTES - BLOB_HEADER_SIZE) / 915),
    );
  });

  it('always returns > 0 for valid allocation counts', () => {
    for (let n = 1; n <= 25; n++) {
      expect(BatchPlanner.maxVotesPerBlob(n)).toBeGreaterThan(0);
    }
  });
});

// ─── voteRecordSize ──────────────────────────────────────────────────────────

describe('BatchPlanner.voteRecordSize', () => {
  it('matches formula: VOTE_FIXED_SIZE + n * ALLOCATION_SIZE', () => {
    for (let n = 1; n <= 25; n++) {
      expect(BatchPlanner.voteRecordSize(n)).toBe(
        VOTE_FIXED_SIZE + n * ALLOCATION_SIZE,
      );
    }
  });
});

// ─── totalPayloadSize ────────────────────────────────────────────────────────

describe('BatchPlanner.totalPayloadSize', () => {
  it('returns header size for empty list', () => {
    expect(BatchPlanner.totalPayloadSize([])).toBe(BLOB_HEADER_SIZE);
  });

  it('sums correctly for mixed allocation sizes', () => {
    const votes = [makeVote(1), makeVote(5), makeVote(10)];
    const expected =
      BLOB_HEADER_SIZE +
      BatchPlanner.voteRecordSize(1) +
      BatchPlanner.voteRecordSize(5) +
      BatchPlanner.voteRecordSize(10);
    expect(BatchPlanner.totalPayloadSize(votes)).toBe(expected);
  });
});

// ─── shouldFlush ─────────────────────────────────────────────────────────────

describe('BatchPlanner.shouldFlush', () => {
  it('returns false for empty buffer', () => {
    expect(BatchPlanner.shouldFlush([])).toBe(false);
  });

  it('returns false for small number of votes', () => {
    const votes = [makeVote(3)];
    expect(BatchPlanner.shouldFlush(votes)).toBe(false);
  });

  it('returns true when approaching capacity', () => {
    const votesNeeded = Math.ceil(
      (BLOB_USABLE_BYTES * 0.94) / BatchPlanner.voteRecordSize(1),
    );
    const votes = Array.from({ length: votesNeeded }, () => makeVote(1));
    expect(BatchPlanner.shouldFlush(votes)).toBe(true);
  });
});

// ─── plan ────────────────────────────────────────────────────────────────────

describe('BatchPlanner.plan', () => {
  it('puts all votes in one batch when they fit', () => {
    const votes = Array.from({ length: 10 }, () => makeVote(3));
    const { batches, remaining } = BatchPlanner.plan(votes);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
    expect(remaining).toHaveLength(0);
  });

  it('splits into multiple batches when exceeding capacity', () => {
    const votesPerBlob = BatchPlanner.maxVotesPerBlob(1);
    const totalVotes = votesPerBlob + Math.floor(votesPerBlob / 2);
    const votes = Array.from({ length: totalVotes }, () => makeVote(1));
    const { batches, remaining } = BatchPlanner.plan(votes);

    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(remaining).toHaveLength(0);

    const totalInBatches = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalInBatches).toBe(totalVotes);
  });

  it('limits to MAX_BLOBS_PER_TX (6) batches', () => {
    const votesPerBlob = BatchPlanner.maxVotesPerBlob(1);
    const totalVotes = votesPerBlob * 8;
    const votes = Array.from({ length: totalVotes }, () => makeVote(1));
    const { batches, remaining } = BatchPlanner.plan(votes);

    expect(batches).toHaveLength(6);
    expect(remaining.length).toBeGreaterThan(0);

    const totalInBatches = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalInBatches + remaining.length).toBe(totalVotes);
  });

  it('handles empty input', () => {
    const { batches, remaining } = BatchPlanner.plan([]);
    expect(batches).toHaveLength(0);
    expect(remaining).toHaveLength(0);
  });

  it('each batch fits within BLOB_USABLE_BYTES', () => {
    const votes = Array.from({ length: 2000 }, () => makeVote(3));
    const { batches } = BatchPlanner.plan(votes);

    for (const batch of batches) {
      expect(BatchPlanner.totalPayloadSize(batch)).toBeLessThanOrEqual(
        BLOB_USABLE_BYTES,
      );
    }
  });
});

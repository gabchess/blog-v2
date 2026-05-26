import {
  BLOB_HEADER_SIZE,
  BLOB_USABLE_BYTES,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
  MAX_BLOBS_PER_TX,
  BATCH_CAPACITY_THRESHOLD,
} from '@octant/vote-types';
import type { SignedVote } from '@octant/vote-types';

export interface BatchPlan {
  readonly batches: readonly SignedVote[][];
  readonly remaining: readonly SignedVote[];
}

export class BatchPlanner {
  static maxVotesPerBlob(allocationsPerVote: number): number {
    const voteSize = VOTE_FIXED_SIZE + allocationsPerVote * ALLOCATION_SIZE;
    return Math.floor((BLOB_USABLE_BYTES - BLOB_HEADER_SIZE) / voteSize);
  }

  static voteRecordSize(numAllocations: number): number {
    return VOTE_FIXED_SIZE + numAllocations * ALLOCATION_SIZE;
  }

  static totalPayloadSize(votes: readonly SignedVote[]): number {
    let size = BLOB_HEADER_SIZE;
    for (const vote of votes) {
      size += BatchPlanner.voteRecordSize(vote.allocations.length);
    }
    return size;
  }

  static shouldFlush(votes: readonly SignedVote[]): boolean {
    return (
      BatchPlanner.totalPayloadSize(votes) >=
      BLOB_USABLE_BYTES * BATCH_CAPACITY_THRESHOLD
    );
  }

  /**
   * Splits a list of votes into blob-sized batches.
   * Returns at most MAX_BLOBS_PER_TX batches.
   */
  static plan(votes: readonly SignedVote[]): BatchPlan {
    const batches: SignedVote[][] = [];
    let currentBatch: SignedVote[] = [];
    let currentSize = BLOB_HEADER_SIZE;

    for (let i = 0; i < votes.length; i++) {
      const vote = votes[i]!;
      const size = BatchPlanner.voteRecordSize(vote.allocations.length);

      if (currentSize + size > BLOB_USABLE_BYTES && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = BLOB_HEADER_SIZE;

        if (batches.length >= MAX_BLOBS_PER_TX) {
          return { batches, remaining: votes.slice(i) as SignedVote[] };
        }
      }

      currentBatch.push(vote);
      currentSize += size;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return { batches, remaining: [] };
  }
}

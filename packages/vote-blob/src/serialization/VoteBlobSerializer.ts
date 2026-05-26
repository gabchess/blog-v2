import type { BlobHeader, SignedVote } from '@octant/vote-types';
import {
  BLOB_HEADER_SIZE,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
  BLOB_USABLE_BYTES,
} from '@octant/vote-types';
import { BlobHeaderCodec } from '@serialization/BlobHeaderCodec';
import { BinaryWriter } from '@serialization/BinaryWriter';

/** Signature: r(32) + s(32) + v(1) = 65 bytes */
const SIGNATURE_BYTES = 65;

export class VoteBlobSerializer {
  static serialize(
    header: BlobHeader,
    votes: readonly SignedVote[],
  ): Uint8Array {
    if (votes.length !== header.voteCount) {
      throw new Error(
        `Vote count mismatch: header says ${header.voteCount}, got ${votes.length} votes`,
      );
    }

    const totalSize = VoteBlobSerializer.estimateSize(votes);
    if (totalSize > BLOB_USABLE_BYTES) {
      throw new Error(
        `Blob overflow: ${totalSize} bytes exceeds ${BLOB_USABLE_BYTES} usable bytes`,
      );
    }

    const buf = new Uint8Array(totalSize);
    buf.set(BlobHeaderCodec.encode(header), 0);

    const w = new BinaryWriter(buf, BLOB_HEADER_SIZE);
    for (const vote of votes) {
      VoteBlobSerializer.writeVoteRecord(w, vote);
    }

    return buf;
  }

  static voteByteSize(numAllocations: number): number {
    return VOTE_FIXED_SIZE + numAllocations * ALLOCATION_SIZE;
  }

  static estimateSize(votes: readonly SignedVote[]): number {
    let total = BLOB_HEADER_SIZE;
    for (const vote of votes) {
      total += VoteBlobSerializer.voteByteSize(vote.allocations.length);
    }
    return total;
  }

  private static writeVoteRecord(w: BinaryWriter, vote: SignedVote): void {
    w.hex(vote.voter, 20)
      .uint32(vote.nonce)
      .uint8(vote.allocations.length);

    for (const alloc of vote.allocations) {
      w.uint8(alloc.optionId)
        .uint128(alloc.amount)
        .uint128(alloc.sqrtAmount);
    }

    w.hex(vote.signature, SIGNATURE_BYTES);
  }
}

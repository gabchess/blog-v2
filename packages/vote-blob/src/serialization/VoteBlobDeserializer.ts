import type { BlobHeader, SignedVote, Allocation } from "@octant/vote-types";
import { BLOB_HEADER_SIZE } from "@octant/vote-types";
import { BlobHeaderCodec } from "@serialization/BlobHeaderCodec";
import { BinaryReader } from "@serialization/BinaryReader";
import type { Address } from "viem";

/** Signature: r(32) + s(32) + v(1) = 65 bytes */
const SIGNATURE_BYTES = 65;

export interface DeserializedBlob {
  readonly header: BlobHeader;
  readonly votes: readonly SignedVote[];
}

export class VoteBlobDeserializer {
  /**
   * Deserializes a raw blob payload into header + vote records.
   * Inverse of VoteBlobSerializer.serialize().
   *
   * @throws {RangeError} if buffer is too small
   * @throws {Error} if header magic is invalid
   * @throws {Error} if buffer runs out before all votes are read
   */
  static deserialize(data: Uint8Array): DeserializedBlob {
    const header = BlobHeaderCodec.decode(data);
    const r = new BinaryReader(data, BLOB_HEADER_SIZE);

    const votes: SignedVote[] = [];
    for (let i = 0; i < header.voteCount; i++) {
      if (r.position >= data.length) {
        throw new Error(
          `Unexpected end of blob at vote ${i}/${header.voteCount} (offset ${r.position})`,
        );
      }
      votes.push(VoteBlobDeserializer.readVoteRecord(r));
    }

    return { header, votes };
  }

  /**
   * Convenience: deserialize and attach the header's roundId to each vote.
   */
  static deserializeWithRound(data: Uint8Array): DeserializedBlob {
    const { header, votes } = VoteBlobDeserializer.deserialize(data);

    const votesWithRound = votes.map((v) => ({
      ...v,
      roundId: header.roundId,
    }));

    return { header, votes: votesWithRound };
  }

  private static readVoteRecord(r: BinaryReader): SignedVote {
    const voter = r.hex(20);
    const nonce = r.uint32();
    const numAllocs = r.uint8();

    const allocations: Allocation[] = [];
    for (let j = 0; j < numAllocs; j++) {
      allocations.push({
        optionId: r.uint8(),
        amount: r.uint128(),
        sqrtAmount: r.uint128(),
      });
    }

    const signature = r.hex(SIGNATURE_BYTES);

    return {
      voter,
      roundId: "" as Address, // set by caller or from header
      allocations,
      nonce,
      signature,
    };
  }
}

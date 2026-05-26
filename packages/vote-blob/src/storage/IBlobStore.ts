import type { BlobHeader } from "@octant/vote-types";
import type { Address, Hash } from "viem";

export interface StoredBlob {
  readonly txHash: Hash;
  readonly blockNumber: bigint;
  /** Blob index within the transaction (0 for calldata, 0..5 for EIP-4844) */
  readonly blobIndex: number;
  /** KZG versioned hash for EIP-4844 blobs, undefined for calldata */
  readonly versionedHash?: Address;
  readonly data: Uint8Array;
}

/**
 * Strategy interface for storing and retrieving serialized vote blobs.
 *
 * retrieve() takes a StoredBlob reference (not just txHash) so each
 * implementation has everything it needs without extra lookups:
 * - CalldataBlobStore: only needs txHash (reads tx.input)
 * - OnChainBlobStore: needs blockNumber + versionedHash (Beacon API query)
 */
export interface IBlobStore {
  store(data: Uint8Array, header: BlobHeader): Promise<StoredBlob>;
  retrieve(ref: BlobRef): Promise<Uint8Array>;
}

/** Minimal reference needed to retrieve a stored blob. */
export interface BlobRef {
  readonly txHash: Hash;
  readonly blockNumber: bigint;
  readonly blobIndex: number;
  readonly versionedHash?: Address;
}

import type { WalletClient, PublicClient } from "viem";
import type { BlobHeader } from "@octant/vote-types";
import type { IBlobStore, StoredBlob, BlobRef } from "@storage/IBlobStore";

/**
 * Beacon API blob sidecar response shape.
 * @see https://ethereum.github.io/beacon-APIs/#/Beacon/getBlobSidecars
 */
interface BlobSidecarResponse {
  data: Array<{
    index: string;
    blob: string; // 0x-prefixed hex, 131072 bytes (128 KB)
    kzg_commitment: string;
    kzg_proof: string;
  }>;
}

/**
 * Stores serialized vote blobs on-chain via EIP-4844 blob transactions.
 *
 * Phase 1 production implementation. Requires:
 * - A chain with EIP-4844 support (Ethereum mainnet post-Dencun)
 * - A Beacon API endpoint for blob retrieval (execution layer does NOT store blob data)
 *
 * ## Blob Retrieval Architecture
 *
 * Unlike regular calldata (stored in tx.input forever), EIP-4844 blob data is:
 * - NOT in the execution layer (eth_getTransactionByHash won't have it)
 * - Stored in the beacon chain as "sidecars" separate from the block body
 * - Retrieved via Beacon API: GET /eth/v1/beacon/blob_sidecars/{block_id}
 * - Pruned after ~18 days (4096 epochs × 32 slots)
 *
 * ## Store Flow
 * 1. Encode data into blob field elements (remove high bit per 32-byte chunk)
 * 2. Generate KZG commitment + proof via c-kzg
 * 3. Send type-3 (blob) transaction with sidecar
 *
 * ## Retrieve Flow
 * 1. Get tx receipt → blockNumber
 * 2. Call Beacon API: GET /eth/v1/beacon/blob_sidecars/{blockNumber}
 * 3. Match blob by KZG commitment (tx.blobVersionedHashes)
 * 4. Decode blob field elements back to original bytes
 *
 * Note: Anvil and Tenderly Virtual TestNets do NOT support EIP-4844.
 * Use CalldataBlobStore for testing.
 */
export class OnChainBlobStore implements IBlobStore {
  constructor(
    private readonly walletClient: WalletClient,
    private readonly publicClient: PublicClient,
    private readonly beaconUrl: string,
  ) {}

  async store(_data: Uint8Array, _header: BlobHeader): Promise<StoredBlob> {
    // EIP-4844 blob transaction submission requires:
    //   1. toBlobs(data)       — split data into 128KB blob field elements
    //   2. toBlobSidecars()    — generate KZG commitments + proofs (c-kzg)
    //   3. sendTransaction()   — type 3 tx with blobs + sidecars
    //
    // Dependencies: c-kzg (native), viem blob utilities
    // Deferred until production infrastructure is ready.
    void this.walletClient;
    void this.publicClient;
    void this.beaconUrl;
    throw new Error(
      "OnChainBlobStore.store() not yet implemented — use CalldataBlobStore for testing",
    );
  }

  async retrieve(ref: BlobRef): Promise<Uint8Array> {
    // BlobRef provides blockNumber directly — no extra getTransaction call needed.
    // For EIP-4844, we use blockNumber to query the Beacon API for blob sidecars,
    // then match by blobIndex (or versionedHash for multi-blob txs).

    // Step 1: Fetch blob sidecars from Beacon API
    //   GET /eth/v1/beacon/blob_sidecars/{block_id}
    //
    // The beacon API indexes by slot, but also accepts block number/hash.
    // We use blockNumber which the beacon node resolves to the correct slot.
    const url = `${this.beaconUrl}/eth/v1/beacon/blob_sidecars/${ref.blockNumber}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Beacon API error: ${response.status} ${response.statusText} (GET ${url})`,
      );
    }

    const json = (await response.json()) as BlobSidecarResponse;

    if (!json.data?.length) {
      throw new Error(`No blob sidecars found at block ${ref.blockNumber}`);
    }

    // Step 2: Find our blob by index within the block's sidecars
    const sidecar = json.data[ref.blobIndex];
    if (!sidecar) {
      throw new Error(
        `Blob index ${ref.blobIndex} not found at block ${ref.blockNumber} (${json.data.length} sidecars available)`,
      );
    }
    const blobHex = sidecar.blob;

    // Step 3: Decode blob field elements back to raw bytes
    // EIP-4844 blobs are 131072 bytes (4096 field elements × 32 bytes).
    // Each 32-byte chunk has the high bit zeroed (field element constraint).
    // viem's fromBlobs() handles this decoding.
    //
    // For now, do a simple hex-to-bytes conversion.
    // Full field-element decoding will use viem's fromBlobs() utility.
    const hex = blobHex.startsWith("0x") ? blobHex.slice(2) : blobHex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
  }
}

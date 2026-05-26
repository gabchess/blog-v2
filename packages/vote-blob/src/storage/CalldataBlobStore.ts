import type { WalletClient, PublicClient, Address } from "viem";
import type { BlobHeader } from "@octant/vote-types";
import type { IBlobStore, StoredBlob, BlobRef } from "@storage/IBlobStore";

/**
 * Stores serialized vote blobs as regular calldata in transactions.
 *
 * This is a testing/fallback implementation that works on ANY EVM chain
 * (Anvil, Tenderly, testnets) without requiring EIP-4844 support.
 *
 * Data is stored as tx.input calldata sent to a target address.
 * retrieve() only needs ref.txHash — reads tx.input directly.
 */
export class CalldataBlobStore implements IBlobStore {
  constructor(
    private readonly walletClient: WalletClient,
    private readonly publicClient: PublicClient,
    private readonly targetAddress: Address,
  ) {}

  async store(data: Uint8Array, _header: BlobHeader): Promise<StoredBlob> {
    // Use attached local account if available, otherwise query RPC
    const account =
      this.walletClient.account ?? (await this.walletClient.getAddresses())[0];
    if (!account) {
      throw new Error("CalldataBlobStore: no account available in wallet");
    }

    // Convert bytes to hex calldata
    const hex = Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const txHash = await this.walletClient.sendTransaction({
      account,
      to: this.targetAddress,
      data: `0x${hex}`,
      value: 0n,
      chain: null,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      blobIndex: 0,
      // No versionedHash for calldata — it's not an EIP-4844 blob
      data,
    };
  }

  async retrieve(ref: BlobRef): Promise<Uint8Array> {
    // Calldata only needs txHash — data lives in tx.input
    const tx = await this.publicClient.getTransaction({ hash: ref.txHash });

    if (!tx.input || tx.input === "0x") {
      throw new Error(
        `CalldataBlobStore: transaction ${ref.txHash} has no input data`,
      );
    }

    // Strip 0x prefix and convert hex to bytes
    const hex = tx.input.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
  }
}

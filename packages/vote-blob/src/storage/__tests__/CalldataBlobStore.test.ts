import { describe, it, expect, vi } from 'vitest';
import type { BlobHeader } from '@octant/vote-types';
import { BLOB_MAGIC } from '@octant/vote-types';
import { CalldataBlobStore } from '@storage/CalldataBlobStore';

// ─── Mock clients ────────────────────────────────────────────────────────────

function makeHeader(): BlobHeader {
  return {
    magic: BLOB_MAGIC,
    roundId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    batchNonce: 0,
    voteCount: 1,
    chainId: 31337n,
    registryAddress: '0x1234567890abcdef1234567890abcdef12345678',
    numOptions: 5,
    snapshotBlock: 42000n,
    balanceRoot: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
  };
}

const TARGET = '0x0000000000000000000000000000000000000001' as `0x${string}`;
const TX_HASH =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`;
const ACCOUNT =
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as `0x${string}`;

describe('CalldataBlobStore', () => {
  it('stores data as calldata and returns StoredBlob', async () => {
    const mockWalletClient = {
      getAddresses: vi.fn().mockResolvedValue([ACCOUNT]),
      sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
    };
    const mockPublicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 100n,
        status: 'success',
      }),
    };

    const store = new CalldataBlobStore(
      mockWalletClient as any,
      mockPublicClient as any,
      TARGET,
    );

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await store.store(data, makeHeader());

    expect(result.txHash).toBe(TX_HASH);
    expect(result.blockNumber).toBe(100n);
    expect(result.data).toEqual(data);

    // Verify sendTransaction was called with correct params
    expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
      account: ACCOUNT,
      to: TARGET,
      data: '0x0102030405',
      value: 0n,
      chain: null,
    });
  });

  it('retrieves data from transaction input', async () => {
    const mockWalletClient = {
      getAddresses: vi.fn().mockResolvedValue([ACCOUNT]),
    };
    const mockPublicClient = {
      getTransaction: vi.fn().mockResolvedValue({
        input: '0x0102030405',
      }),
    };

    const store = new CalldataBlobStore(
      mockWalletClient as any,
      mockPublicClient as any,
      TARGET,
    );

    const ref = { txHash: TX_HASH, blockNumber: 100n, blobIndex: 0 };
    const result = await store.retrieve(ref);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('throws if wallet has no account', async () => {
    const mockWalletClient = {
      getAddresses: vi.fn().mockResolvedValue([]),
    };
    const mockPublicClient = {};

    const store = new CalldataBlobStore(
      mockWalletClient as any,
      mockPublicClient as any,
      TARGET,
    );

    await expect(
      store.store(new Uint8Array([1]), makeHeader()),
    ).rejects.toThrow('no account available');
  });

  it('throws if transaction has no input data', async () => {
    const mockWalletClient = {
      getAddresses: vi.fn().mockResolvedValue([ACCOUNT]),
    };
    const mockPublicClient = {
      getTransaction: vi.fn().mockResolvedValue({
        input: '0x',
      }),
    };

    const store = new CalldataBlobStore(
      mockWalletClient as any,
      mockPublicClient as any,
      TARGET,
    );

    const ref = { txHash: TX_HASH, blockNumber: 100n, blobIndex: 0 };
    await expect(store.retrieve(ref)).rejects.toThrow('no input data');
  });

  it('roundtrips data through store + retrieve mocks', async () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;

    const storedInputHex =
      '0x' + Buffer.from(data).toString('hex');

    const mockWalletClient = {
      getAddresses: vi.fn().mockResolvedValue([ACCOUNT]),
      sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
    };
    const mockPublicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 42n,
      }),
      getTransaction: vi.fn().mockResolvedValue({
        input: storedInputHex,
      }),
    };

    const store = new CalldataBlobStore(
      mockWalletClient as any,
      mockPublicClient as any,
      TARGET,
    );

    await store.store(data, makeHeader());
    const ref = { txHash: TX_HASH, blockNumber: 42n, blobIndex: 0 };
    const retrieved = await store.retrieve(ref);

    expect(retrieved).toEqual(data);
  });
});

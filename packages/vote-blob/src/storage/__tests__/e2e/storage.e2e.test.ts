import { describe, it, expect, beforeAll } from 'vitest';
import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  formatEther,
  type WalletClient,
  type PublicClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BlobHeader, SignedVote, Vote, Allocation } from '@octant/vote-types';
import { BLOB_MAGIC } from '@octant/vote-types';
import { VoteBlobSerializer } from '@serialization/VoteBlobSerializer';
import { VoteBlobDeserializer } from '@serialization/VoteBlobDeserializer';
import { IntegerSqrt } from '@math/IntegerSqrt';
import { CalldataBlobStore } from '@storage/CalldataBlobStore';
import { VoteSigner } from '@signing/VoteSigner';
import { VoteVerifier } from '@signing/VoteVerifier';

/**
 * E2E Storage Roundtrip Test
 *
 * Tests the full pipeline: serialize → store → retrieve → deserialize → verify
 *
 * Uses CalldataBlobStore against any EVM chain via RPC_URL environment variable.
 *
 * To run against Anvil:
 *   pnpm chain:dev
 *   RPC_URL=http://127.0.0.1:8545 pnpm --filter @octant/vote-blob test -- src/storage/__tests__/e2e/
 *
 * To run against Tenderly:
 *   RPC_URL=https://virtual.mainnet.rpc.tenderly.co/... pnpm --filter @octant/vote-blob test -- src/storage/__tests__/e2e/
 */

const RPC_URL = process.env['RPC_URL'];

// Anvil's first default private key — works on both Anvil and Tenderly
// (Tenderly funds any account via tenderly_setBalance)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

// Send to a dead address (just stores calldata)
const TARGET_ADDRESS =
  '0x000000000000000000000000000000000000dEaD' as `0x${string}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAllocation(optionId: number, amount: bigint): Allocation {
  return { optionId, amount, sqrtAmount: IntegerSqrt.compute(amount) };
}

function makeUnsignedVote(overrides: Partial<Vote> = {}): Vote {
  return {
    roundId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    allocations: [
      makeAllocation(0, 4900n),
      makeAllocation(1, 3600n),
      makeAllocation(2, 900n),
    ],
    nonce: 1,
    ...overrides,
  };
}

function makeHeader(
  votes: readonly SignedVote[],
  chainId: bigint,
  overrides: Partial<BlobHeader> = {},
): BlobHeader {
  return {
    magic: BLOB_MAGIC,
    roundId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    batchNonce: 0,
    voteCount: votes.length,
    chainId,
    registryAddress: '0x1234567890abcdef1234567890abcdef12345678',
    numOptions: 5,
    snapshotBlock: 42000n,
    balanceRoot: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(step: string, detail: string) {
  console.log(`  [E2E] ${step}: ${detail}`);
}

async function detectChain(rpcUrl: string): Promise<Chain> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
  });
  const json = (await response.json()) as { result: string };
  const chainId = Number(json.result);

  return defineChain({
    id: chainId,
    name: `E2E Test Chain (${chainId})`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

async function fundAccountOnTenderly(
  rpcUrl: string,
  address: `0x${string}`,
): Promise<void> {
  await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tenderly_setBalance',
      params: [[address], '0xDE0B6B3A7640000'], // 1 ETH in hex wei
      id: 1,
    }),
  });
}

// ─── E2E Tests ───────────────────────────────────────────────────────────────

// Registry address used for EIP-712 domain (matches makeHeader default)
const REGISTRY_ADDRESS =
  '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

describe.skipIf(!RPC_URL)('CalldataBlobStore E2E', () => {
  let walletClient: WalletClient;
  let publicClient: PublicClient;
  let store: CalldataBlobStore;
  let voteSigner: VoteSigner;
  let voteVerifier: VoteVerifier;
  let chainId: bigint;
  let isChainReachable = false;

  beforeAll(async () => {
    log('SETUP', `connecting to ${RPC_URL}`);

    try {
      const chain = await detectChain(RPC_URL!);
      chainId = BigInt(chain.id);
      log('SETUP', `chain detected: id=${chain.id}, name="${chain.name}"`);

      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      log('SETUP', `wallet account: ${account.address}`);

      publicClient = createPublicClient({
        chain,
        transport: http(RPC_URL),
      });

      walletClient = createWalletClient({
        account,
        chain,
        transport: http(RPC_URL),
      });

      // Fund account on Tenderly (no-op failure on Anvil is fine)
      if (chain.id !== 31337) {
        log('SETUP', `funding account via tenderly_setBalance...`);
        await fundAccountOnTenderly(RPC_URL!, account.address);
      }

      const balance = await publicClient.getBalance({ address: account.address });
      log('SETUP', `account balance: ${formatEther(balance)} ETH`);

      const blockNumber = await publicClient.getBlockNumber();
      log('SETUP', `current block: ${blockNumber}`);

      store = new CalldataBlobStore(walletClient, publicClient, TARGET_ADDRESS);
      log('SETUP', `CalldataBlobStore target: ${TARGET_ADDRESS}`);

      voteSigner = new VoteSigner(walletClient, chain.id, REGISTRY_ADDRESS);
      voteVerifier = new VoteVerifier(chain.id, REGISTRY_ADDRESS);
      log('SETUP', `VoteSigner + VoteVerifier initialized (registry=${REGISTRY_ADDRESS})`);

      isChainReachable = true;
      log('SETUP', 'ready');
    } catch (err) {
      log('SETUP', `FAILED: ${err}`);
      isChainReachable = false;
    }
  });

  it('full roundtrip: serialize → store → retrieve → deserialize → verify', async () => {
    if (!isChainReachable) {
      console.warn('Skipping E2E test: chain not reachable at ' + RPC_URL);
      return;
    }

    log('TEST 1', '── full roundtrip (3 votes, 3 allocations each) ──');

    // 1. Create and sign test votes with real EIP-712 signatures
    const votes: SignedVote[] = [];
    for (let i = 0; i < 3; i++) {
      const signed = await voteSigner.sign(makeUnsignedVote({ nonce: i }));
      votes.push(signed);
    }
    const header = makeHeader(votes, chainId);
    log('STEP 1', `signed ${votes.length} test votes, chainId=${chainId}`);

    // 2. Serialize
    const serialized = VoteBlobSerializer.serialize(header, votes);
    log('STEP 2', `serialized → ${serialized.length} bytes`);
    expect(serialized.length).toBeGreaterThan(0);

    // 3. Store on-chain as calldata
    log('STEP 3', 'sending calldata tx...');
    const stored = await store.store(serialized, header);
    log('STEP 3', `stored → txHash=${stored.txHash}`);
    log('STEP 3', `stored → blockNumber=${stored.blockNumber}`);
    expect(stored.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(stored.blockNumber).toBeGreaterThan(0n);

    // 4. Retrieve from chain — deep inspect the raw transaction
    log('RETRIEVE', `── fetching tx ${stored.txHash} from chain ──`);
    const tx = await publicClient.getTransaction({ hash: stored.txHash });
    log('RETRIEVE', `  from:       ${tx.from}`);
    log('RETRIEVE', `  to:         ${tx.to}`);
    log('RETRIEVE', `  blockHash:  ${tx.blockHash}`);
    log('RETRIEVE', `  blockNumber:${tx.blockNumber}`);
    log('RETRIEVE', `  txIndex:    ${tx.transactionIndex}`);
    log('RETRIEVE', `  nonce:      ${tx.nonce}`);
    log('RETRIEVE', `  value:      ${tx.value} wei`);
    log('RETRIEVE', `  gas:        ${tx.gas}`);
    log('RETRIEVE', `  input size: ${(tx.input.length - 2) / 2} bytes (hex chars: ${tx.input.length - 2})`);
    log('RETRIEVE', `  input head: ${tx.input.slice(0, 34)}...`);
    log('RETRIEVE', `  input tail: ...${tx.input.slice(-32)}`);

    // Now use CalldataBlobStore.retrieve() which reads tx.input
    const retrieved = await store.retrieve({
      txHash: stored.txHash,
      blockNumber: stored.blockNumber,
      blobIndex: stored.blobIndex,
    });
    log('RETRIEVE', `  decoded to: ${retrieved.length} bytes (Uint8Array)`);

    // Byte-level comparison
    const bytesMatch = retrieved.length === serialized.length &&
      retrieved.every((b, i) => b === serialized[i]);
    log('RETRIEVE', `  exact match with serialized: ${bytesMatch}`);
    if (!bytesMatch) {
      // Find first mismatch for debugging
      for (let i = 0; i < Math.max(retrieved.length, serialized.length); i++) {
        if (retrieved[i] !== serialized[i]) {
          log('RETRIEVE', `  MISMATCH at byte[${i}]: got ${retrieved[i]}, expected ${serialized[i]}`);
          break;
        }
      }
    }

    // Show magic bytes from raw retrieved data (first 4 bytes = QMV1)
    const magicHex = Array.from(retrieved.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const magicAscii = String.fromCharCode(...retrieved.slice(0, 4));
    log('RETRIEVE', `  magic bytes: 0x${magicHex} ("${magicAscii}")`);

    // 5. Deserialize
    const { header: decodedHeader, votes: decodedVotes } =
      VoteBlobDeserializer.deserializeWithRound(retrieved);
    log('STEP 5', `deserialized → header.magic=0x${decodedHeader.magic.toString(16)}, voteCount=${decodedHeader.voteCount}`);
    log('STEP 5', `deserialized → ${decodedVotes.length} votes recovered`);

    // 6. Verify header
    log('STEP 6', 'verifying header fields...');
    expect(decodedHeader.magic).toBe(header.magic);
    expect(decodedHeader.roundId).toBe(header.roundId);
    expect(decodedHeader.batchNonce).toBe(header.batchNonce);
    expect(decodedHeader.voteCount).toBe(header.voteCount);
    expect(decodedHeader.chainId).toBe(header.chainId);
    expect(decodedHeader.registryAddress).toBe(header.registryAddress);
    expect(decodedHeader.numOptions).toBe(header.numOptions);
    expect(decodedHeader.snapshotBlock).toBe(header.snapshotBlock);
    expect(decodedHeader.balanceRoot).toBe(header.balanceRoot);
    log('STEP 6', 'header verified OK');

    // 7. Verify votes
    // Note: voter addresses lose EIP-55 checksum after binary roundtrip (20 raw bytes → lowercase hex)
    log('STEP 7', 'verifying vote data...');
    expect(decodedVotes).toHaveLength(3);
    for (let i = 0; i < votes.length; i++) {
      expect(decodedVotes[i]!.voter.toLowerCase()).toBe(votes[i]!.voter.toLowerCase());
      expect(decodedVotes[i]!.nonce).toBe(votes[i]!.nonce);
      expect(decodedVotes[i]!.signature).toBe(votes[i]!.signature);
      expect(decodedVotes[i]!.allocations).toEqual(votes[i]!.allocations);
      log('STEP 7', `  vote[${i}]: voter=${decodedVotes[i]!.voter.slice(0, 10)}... nonce=${decodedVotes[i]!.nonce} allocs=${decodedVotes[i]!.allocations.length} sig=${decodedVotes[i]!.signature.slice(0, 10)}... ✓`);
    }
    log('STEP 7', 'all votes verified OK');

    // 8. Verify EIP-712 signatures — proves each vote was signed by voter
    log('STEP 8', 'verifying EIP-712 signatures...');
    const results = await voteVerifier.verifyAll(decodedVotes);
    for (let i = 0; i < results.length; i++) {
      expect(results[i]!.valid).toBe(true);
      log('STEP 8', `  vote[${i}]: signature valid for voter=${results[i]!.vote.voter.slice(0, 10)}... ✓`);
    }
    log('STEP 8', 'all signatures verified OK');
  });

  it('roundtrip with single vote and single allocation', async () => {
    if (!isChainReachable) {
      console.warn('Skipping E2E test: chain not reachable at ' + RPC_URL);
      return;
    }

    log('TEST 2', '── single vote, 1 allocation (amount=10000) ──');

    const signed = await voteSigner.sign(
      makeUnsignedVote({ allocations: [makeAllocation(0, 10000n)] }),
    );
    const votes = [signed];
    const header = makeHeader(votes, chainId);

    const serialized = VoteBlobSerializer.serialize(header, votes);
    log('STEP 1', `serialized → ${serialized.length} bytes`);

    log('STEP 2', 'sending calldata tx...');
    const stored = await store.store(serialized, header);
    log('STEP 2', `txHash=${stored.txHash}`);
    log('STEP 2', `blockNumber=${stored.blockNumber}`);

    log('RETRIEVE', `fetching tx ${stored.txHash} from chain...`);
    const tx2 = await publicClient.getTransaction({ hash: stored.txHash });
    log('RETRIEVE', `  from: ${tx2.from}  to: ${tx2.to}`);
    log('RETRIEVE', `  blockNumber: ${tx2.blockNumber}  input size: ${(tx2.input.length - 2) / 2} bytes`);
    log('RETRIEVE', `  input head: ${tx2.input.slice(0, 34)}...`);

    const retrieved = await store.retrieve({
      txHash: stored.txHash,
      blockNumber: stored.blockNumber,
      blobIndex: stored.blobIndex,
    });
    log('RETRIEVE', `  decoded → ${retrieved.length} bytes, match: ${retrieved.length === serialized.length}`);

    const { votes: decoded } = VoteBlobDeserializer.deserialize(retrieved);
    log('STEP 4', `deserialized → ${decoded.length} vote(s)`);
    log('STEP 4', `  amount=${decoded[0]!.allocations[0]!.amount}, sqrtAmount=${decoded[0]!.allocations[0]!.sqrtAmount}`);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.allocations[0]!.amount).toBe(10000n);
    expect(decoded[0]!.allocations[0]!.sqrtAmount).toBe(100n);
    log('STEP 4', 'verified: sqrt(10000) = 100 ✓');
  });

  it('roundtrip with max allocations per vote', async () => {
    if (!isChainReachable) {
      console.warn('Skipping E2E test: chain not reachable at ' + RPC_URL);
      return;
    }

    log('TEST 3', '── 1 vote, 25 allocations (max) ──');

    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation(i, BigInt((i + 1) * 100)),
    );
    const signed = await voteSigner.sign(makeUnsignedVote({ allocations }));
    const votes = [signed];
    const header = makeHeader(votes, chainId);

    const serialized = VoteBlobSerializer.serialize(header, votes);
    log('STEP 1', `serialized → ${serialized.length} bytes (25 allocations = big payload)`);

    log('STEP 2', 'sending calldata tx...');
    const stored = await store.store(serialized, header);
    log('STEP 2', `txHash=${stored.txHash}`);
    log('STEP 2', `blockNumber=${stored.blockNumber}`);

    log('RETRIEVE', `fetching tx ${stored.txHash} from chain...`);
    const tx3 = await publicClient.getTransaction({ hash: stored.txHash });
    log('RETRIEVE', `  from: ${tx3.from}  to: ${tx3.to}`);
    log('RETRIEVE', `  blockNumber: ${tx3.blockNumber}  input size: ${(tx3.input.length - 2) / 2} bytes`);
    log('RETRIEVE', `  input head: ${tx3.input.slice(0, 34)}...`);
    log('RETRIEVE', `  input tail: ...${tx3.input.slice(-32)}`);

    const retrieved = await store.retrieve({
      txHash: stored.txHash,
      blockNumber: stored.blockNumber,
      blobIndex: stored.blobIndex,
    });
    log('RETRIEVE', `  decoded → ${retrieved.length} bytes, match: ${retrieved.length === serialized.length}`);

    const { votes: decoded } = VoteBlobDeserializer.deserialize(retrieved);
    log('STEP 4', `deserialized → ${decoded[0]!.allocations.length} allocations`);

    expect(decoded[0]!.allocations).toHaveLength(25);
    for (let i = 0; i < 25; i++) {
      expect(decoded[0]!.allocations[i]!.optionId).toBe(i);
      expect(decoded[0]!.allocations[i]!.amount).toBe(allocations[i]!.amount);
    }

    log('STEP 4', 'allocation sample:');
    for (const i of [0, 12, 24]) {
      const a = decoded[0]!.allocations[i]!;
      log('STEP 4', `  [${i}] optionId=${a.optionId} amount=${a.amount} sqrt=${a.sqrtAmount} ✓`);
    }
    log('STEP 4', 'all 25 allocations verified OK');
  });
});

import { describe, it, expect } from 'vitest';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { Vote, Allocation } from '@octant/vote-types';
import { IntegerSqrt } from '@math/IntegerSqrt';
import { VoteSigner } from '@signing/VoteSigner';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const REGISTRY_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const;
const CHAIN_ID = 31337;

function makeAllocation(optionId: number, amount: bigint): Allocation {
  return { optionId, amount, sqrtAmount: IntegerSqrt.compute(amount) };
}

function makeVote(): Vote {
  return {
    roundId: ('0x' + 'aa'.repeat(32)) as Hex,
    allocations: [
      makeAllocation(0, 4900n),
      makeAllocation(1, 3600n),
    ],
    nonce: 1,
  };
}

describe('VoteSigner', () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(),
  });
  const signer = new VoteSigner(walletClient, CHAIN_ID, REGISTRY_ADDRESS);

  it('produces a 65-byte hex signature', async () => {
    const signed = await signer.sign(makeVote());

    // 65 bytes = 130 hex chars + 0x prefix
    expect(signed.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });

  it('sets voter from wallet account', async () => {
    const signed = await signer.sign(makeVote());

    expect(signed.voter.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('preserves vote fields', async () => {
    const vote = makeVote();
    const signed = await signer.sign(vote);

    expect(signed.roundId).toBe(vote.roundId);
    expect(signed.nonce).toBe(vote.nonce);
    expect(signed.allocations).toHaveLength(vote.allocations.length);
    for (let i = 0; i < vote.allocations.length; i++) {
      expect(signed.allocations[i]!.optionId).toBe(vote.allocations[i]!.optionId);
      expect(signed.allocations[i]!.amount).toBe(vote.allocations[i]!.amount);
      expect(signed.allocations[i]!.sqrtAmount).toBe(vote.allocations[i]!.sqrtAmount);
    }
  });

  it('computes sqrtAmount when zero', async () => {
    const vote: Vote = {
      roundId: ('0x' + 'aa'.repeat(32)) as Hex,
      allocations: [{ optionId: 0, amount: 10000n, sqrtAmount: 0n }],
      nonce: 0,
    };

    const signed = await signer.sign(vote);

    expect(signed.allocations[0]!.sqrtAmount).toBe(100n);
  });

  it('produces deterministic signatures for same input', async () => {
    const vote = makeVote();
    const sig1 = await signer.sign(vote);
    const sig2 = await signer.sign(vote);

    expect(sig1.signature).toBe(sig2.signature);
  });

  it('produces different signatures for different nonces', async () => {
    const vote1 = { ...makeVote(), nonce: 1 };
    const vote2 = { ...makeVote(), nonce: 2 };

    const signed1 = await signer.sign(vote1);
    const signed2 = await signer.sign(vote2);

    expect(signed1.signature).not.toBe(signed2.signature);
  });
});

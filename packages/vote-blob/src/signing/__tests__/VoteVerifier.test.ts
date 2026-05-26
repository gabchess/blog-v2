import { describe, it, expect } from 'vitest';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { Vote, Allocation } from '@octant/vote-types';
import { IntegerSqrt } from '@math/IntegerSqrt';
import { VoteSigner } from '@signing/VoteSigner';
import { VoteVerifier } from '@signing/VoteVerifier';

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
      makeAllocation(2, 900n),
    ],
    nonce: 1,
  };
}

describe('VoteVerifier', () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(),
  });
  const signer = new VoteSigner(walletClient, CHAIN_ID, REGISTRY_ADDRESS);
  const verifier = new VoteVerifier(CHAIN_ID, REGISTRY_ADDRESS);

  it('returns true for a correctly signed vote', async () => {
    const signed = await signer.sign(makeVote());

    const valid = await verifier.verify(signed);

    expect(valid).toBe(true);
  });

  it('returns false when voter address is tampered', async () => {
    const signed = await signer.sign(makeVote());
    const tampered = {
      ...signed,
      voter: '0x0000000000000000000000000000000000000001' as const,
    };

    const valid = await verifier.verify(tampered);

    expect(valid).toBe(false);
  });

  it('returns false when signature is tampered', async () => {
    const signed = await signer.sign(makeVote());
    const tampered = {
      ...signed,
      signature: ('0x' + 'ff'.repeat(65)) as Hex,
    };

    const valid = await verifier.verify(tampered);

    expect(valid).toBe(false);
  });

  it('returns false when vote data is tampered', async () => {
    const signed = await signer.sign(makeVote());
    const tampered = {
      ...signed,
      nonce: signed.nonce + 1,
    };

    const valid = await verifier.verify(tampered);

    expect(valid).toBe(false);
  });

  it('returns false with wrong chain ID', async () => {
    const signed = await signer.sign(makeVote());
    const wrongChainVerifier = new VoteVerifier(1, REGISTRY_ADDRESS);

    const valid = await wrongChainVerifier.verify(signed);

    expect(valid).toBe(false);
  });

  it('returns false with wrong registry address', async () => {
    const signed = await signer.sign(makeVote());
    const wrongRegistryVerifier = new VoteVerifier(
      CHAIN_ID,
      '0x0000000000000000000000000000000000000001',
    );

    const valid = await wrongRegistryVerifier.verify(signed);

    expect(valid).toBe(false);
  });

  describe('verifyAll', () => {
    it('verifies multiple votes', async () => {
      const vote1 = await signer.sign({ ...makeVote(), nonce: 1 });
      const vote2 = await signer.sign({ ...makeVote(), nonce: 2 });
      const vote3 = await signer.sign({ ...makeVote(), nonce: 3 });

      const results = await verifier.verifyAll([vote1, vote2, vote3]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.valid)).toBe(true);
    });

    it('identifies invalid votes in a batch', async () => {
      const valid = await signer.sign(makeVote());
      const tampered = {
        ...valid,
        voter: '0x0000000000000000000000000000000000000001' as const,
      };

      const results = await verifier.verifyAll([valid, tampered]);

      expect(results[0]!.valid).toBe(true);
      expect(results[1]!.valid).toBe(false);
    });

    it('returns empty array for empty input', async () => {
      const results = await verifier.verifyAll([]);

      expect(results).toEqual([]);
    });
  });

  it('works with a different signer key', async () => {
    const otherKey = generatePrivateKey();
    const otherAccount = privateKeyToAccount(otherKey);
    const otherWallet = createWalletClient({
      account: otherAccount,
      chain: foundry,
      transport: http(),
    });
    const otherSigner = new VoteSigner(otherWallet, CHAIN_ID, REGISTRY_ADDRESS);

    const signed = await otherSigner.sign(makeVote());
    const valid = await verifier.verify(signed);

    expect(valid).toBe(true);
    expect(signed.voter.toLowerCase()).toBe(otherAccount.address.toLowerCase());
  });
});

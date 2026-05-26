import { verifyTypedData as verifyTypedDataPure } from 'viem';
import type { Address, PublicClient } from 'viem';
import type { SignedVote } from '@octant/vote-types';
import {
  VOTE_TYPES,
  VOTE_PRIMARY_TYPE,
  buildVoteDomain,
  buildVoteMessage,
} from '@octant/vote-types';

export interface VerificationResult {
  readonly vote: SignedVote;
  readonly valid: boolean;
}

/**
 * Verifies EIP-712 signatures on SignedVote objects.
 *
 * Supports two modes:
 * - **Without PublicClient**: ECDSA-only verification (ecrecover). Fast, no RPC calls.
 * - **With PublicClient**: ECDSA first, then falls back to EIP-1271 on-chain
 *   `isValidSignature` for smart-contract wallets (Safe, Argent, etc.).
 */
export class VoteVerifier {
  private readonly publicClient?: PublicClient;

  constructor(
    private readonly chainId: number,
    private readonly registryAddress: Address,
    publicClient?: PublicClient,
  ) {
    this.publicClient = publicClient;
  }

  /** Returns true if the signature was produced by vote.voter. */
  async verify(vote: SignedVote): Promise<boolean> {
    const domain = buildVoteDomain(this.chainId, this.registryAddress);
    const message = buildVoteMessage(vote);

    const params = {
      address: vote.voter,
      domain,
      types: VOTE_TYPES,
      primaryType: VOTE_PRIMARY_TYPE,
      message,
      signature: vote.signature,
    } as const;

    try {
      if (this.publicClient) {
        // Tries ECDSA first, then EIP-1271 on-chain for contract wallets
        return await this.publicClient.verifyTypedData(params);
      }
      // Pure ECDSA recovery (no RPC needed)
      return await verifyTypedDataPure(params);
    } catch {
      // Invalid signature bytes — treat as invalid
      return false;
    }
  }

  /** Verifies all votes, returning a result per vote. */
  async verifyAll(votes: readonly SignedVote[]): Promise<VerificationResult[]> {
    return Promise.all(
      votes.map(async (vote) => ({
        vote,
        valid: await this.verify(vote),
      })),
    );
  }
}

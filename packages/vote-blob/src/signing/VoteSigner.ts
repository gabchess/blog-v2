import type { Address, WalletClient } from "viem";
import type { Vote, SignedVote } from "@octant/vote-types";
import {
  VOTE_TYPES,
  VOTE_PRIMARY_TYPE,
  buildVoteDomain,
  buildVoteMessage,
} from "@octant/vote-types";
import { IntegerSqrt } from "@math/IntegerSqrt";

/**
 * Signs a Vote using EIP-712 typed data via a viem WalletClient.
 *
 * Produces a SignedVote with a real cryptographic signature that can be
 * verified on-chain or off-chain using VoteVerifier.
 *
 * The WalletClient must have an account attached (created with `account` option).
 */
export class VoteSigner {
  constructor(
    private readonly walletClient: WalletClient,
    private readonly chainId: number,
    private readonly registryAddress: Address,
  ) {
    if (!walletClient.account) {
      throw new Error("VoteSigner requires a WalletClient with an account");
    }
  }

  /**
   * Signs a vote, returning a SignedVote with the wallet's EIP-712 signature.
   *
   * - Computes sqrtAmount for any allocation missing it
   * - Sets voter from the wallet account address
   * - Produces a 65-byte ECDSA signature (r + s + v)
   */
  async sign(vote: Vote): Promise<SignedVote> {
    const account = this.walletClient.account!;

    const allocations = vote.allocations.map((a) => ({
      optionId: a.optionId,
      amount: a.amount,
      sqrtAmount:
        a.sqrtAmount > 0n ? a.sqrtAmount : IntegerSqrt.compute(a.amount),
    }));

    const domain = buildVoteDomain(this.chainId, this.registryAddress);
    const message = buildVoteMessage({ ...vote, allocations });

    const signature = await this.walletClient.signTypedData({
      account,
      domain,
      types: VOTE_TYPES,
      primaryType: VOTE_PRIMARY_TYPE,
      message,
    });

    return {
      roundId: vote.roundId,
      allocations,
      nonce: vote.nonce,
      voter: account.address,
      signature,
    };
  }
}

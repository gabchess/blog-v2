import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { BalanceEntry } from "@octant/vote-types";
import type { Address } from "viem";

/** Leaf encoding: [address, uint256] — compatible with OZ MerkleProof.verify() */
const LEAF_ENCODING: string[] = ["address", "uint256"];

type TreeDump = ReturnType<StandardMerkleTree<[string, string]>["dump"]>;

export class BalanceMerkleTree {
  readonly root: Address;
  readonly length: number;

  private readonly tree: StandardMerkleTree<[string, string]>;
  private readonly voterIndex: Map<string, number>;

  private constructor(tree: StandardMerkleTree<[string, string]>) {
    this.tree = tree;
    this.voterIndex = new Map<string, number>();
    for (const [i, value] of tree.entries()) {
      this.voterIndex.set(value[0]!.toLowerCase(), i);
    }
    this.root = tree.root as Address;
    this.length = this.voterIndex.size;
  }

  /**
   * Builds a Merkle tree from balance entries.
   * @throws {Error} if entries contain duplicate voters
   */
  static build(entries: readonly BalanceEntry[]): BalanceMerkleTree {
    const seen = new Set<string>();
    for (const entry of entries) {
      const normalized = entry.voter.toLowerCase();
      if (seen.has(normalized)) {
        throw new Error(`Duplicate voter in balance tree: ${entry.voter}`);
      }
      seen.add(normalized);
    }

    const values: [string, string][] = entries.map((e) => [
      e.voter,
      e.balance.toString(),
    ]);

    return new BalanceMerkleTree(StandardMerkleTree.of(values, LEAF_ENCODING));
  }

  /** Restores a BalanceMerkleTree from a serialized dump. */
  static load(dump: TreeDump): BalanceMerkleTree {
    return new BalanceMerkleTree(StandardMerkleTree.load(dump));
  }

  /** Verifies that a voter's balance is part of the tree with the given root. */
  static verify(
    root: Address,
    voter: Address,
    balance: bigint,
    proof: readonly Address[],
  ): boolean {
    return StandardMerkleTree.verify(
      root,
      LEAF_ENCODING,
      [voter, balance.toString()],
      proof as string[],
    );
  }

  /** Get the Merkle proof for a given voter. */
  getProof(voter: Address): readonly Address[] {
    const index = this.voterIndex.get(voter.toLowerCase());
    if (index === undefined) {
      throw new Error(`Voter not found in balance tree: ${voter}`);
    }
    return this.tree.getProof(index) as Address[];
  }

  /** Get the balance for a given voter (or undefined if not in tree). */
  getBalance(voter: Address): bigint | undefined {
    const index = this.voterIndex.get(voter.toLowerCase());
    if (index === undefined) return undefined;
    const leaf = this.tree.at(index) as [string, string];
    return BigInt(leaf[1]);
  }

  /** Serializable tree dump for persistence/transport. */
  dump(): TreeDump {
    return this.tree.dump();
  }
}

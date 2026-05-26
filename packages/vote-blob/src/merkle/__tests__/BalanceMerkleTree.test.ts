import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { BalanceEntry } from "@octant/vote-types";
import { BalanceMerkleTree } from "@merkle/BalanceMerkleTree";
import type { Address } from "viem";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEntry(index: number, balance: bigint): BalanceEntry {
  const addr = "0x" + index.toString(16).padStart(40, "0");
  return { voter: addr as Address, balance };
}

function makeEntries(count: number): BalanceEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry(i + 1, BigInt((i + 1) * 1000)),
  );
}

// ─── build ──────────────────────────────────────────────────────────────────

describe("BalanceMerkleTree.build", () => {
  it("builds tree from entries", () => {
    const entries = makeEntries(5);
    const tree = BalanceMerkleTree.build(entries);

    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tree.length).toBe(5);
  });

  it("produces a deterministic root for same entries", () => {
    const entries = makeEntries(10);
    const root1 = BalanceMerkleTree.build(entries).root;
    const root2 = BalanceMerkleTree.build(entries).root;
    expect(root1).toBe(root2);
  });

  it("produces different roots for different entries", () => {
    const entries1 = makeEntries(3);
    const entries2 = [...makeEntries(2), makeEntry(3, 999999n)];
    expect(BalanceMerkleTree.build(entries1).root).not.toBe(
      BalanceMerkleTree.build(entries2).root,
    );
  });

  it("throws on duplicate voters", () => {
    const entries: BalanceEntry[] = [makeEntry(1, 1000n), makeEntry(1, 2000n)];
    expect(() => BalanceMerkleTree.build(entries)).toThrow("Duplicate voter");
  });

  it("handles case-insensitive duplicate detection", () => {
    const entries: BalanceEntry[] = [
      {
        voter: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        balance: 100n,
      },
      {
        voter: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        balance: 200n,
      },
    ];
    expect(() => BalanceMerkleTree.build(entries)).toThrow("Duplicate voter");
  });

  it("handles single entry", () => {
    const entries = [makeEntry(1, 5000n)];
    const tree = BalanceMerkleTree.build(entries);
    expect(tree.length).toBe(1);
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ─── Proof generation + verification ─────────────────────────────────────────

describe("proof generation and verification", () => {
  it("generates valid proof for each entry", () => {
    const entries = makeEntries(10);
    const tree = BalanceMerkleTree.build(entries);

    for (const entry of entries) {
      const proof = tree.getProof(entry.voter);
      expect(proof.length).toBeGreaterThan(0);

      const valid = BalanceMerkleTree.verify(
        tree.root,
        entry.voter,
        entry.balance,
        proof,
      );
      expect(valid).toBe(true);
    }
  });

  it("rejects proof with wrong balance", () => {
    const entries = makeEntries(5);
    const tree = BalanceMerkleTree.build(entries);

    const proof = tree.getProof(entries[0]!.voter);
    const valid = BalanceMerkleTree.verify(
      tree.root,
      entries[0]!.voter,
      entries[0]!.balance + 1n,
      proof,
    );
    expect(valid).toBe(false);
  });

  it("rejects proof with wrong voter", () => {
    const entries = makeEntries(5);
    const tree = BalanceMerkleTree.build(entries);

    const proof = tree.getProof(entries[0]!.voter);
    const valid = BalanceMerkleTree.verify(
      tree.root,
      entries[1]!.voter,
      entries[0]!.balance,
      proof,
    );
    expect(valid).toBe(false);
  });

  it("rejects proof with wrong root", () => {
    const entries = makeEntries(5);
    const tree = BalanceMerkleTree.build(entries);

    const proof = tree.getProof(entries[0]!.voter);
    const fakeRoot = ("0x" + "ff".repeat(32)) as Address;
    const valid = BalanceMerkleTree.verify(
      fakeRoot,
      entries[0]!.voter,
      entries[0]!.balance,
      proof,
    );
    expect(valid).toBe(false);
  });

  it("throws when getting proof for non-existent voter", () => {
    const tree = BalanceMerkleTree.build(makeEntries(5));
    const nonExistent = ("0x" + "ff".repeat(20)) as Address;
    expect(() => tree.getProof(nonExistent)).toThrow("Voter not found");
  });
});

// ─── getBalance ──────────────────────────────────────────────────────────────

describe("getBalance", () => {
  it("returns correct balance for each voter", () => {
    const entries = makeEntries(5);
    const tree = BalanceMerkleTree.build(entries);

    for (const entry of entries) {
      expect(tree.getBalance(entry.voter)).toBe(entry.balance);
    }
  });

  it("returns undefined for non-existent voter", () => {
    const tree = BalanceMerkleTree.build(makeEntries(3));
    const nonExistent = ("0x" + "ff".repeat(20)) as Address;
    expect(tree.getBalance(nonExistent)).toBeUndefined();
  });
});

// ─── dump / load roundtrip ──────────────────────────────────────────────────

describe("dump / load", () => {
  it("roundtrips via dump and load", () => {
    const entries = makeEntries(10);
    const tree = BalanceMerkleTree.build(entries);
    const dumped = tree.dump();
    const loaded = BalanceMerkleTree.load(dumped);

    expect(loaded.root).toBe(tree.root);
    expect(loaded.length).toBe(tree.length);

    for (const entry of entries) {
      expect(loaded.getBalance(entry.voter)).toBe(entry.balance);

      const proof = loaded.getProof(entry.voter);
      expect(
        BalanceMerkleTree.verify(
          loaded.root,
          entry.voter,
          entry.balance,
          proof,
        ),
      ).toBe(true);
    }
  });

  it("dump is JSON-serializable", () => {
    const tree = BalanceMerkleTree.build(makeEntries(5));
    const dumped = tree.dump();
    const json = JSON.stringify(dumped);
    const parsed = JSON.parse(json);
    const loaded = BalanceMerkleTree.load(parsed);
    expect(loaded.root).toBe(tree.root);
  });
});

// ─── Property-based ──────────────────────────────────────────────────────────

describe("property-based Merkle tree", () => {
  const arbAddress = fc
    .hexaString({ minLength: 40, maxLength: 40 })
    .map((h) => `0x${h}` as Address);

  const arbEntry = fc.record({
    voter: arbAddress,
    balance: fc.bigUintN(128),
  });

  it("all proofs verify for any set of entries", () => {
    fc.assert(
      fc.property(
        fc
          .array(arbEntry, { minLength: 1, maxLength: 50 })
          .map((entries) => {
            const seen = new Set<string>();
            return entries.filter((e) => {
              const k = e.voter.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          })
          .filter((entries) => entries.length > 0),
        (entries) => {
          const tree = BalanceMerkleTree.build(entries);

          for (const entry of entries) {
            const proof = tree.getProof(entry.voter);
            if (
              !BalanceMerkleTree.verify(
                tree.root,
                entry.voter,
                entry.balance,
                proof,
              )
            ) {
              return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("modified balance invalidates proof", () => {
    fc.assert(
      fc.property(
        fc
          .array(arbEntry, { minLength: 2, maxLength: 20 })
          .map((entries) => {
            const seen = new Set<string>();
            return entries.filter((e) => {
              const k = e.voter.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          })
          .filter((entries) => entries.length >= 2),
        (entries) => {
          const tree = BalanceMerkleTree.build(entries);
          const target = entries[0]!;
          const proof = tree.getProof(target.voter);

          const wrongBalance = target.balance + 1n;
          return !BalanceMerkleTree.verify(
            tree.root,
            target.voter,
            wrongBalance,
            proof,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

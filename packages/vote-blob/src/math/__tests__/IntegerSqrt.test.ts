import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { IntegerSqrt } from "@math/IntegerSqrt";

describe("IntegerSqrt.compute", () => {
  it.each([
    [0n, 0n],
    [1n, 1n],
    [2n, 1n],
    [3n, 1n],
    [4n, 2n],
    [8n, 2n],
    [9n, 3n],
    [15n, 3n],
    [16n, 4n],
    [25n, 5n],
    [36n, 6n],
    [49n, 7n],
    [100n, 10n],
    [10000n, 100n],
    [999999n, 999n],
    [1000000n, 1000n],
  ])("compute(%d) = %d", (input, expected) => {
    expect(IntegerSqrt.compute(input)).toBe(expected);
  });

  it("handles large numbers (uint128 range)", () => {
    const large = 2n ** 128n - 1n;
    const result = IntegerSqrt.compute(large);
    expect(result * result).toBeLessThanOrEqual(large);
    expect((result + 1n) * (result + 1n)).toBeGreaterThan(large);
  });

  it("handles perfect squares at uint128 boundary", () => {
    const base = 2n ** 64n;
    expect(IntegerSqrt.compute(base * base)).toBe(base);
  });

  it("throws on negative input", () => {
    expect(() => IntegerSqrt.compute(-1n)).toThrow(RangeError);
    expect(() => IntegerSqrt.compute(-1000n)).toThrow(RangeError);
  });

  // ─── Invariant: compute(n)² <= n < (compute(n) + 1)² ────────────────────

  it("satisfies floor sqrt invariant for small values (exhaustive 0..10000)", () => {
    for (let n = 0n; n <= 10000n; n++) {
      const s = IntegerSqrt.compute(n);
      expect(s * s).toBeLessThanOrEqual(n);
      expect((s + 1n) * (s + 1n)).toBeGreaterThan(n);
    }
  });

  it("satisfies floor sqrt invariant (property-based, large range)", () => {
    fc.assert(
      fc.property(fc.bigUintN(128), (n) => {
        const s = IntegerSqrt.compute(n);
        return s * s <= n && (s + 1n) * (s + 1n) > n;
      }),
      { numRuns: 5000 },
    );
  });

  // ─── Idempotence: compute(n²) = n ─────────────────────────────────────

  it("compute(n²) = n for perfect squares (property-based)", () => {
    fc.assert(
      fc.property(fc.bigUintN(64), (n) => {
        return IntegerSqrt.compute(n * n) === n;
      }),
      { numRuns: 1000 },
    );
  });

  // ─── Monotonicity: a <= b => compute(a) <= compute(b) ────────────────────

  it("is monotonically non-decreasing (property-based)", () => {
    fc.assert(
      fc.property(fc.bigUintN(128), fc.bigUintN(128), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return IntegerSqrt.compute(lo) <= IntegerSqrt.compute(hi);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("IntegerSqrt.validate", () => {
  it("validates correct sqrt values", () => {
    expect(IntegerSqrt.validate(49n, 7n)).toBe(true);
    expect(IntegerSqrt.validate(50n, 7n)).toBe(true);
    expect(IntegerSqrt.validate(63n, 7n)).toBe(true);
  });

  it("rejects incorrect sqrt values", () => {
    expect(IntegerSqrt.validate(49n, 6n)).toBe(false);
    expect(IntegerSqrt.validate(49n, 8n)).toBe(false);
    expect(IntegerSqrt.validate(100n, 9n)).toBe(false);
  });

  it("rejects negative sqrt", () => {
    expect(IntegerSqrt.validate(49n, -1n)).toBe(false);
  });

  it("is consistent with compute (property-based)", () => {
    fc.assert(
      fc.property(fc.bigUintN(128), (amount) => {
        const sqrt = IntegerSqrt.compute(amount);
        return IntegerSqrt.validate(amount, sqrt);
      }),
      { numRuns: 5000 },
    );
  });
});

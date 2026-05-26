/**
 * Integer square root via Newton's method.
 *
 * Matches Solidity's integer square root behavior exactly:
 *   IntegerSqrt.compute(n)² <= n < (IntegerSqrt.compute(n) + 1)²
 */
export class IntegerSqrt {
  /**
   * Returns the largest `s` such that `s * s <= n`.
   * @throws {RangeError} if n is negative
   */
  static compute(n: bigint): bigint {
    if (n < 0n) throw new RangeError('isqrt: input must be non-negative');
    if (n < 2n) return n;

    // Newton's method: x_{k+1} = (x_k + n / x_k) / 2
    let x = n;
    let y = (x + 1n) >> 1n;

    while (y < x) {
      x = y;
      y = (x + n / x) >> 1n;
    }

    return x;
  }

  /**
   * Validates that a given sqrtAmount value is correct for the given amount.
   * Checks: sqrt² <= amount < (sqrt + 1)²
   */
  static validate(amount: bigint, sqrtAmount: bigint): boolean {
    if (sqrtAmount < 0n) return false;
    const sq = sqrtAmount * sqrtAmount;
    const sqPlus1 = (sqrtAmount + 1n) * (sqrtAmount + 1n);
    return sq <= amount && amount < sqPlus1;
  }
}

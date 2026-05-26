import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import {
  AllocationSchema,
  VoteSubmissionSchema,
  RoundCreationSchema,
  RoundIdParamSchema,
} from './schemas.js';

// ─── AllocationSchema ────────────────────────────────────────────────────────

describe('AllocationSchema', () => {
  it('accepts valid allocation', () => {
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: '4900',
    });
    expect(result.success).toBe(true);
  });

  it('accepts maximum optionId', () => {
    const result = AllocationSchema.safeParse({
      optionId: 24,
      amount: '100',
    });
    expect(result.success).toBe(true);
  });

  it('rejects optionId >= 25', () => {
    const result = AllocationSchema.safeParse({
      optionId: 25,
      amount: '100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative optionId', () => {
    const result = AllocationSchema.safeParse({
      optionId: -1,
      amount: '100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer optionId', () => {
    const result = AllocationSchema.safeParse({
      optionId: 1.5,
      amount: '100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: '-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount exceeding uint128', () => {
    const tooBig = (2n ** 128n).toString();
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: tooBig,
    });
    expect(result.success).toBe(false);
  });

  it('accepts max uint128 amount', () => {
    const maxUint128 = (2n ** 128n - 1n).toString();
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: maxUint128,
    });
    expect(result.success).toBe(true);
  });

  it('accepts zero amount', () => {
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: '0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric amount string', () => {
    const result = AllocationSchema.safeParse({
      optionId: 0,
      amount: 'abc',
    });
    expect(result.success).toBe(false);
  });
});

// ─── VoteSubmissionSchema ────────────────────────────────────────────────────

describe('VoteSubmissionSchema', () => {
  const validSubmission = {
    voter: '0x1234567890abcdef1234567890abcdef12345678',
    allocations: [
      { optionId: 0, amount: '4900' },
      { optionId: 1, amount: '3600' },
      { optionId: 2, amount: '900' },
    ],
    nonce: 1,
    signature:
      '0x' + 'ab'.repeat(65),
  };

  it('accepts valid vote submission', () => {
    const result = VoteSubmissionSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it('checksums the voter address via getAddress', () => {
    const result = VoteSubmissionSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voter).toBe(
        getAddress('0x1234567890abcdef1234567890abcdef12345678'),
      );
    }
  });

  it('rejects invalid voter address (too short)', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      voter: '0x1234',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid voter address (no 0x prefix)', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      voter: '1234567890abcdef1234567890abcdef12345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects completely invalid address', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      voter: 'not-an-address',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty allocations array', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      allocations: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 25 allocations', () => {
    const allocations = Array.from({ length: 26 }, (_, i) => ({
      optionId: i % 25,
      amount: '100',
    }));
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      allocations,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate optionIds', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      allocations: [
        { optionId: 0, amount: '100' },
        { optionId: 0, amount: '200' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects nonce exceeding uint32', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      nonce: 2 ** 32,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative nonce', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      nonce: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid signature length', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      signature: '0xaabb',
    });
    expect(result.success).toBe(false);
  });

  it('accepts single allocation', () => {
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      allocations: [{ optionId: 0, amount: '100' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts 25 allocations (max)', () => {
    const allocations = Array.from({ length: 25 }, (_, i) => ({
      optionId: i,
      amount: '100',
    }));
    const result = VoteSubmissionSchema.safeParse({
      ...validSubmission,
      allocations,
    });
    expect(result.success).toBe(true);
  });
});

// ─── RoundCreationSchema ─────────────────────────────────────────────────────

describe('RoundCreationSchema', () => {
  const validRound = {
    roundId: '0x' + 'aa'.repeat(32),
    votingOpensAt: 1000,
    votingClosesAt: 73000,
    numOptions: 5,
    payoutToken: '0x1234567890abcdef1234567890abcdef12345678',
    relayers: ['0xabcdef1234567890abcdef1234567890abcdef12'],
  };

  it('accepts valid round', () => {
    const result = RoundCreationSchema.safeParse(validRound);
    expect(result.success).toBe(true);
  });

  it('checksums payoutToken and relayer addresses', () => {
    const result = RoundCreationSchema.safeParse(validRound);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payoutToken).toBe(
        getAddress('0x1234567890abcdef1234567890abcdef12345678'),
      );
      expect(result.data.relayers[0]).toBe(
        getAddress('0xabcdef1234567890abcdef1234567890abcdef12'),
      );
    }
  });

  it('rejects votingClosesAt <= votingOpensAt', () => {
    const result = RoundCreationSchema.safeParse({
      ...validRound,
      votingClosesAt: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects numOptions = 0', () => {
    const result = RoundCreationSchema.safeParse({
      ...validRound,
      numOptions: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects numOptions > 25', () => {
    const result = RoundCreationSchema.safeParse({
      ...validRound,
      numOptions: 26,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty relayers array', () => {
    const result = RoundCreationSchema.safeParse({
      ...validRound,
      relayers: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid roundId (not bytes32)', () => {
    const result = RoundCreationSchema.safeParse({
      ...validRound,
      roundId: '0xabcd',
    });
    expect(result.success).toBe(false);
  });
});

// ─── RoundIdParamSchema ──────────────────────────────────────────────────────

describe('RoundIdParamSchema', () => {
  it('accepts valid bytes32 roundId', () => {
    const result = RoundIdParamSchema.safeParse({
      roundId: '0x' + '00'.repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it('rejects short hex', () => {
    const result = RoundIdParamSchema.safeParse({
      roundId: '0xabcd',
    });
    expect(result.success).toBe(false);
  });
});

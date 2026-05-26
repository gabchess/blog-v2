import { z } from 'zod';
import { getAddress } from 'viem';

// ─── Primitives ──────────────────────────────────────────────────────────────

const hexString = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'must be a hex string')
  .transform((v) => v as `0x${string}`);

const address = z
  .string()
  .transform((v, ctx) => {
    try {
      return getAddress(v) as `0x${string}`;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid Ethereum address',
      });
      return z.NEVER;
    }
  });

const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a bytes32 hex string')
  .transform((v) => v as `0x${string}`);

const signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, 'must be a 65-byte signature')
  .transform((v) => v as `0x${string}`);

/** uint128 upper bound */
const UINT128_MAX = 2n ** 128n;

/** Amount as string (JSON-safe bigint representation of votingPower allocation) */
const amountString = z
  .string()
  .regex(/^\d+$/, 'amount must be a non-negative integer string')
  .pipe(
    z.string().refine(
      (v) => BigInt(v) < UINT128_MAX,
      'amount must fit in uint128',
    ),
  );

// ─── Allocation Schema ──────────────────────────────────────────────────────

export const AllocationSchema = z.object({
  optionId: z
    .number()
    .int()
    .min(0, 'optionId must be >= 0')
    .max(24, 'optionId must be < 25'),
  amount: amountString,
});

export type AllocationInput = z.infer<typeof AllocationSchema>;

// ─── Vote Submission Schema (Relayer API body) ───────────────────────────────

export const VoteSubmissionSchema = z.object({
  voter: address,
  allocations: z
    .array(AllocationSchema)
    .min(1, 'must have at least one allocation')
    .max(25, 'cannot exceed 25 allocations')
    .refine(
      (allocs) => {
        const ids = allocs.map((a) => a.optionId);
        return new Set(ids).size === ids.length;
      },
      'duplicate optionId in allocations',
    ),
  nonce: z.number().int().min(0).max(2 ** 32 - 1, 'nonce must fit in uint32'),
  signature: signature,
});

export type VoteSubmissionInput = z.infer<typeof VoteSubmissionSchema>;

// ─── Round Creation Schema ───────────────────────────────────────────────────

export const RoundCreationSchema = z
  .object({
    roundId: bytes32,
    votingOpensAt: z
      .number()
      .int()
      .positive('votingOpensAt must be a future block'),
    votingClosesAt: z
      .number()
      .int()
      .positive('votingClosesAt must be a future block'),
    numOptions: z
      .number()
      .int()
      .min(1, 'must have at least 1 option')
      .max(25, 'cannot exceed 25 options'),
    payoutToken: address,
    relayers: z
      .array(address)
      .min(1, 'must have at least one relayer'),
  })
  .refine(
    (p) => p.votingClosesAt > p.votingOpensAt,
    'votingClosesAt must be after votingOpensAt',
  );

export type RoundCreationInput = z.infer<typeof RoundCreationSchema>;

// ─── Route Params ────────────────────────────────────────────────────────────

export const RoundIdParamSchema = z.object({
  roundId: bytes32,
});

// ─── Re-export primitives for composition ────────────────────────────────────

export { hexString, address, bytes32, signature, amountString };

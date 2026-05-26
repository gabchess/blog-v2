// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  Allocation,
  Vote,
  SignedVote,
  BlobHeader,
  BalanceEntry,
  RoundConfig,
  VoteSubmission,
  VoteAccepted,
  VoteRejected,
  VoteResponse,
} from './types.js';

export { RoundStatus } from './types.js';

// ─── EIP-712 ─────────────────────────────────────────────────────────────────
export {
  VOTE_TYPES,
  VOTE_PRIMARY_TYPE,
  buildVoteDomain,
  buildVoteMessage,
} from './eip712.js';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────
export {
  AllocationSchema,
  VoteSubmissionSchema,
  RoundCreationSchema,
  RoundIdParamSchema,
  hexString,
  address,
  bytes32,
  signature,
  amountString,
} from './schemas.js';

export type {
  AllocationInput,
  VoteSubmissionInput,
  RoundCreationInput,
} from './schemas.js';

// ─── Constants ───────────────────────────────────────────────────────────────
export {
  BLOB_MAGIC,
  MAX_OPTIONS,
  MIN_OPTIONS,
  BLOB_RETENTION_BLOCKS,
  MAX_VOTING_PERIOD_BLOCKS,
  SAFETY_MARGIN_BLOCKS,
  PROVING_WINDOW_BLOCKS,
  BLOB_HEADER_SIZE,
  VOTE_FIXED_SIZE,
  ALLOCATION_SIZE,
  ALLOCATION_SIZE_BASE,
  BLOB_USABLE_BYTES,
  MAX_VOTES_PER_BLOB,
  MAX_BLOBS_PER_TX,
  BATCH_CAPACITY_THRESHOLD,
  BATCH_TIMER_MS,
} from './constants.js';

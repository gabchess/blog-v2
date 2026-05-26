// ─── Protocol Constants ───────────────────────────────────────────────────────
// All constants match the Phase 1 specification exactly.
// Changes here must be mirrored in VoteRegistry.sol.

/** Magic bytes: "QMV1" (Quadratic Multipass Vote, version 1) */
export const BLOB_MAGIC = 0x514d5631 as const;

/** Maximum number of options (project proposals) a round can have */
export const MAX_OPTIONS = 25 as const;

/** Minimum number of options a round must have */
export const MIN_OPTIONS = 1 as const;

// ─── Timing Constants (in L1 blocks, ~12s each) ──────────────────────────────

/** Blob retention: 4096 epochs × 32 slots ≈ 131,072 blocks ≈ 18.2 days */
export const BLOB_RETENTION_BLOCKS = 131_072n as const;

/** Maximum voting period: ~10 days */
export const MAX_VOTING_PERIOD_BLOCKS = 72_000n as const;

/** Safety margin for proving + L1 inclusion: ~4 days */
export const SAFETY_MARGIN_BLOCKS = 28_800n as const;

/** Proving window: retention - voting - safety ≈ 4.2 days */
export const PROVING_WINDOW_BLOCKS =
  BLOB_RETENTION_BLOCKS - MAX_VOTING_PERIOD_BLOCKS - SAFETY_MARGIN_BLOCKS;

// ─── Binary Encoding Sizes ───────────────────────────────────────────────────

/** Blob header is always exactly 128 bytes */
export const BLOB_HEADER_SIZE = 128 as const;

/** Fixed portion of each vote record: voter(20) + nonce(4) + numAllocs(1) + sig(65) */
export const VOTE_FIXED_SIZE = 90 as const;

/**
 * Each allocation: optionId(1) + amount(16) + sqrtAmount(16) = 33 bytes.
 * The spec's base is 17B (without sqrt). We add 16B for relayer-computed sqrtAmount.
 */
export const ALLOCATION_SIZE = 33 as const;

/** Spec-original allocation size without sqrtAmount */
export const ALLOCATION_SIZE_BASE = 17 as const;

/** Maximum usable bytes per blob after field-element encoding overhead */
export const BLOB_USABLE_BYTES = 126_976 as const;

/** Maximum vote count per blob (uint16 limit) */
export const MAX_VOTES_PER_BLOB = 65_535 as const;

/** EIP-4844: maximum blobs per transaction */
export const MAX_BLOBS_PER_TX = 6 as const;

// ─── Batching Thresholds ─────────────────────────────────────────────────────

/** Trigger blob submission when buffer reaches 94% of blob capacity */
export const BATCH_CAPACITY_THRESHOLD = 0.94 as const;

/** Default timer flush interval in milliseconds (10 minutes) */
export const BATCH_TIMER_MS = 600_000 as const;

import { describe, it, expect } from 'vitest';
import {
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
} from './constants.js';

describe('Protocol constants', () => {
  it('BLOB_MAGIC encodes "QMV1"', () => {
    // Q=0x51, M=0x4D, V=0x56, 1=0x31
    expect(BLOB_MAGIC).toBe(0x514d5631);
  });

  it('MAX_OPTIONS is 25', () => {
    expect(MAX_OPTIONS).toBe(25);
  });

  it('MIN_OPTIONS is 1', () => {
    expect(MIN_OPTIONS).toBe(1);
  });
});

describe('Timing invariants', () => {
  it('BLOB_RETENTION_BLOCKS is ~18.2 days of blocks', () => {
    expect(BLOB_RETENTION_BLOCKS).toBe(131_072n);
    // 131072 blocks * 12s/block = 1,572,864s ≈ 18.2 days
    const days = Number(BLOB_RETENTION_BLOCKS) * 12 / 86400;
    expect(days).toBeCloseTo(18.2, 0);
  });

  it('MAX_VOTING_PERIOD_BLOCKS is ~10 days', () => {
    expect(MAX_VOTING_PERIOD_BLOCKS).toBe(72_000n);
    const days = Number(MAX_VOTING_PERIOD_BLOCKS) * 12 / 86400;
    expect(days).toBe(10);
  });

  it('SAFETY_MARGIN_BLOCKS is ~4 days', () => {
    expect(SAFETY_MARGIN_BLOCKS).toBe(28_800n);
    const days = Number(SAFETY_MARGIN_BLOCKS) * 12 / 86400;
    expect(days).toBe(4);
  });

  it('PROVING_WINDOW_BLOCKS = retention - voting - safety', () => {
    expect(PROVING_WINDOW_BLOCKS).toBe(
      BLOB_RETENTION_BLOCKS - MAX_VOTING_PERIOD_BLOCKS - SAFETY_MARGIN_BLOCKS,
    );
  });

  it('proving window is positive (INV-3 feasibility)', () => {
    expect(PROVING_WINDOW_BLOCKS).toBeGreaterThan(0n);
  });
});

describe('Binary encoding sizes', () => {
  it('BLOB_HEADER_SIZE is 128 bytes', () => {
    // magic(4) + proposalId(32) + batchNonce(4) + voteCount(2) +
    // chainId(8) + registryAddr(20) + numOptions(1) + snapshotBlock(8) +
    // balanceRoot(32) + reserved(17) = 128
    const expectedSize = 4 + 32 + 4 + 2 + 8 + 20 + 1 + 8 + 32 + 17;
    expect(BLOB_HEADER_SIZE).toBe(128);
    expect(expectedSize).toBe(128);
  });

  it('VOTE_FIXED_SIZE is 90 bytes', () => {
    // voter(20) + nonce(4) + numAllocs(1) + sig_r(32) + sig_s(32) + sig_v(1) = 90
    const expectedSize = 20 + 4 + 1 + 32 + 32 + 1;
    expect(VOTE_FIXED_SIZE).toBe(90);
    expect(expectedSize).toBe(90);
  });

  it('ALLOCATION_SIZE is 33 bytes (with sqrt)', () => {
    // optionId(1) + credits(16) + sqrtCredits(16) = 33
    expect(ALLOCATION_SIZE).toBe(33);
  });

  it('ALLOCATION_SIZE_BASE is 17 bytes (spec original)', () => {
    // optionId(1) + credits(16) = 17
    expect(ALLOCATION_SIZE_BASE).toBe(17);
  });

  it('vote size formula: VOTE_FIXED_SIZE + numAllocs * ALLOCATION_SIZE', () => {
    // 1 alloc: 90 + 33 = 123
    expect(VOTE_FIXED_SIZE + 1 * ALLOCATION_SIZE).toBe(123);
    // 5 allocs: 90 + 165 = 255
    expect(VOTE_FIXED_SIZE + 5 * ALLOCATION_SIZE).toBe(255);
    // 10 allocs: 90 + 330 = 420
    expect(VOTE_FIXED_SIZE + 10 * ALLOCATION_SIZE).toBe(420);
    // 25 allocs: 90 + 825 = 915
    expect(VOTE_FIXED_SIZE + 25 * ALLOCATION_SIZE).toBe(915);
  });

  it('BLOB_USABLE_BYTES accommodates at least 100 max-allocation votes', () => {
    const maxVoteSize = VOTE_FIXED_SIZE + MAX_OPTIONS * ALLOCATION_SIZE;
    const votesPerBlob = Math.floor(
      (BLOB_USABLE_BYTES - BLOB_HEADER_SIZE) / maxVoteSize,
    );
    expect(votesPerBlob).toBeGreaterThanOrEqual(100);
  });
});

describe('Limits', () => {
  it('MAX_VOTES_PER_BLOB fits in uint16', () => {
    expect(MAX_VOTES_PER_BLOB).toBe(65535);
    expect(MAX_VOTES_PER_BLOB).toBeLessThanOrEqual(2 ** 16 - 1);
  });

  it('MAX_BLOBS_PER_TX is 6', () => {
    expect(MAX_BLOBS_PER_TX).toBe(6);
  });
});

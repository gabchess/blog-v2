import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { BlobHeader } from '@octant/vote-types';
import { BLOB_MAGIC, BLOB_HEADER_SIZE } from '@octant/vote-types';
import { BlobHeaderCodec } from '@serialization/BlobHeaderCodec';

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeHeader(overrides: Partial<BlobHeader> = {}): BlobHeader {
  return {
    magic: BLOB_MAGIC,
    roundId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    batchNonce: 1,
    voteCount: 100,
    chainId: 1n,
    registryAddress: '0x1234567890abcdef1234567890abcdef12345678',
    numOptions: 5,
    snapshotBlock: 42000n,
    balanceRoot: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

// ─── encode / decode ─────────────────────────────────────────────────────────

describe('BlobHeaderCodec', () => {
  it('roundtrips a standard header', () => {
    const header = makeHeader();
    const encoded = BlobHeaderCodec.encode(header);
    expect(encoded.length).toBe(BLOB_HEADER_SIZE);

    const decoded = BlobHeaderCodec.decode(encoded);
    expect(decoded).toEqual(header);
  });

  it('produces exactly 128 bytes', () => {
    const encoded = BlobHeaderCodec.encode(makeHeader());
    expect(encoded.length).toBe(128);
  });

  it('writes magic bytes at offset 0', () => {
    const encoded = BlobHeaderCodec.encode(makeHeader());
    const view = new DataView(encoded.buffer);
    expect(view.getUint32(0)).toBe(BLOB_MAGIC);
  });

  it('rejects buffer too small', () => {
    expect(() => BlobHeaderCodec.decode(new Uint8Array(64))).toThrow(
      RangeError,
    );
  });

  it('rejects invalid magic', () => {
    const encoded = BlobHeaderCodec.encode(makeHeader());
    const view = new DataView(encoded.buffer);
    view.setUint32(0, 0xdeadbeef);
    expect(() => BlobHeaderCodec.decode(encoded)).toThrow('Invalid blob magic');
  });

  it('preserves roundId (32 bytes)', () => {
    const roundId = ('0x' + 'ff'.repeat(32)) as `0x${string}`;
    const header = makeHeader({ roundId });
    const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
    expect(decoded.roundId).toBe(roundId);
  });

  it('preserves zero roundId', () => {
    const roundId = ('0x' + '00'.repeat(32)) as `0x${string}`;
    const header = makeHeader({ roundId });
    const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
    expect(decoded.roundId).toBe(roundId);
  });

  it('preserves batchNonce edge cases', () => {
    for (const nonce of [0, 1, 255, 65535, 2 ** 32 - 1]) {
      const header = makeHeader({ batchNonce: nonce });
      const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
      expect(decoded.batchNonce).toBe(nonce);
    }
  });

  it('preserves voteCount edge cases', () => {
    for (const count of [0, 1, 255, 65535]) {
      const header = makeHeader({ voteCount: count });
      const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
      expect(decoded.voteCount).toBe(count);
    }
  });

  it('preserves chainId (uint64)', () => {
    const header = makeHeader({ chainId: 2n ** 64n - 1n });
    const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
    expect(decoded.chainId).toBe(2n ** 64n - 1n);
  });

  it('preserves numOptions 1..25', () => {
    for (let n = 1; n <= 25; n++) {
      const header = makeHeader({ numOptions: n });
      const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
      expect(decoded.numOptions).toBe(n);
    }
  });

  it('reserved bytes are zero', () => {
    const encoded = BlobHeaderCodec.encode(makeHeader());
    for (let i = 111; i < 128; i++) {
      expect(encoded[i]).toBe(0);
    }
  });

  // ─── Property-based roundtrip ──────────────────────────────────────────

  it('roundtrips arbitrary headers (property-based)', () => {
    const arbHeader = fc.record({
      magic: fc.constant(BLOB_MAGIC),
      roundId: fc
        .hexaString({ minLength: 64, maxLength: 64 })
        .map((h) => `0x${h}` as `0x${string}`),
      batchNonce: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
      voteCount: fc.integer({ min: 0, max: 65535 }),
      chainId: fc.bigUintN(64),
      registryAddress: fc
        .hexaString({ minLength: 40, maxLength: 40 })
        .map((h) => `0x${h}` as `0x${string}`),
      numOptions: fc.integer({ min: 1, max: 25 }),
      snapshotBlock: fc.bigUintN(64),
      balanceRoot: fc
        .hexaString({ minLength: 64, maxLength: 64 })
        .map((h) => `0x${h}` as `0x${string}`),
    });

    fc.assert(
      fc.property(arbHeader, (header) => {
        const decoded = BlobHeaderCodec.decode(BlobHeaderCodec.encode(header));
        expect(decoded.magic).toBe(header.magic);
        expect(decoded.roundId).toBe(header.roundId);
        expect(decoded.batchNonce).toBe(header.batchNonce);
        expect(decoded.voteCount).toBe(header.voteCount);
        expect(decoded.chainId).toBe(header.chainId);
        expect(decoded.registryAddress).toBe(header.registryAddress);
        expect(decoded.numOptions).toBe(header.numOptions);
        expect(decoded.snapshotBlock).toBe(header.snapshotBlock);
        expect(decoded.balanceRoot).toBe(header.balanceRoot);
      }),
      { numRuns: 500 },
    );
  });
});

// ─── validate ───────────────────────────────────────────────────────────────

describe('BlobHeaderCodec.validate', () => {
  it('accepts valid header', () => {
    expect(() => BlobHeaderCodec.validate(makeHeader())).not.toThrow();
  });

  it('rejects invalid magic', () => {
    expect(() =>
      BlobHeaderCodec.validate(makeHeader({ magic: 0xdeadbeef })),
    ).toThrow('Invalid magic');
  });

  it('rejects numOptions out of range', () => {
    expect(() =>
      BlobHeaderCodec.validate(makeHeader({ numOptions: 0 })),
    ).toThrow('numOptions out of range');
    expect(() =>
      BlobHeaderCodec.validate(makeHeader({ numOptions: 26 })),
    ).toThrow('numOptions out of range');
  });
});

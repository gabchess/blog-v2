import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BinaryWriter } from '@serialization/BinaryWriter';
import { BinaryReader } from '@serialization/BinaryReader';

describe('BinaryWriter', () => {
  it('writes uint8 and advances position', () => {
    const buf = new Uint8Array(4);
    const w = new BinaryWriter(buf);
    w.uint8(0xff);
    expect(w.position).toBe(1);
    expect(buf[0]).toBe(0xff);
  });

  it('writes uint16 big-endian', () => {
    const buf = new Uint8Array(4);
    const w = new BinaryWriter(buf);
    w.uint16(0x1234);
    expect(w.position).toBe(2);
    expect(buf[0]).toBe(0x12);
    expect(buf[1]).toBe(0x34);
  });

  it('writes uint32 big-endian', () => {
    const buf = new Uint8Array(4);
    const w = new BinaryWriter(buf);
    w.uint32(0x12345678);
    expect(w.position).toBe(4);
    const view = new DataView(buf.buffer);
    expect(view.getUint32(0)).toBe(0x12345678);
  });

  it('writes uint64 big-endian', () => {
    const buf = new Uint8Array(8);
    const w = new BinaryWriter(buf);
    w.uint64(0x123456789abcdef0n);
    expect(w.position).toBe(8);
    const view = new DataView(buf.buffer);
    expect(view.getBigUint64(0)).toBe(0x123456789abcdef0n);
  });

  it('writes uint128 big-endian', () => {
    const buf = new Uint8Array(16);
    const w = new BinaryWriter(buf);
    const value = (0x12345678n << 64n) | 0x9abcdef0n;
    w.uint128(value);
    expect(w.position).toBe(16);
    const r = new BinaryReader(buf);
    expect(r.uint128()).toBe(value);
  });

  it('writes hex string as raw bytes', () => {
    const buf = new Uint8Array(20);
    const w = new BinaryWriter(buf);
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    w.hex(addr, 20);
    expect(w.position).toBe(20);
    expect(BinaryReader.readHex(buf, 0, 20)).toBe(addr);
  });

  it('throws on hex length mismatch', () => {
    const buf = new Uint8Array(32);
    const w = new BinaryWriter(buf);
    expect(() => w.hex('0xabcd', 32)).toThrow('Hex length mismatch');
  });

  it('chains operations', () => {
    const buf = new Uint8Array(7);
    const w = new BinaryWriter(buf);
    w.uint8(1).uint16(2).uint32(3);
    expect(w.position).toBe(7);
  });

  it('writes at start offset', () => {
    const buf = new Uint8Array(8);
    const w = new BinaryWriter(buf, 4);
    w.uint32(0xdeadbeef);
    expect(w.position).toBe(8);
    const view = new DataView(buf.buffer);
    expect(view.getUint32(4)).toBe(0xdeadbeef);
    expect(view.getUint32(0)).toBe(0); // untouched
  });

  it('writes raw bytes', () => {
    const buf = new Uint8Array(8);
    const w = new BinaryWriter(buf);
    w.bytes(new Uint8Array([1, 2, 3, 4]));
    expect(w.position).toBe(4);
    expect(buf[0]).toBe(1);
    expect(buf[3]).toBe(4);
  });

  it('skips bytes', () => {
    const buf = new Uint8Array(8);
    const w = new BinaryWriter(buf);
    w.uint8(0xff).skip(3).uint8(0xaa);
    expect(w.position).toBe(5);
    expect(buf[0]).toBe(0xff);
    expect(buf[4]).toBe(0xaa);
  });

  it('exposes buffer reference', () => {
    const buf = new Uint8Array(4);
    const w = new BinaryWriter(buf);
    expect(w.buffer).toBe(buf);
  });
});

// ─── Static helpers ───────────────────────────────────────────────────────────

describe('BinaryWriter.writeHex', () => {
  it('roundtrips a 20-byte address', () => {
    const buf = new Uint8Array(20);
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    BinaryWriter.writeHex(buf, 0, addr, 20);
    expect(BinaryReader.readHex(buf, 0, 20)).toBe(addr);
  });

  it('roundtrips a 32-byte hash', () => {
    const buf = new Uint8Array(32);
    const hash = '0x' + 'ff'.repeat(32);
    BinaryWriter.writeHex(buf, 0, hash, 32);
    expect(BinaryReader.readHex(buf, 0, 32)).toBe(hash);
  });

  it('throws on length mismatch', () => {
    const buf = new Uint8Array(32);
    expect(() => BinaryWriter.writeHex(buf, 0, '0xabcd', 32)).toThrow(
      'Hex string length mismatch',
    );
  });

  it('handles zero bytes', () => {
    const buf = new Uint8Array(4);
    BinaryWriter.writeHex(buf, 0, '0x00000000', 4);
    expect(BinaryReader.readHex(buf, 0, 4)).toBe('0x00000000');
  });
});

describe('BinaryWriter.writeUint128', () => {
  it.each([
    0n,
    1n,
    255n,
    256n,
    2n ** 64n,
    2n ** 64n + 1n,
    2n ** 128n - 1n,
  ])('roundtrips %d', (value) => {
    const buf = new Uint8Array(16);
    BinaryWriter.writeUint128(buf, 0, value);
    expect(BinaryReader.readUint128(buf, 0)).toBe(value);
  });

  it('is big-endian', () => {
    const buf = new Uint8Array(16);
    BinaryWriter.writeUint128(buf, 0, 1n);
    expect(buf[15]).toBe(1);
    for (let i = 0; i < 15; i++) {
      expect(buf[i]).toBe(0);
    }
  });

  it('roundtrips at non-zero offset', () => {
    const buf = new Uint8Array(32);
    const value = 0x123456789abcdef0n;
    BinaryWriter.writeUint128(buf, 8, value);
    expect(BinaryReader.readUint128(buf, 8)).toBe(value);
  });

  it('roundtrips arbitrary uint128 (property-based)', () => {
    fc.assert(
      fc.property(fc.bigUintN(128), (value) => {
        const buf = new Uint8Array(16);
        BinaryWriter.writeUint128(buf, 0, value);
        return BinaryReader.readUint128(buf, 0) === value;
      }),
      { numRuns: 1000 },
    );
  });
});

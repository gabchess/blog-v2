import { describe, it, expect } from 'vitest';
import { BinaryWriter } from '@serialization/BinaryWriter';
import { BinaryReader } from '@serialization/BinaryReader';

describe('BinaryReader', () => {
  it('reads uint8 and advances position', () => {
    const buf = new Uint8Array([0xff, 0x00]);
    const r = new BinaryReader(buf);
    expect(r.uint8()).toBe(0xff);
    expect(r.position).toBe(1);
  });

  it('reads uint16 big-endian', () => {
    const buf = new Uint8Array([0x12, 0x34]);
    const r = new BinaryReader(buf);
    expect(r.uint16()).toBe(0x1234);
    expect(r.position).toBe(2);
  });

  it('reads uint32 big-endian', () => {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, 0x12345678);
    const r = new BinaryReader(buf);
    expect(r.uint32()).toBe(0x12345678);
    expect(r.position).toBe(4);
  });

  it('reads uint64 big-endian', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, 0x123456789abcdef0n);
    const r = new BinaryReader(buf);
    expect(r.uint64()).toBe(0x123456789abcdef0n);
    expect(r.position).toBe(8);
  });

  it('reads uint128 big-endian', () => {
    const buf = new Uint8Array(16);
    const w = new BinaryWriter(buf);
    const value = (0xdeadbeefn << 64n) | 0xcafebaben;
    w.uint128(value);
    const r = new BinaryReader(buf);
    expect(r.uint128()).toBe(value);
    expect(r.position).toBe(16);
  });

  it('reads hex as 0x-prefixed lowercase string', () => {
    const buf = new Uint8Array(4);
    BinaryWriter.writeHex(buf, 0, '0xaaBBccDD', 4);
    const r = new BinaryReader(buf);
    expect(r.hex(4)).toBe('0xaabbccdd');
    expect(r.position).toBe(4);
  });

  it('reads raw bytes', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    const r = new BinaryReader(buf);
    const slice = r.bytes(3);
    expect(slice).toEqual(new Uint8Array([1, 2, 3]));
    expect(r.position).toBe(3);
  });

  it('skips bytes', () => {
    const buf = new Uint8Array([0xff, 0x00, 0x00, 0xaa]);
    const r = new BinaryReader(buf);
    r.skip(3);
    expect(r.uint8()).toBe(0xaa);
    expect(r.position).toBe(4);
  });

  it('reports remaining bytes', () => {
    const buf = new Uint8Array(10);
    const r = new BinaryReader(buf);
    expect(r.remaining).toBe(10);
    r.skip(4);
    expect(r.remaining).toBe(6);
  });

  it('reads at start offset', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint32(4, 0xdeadbeef);
    const r = new BinaryReader(buf, 4);
    expect(r.uint32()).toBe(0xdeadbeef);
    expect(r.position).toBe(8);
  });
});

// ─── Static helpers ───────────────────────────────────────────────────────────

describe('BinaryReader.readHex', () => {
  it('reads 20-byte address', () => {
    const buf = new Uint8Array(20);
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    BinaryWriter.writeHex(buf, 0, addr, 20);
    expect(BinaryReader.readHex(buf, 0, 20)).toBe(addr);
  });
});

describe('BinaryReader.readUint128', () => {
  it('reads uint128 at offset', () => {
    const buf = new Uint8Array(16);
    BinaryWriter.writeUint128(buf, 0, 2n ** 128n - 1n);
    expect(BinaryReader.readUint128(buf, 0)).toBe(2n ** 128n - 1n);
  });
});

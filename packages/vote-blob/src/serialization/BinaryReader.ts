import type { Address } from "viem";

/**
 * Chainable binary reader with auto-advancing position.
 * All integers are big-endian (network byte order).
 */
export class BinaryReader {
  private readonly view: DataView;
  private pos: number;

  constructor(
    private readonly buf: Uint8Array,
    startOffset = 0,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = startOffset;
  }

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  uint8(): number {
    const v = this.buf[this.pos]!;
    this.pos += 1;
    return v;
  }

  uint16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  uint32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  uint64(): bigint {
    const v = this.view.getBigUint64(this.pos);
    this.pos += 8;
    return v;
  }

  uint128(): bigint {
    const hi = this.view.getBigUint64(this.pos);
    const lo = this.view.getBigUint64(this.pos + 8);
    this.pos += 16;
    return (hi << 64n) | lo;
  }

  /** Read `length` bytes as a 0x-prefixed lowercase hex string. */
  hex(length: number): Address {
    let hex = "0x";
    for (let i = 0; i < length; i++) {
      hex += this.buf[this.pos + i]!.toString(16).padStart(2, "0");
    }
    this.pos += length;
    return hex as Address;
  }

  bytes(length: number): Uint8Array {
    const slice = this.buf.slice(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }

  // ── Static helpers (one-off reads without a full reader) ───────────────

  static readHex(buf: Uint8Array, offset: number, length: number): Address {
    let hex = "0x";
    for (let i = 0; i < length; i++) {
      hex += buf[offset + i]!.toString(16).padStart(2, "0");
    }
    return hex as Address;
  }

  static readUint128(buf: Uint8Array, offset: number): bigint {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hi = view.getBigUint64(offset);
    const lo = view.getBigUint64(offset + 8);
    return (hi << 64n) | lo;
  }
}

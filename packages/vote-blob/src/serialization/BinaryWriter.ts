/**
 * Chainable binary writer with auto-advancing position.
 * All integers are big-endian (network byte order).
 */
export class BinaryWriter {
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

  get buffer(): Uint8Array {
    return this.buf;
  }

  uint8(v: number): this {
    this.buf[this.pos] = v;
    this.pos += 1;
    return this;
  }

  uint16(v: number): this {
    this.view.setUint16(this.pos, v);
    this.pos += 2;
    return this;
  }

  uint32(v: number): this {
    this.view.setUint32(this.pos, v);
    this.pos += 4;
    return this;
  }

  uint64(v: bigint): this {
    this.view.setBigUint64(this.pos, v);
    this.pos += 8;
    return this;
  }

  uint128(v: bigint): this {
    this.view.setBigUint64(this.pos, v >> 64n);
    this.view.setBigUint64(this.pos + 8, v & 0xffff_ffff_ffff_ffffn);
    this.pos += 16;
    return this;
  }

  /**
   * Write a 0x-prefixed hex string as raw bytes.
   * Validates that the hex string is exactly `length` bytes.
   */
  hex(value: string, length: number): this {
    const raw = value.startsWith('0x') ? value.slice(2) : value;
    if (raw.length !== length * 2) {
      throw new Error(
        `Hex length mismatch: expected ${length * 2} chars, got ${raw.length}`,
      );
    }
    for (let i = 0; i < length; i++) {
      this.buf[this.pos + i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    this.pos += length;
    return this;
  }

  bytes(data: Uint8Array): this {
    this.buf.set(data, this.pos);
    this.pos += data.length;
    return this;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }

  // ── Static helpers (one-off writes without a full writer) ──────────────

  static writeHex(
    buf: Uint8Array,
    offset: number,
    hex: string,
    expectedLength: number,
  ): void {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (raw.length !== expectedLength * 2) {
      throw new Error(
        `Hex string length mismatch: expected ${expectedLength * 2} chars, got ${raw.length}`,
      );
    }
    for (let i = 0; i < expectedLength; i++) {
      buf[offset + i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
  }

  static writeUint128(buf: Uint8Array, offset: number, value: bigint): void {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setBigUint64(offset, value >> 64n);
    view.setBigUint64(offset + 8, value & 0xffff_ffff_ffff_ffffn);
  }
}

import type { BlobHeader } from '@octant/vote-types';
import { BLOB_HEADER_SIZE, BLOB_MAGIC } from '@octant/vote-types';
import { BinaryWriter } from '@serialization/BinaryWriter';
import { BinaryReader } from '@serialization/BinaryReader';

/**
 * Blob Header Layout (128 bytes total):
 *
 *  Offset  Size  Field
 *  ------  ----  -------------
 *    0      4    magic          (uint32 BE)
 *    4     32    roundId        (bytes32)
 *   36      4    batchNonce     (uint32 BE)
 *   40      2    voteCount      (uint16 BE)
 *   42      8    chainId        (uint64 BE)
 *   50     20    registryAddr   (address, raw bytes)
 *   70      1    numOptions     (uint8)
 *   71      8    snapshotBlock  (uint64 BE)
 *   79     32    balanceRoot    (bytes32)
 *  111     17    reserved       (zero-padded)
 *  ------
 *  128
 */
export class BlobHeaderCodec {
  static encode(header: BlobHeader): Uint8Array {
    const buf = new Uint8Array(BLOB_HEADER_SIZE);

    new BinaryWriter(buf)
      .uint32(header.magic)
      .hex(header.roundId, 32)
      .uint32(header.batchNonce)
      .uint16(header.voteCount)
      .uint64(header.chainId)
      .hex(header.registryAddress, 20)
      .uint8(header.numOptions)
      .uint64(header.snapshotBlock)
      .hex(header.balanceRoot, 32);
    // remaining 17 bytes are zero (Uint8Array constructor)

    return buf;
  }

  static decode(data: Uint8Array): BlobHeader {
    if (data.length < BLOB_HEADER_SIZE) {
      throw new RangeError(
        `Buffer too small for blob header: ${data.length} < ${BLOB_HEADER_SIZE}`,
      );
    }

    const r = new BinaryReader(data);

    const magic = r.uint32();
    if (magic !== BLOB_MAGIC) {
      throw new Error(
        `Invalid blob magic: 0x${magic.toString(16).padStart(8, '0')} (expected 0x${BLOB_MAGIC.toString(16)})`,
      );
    }

    return {
      magic,
      roundId: r.hex(32),
      batchNonce: r.uint32(),
      voteCount: r.uint16(),
      chainId: r.uint64(),
      registryAddress: r.hex(20),
      numOptions: r.uint8(),
      snapshotBlock: r.uint64(),
      balanceRoot: r.hex(32),
    };
  }

  static validate(header: BlobHeader): void {
    if (header.magic !== BLOB_MAGIC) {
      throw new Error(
        `Invalid magic: 0x${header.magic.toString(16).padStart(8, '0')}`,
      );
    }
    if (header.voteCount < 0 || header.voteCount > 65535) {
      throw new RangeError(`voteCount out of uint16 range: ${header.voteCount}`);
    }
    if (header.batchNonce < 0 || header.batchNonce > 0xffffffff) {
      throw new RangeError(`batchNonce out of uint32 range: ${header.batchNonce}`);
    }
    if (header.numOptions < 1 || header.numOptions > 25) {
      throw new RangeError(`numOptions out of range [1,25]: ${header.numOptions}`);
    }
  }
}

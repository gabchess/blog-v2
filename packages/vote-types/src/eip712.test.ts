import { describe, it, expect } from 'vitest';
import { VOTE_TYPES, VOTE_PRIMARY_TYPE, buildVoteDomain, buildVoteMessage } from './eip712.js';

describe('VOTE_TYPES', () => {
  it('has Allocation with optionId(uint8) and amount(uint256)', () => {
    expect(VOTE_TYPES.Allocation).toEqual([
      { name: 'optionId', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ]);
  });

  it('has Vote with roundId, allocations array, and nonce', () => {
    expect(VOTE_TYPES.Vote).toEqual([
      { name: 'roundId', type: 'bytes32' },
      { name: 'allocations', type: 'Allocation[]' },
      { name: 'nonce', type: 'uint256' },
    ]);
  });

  it('primary type is Vote', () => {
    expect(VOTE_PRIMARY_TYPE).toBe('Vote');
  });
});

describe('buildVoteDomain', () => {
  it('builds correct domain for given chain and registry', () => {
    const domain = buildVoteDomain(
      1,
      '0x1234567890abcdef1234567890abcdef12345678',
    );

    expect(domain).toEqual({
      name: 'ZKVoteRegistry',
      version: '1',
      chainId: 1,
      verifyingContract: '0x1234567890abcdef1234567890abcdef12345678',
    });
  });

  it('uses correct name and version for all chains', () => {
    const domain = buildVoteDomain(
      31337,
      '0xabcdef1234567890abcdef1234567890abcdef12',
    );

    expect(domain.name).toBe('ZKVoteRegistry');
    expect(domain.version).toBe('1');
    expect(domain.chainId).toBe(31337);
  });
});

describe('buildVoteMessage', () => {
  it('builds correct message structure', () => {
    const message = buildVoteMessage({
      roundId: '0x' + 'aa'.repeat(32) as `0x${string}`,
      allocations: [
        { optionId: 0, amount: 4900n },
        { optionId: 1, amount: 3600n },
      ],
      nonce: 1,
    });

    expect(message.roundId).toBe('0x' + 'aa'.repeat(32));
    expect(message.allocations).toHaveLength(2);
    expect(message.allocations[0]).toEqual({ optionId: 0, amount: 4900n });
    expect(message.allocations[1]).toEqual({ optionId: 1, amount: 3600n });
    expect(message.nonce).toBe(1n);
  });

  it('converts nonce to bigint', () => {
    const message = buildVoteMessage({
      roundId: '0x' + '00'.repeat(32) as `0x${string}`,
      allocations: [{ optionId: 0, amount: 100n }],
      nonce: 42,
    });

    expect(typeof message.nonce).toBe('bigint');
    expect(message.nonce).toBe(42n);
  });

  it('strips extra properties from allocations', () => {
    const message = buildVoteMessage({
      roundId: '0x' + '00'.repeat(32) as `0x${string}`,
      allocations: [
        { optionId: 0, amount: 100n, sqrtAmount: 10n } as any,
      ],
      nonce: 0,
    });

    expect(message.allocations[0]).toEqual({ optionId: 0, amount: 100n });
    expect((message.allocations[0] as any).sqrtAmount).toBeUndefined();
  });
});

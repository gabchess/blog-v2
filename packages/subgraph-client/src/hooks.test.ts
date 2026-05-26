import { describe, it, expect } from 'vitest';
import { subgraphKeys } from './hooks.js';

describe('subgraphKeys', () => {
  it('all() returns the base key', () => {
    expect(subgraphKeys.all).toEqual(['subgraph']);
  });

  it('transfers(n) nests under the base key with count', () => {
    const key = subgraphKeys.transfers(10);
    expect(key).toEqual(['subgraph', 'transfers', 10]);
    // Must start with the base key so invalidating `all` cascades
    expect(key[0]).toBe(subgraphKeys.all[0]);
  });

  it('approvals(n) nests under the base key with count', () => {
    const key = subgraphKeys.approvals(5);
    expect(key).toEqual(['subgraph', 'approvals', 5]);
    expect(key[0]).toBe(subgraphKeys.all[0]);
  });

  it('different counts produce different keys', () => {
    expect(subgraphKeys.transfers(5)).not.toEqual(subgraphKeys.transfers(10));
    expect(subgraphKeys.approvals(5)).not.toEqual(subgraphKeys.approvals(20));
  });

  it('transfers and approvals keys are distinct', () => {
    expect(subgraphKeys.transfers(10)).not.toEqual(subgraphKeys.approvals(10));
  });
});

describe('subgraphKeys.tokenStats', () => {
  it('tokenStats() nests under the base key', () => {
    const key = subgraphKeys.tokenStats();
    expect(key).toEqual(['subgraph', 'tokenStats']);
    expect(key[0]).toBe(subgraphKeys.all[0]);
  });

  it('tokenStats key is distinct from transfers and approvals', () => {
    expect(subgraphKeys.tokenStats()).not.toEqual(subgraphKeys.transfers(10));
    expect(subgraphKeys.tokenStats()).not.toEqual(subgraphKeys.approvals(10));
  });
});

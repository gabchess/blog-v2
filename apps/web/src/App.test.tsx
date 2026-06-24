import { describe, it, expect } from 'vitest';

describe('App', () => {
  it('renders without crashing', async () => {
    // Basic smoke test
    const { App } = await import('./App');
    expect(App).toBeDefined();
  });
});

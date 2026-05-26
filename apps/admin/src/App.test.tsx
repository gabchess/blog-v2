import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createClient, cacheExchange, fetchExchange } from 'urql';
import { App } from './App';

// Create a mock client
const mockClient = createClient({
  url: 'http://localhost:4001/graphql',
  exchanges: [cacheExchange, fetchExchange],
  suspense: false,
});

// Mock fetch to prevent actual network requests
globalThis.fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify({ data: { me: null } }), {
      headers: { 'Content-Type': 'application/json' },
    })
  );

// Mock localStorage
const localStorageMock = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  length: 0,
  key: () => null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('App', () => {
  it('renders the admin dashboard header', () => {
    render(
      <Provider value={mockClient}>
        <App />
      </Provider>
    );

    expect(screen.getByText('Admin Dashboard')).toBeDefined();
  });

  it('shows login form when not authenticated', () => {
    render(
      <Provider value={mockClient}>
        <App />
      </Provider>
    );

    expect(screen.getByText('Login')).toBeDefined();
  });
});

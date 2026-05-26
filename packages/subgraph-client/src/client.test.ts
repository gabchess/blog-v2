import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSubgraphClient, setSubgraphUrl, getDefaultClient } from './client.js';

const DEFAULT_URL = 'http://localhost:8000/subgraphs/name/octant-token';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  // Reset closure state so tests are independent
  setSubgraphUrl(DEFAULT_URL);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createSubgraphClient', () => {
  it('sends a POST request with query and variables as JSON', async () => {
    const data = { transfers: [{ id: '1' }] };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data }));

    const client = createSubgraphClient('http://test:8000/subgraphs/name/test');
    await client.query('{ transfers { id } }', { first: 5 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test:8000/subgraphs/name/test');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      query: '{ transfers { id } }',
      variables: { first: 5 },
    });
  });

  it('returns the data field from a successful response', async () => {
    const transfers = [
      { id: '0x1', from: '0xaaa', to: '0xbbb', value: '1000' },
      { id: '0x2', from: '0xccc', to: '0xddd', value: '2000' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { transfers } }));

    const client = createSubgraphClient();
    const result = await client.query<{ transfers: typeof transfers }>('{ transfers { id from to value } }');

    expect(result).toEqual({ transfers });
    expect(result.transfers).toHaveLength(2);
    expect(result.transfers[0]!.from).toBe('0xaaa');
  });

  it('throws on non-OK HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    const client = createSubgraphClient();
    await expect(client.query('{ bad }')).rejects.toThrow(
      'Subgraph request failed: 500 Internal Server Error',
    );
  });

  it('throws on HTTP 404', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    const client = createSubgraphClient();
    await expect(client.query('{ missing }')).rejects.toThrow(
      'Subgraph request failed: 404 Not Found',
    );
  });

  it('throws on GraphQL errors in the response body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: null,
        errors: [{ message: 'Field "foo" not found' }],
      }),
    );

    const client = createSubgraphClient();
    await expect(client.query('{ foo }')).rejects.toThrow(
      'Subgraph query error: Field "foo" not found',
    );
  });

  it('joins multiple GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: null,
        errors: [
          { message: 'Error one' },
          { message: 'Error two' },
        ],
      }),
    );

    const client = createSubgraphClient();
    await expect(client.query('{ bad }')).rejects.toThrow(
      'Subgraph query error: Error one, Error two',
    );
  });

  it('does not throw when errors array is empty', async () => {
    const data = { transfers: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data, errors: [] }));

    const client = createSubgraphClient();
    const result = await client.query('{ transfers { id } }');
    expect(result).toEqual(data);
  });

  it('uses the default URL when no argument provided', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { transfers: [] } }));

    const client = createSubgraphClient();
    await client.query('{ transfers { id } }');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEFAULT_URL);
  });

  it('sends undefined variables when none provided', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: {} }));

    const client = createSubgraphClient();
    await client.query('{ totalSupply }');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe('{ totalSupply }');
    expect(body.variables).toBeUndefined();
  });

  it('propagates network errors from fetch', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const client = createSubgraphClient();
    await expect(client.query('{ test }')).rejects.toThrow('Failed to fetch');
  });

  it('closes over the URL at creation time', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: {} }));

    const clientA = createSubgraphClient('http://a.test/subgraph');
    const clientB = createSubgraphClient('http://b.test/subgraph');

    await clientA.query('{ x }');
    await clientB.query('{ y }');

    const [urlA] = mockFetch.mock.calls[0] as [string, RequestInit];
    const [urlB] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(urlA).toBe('http://a.test/subgraph');
    expect(urlB).toBe('http://b.test/subgraph');
  });
});

describe('setSubgraphUrl / getDefaultClient', () => {
  it('getDefaultClient returns a client that uses the default URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: {} }));

    const client = getDefaultClient();
    await client.query('{ test }');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEFAULT_URL);
  });

  it('getDefaultClient returns the same cached instance on repeated calls', () => {
    const a = getDefaultClient();
    const b = getDefaultClient();
    expect(a).toBe(b);
  });

  it('setSubgraphUrl changes the URL used by subsequent getDefaultClient calls', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: {} }));

    setSubgraphUrl('http://staging:8000/subgraphs/name/octant-token');
    const client = getDefaultClient();
    await client.query('{ test }');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://staging:8000/subgraphs/name/octant-token');
  });

  it('setSubgraphUrl invalidates the cached client', () => {
    const before = getDefaultClient();
    setSubgraphUrl('http://new-url:8000/subgraphs/name/test');
    const after = getDefaultClient();
    expect(before).not.toBe(after);
  });

  it('repeated setSubgraphUrl calls use the latest URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: {} }));

    setSubgraphUrl('http://first:8000/sg');
    setSubgraphUrl('http://second:8000/sg');
    const client = getDefaultClient();
    await client.query('{ test }');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://second:8000/sg');
  });

  it('setSubgraphUrl back to default restores original behavior', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: {} }));

    setSubgraphUrl('http://other:8000/sg');
    setSubgraphUrl(DEFAULT_URL);
    const client = getDefaultClient();
    await client.query('{ test }');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEFAULT_URL);
  });
});

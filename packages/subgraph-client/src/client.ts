import type { SubgraphResponse } from './types.js';

const DEFAULT_URL = 'http://localhost:8000/subgraphs/name/octant-token';

export interface SubgraphClient {
  query: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
}

export function createSubgraphClient(url: string = DEFAULT_URL): SubgraphClient {
  return {
    async query<T>(
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<T> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        throw new Error(`Subgraph request failed: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as SubgraphResponse<T>;

      if (json.errors?.length) {
        throw new Error(
          `Subgraph query error: ${json.errors.map((e) => e.message).join(', ')}`,
        );
      }

      return json.data;
    },
  };
}

const defaultClient = (() => {
  let url = DEFAULT_URL;
  let cached: SubgraphClient | undefined;

  return {
    setUrl(newUrl: string) {
      url = newUrl;
      cached = undefined;
    },
    get(): SubgraphClient {
      cached ??= createSubgraphClient(url);
      return cached;
    },
  };
})();

export const setSubgraphUrl = defaultClient.setUrl;
export const getDefaultClient = defaultClient.get;

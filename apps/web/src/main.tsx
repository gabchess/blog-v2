import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Address } from 'viem';
import { Web3Provider } from '@octant/web3';
import { setSubgraphUrl } from '@octant/subgraph-client';
import { App } from './App';

const subgraphUrl = import.meta.env['VITE_SUBGRAPH_URL'];
if (subgraphUrl) {
  setSubgraphUrl(subgraphUrl);
}

function getSafeAddressFromUrl(): Address | undefined {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('safe');
  if (!raw) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    console.warn(`Invalid Safe address in URL: ${raw}`);
    return undefined;
  }
  return raw as Address;
}

const safeAddress = getSafeAddressFromUrl();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <Web3Provider
      mainnetRpcUrl={import.meta.env['VITE_MAINNET_RPC_URL']}
      safeAddress={safeAddress}
    >
      <App />
    </Web3Provider>
  </StrictMode>
);

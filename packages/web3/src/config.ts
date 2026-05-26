import { type Config, createConfig, http, fallback } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { safe, injected } from 'wagmi/connectors';
import type { Address } from 'viem';
import { anvilLocal } from './chains.js';
import { safeProtocolKit } from './safe/index.js';

export interface AppConfigOptions {
  mainnetRpcUrl?: string;
  safeAddress?: Address;
}

export function createAppConfig(options: AppConfigOptions = {}): Config {
  const { mainnetRpcUrl, safeAddress } = options;
  return createConfig({
    chains: [anvilLocal, mainnet],
    connectors: [
      // allowedDomains restricts Safe SDK to the official Safe UI origin.
      // Removing this would allow any iframe host to trigger wallet connection.
      safe({
        allowedDomains: [/app\.safe\.global$/, /\.octant\.build$/],
      }),
      // Protocol Kit connector — only added when ?safe=0x... is in the URL
      ...(safeAddress ? [safeProtocolKit({ safeAddress })] : []),
      injected(),
    ],
    transports: {
      [anvilLocal.id]: http(),
      [mainnet.id]: mainnetRpcUrl
        ? fallback([http(mainnetRpcUrl), http()])
        : http(),
    },
  });
}

// Default config (no keyed RPC — public endpoint only)
export const config = createAppConfig();

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}

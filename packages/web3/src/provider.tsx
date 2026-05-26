import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Address } from 'viem';
import { createAppConfig, config as defaultConfig } from './config.js';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000 },
    },
  });
}

interface Web3ProviderProps {
  children: ReactNode;
  mainnetRpcUrl?: string;
  safeAddress?: Address;
}

export function Web3Provider({ children, mainnetRpcUrl, safeAddress }: Web3ProviderProps) {
  const [queryClient] = useState(makeQueryClient);
  const [config] = useState(() =>
    mainnetRpcUrl || safeAddress
      ? createAppConfig({ mainnetRpcUrl, safeAddress })
      : defaultConfig,
  );
  return (
    // reconnectOnMount={false} because useAutoConnect handles Safe connector
    // detection. Enabling both would race and potentially double-connect.
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

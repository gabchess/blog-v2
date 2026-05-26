import { createConnector, type CreateConnectorFn } from 'wagmi';
import { getAddress, type Address } from 'viem';
import { initProtocolKit } from './initProtocolKit.js';
import { createSafeProvider, type Eip1193Request, type SafeTxResult } from './safeProvider.js';

export interface SafeProtocolKitParameters {
  safeAddress: Address;
  onTransactionResult?: (result: SafeTxResult) => void;
}

export function safeProtocolKit(parameters: SafeProtocolKitParameters): CreateConnectorFn {
  const { safeAddress, onTransactionResult } = parameters;

  let cachedProvider: Eip1193Request | undefined;
  let cachedChainId: number | undefined;

  return createConnector((config) => ({
    id: 'safeProtocolKit',
    name: 'Safe (Protocol Kit)',
    type: 'safeProtocolKit',

    async setup() {
      // Prevent activation inside a Safe iframe — use wagmi's built-in safe() connector there
      if (typeof window !== 'undefined' && window.parent !== window) {
        throw new Error('safeProtocolKit connector is not available inside iframes');
      }
    },

    async connect() {
      const injected = (window as unknown as Record<string, unknown>)['ethereum'] as Eip1193Request | undefined;
      if (!injected) {
        throw new Error('No injected wallet found (window.ethereum)');
      }

      // Trigger MetaMask popup
      await injected.request({ method: 'eth_requestAccounts' });

      const { protocolKit, apiKit, signerAddress, chainId } = await initProtocolKit(
        safeAddress,
        injected,
      );

      cachedProvider = createSafeProvider({
        safeAddress,
        signerAddress,
        injectedProvider: injected,
        protocolKit,
        apiKit,
        onTransactionResult,
      });
      cachedChainId = chainId;

      return {
        accounts: [getAddress(safeAddress)] as never,
        chainId,
      };
    },

    async disconnect() {
      cachedProvider = undefined;
      cachedChainId = undefined;
    },

    async getAccounts() {
      return [getAddress(safeAddress)];
    },

    async getChainId() {
      if (cachedChainId != null) return cachedChainId;

      const injected = (window as unknown as Record<string, unknown>)['ethereum'] as Eip1193Request | undefined;
      if (!injected) return 1; // fallback to mainnet

      const raw = (await injected.request({ method: 'eth_chainId' })) as string;
      return Number(raw);
    },

    async getProvider() {
      return cachedProvider;
    },

    async isAuthorized() {
      return cachedProvider != null;
    },

    onAccountsChanged() {
      // If the signer changes in MetaMask, they may no longer be a Safe owner.
      // Safest to disconnect and let the user reconnect.
      config.emitter.emit('disconnect');
      cachedProvider = undefined;
      cachedChainId = undefined;
    },

    onChainChanged(chainId: string) {
      cachedChainId = Number(chainId);
      config.emitter.emit('change', { chainId: Number(chainId) });
    },

    onDisconnect() {
      config.emitter.emit('disconnect');
      cachedProvider = undefined;
      cachedChainId = undefined;
    },
  }));
}

export { SafeInitError } from './initProtocolKit.js';
export type { SafeTxResult } from './safeProvider.js';

import type Safe from '@safe-global/protocol-kit';
import type SafeApiKit from '@safe-global/api-kit';
import type { Address } from 'viem';

/** Minimal EIP-1193 request interface compatible with both viem and Protocol Kit */
export interface Eip1193Request {
  request(args: { method: string; params?: readonly unknown[] | unknown[] }): Promise<unknown>;
}

export type SafeTxResult =
  | { safeTxHash: string; proposed: true }
  | { hash: string; proposed: false };

export interface SafeProviderOptions {
  safeAddress: Address;
  signerAddress: Address;
  injectedProvider: Eip1193Request;
  protocolKit: Safe;
  apiKit: SafeApiKit;
  onTransactionResult?: (result: SafeTxResult) => void;
}

/**
 * EIP-1193 provider wrapper that intercepts account/transaction methods
 * and routes them through Safe Protocol Kit. All other RPC methods pass
 * through to the underlying injected provider (e.g. MetaMask).
 */
export function createSafeProvider(options: SafeProviderOptions): Eip1193Request {
  const {
    safeAddress,
    signerAddress,
    injectedProvider,
    protocolKit,
    apiKit,
    onTransactionResult,
  } = options;

  const provider: Eip1193Request & Record<string, unknown> = {
    async request({ method, params }: { method: string; params?: readonly unknown[] | unknown[] }) {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [safeAddress];

        case 'eth_sendTransaction': {
          const txParams = (params as Record<string, string>[])[0]!;
          const safeTx = await protocolKit.createTransaction({
            transactions: [
              {
                to: txParams['to'] ?? safeAddress,
                value: txParams['value'] ?? '0',
                data: txParams['data'] ?? '0x',
                operation: 0, // Call
              },
            ],
          });

          const signed = await protocolKit.signTransaction(safeTx);
          const threshold = await protocolKit.getThreshold();

          if (signed.signatures.size >= threshold) {
            const result = await protocolKit.executeTransaction(signed);
            const hash = result.hash;
            onTransactionResult?.({ hash, proposed: false });
            return hash;
          }

          // Not enough signatures — propose to Transaction Service
          const safeTxHash = await protocolKit.getTransactionHash(signed);
          const signature = await protocolKit.signHash(safeTxHash);
          await apiKit.proposeTransaction({
            safeAddress,
            safeTransactionData: signed.data,
            safeTxHash,
            senderAddress: signerAddress,
            senderSignature: signature.data,
          });
          onTransactionResult?.({ safeTxHash, proposed: true });
          return safeTxHash;
        }

        default:
          return injectedProvider.request({ method, params });
      }
    },
  };

  // Forward event methods from injected provider (MetaMask's on/removeListener)
  const injected = injectedProvider as unknown as Record<string, unknown>;
  if (typeof injected['on'] === 'function') {
    provider['on'] = injected['on'];
  }
  if (typeof injected['removeListener'] === 'function') {
    provider['removeListener'] = injected['removeListener'];
  }

  return provider;
}

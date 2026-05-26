import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { getAddress, type Address } from 'viem';
import type { Eip1193Request } from './safeProvider.js';

export class SafeInitError extends Error {
  constructor(
    public readonly code: 'NOT_OWNER' | 'NO_ACCOUNTS' | 'INIT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'SafeInitError';
  }
}

export interface ProtocolKitInitResult {
  protocolKit: Safe;
  apiKit: SafeApiKit;
  signerAddress: Address;
  chainId: number;
}

export async function initProtocolKit(
  safeAddress: Address,
  injectedProvider: Eip1193Request,
): Promise<ProtocolKitInitResult> {
  // Get signer address from injected wallet
  const accounts = (await injectedProvider.request({
    method: 'eth_accounts',
  })) as string[];
  if (!accounts[0]) {
    throw new SafeInitError('NO_ACCOUNTS', 'No accounts found in injected wallet');
  }
  const signerAddress = getAddress(accounts[0]) as Address;

  // Get chain ID
  const rawChainId = (await injectedProvider.request({
    method: 'eth_chainId',
  })) as string;
  const chainId = Number(rawChainId);

  // Initialize Protocol Kit — cast provider to the shape Protocol Kit expects
  let protocolKit: Safe;
  try {
    protocolKit = await Safe.init({
      provider: injectedProvider as Parameters<typeof Safe.init>[0]['provider'],
      signer: signerAddress,
      safeAddress,
    });
  } catch (err) {
    throw new SafeInitError(
      'INIT_FAILED',
      `Failed to initialize Protocol Kit: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate signer is an owner of the Safe
  const owners = await protocolKit.getOwners();
  const normalizedOwners = owners.map((o) => getAddress(o).toLowerCase());
  if (!normalizedOwners.includes(signerAddress.toLowerCase())) {
    throw new SafeInitError(
      'NOT_OWNER',
      `Signer ${signerAddress} is not an owner of Safe ${safeAddress}`,
    );
  }

  // Initialize API Kit
  const apiKit = new SafeApiKit({ chainId: BigInt(chainId) });

  return { protocolKit, apiKit, signerAddress, chainId };
}

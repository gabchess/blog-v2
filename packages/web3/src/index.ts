export { config, createAppConfig, type AppConfigOptions } from './config.js';
export { anvilLocal } from './chains.js';
export { OCTANT_TOKEN_ADDRESS, octantTokenAbi, USDC_ADDRESS, erc20Abi } from './contracts.js';
export { Web3Provider } from './provider.js';
export { useAutoConnect } from './hooks/index.js';
export { safeProtocolKit, SafeInitError, type SafeProtocolKitParameters, type SafeTxResult } from './safe/index.js';

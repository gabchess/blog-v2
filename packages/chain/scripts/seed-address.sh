#!/bin/bash
set -euo pipefail

# Seeds an address with USDC + ETH on a running Anvil mainnet fork.
# Usage: SEED_ADDRESS=0x... ./scripts/seed-address.sh

RPC_URL="http://localhost:${ANVIL_PORT:-8545}"
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
USDC_AMOUNT="10000000000"  # 10,000 USDC (6 decimals)
ETH_AMOUNT="0x56BC75E2D63100000"  # 100 ETH in hex wei

TARGET="${SEED_ADDRESS:?SEED_ADDRESS env var is required (e.g. SEED_ADDRESS=0x...)}"

echo "Seeding $TARGET on Anvil fork..."

# 1. Set ETH balance (current + 100 ETH)
echo "  Setting ETH balance..."
cast rpc anvil_setBalance "$TARGET" "$ETH_AMOUNT" --rpc-url "$RPC_URL" > /dev/null

# 2. Impersonate USDC whale and transfer
echo "  Transferring USDC..."
cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
cast send "$USDC" "transfer(address,uint256)(bool)" "$TARGET" "$USDC_AMOUNT" \
  --from "$USDC_WHALE" --rpc-url "$RPC_URL" --unlocked > /dev/null
cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

# 3. Verify
ETH_BAL=$(cast balance "$TARGET" --rpc-url "$RPC_URL" --ether)
USDC_RAW=$(cast call "$USDC" "balanceOf(address)(uint256)" "$TARGET" --rpc-url "$RPC_URL")
# cast returns decimal like "20000000000" — divide by 1e6 for human-readable
USDC_HUMAN=$(cast --to-unit "$USDC_RAW" 6 2>/dev/null || echo "$USDC_RAW (raw)")

echo ""
echo "Done:"
echo "  ETH:  $ETH_BAL"
echo "  USDC: $USDC_HUMAN"

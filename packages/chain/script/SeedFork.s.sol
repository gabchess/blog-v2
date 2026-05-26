// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Seeds Anvil default accounts with USDC on a mainnet fork.
///         Uses vm.prank to impersonate a known USDC whale.
contract SeedForkScript is Script {
    // USDC on Ethereum mainnet
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // Circle/Centre USDC reserve — reliable large holder
    address constant USDC_WHALE = 0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341;

    // Anvil default accounts
    address constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ALICE    = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant BOB      = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    // 10,000 USDC (6 decimals)
    uint256 constant SEED_AMOUNT = 10_000 * 1e6;

    function run() external {
        IERC20 usdc = IERC20(USDC);

        uint256 whaleBalance = usdc.balanceOf(USDC_WHALE);
        require(whaleBalance >= SEED_AMOUNT * 3, "Whale has insufficient USDC - try a different whale address");

        vm.startPrank(USDC_WHALE);
        usdc.transfer(DEPLOYER, SEED_AMOUNT);
        usdc.transfer(ALICE, SEED_AMOUNT);
        usdc.transfer(BOB, SEED_AMOUNT);
        vm.stopPrank();

        console.log("Seeded USDC on mainnet fork:");
        console.log("  Deployer:", usdc.balanceOf(DEPLOYER) / 1e6, "USDC");
        console.log("  Alice:   ", usdc.balanceOf(ALICE) / 1e6, "USDC");
        console.log("  Bob:     ", usdc.balanceOf(BOB) / 1e6, "USDC");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Seeds an arbitrary address with USDC + ETH on a mainnet fork.
///         Target address is read from the SEED_ADDRESS env var.
contract SeedAddressScript is Script {
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDC_WHALE = 0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341;

    uint256 constant USDC_AMOUNT = 10_000 * 1e6;   // 10,000 USDC
    uint256 constant ETH_AMOUNT  = 100 ether;       // 100 ETH

    function run() external {
        address target = vm.envAddress("SEED_ADDRESS");
        IERC20 usdc = IERC20(USDC);

        // Seed USDC via whale impersonation
        vm.startPrank(USDC_WHALE);
        usdc.transfer(target, USDC_AMOUNT);
        vm.stopPrank();

        // Seed ETH via deal
        vm.deal(target, target.balance + ETH_AMOUNT);

        console.log("Seeded address:", target);
        console.log("  USDC:", usdc.balanceOf(target) / 1e6);
        console.log("  ETH: ", target.balance / 1 ether);
    }
}

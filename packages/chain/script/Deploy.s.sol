// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OctantToken.sol";

contract DeployScript is Script {
    // Anvil default account 0 private key
    uint256 constant ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Initial supply: 1,000,000 OCT (18 decimals)
    uint256 constant INITIAL_SUPPLY = 1_000_000 ether;

    function run() external {
        vm.startBroadcast(ANVIL_PRIVATE_KEY);
        new OctantToken(INITIAL_SUPPLY);
        vm.stopBroadcast();
    }
}

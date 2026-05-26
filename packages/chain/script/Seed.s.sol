// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OctantToken.sol";

contract SeedScript is Script {
    // Anvil default account 0 private key (deployer, token holder)
    uint256 constant ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Deterministic deployed contract address (deployer nonce 0)
    address constant TOKEN = 0x5FbDB2315678afecb367f032d93F642f64180aa3;

    // Anvil default accounts for recipients/spenders
    address constant ALICE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant BOB = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external {
        OctantToken token = OctantToken(TOKEN);

        vm.startBroadcast(ANVIL_PRIVATE_KEY);

        // Transfer events (3 transfers to create indexable history)
        token.transfer(ALICE, 10_000 ether);
        token.transfer(BOB, 5_000 ether);
        token.transfer(ALICE, 2_500 ether);

        // Approval events (2 approvals for different spenders)
        token.approve(ALICE, 50_000 ether);
        token.approve(BOB, 25_000 ether);

        vm.stopBroadcast();
    }
}

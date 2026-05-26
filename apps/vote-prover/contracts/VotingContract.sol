// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VotingContract {
    event VoteCast(address indexed voter, uint256 indexed projectId, uint256 amount, uint256 epoch);

    uint256 public currentEpoch = 1;    // slot 0
    bytes32 public voteMerkleRoot;      // slot 1
    uint256 public voteCount;           // slot 2
    bytes32[] public leaves;            // slot 3 (length), data at keccak256(3)

    function vote(uint256 projectId, uint256 amount) external {
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, projectId, amount, currentEpoch));
        leaves.push(leaf);
        voteCount++;
        voteMerkleRoot = _computeRoot();
        emit VoteCast(msg.sender, projectId, amount, currentEpoch);
    }

    function getLeafCount() external view returns (uint256) {
        return leaves.length;
    }

    function _computeRoot() internal view returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) return bytes32(0);
        if (n == 1) return leaves[0];

        uint256 size = 1;
        while (size < n) {
            size *= 2;
        }

        bytes32[] memory layer = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) {
            layer[i] = leaves[i];
        }

        while (size > 1) {
            for (uint256 i = 0; i < size / 2; i++) {
                layer[i] = keccak256(abi.encodePacked(layer[2 * i], layer[2 * i + 1]));
            }
            size /= 2;
        }

        return layer[0];
    }
}

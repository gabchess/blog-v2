// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGroth16Verifier {
    function verifyProof(
        uint256[8] calldata proof,
        uint256[2] calldata input
    ) external view;
}

contract VoteVerifier {
    error InvalidPublicValuesLength();

    event VoteRootVerified(
        bytes32 indexed stateRoot,
        address indexed contractAddr,
        bytes32 storageSlot,
        bytes32 storageValue
    );

    uint256 constant BN254_MASK = (1 << 253) - 1;
    uint256 constant PUBLIC_VALUES_LENGTH = 116;

    IGroth16Verifier public immutable groth16Verifier;
    bytes32 public immutable vkeyHash;

    constructor(IGroth16Verifier _groth16Verifier, bytes32 _vkeyHash) {
        groth16Verifier = _groth16Verifier;
        vkeyHash = _vkeyHash;
    }

    function verifyVoteRoot(
        uint256[8] calldata proof,
        bytes calldata publicValues
    ) external returns (bytes32) {
        if (publicValues.length != PUBLIC_VALUES_LENGTH) revert InvalidPublicValuesLength();

        uint256 committedValuesDigest = uint256(sha256(publicValues)) & BN254_MASK;

        uint256[2] memory inputs;
        inputs[0] = uint256(vkeyHash);
        inputs[1] = committedValuesDigest;

        groth16Verifier.verifyProof(proof, inputs);

        bytes32 stateRoot = bytes32(publicValues[0:32]);
        address contractAddr = address(bytes20(publicValues[32:52]));
        bytes32 storageSlot = bytes32(publicValues[52:84]);
        bytes32 storageValue = bytes32(publicValues[84:116]);

        emit VoteRootVerified(stateRoot, contractAddr, storageSlot, storageValue);
        return storageValue;
    }
}

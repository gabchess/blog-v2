# Vote Prover

ZK prover for verifying L2 vote results on mainnet. Proves the `voteMerkleRoot` storage slot of a `VotingContract` on L2 by verifying Ethereum MPT (Merkle Patricia Trie) proofs inside the Pico zkVM, producing a Groth16 proof verifiable on-chain.

## Prerequisites

- Rust nightly-2025-08-04 (pinned in `rust-toolchain`, auto-selected by rustup)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast, anvil)
- Docker (required only for Groth16 wrapping; not needed for `--fast` mode)

### Install Rust toolchain

```bash
rustup install nightly-2025-08-04
rustup component add rust-src --toolchain nightly-2025-08-04
```

### Install cargo pico CLI

```bash
cargo +nightly-2025-08-04 install --git https://github.com/brevis-network/pico --tag v1.2.2 pico-cli
cargo pico --version
```

## How to Run

All commands below assume you are in the `apps/vote-prover/` directory.

### 1. Start a local chain

```bash
anvil --chain-id 8453
```

Keep this running in a separate terminal.

### 2. Deploy the VotingContract

```bash
forge create contracts/VotingContract.sol:VotingContract \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Copy the `Deployed to:` address.

### 3. Cast a vote

```bash
cast send <DEPLOYED_ADDRESS> "vote(uint256,uint256)" 1 100 \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Verify the merkle root:

```bash
cast call <DEPLOYED_ADDRESS> "voteMerkleRoot()" --rpc-url http://localhost:8545
```

### 4. Build the RISC-V guest program

```bash
cd prover/app
cargo pico build
```

Compiles the circuit to `app/elf/riscv32im-pico-zkvm-elf`. Re-run if `app/src/main.rs` or `lib/src/lib.rs` changes.

### 5. Generate a proof

**Fast mode** (development — no Docker, no Groth16):

```bash
cd prover/script
cargo run --release -- --contract <DEPLOYED_ADDRESS> --fast
```

**Full pipeline** (STARK proof with verification):

```bash
cd prover/script
cargo run --release -- --contract <DEPLOYED_ADDRESS>
```

**EVM/Groth16 mode** (on-chain verifiable — requires Docker):

```bash
cd prover/script
cargo run --release -- --contract <DEPLOYED_ADDRESS> --evm
```

### 6. Deploy and verify on-chain

Deploy the generated Groth16 verifier:

```bash
cp prover/output/Groth16Verifier.sol contracts/
forge create contracts/Groth16Verifier.sol:Verifier \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Deploy VoteVerifier (pass Groth16Verifier address and vkey hash as constructor args):

```bash
forge create contracts/VoteVerifier.sol:VoteVerifier \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast \
  --constructor-args <GROTH16_VERIFIER_ADDRESS> <VKEY_HASH>
```

The `VKEY_HASH` is the 9th value (index 8) from `prover/output/proof.data`. It is deterministic per ELF binary.

Verify the proof on-chain (use values from `prover/output/proof.data` and `prover/output/pv_file`):

```bash
cast send <VOTE_VERIFIER_ADDRESS> \
  "verifyVoteRoot(uint256[8],bytes)" \
  "[<8 proof elements from proof.data>]" \
  "0x<public_values_hex from pv_file>" \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

A successful transaction emits `VoteRootVerified` with the decoded state root, contract address, slot, and value. An invalid proof reverts with `ProofInvalid()`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `L2_RPC_URL` | `http://localhost:8545` | L2 Ethereum RPC endpoint |
| `VOTING_CONTRACT` | (required) | Deployed VotingContract address |
| `STORAGE_SLOT` | `1` | Storage slot to prove (1 = `voteMerkleRoot`) |
| `BLOCK_NUM` | latest | Block number to prove against |

## CLI Flags

```
vote-prover-script [OPTIONS] --contract <CONTRACT>

Options:
  --contract <CONTRACT>    VotingContract address [env: VOTING_CONTRACT]
  --rpc-url <RPC_URL>      L2 RPC endpoint [env: L2_RPC_URL] [default: http://localhost:8545]
  --slot <SLOT>            Storage slot index [env: STORAGE_SLOT] [default: 1]
  --block <BLOCK>          Block number [env: BLOCK_NUM]
  --fast                   Fast proving mode (STARK only, no Docker)
  --evm                    Generate Groth16 proof for on-chain verification (requires Docker)
  --output <OUTPUT>        Output directory for proof artifacts [default: ../output]
```

## What the Prover Does

1. **Fetch proof data** — calls `eth_getProof` on the L2 RPC to get account and storage MPT proof nodes
2. **Build input** — constructs `EthProofInput` with state root, address, account fields, and proof nodes
3. **Verify MPT inside zkVM** — the guest circuit verifies both account and storage proofs using `alloy-trie`
4. **Generate STARK proof** — Pico generates a STARK proof of correct execution
5. **Groth16 wrap** (with `--evm`) — wraps the STARK into a ~256-byte Groth16 proof verifiable on-chain

## Project Structure

```
apps/vote-prover/
├── contracts/
│   ├── VotingContract.sol       # L2 voting contract with on-chain merkle tree
│   ├── Groth16Verifier.sol      # Generated Groth16 verifier (from gnark setup)
│   └── VoteVerifier.sol         # Vote-specific verification wrapper
├── prover/
│   ├── Cargo.toml               # Workspace root
│   ├── rust-toolchain           # nightly-2025-08-04
│   ├── app/                     # RISC-V guest program (MPT verification circuit)
│   │   └── src/main.rs
│   ├── lib/                     # Shared types (EthProofInput, PublicValues)
│   │   └── src/lib.rs
│   ├── script/                  # Proof generation CLI (host-side)
│   │   └── src/main.rs
│   └── output/                  # Proof artifacts (vm_pk, vm_vk, proof.data, etc.)
├── .env
├── package.json
└── README.md
```

## Contracts

### VotingContract

Accepts votes and maintains a merkle root over all vote leaves.

**Storage layout:**

| Slot | Type | Name | Description |
|------|------|------|-------------|
| 0 | `uint256` | `currentEpoch` | Epoch counter (starts at 1) |
| 1 | `bytes32` | `voteMerkleRoot` | Merkle root over all vote leaves (proven by the circuit) |
| 2 | `uint256` | `voteCount` | Total votes cast |
| 3 | `bytes32[]` | `leaves` | Dynamic array of vote leaves |

### Groth16Verifier

Generated by gnark during the setup phase. Contains the circuit's verification key as constants. Exposes `verifyProof(uint256[8] proof, uint256[2] input)` which reverts on invalid proofs.

Deterministic per ELF binary — only regenerate if the circuit code changes.

### VoteVerifier

Verifies the full proof chain. Accepts a Groth16 proof and raw public values bytes, reconstructs the two Groth16 public inputs (`vkeyHash` and `sha256(publicValues) & ((1 << 253) - 1)`), verifies the proof via `Groth16Verifier`, then decodes and emits the verified state root, contract address, storage slot, and value.

Constructor takes the Groth16Verifier address and the circuit's `vkeyHash` (deterministic per ELF, found at index 8 in `proof.data`).

## Circuit

The guest program (`app/src/main.rs`) runs inside Pico's RISC-V zkVM and:

1. Reads `EthProofInput` from the host (state root, address, account/storage proof nodes)
2. RLP-encodes the account and verifies the account proof against the state root via `alloy_trie::proof::verify_proof`
3. RLP-encodes the storage value and verifies the storage proof against the account's storage hash
4. Commits `PublicValues` (state_root, address, slot, value) as public output

This is fully self-contained MPT verification — no external service or coprocessor network required.

## Dependencies

| Package | Source | Purpose |
|---------|--------|---------|
| `pico-sdk` | `github.com/brevis-network/pico` (v1.2.2) | RISC-V guest SDK + prover client |
| `alloy-trie` | crates.io (0.9) | MPT proof verification (inside zkVM guest) |
| `alloy-primitives` | crates.io (1.x) | Ethereum types, keccak256 |
| `alloy-rlp` | crates.io (0.3) | RLP encoding for account/value |
| `alloy` | crates.io (1.x) | Ethereum RPC client (`eth_getProof`) |
| `clap` | crates.io | CLI argument parsing |

## Groth16 Setup

The gnark Groth16 setup and prove steps run inside Docker via `pico-cli`. The setup keys (`vm_pk`, `vm_vk`) are reusable per ELF binary — only re-run setup if the circuit changes.

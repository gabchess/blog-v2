use std::path::PathBuf;

use alloy::{
    primitives::{Address, B256, U256},
    providers::{Provider, ProviderBuilder},
};
use clap::Parser;
use vote_prover_lib::{load_elf, EthProofInput, PublicValues, DEFAULT_STORAGE_SLOT};

#[derive(Parser)]
#[command(name = "vote-prover", about = "Generate ZK proofs for VotingContract storage slots")]
struct Cli {
    #[arg(long, env = "VOTING_CONTRACT")]
    contract: String,

    #[arg(long, env = "L2_RPC_URL", default_value = "http://localhost:8545")]
    rpc_url: String,

    #[arg(long, env = "STORAGE_SLOT", default_value_t = DEFAULT_STORAGE_SLOT)]
    slot: u32,

    #[arg(long, env = "BLOCK_NUM")]
    block: Option<u64>,

    #[arg(long, help = "Use fast proving mode (no Docker required)")]
    fast: bool,

    #[arg(long, help = "Generate Groth16 proof for on-chain verification (requires Docker)")]
    evm: bool,

    #[arg(long, default_value = "../output", help = "Output directory for proof artifacts")]
    output: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    pico_sdk::init_logger();
    let cli = Cli::parse();

    let provider = ProviderBuilder::new().connect_http(cli.rpc_url.parse()?);
    let chain_id = provider.get_chain_id().await?;
    println!("Chain ID: {chain_id}");

    let block_number = match cli.block {
        Some(n) => n,
        None => provider.get_block_number().await?,
    };
    println!("Block number: {block_number}");

    let contract_addr: Address = cli.contract.parse()?;
    let slot_key = B256::from(U256::from(cli.slot).to_be_bytes::<32>());

    let block = provider
        .get_block_by_number(block_number.into())
        .await?
        .expect("block not found");
    let state_root = block.header.state_root;
    println!("State root: {state_root}");

    let proof_response = provider
        .get_proof(contract_addr, vec![slot_key])
        .block_id(block_number.into())
        .await?;

    let storage_value = proof_response.storage_proof[0].value;
    println!("Storage value (voteMerkleRoot): {storage_value:#x}");

    let circuit_input = EthProofInput {
        block_number,
        state_root: state_root.into(),
        contract_address: contract_addr.into_array(),
        nonce: proof_response.nonce,
        balance: proof_response.balance.to_be_bytes(),
        storage_hash: proof_response.storage_hash.into(),
        code_hash: proof_response.code_hash.into(),
        account_proof: proof_response
            .account_proof
            .iter()
            .map(|node| node.to_vec())
            .collect(),
        storage_slot: slot_key.into(),
        storage_value: storage_value.to_be_bytes(),
        storage_proof: proof_response.storage_proof[0]
            .proof
            .iter()
            .map(|node| node.to_vec())
            .collect(),
    };

    let elf = load_elf("../app/elf/riscv32im-pico-zkvm-elf");
    println!("ELF loaded ({} bytes)", elf.len());

    let client = pico_sdk::client::DefaultProverClient::new(&elf);
    let mut stdin_builder = client.new_stdin_builder();
    stdin_builder.write(&circuit_input);

    let mode = if cli.evm {
        "evm/groth16"
    } else if cli.fast {
        "fast"
    } else {
        "full pipeline"
    };
    println!("Generating proof ({mode})...");

    let proof = if cli.evm {
        let output = std::fs::canonicalize(&cli.output).unwrap_or_else(|_| {
            std::fs::create_dir_all(&cli.output).expect("failed to create output dir");
            std::fs::canonicalize(&cli.output).unwrap()
        });
        println!("Output directory: {}", output.display());
        client.prove_evm(stdin_builder, true, &output, "kb")?;
        println!("Groth16 proof generated successfully.");

        let contract_inputs_path = output.join("contract_inputs.json");
        if contract_inputs_path.exists() {
            let contract_inputs = std::fs::read_to_string(&contract_inputs_path)?;
            println!("\nContract inputs (for VoteVerifier.verifyVoteRoot):");
            println!("{contract_inputs}");
        }

        return Ok(());
    } else if cli.fast {
        client.prove_fast(stdin_builder)?
    } else {
        let full_proof = client.prove(stdin_builder)?;
        println!("Verifying proofs...");
        client.verify(&full_proof)?;
        println!("Proof verification: PASS");
        full_proof.0
    };

    let pv_stream = proof
        .pv_stream
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no public values in proof"))?;

    let public_values: PublicValues = bincode::deserialize(pv_stream)?;

    println!("\nVerified public values:");
    println!("  State root:       0x{}", hex::encode(public_values.state_root));
    println!("  Contract address: 0x{}", hex::encode(public_values.contract_address));
    println!("  Storage slot:     0x{}", hex::encode(public_values.storage_slot));
    println!("  Storage value:    0x{}", hex::encode(public_values.storage_value));

    assert_eq!(
        public_values.state_root,
        <[u8; 32]>::from(state_root),
        "state root mismatch"
    );
    assert_eq!(
        public_values.storage_value,
        storage_value.to_be_bytes(),
        "storage value mismatch"
    );

    println!("\nResult: PASS — MPT proof verified inside zkVM");
    println!("Chain ID: {chain_id}");
    println!("Block: {block_number}");
    println!("Contract: {}", cli.contract);
    println!("Slot: {}", cli.slot);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::{
        network::{EthereumWallet, TransactionBuilder},
        primitives::Bytes,
        rpc::types::TransactionRequest,
        signers::local::PrivateKeySigner,
    };
    use clap::Parser;

    #[test]
    fn cli_default_values() {
        let cli = Cli::try_parse_from([
            "vote-prover",
            "--contract",
            "0x1234567890abcdef1234567890abcdef12345678",
        ])
        .unwrap();

        assert_eq!(cli.rpc_url, "http://localhost:8545");
        assert_eq!(cli.slot, DEFAULT_STORAGE_SLOT);
        assert_eq!(cli.output, PathBuf::from("../output"));
        assert!(cli.block.is_none());
        assert!(!cli.fast);
        assert!(!cli.evm);
    }

    #[test]
    fn cli_custom_values() {
        let cli = Cli::try_parse_from([
            "vote-prover",
            "--contract",
            "0xdeadbeef",
            "--rpc-url",
            "http://localhost:8545",
            "--slot",
            "42",
            "--block",
            "100",
            "--fast",
            "--output",
            "/tmp/out",
        ])
        .unwrap();

        assert_eq!(cli.contract, "0xdeadbeef");
        assert_eq!(cli.rpc_url, "http://localhost:8545");
        assert_eq!(cli.slot, 42);
        assert_eq!(cli.block, Some(100));
        assert!(cli.fast);
        assert!(!cli.evm);
        assert_eq!(cli.output, PathBuf::from("/tmp/out"));
    }

    #[test]
    fn cli_evm_flag() {
        let cli = Cli::try_parse_from(["vote-prover", "--contract", "0xabc", "--evm"]).unwrap();

        assert!(cli.evm);
        assert!(!cli.fast);
    }

    #[test]
    fn cli_missing_contract_fails() {
        std::env::remove_var("VOTING_CONTRACT");
        let result = Cli::try_parse_from(["vote-prover"]);
        assert!(result.is_err());
    }

    #[test]
    fn cli_fast_and_evm_both_set() {
        let cli =
            Cli::try_parse_from(["vote-prover", "--contract", "0xabc", "--fast", "--evm"])
                .unwrap();

        assert!(cli.fast);
        assert!(cli.evm);
    }

    #[test]
    #[ignore]
    fn gen_fixture() {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(gen_fixture_inner())
            .unwrap();
    }

    async fn gen_fixture_inner() -> anyhow::Result<()> {
        let signer: PrivateKeySigner =
            "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".parse()?;
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http("http://localhost:8545".parse()?);

        let artifact: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("../../out/VotingContract.sol/VotingContract.json")
                .expect("Run `forge build` in the vote-prover directory first"),
        )?;
        let bytecode_hex = artifact["bytecode"]["object"]
            .as_str()
            .expect("missing bytecode in artifact")
            .trim_start_matches("0x");
        let bytecode = hex::decode(bytecode_hex)?;

        let deploy_tx = TransactionRequest::default().with_deploy_code(Bytes::from(bytecode));
        let receipt = provider
            .send_transaction(deploy_tx)
            .await?
            .get_receipt()
            .await?;
        let contract_addr = receipt
            .contract_address
            .expect("deployment did not return contract address");

        let mut calldata = hex::decode("b384abef")?;
        calldata.extend_from_slice(&U256::from(1).to_be_bytes::<32>());
        calldata.extend_from_slice(&U256::from(100).to_be_bytes::<32>());

        let vote_tx = TransactionRequest::default()
            .with_to(contract_addr)
            .with_input(Bytes::from(calldata));
        provider
            .send_transaction(vote_tx)
            .await?
            .get_receipt()
            .await?;

        let slot_key = B256::from(U256::from(1).to_be_bytes::<32>());
        let block_number = provider.get_block_number().await?;
        let block = provider
            .get_block_by_number(block_number.into())
            .await?
            .expect("block not found");
        let state_root = block.header.state_root;

        let proof_response = provider
            .get_proof(contract_addr, vec![slot_key])
            .block_id(block_number.into())
            .await?;

        let storage_value = proof_response.storage_proof[0].value;

        let input = EthProofInput {
            block_number,
            state_root: state_root.into(),
            contract_address: contract_addr.into_array(),
            nonce: proof_response.nonce,
            balance: proof_response.balance.to_be_bytes(),
            storage_hash: proof_response.storage_hash.into(),
            code_hash: proof_response.code_hash.into(),
            account_proof: proof_response
                .account_proof
                .iter()
                .map(|node| node.to_vec())
                .collect(),
            storage_slot: slot_key.into(),
            storage_value: storage_value.to_be_bytes(),
            storage_proof: proof_response.storage_proof[0]
                .proof
                .iter()
                .map(|node| node.to_vec())
                .collect(),
        };

        let json = serde_json::to_string_pretty(&input)?;
        let fixture_path = std::path::Path::new("../lib/fixtures/anvil_proof.json");
        std::fs::create_dir_all(fixture_path.parent().unwrap())?;
        std::fs::write(fixture_path, &json)?;

        Ok(())
    }
}

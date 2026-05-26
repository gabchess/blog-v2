use alloy_primitives::{keccak256, Bytes, B256, U256};
use alloy_rlp::Encodable;
use alloy_trie::{proof::verify_proof, Nibbles};
use serde::{Deserialize, Serialize};

pub const DEFAULT_STORAGE_SLOT: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EthProofInput {
    pub block_number: u64,
    pub state_root: [u8; 32],
    pub contract_address: [u8; 20],
    pub nonce: u64,
    pub balance: [u8; 32],
    pub storage_hash: [u8; 32],
    pub code_hash: [u8; 32],
    pub account_proof: Vec<Vec<u8>>,
    pub storage_slot: [u8; 32],
    pub storage_value: [u8; 32],
    pub storage_proof: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicValues {
    pub state_root: [u8; 32],
    pub contract_address: [u8; 20],
    pub storage_slot: [u8; 32],
    pub storage_value: [u8; 32],
}

#[derive(alloy_rlp::RlpEncodable)]
struct TrieAccount {
    nonce: u64,
    balance: U256,
    storage_root: B256,
    code_hash: B256,
}

pub fn verify_mpt_proof(
    input: &EthProofInput,
) -> Result<PublicValues, alloy_trie::proof::ProofVerificationError> {
    let state_root = B256::from(input.state_root);
    let storage_root = B256::from(input.storage_hash);

    let account = TrieAccount {
        nonce: input.nonce,
        balance: U256::from_be_bytes(input.balance),
        storage_root,
        code_hash: B256::from(input.code_hash),
    };
    let mut account_rlp = Vec::new();
    account.encode(&mut account_rlp);

    let account_key = Nibbles::unpack(keccak256(input.contract_address));
    let account_proof: Vec<Bytes> = input
        .account_proof
        .iter()
        .map(|node| Bytes::from(node.clone()))
        .collect();

    verify_proof(state_root, account_key, Some(account_rlp), &account_proof)?;

    let storage_key = Nibbles::unpack(keccak256(B256::from(input.storage_slot)));
    let storage_value = U256::from_be_bytes(input.storage_value);
    let expected_value = if storage_value.is_zero() {
        None
    } else {
        let mut value_rlp = Vec::new();
        storage_value.encode(&mut value_rlp);
        Some(value_rlp)
    };

    let storage_proof: Vec<Bytes> = input
        .storage_proof
        .iter()
        .map(|node| Bytes::from(node.clone()))
        .collect();

    verify_proof(storage_root, storage_key, expected_value, &storage_proof)?;

    Ok(PublicValues {
        state_root: input.state_root,
        contract_address: input.contract_address,
        storage_slot: input.storage_slot,
        storage_value: input.storage_value,
    })
}

pub fn load_elf(path: &str) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|err| {
        panic!("Failed to load ELF file from {path}: {err}");
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_public_values() -> PublicValues {
        PublicValues {
            state_root: [1u8; 32],
            contract_address: [2u8; 20],
            storage_slot: [3u8; 32],
            storage_value: [4u8; 32],
        }
    }

    fn sample_eth_proof_input() -> EthProofInput {
        EthProofInput {
            block_number: 42,
            state_root: [1u8; 32],
            contract_address: [2u8; 20],
            nonce: 1,
            balance: [0u8; 32],
            storage_hash: [3u8; 32],
            code_hash: [4u8; 32],
            account_proof: vec![vec![5u8; 64]],
            storage_slot: [6u8; 32],
            storage_value: [7u8; 32],
            storage_proof: vec![vec![8u8; 64]],
        }
    }

    fn load_fixture() -> EthProofInput {
        let path = format!("{}/fixtures/anvil_proof.json", env!("CARGO_MANIFEST_DIR"));
        let json = std::fs::read_to_string(&path)
            .expect("fixture not found — run `cargo run --bin gen-fixture` from prover/script/");
        serde_json::from_str(&json).expect("invalid fixture JSON")
    }

    #[test]
    fn public_values_bincode_round_trip() {
        let pv = sample_public_values();
        let bytes = bincode::serialize(&pv).unwrap();
        let decoded: PublicValues = bincode::deserialize(&bytes).unwrap();
        assert_eq!(pv, decoded);
    }

    #[test]
    fn public_values_bincode_size_matches_solidity() {
        let pv = sample_public_values();
        let bytes = bincode::serialize(&pv).unwrap();
        assert_eq!(bytes.len(), 116, "must match VoteVerifier.sol PUBLIC_VALUES_LENGTH");
    }

    #[test]
    fn public_values_bincode_layout_matches_solidity() {
        let pv = PublicValues {
            state_root: [0xAA; 32],
            contract_address: [0xBB; 20],
            storage_slot: [0xCC; 32],
            storage_value: [0xDD; 32],
        };
        let bytes = bincode::serialize(&pv).unwrap();

        assert_eq!(&bytes[0..32], &[0xAA; 32], "publicValues[0:32] = state_root");
        assert_eq!(&bytes[32..52], &[0xBB; 20], "publicValues[32:52] = contract_address");
        assert_eq!(&bytes[52..84], &[0xCC; 32], "publicValues[52:84] = storage_slot");
        assert_eq!(&bytes[84..116], &[0xDD; 32], "publicValues[84:116] = storage_value");
    }

    #[test]
    fn eth_proof_input_bincode_round_trip() {
        let input = sample_eth_proof_input();
        let bytes = bincode::serialize(&input).unwrap();
        let decoded: EthProofInput = bincode::deserialize(&bytes).unwrap();
        assert_eq!(input, decoded);
    }

    #[test]
    fn public_values_json_round_trip() {
        let pv = sample_public_values();
        let json = serde_json::to_string(&pv).unwrap();
        let decoded: PublicValues = serde_json::from_str(&json).unwrap();
        assert_eq!(pv, decoded);
    }

    #[test]
    fn eth_proof_input_json_round_trip() {
        let input = sample_eth_proof_input();
        let json = serde_json::to_string(&input).unwrap();
        let decoded: EthProofInput = serde_json::from_str(&json).unwrap();
        assert_eq!(input, decoded);
    }

    #[test]
    fn load_elf_reads_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.elf");
        let content = b"test elf content";
        std::fs::write(&path, content).unwrap();
        let loaded = load_elf(path.to_str().unwrap());
        assert_eq!(loaded, content);
    }

    #[test]
    #[should_panic(expected = "Failed to load ELF file")]
    fn load_elf_panics_on_missing_file() {
        load_elf("/nonexistent/path/to/elf");
    }

    #[test]
    fn valid_proof_verifies() {
        let input = load_fixture();
        let pv = verify_mpt_proof(&input).expect("valid proof should verify");
        assert_eq!(pv.state_root, input.state_root);
        assert_eq!(pv.contract_address, input.contract_address);
        assert_eq!(pv.storage_slot, input.storage_slot);
        assert_eq!(pv.storage_value, input.storage_value);
    }

    #[test]
    fn tampered_state_root_fails() {
        let mut input = load_fixture();
        input.state_root[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_storage_value_fails() {
        let mut input = load_fixture();
        input.storage_value[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_account_proof_node_fails() {
        let mut input = load_fixture();
        if let Some(node) = input.account_proof.first_mut() {
            node[0] ^= 0xFF;
        }
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_storage_proof_node_fails() {
        let mut input = load_fixture();
        if let Some(node) = input.storage_proof.first_mut() {
            node[0] ^= 0xFF;
        }
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_contract_address_fails() {
        let mut input = load_fixture();
        input.contract_address[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_storage_hash_fails() {
        let mut input = load_fixture();
        input.storage_hash[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_nonce_fails() {
        let mut input = load_fixture();
        input.nonce ^= 0xFFFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_balance_fails() {
        let mut input = load_fixture();
        input.balance[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_code_hash_fails() {
        let mut input = load_fixture();
        input.code_hash[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }

    #[test]
    fn tampered_storage_slot_fails() {
        let mut input = load_fixture();
        input.storage_slot[0] ^= 0xFF;
        assert!(verify_mpt_proof(&input).is_err());
    }
}

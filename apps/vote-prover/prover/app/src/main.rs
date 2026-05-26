#![no_main]

use vote_prover_lib::{verify_mpt_proof, EthProofInput};

pico_sdk::entrypoint!(main);

pub fn main() {
    let input: EthProofInput = pico_sdk::io::read_as();
    let public_values = verify_mpt_proof(&input).expect("MPT verification failed");
    pico_sdk::io::commit(&public_values);
}

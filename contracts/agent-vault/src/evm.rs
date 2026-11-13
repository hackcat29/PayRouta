// EIP-1559 transactions for an ERC-20 transfer, built and hashed inside the
// contract so the MPC network signs only what the vault's policy allowed.
use near_sdk::{env, near};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Eip1559 {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    /// The ERC-20 contract, 20 bytes.
    pub token: [u8; 20],
    pub to: [u8; 20],
    pub amount: u128,
}

fn rlp_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.len() == 1 && bytes[0] < 0x80 {
        out.push(bytes[0]);
    } else {
        rlp_length(out, bytes.len(), 0x80);
        out.extend_from_slice(bytes);
    }
}

fn rlp_length(out: &mut Vec<u8>, len: usize, offset: u8) {
    if len < 56 {
        out.push(offset + len as u8);
    } else {
        let be = (len as u64).to_be_bytes();
        let start = be.iter().position(|b| *b != 0).unwrap_or(7);
        out.push(offset + 55 + (8 - start) as u8);
        out.extend_from_slice(&be[start..]);
    }
}

/// An unsigned integer as RLP: big-endian with no leading zeros; zero is empty.
fn rlp_uint(out: &mut Vec<u8>, value: &[u8]) {
    let start = value.iter().position(|b| *b != 0).unwrap_or(value.len());
    rlp_bytes(out, &value[start..]);
}

fn rlp_list(items: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(items.len() + 9);
    rlp_length(&mut out, items.len(), 0xc0);
    out.extend_from_slice(items);
    out
}

/// transfer(address,uint256)
pub fn transfer_data(to: &[u8; 20], amount: u128) -> Vec<u8> {
    let mut data = Vec::with_capacity(68);
    data.extend_from_slice(&[0xa9, 0x05, 0x9c, 0xbb]);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(to);
    data.extend_from_slice(&[0u8; 16]);
    data.extend_from_slice(&amount.to_be_bytes());
    data
}

impl Eip1559 {
    fn fields(&self) -> Vec<u8> {
        let mut f = Vec::with_capacity(160);
        rlp_uint(&mut f, &self.chain_id.to_be_bytes());
        rlp_uint(&mut f, &self.nonce.to_be_bytes());
        rlp_uint(&mut f, &self.max_priority_fee_per_gas.to_be_bytes());
        rlp_uint(&mut f, &self.max_fee_per_gas.to_be_bytes());
        rlp_uint(&mut f, &self.gas_limit.to_be_bytes());
        rlp_bytes(&mut f, &self.token);
        rlp_uint(&mut f, &[]); // value: no ETH
        rlp_bytes(&mut f, &transfer_data(&self.to, self.amount));
        f.push(0xc0); // empty access list
        f
    }

    /// The bytes the sender signs: keccak256(0x02 || rlp(fields)).
    pub fn signing_hash(&self) -> [u8; 32] {
        let mut payload = vec![0x02];
        payload.extend(rlp_list(&self.fields()));
        env::keccak256_array(&payload)
    }

    /// The signed transaction, ready for eth_sendRawTransaction.
    pub fn signed(&self, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
        let mut f = self.fields();
        rlp_uint(&mut f, &[y_parity]);
        rlp_uint(&mut f, r);
        rlp_uint(&mut f, s);
        let mut out = vec![0x02];
        out.extend(rlp_list(&f));
        out
    }
}

pub fn parse_address(value: &str) -> Option<[u8; 20]> {
    let hex_part = value.strip_prefix("0x")?;
    if hex_part.len() != 40 {
        return None;
    }
    let bytes = hex::decode(hex_part).ok()?;
    bytes.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_lengths() {
        let mut out = Vec::new();
        rlp_bytes(&mut out, &[0x7f]);
        assert_eq!(out, vec![0x7f]);
        let mut out = Vec::new();
        rlp_bytes(&mut out, &[0x80]);
        assert_eq!(out, vec![0x81, 0x80]);
        let mut out = Vec::new();
        rlp_uint(&mut out, &0u64.to_be_bytes());
        assert_eq!(out, vec![0x80]);
        let mut out = Vec::new();
        rlp_bytes(&mut out, &[1u8; 60]);
        assert_eq!(&out[..2], &[0xb8, 60]);
    }

    #[test]
    fn transfer_calldata() {
        let to = parse_address("0x59ee649f1d4437374b42dbe3897ab894937f2744").unwrap();
        let data = transfer_data(&to, 2_000_000);
        assert_eq!(
            hex::encode(&data),
            "a9059cbb00000000000000000000000059ee649f1d4437374b42dbe3897ab894937f274400000000000000000000000000000000000000000000000000000000001e8480"
        );
    }

    #[test]
    fn rejects_bad_addresses() {
        assert!(parse_address("59ee649f1d4437374b42dbe3897ab894937f2744").is_none());
        assert!(parse_address("0x59ee").is_none());
        assert!(parse_address("0xzzee649f1d4437374b42dbe3897ab894937f2744").is_none());
    }
}

// Unit tests: every rule `pay` enforces, against orders signed the way
// PayRouta signs them.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{VMContextBuilder, accounts, get_logs};
use near_sdk::testing_env;

const VAULT: &str = "vault.testnet";
const TOKEN: &str = "usdc.testnet";

fn payrouta() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn agent_key() -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, vec![9u8; 32]).unwrap()
}
fn key_of(k: &SigningKey) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, k.verifying_key().to_bytes().to_vec()).unwrap()
}

fn context(predecessor: &str, signer_pk: PublicKey, now_ms: u64) {
    let vault: AccountId = VAULT.parse().unwrap();
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault)
        .predecessor_account_id(predecessor.parse().unwrap())
        .signer_account_pk(signer_pk)
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(NearToken::from_millinear(10))
        .build());
}

fn vault() -> Vault {
    context(accounts(0).as_str(), agent_key(), 1_000);
    let mut v = Vault::new(
        accounts(0),
        "v1.signer-prod.testnet".parse().unwrap(),
        "near:testnet".to_string(),
        key_of(&payrouta()),
        false,
        U64(86_400_000),
        Policy {
            per_payment_cents: U64(2_500),
            budget_cents: U64(5_000),
            period_ms: U64(86_400_000),
            max_evm_fee_wei: U128(1_000_000_000_000_000),
            agent_gas_allowance: U128(250_000_000_000_000_000_000_000),
        },
    );
    v.allow_merchant("org_harbor".to_string());
    v.allow_token("near:testnet".to_string(), TOKEN.to_string(), 6);
    v.allow_token("eip155:84532".to_string(), "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(), 6);
    let _ = v.approve_agent(agent_key(), "Shopping agent".to_string());
    v
}

fn order(id: &str, merchant: &str, network: &str, token: &str, pay_to: &str, amount: u128, expires: u64) -> String {
    serde_json::json!({
        "id": id, "merchant": merchant, "merchant_name": "Harbor Audio", "network": network, "token": token,
        "pay_to": pay_to, "amount": amount.to_string(), "expires_at_ms": expires.to_string(),
    })
    .to_string()
}
fn sign(k: &SigningKey, order: &str) -> String {
    let mut m = ORDER_DOMAIN.to_vec();
    m.extend_from_slice(order.as_bytes());
    hex::encode(k.sign(&m).to_bytes())
}
fn near_order(id: &str, amount: u128) -> String {
    order(id, "org_harbor", "near:testnet", TOKEN, "payrouta-merchant.testnet", amount, 10_000)
}
fn as_agent() {
    context(VAULT, agent_key(), 2_000);
}

#[test]
fn pays_a_signed_order_within_the_policy() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 20_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    assert!(v.is_paid("pay_1".to_string()));
    assert_eq!(v.get_spending().spent_cents.0, 2_000);
    assert!(get_logs().iter().any(|l| l.contains("payment_allowed")));
}

#[test]
#[should_panic(expected = "The order isn't signed by PayRouta")]
fn refuses_an_order_the_agent_signed_itself() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 1_000_000);
    let _ = v.pay(o.clone(), sign(&SigningKey::from_bytes(&[8u8; 32]), &o), None);
}

#[test]
#[should_panic(expected = "The order isn't signed by PayRouta")]
fn refuses_an_order_changed_after_signing() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 1_000_000);
    let s = sign(&payrouta(), &o);
    let _ = v.pay(o.replace("payrouta-merchant.testnet", "attacker.testnet"), s, None);
}

#[test]
#[should_panic(expected = "This merchant isn't on the vault's allow-list")]
fn refuses_a_merchant_not_allowed() {
    let mut v = vault();
    as_agent();
    let o = order("pay_2", "org_unknown", "near:testnet", TOKEN, "shop.testnet", 1_000_000, 10_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "The amount is over the per-payment cap")]
fn refuses_over_the_per_payment_cap() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_3", 400_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "The payment would exceed the budget for this period")]
fn refuses_past_the_budget() {
    let mut v = vault();
    as_agent();
    for (i, amount) in [20_000_000u128, 20_000_000, 20_000_000].iter().enumerate() {
        let o = near_order(&format!("pay_{i}"), *amount);
        let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    }
}

#[test]
fn the_budget_resets_each_period() {
    let mut v = vault();
    as_agent();
    for i in 0..2 {
        let o = near_order(&format!("pay_{i}"), 25_000_000);
        let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    }
    context(VAULT, agent_key(), 2_000 + 86_400_000);
    let o = order("pay_next_day", "org_harbor", "near:testnet", TOKEN, "payrouta-merchant.testnet", 25_000_000, 200_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    assert_eq!(v.get_spending().spent_cents.0, 2_500);
}

#[test]
#[should_panic(expected = "This order is already paid")]
fn pays_an_order_once() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "The order has expired")]
fn refuses_an_expired_order() {
    let mut v = vault();
    context(VAULT, agent_key(), 20_000);
    let o = near_order("pay_1", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "This token isn't allowed on that network")]
fn refuses_a_token_not_allowed() {
    let mut v = vault();
    as_agent();
    let o = order("pay_1", "org_harbor", "near:testnet", "wrap.testnet", "payrouta-merchant.testnet", 1_000_000, 10_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "Not an agent of this vault")]
fn refuses_a_key_that_is_not_an_agent() {
    let mut v = vault();
    context(VAULT, PublicKey::from_parts(CurveType::ED25519, vec![3u8; 32]).unwrap(), 2_000);
    let o = near_order("pay_1", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "Only this vault's agents can pay")]
fn refuses_calls_from_other_accounts() {
    let mut v = vault();
    context("attacker.testnet", agent_key(), 2_000);
    let o = near_order("pay_1", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_changes_the_policy() {
    let mut v = vault();
    as_agent();
    v.allow_merchant("org_unknown".to_string());
}

#[test]
fn an_approved_local_agent_does_not_expire() {
    let mut v = vault();
    context(VAULT, agent_key(), 1_000 + 400 * 86_400_000);
    let o = order("pay_1", "org_harbor", "near:testnet", TOKEN, "payrouta-merchant.testnet", 1_000_000, u64::MAX);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    assert!(v.is_paid("pay_1".to_string()));
}

#[test]
#[should_panic(expected = "The gas fee is over the vault's cap")]
fn caps_evm_gas_fees() {
    let mut v = vault();
    as_agent();
    let o = order("pay_1", "org_harbor", "eip155:84532", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "0x59ee649f1D4437374B42Dbe3897AB894937F2744", 1_000_000, 10_000);
    let gas = EvmGas { nonce: U64(0), gas_limit: U64(100_000), max_fee_per_gas: U128(100_000_000_000), max_priority_fee_per_gas: U128(1) };
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), Some(gas));
}

#[test]
fn signs_an_evm_payment_within_the_policy() {
    let mut v = vault();
    as_agent();
    let o = order("pay_1", "org_harbor", "eip155:84532", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "0x59ee649f1D4437374B42Dbe3897AB894937F2744", 1_000_000, 10_000);
    let gas = EvmGas { nonce: U64(0), gas_limit: U64(80_000), max_fee_per_gas: U128(2_000_000_000), max_priority_fee_per_gas: U128(1_000_000) };
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), Some(gas));
    assert_eq!(v.get_spending().spent_cents.0, 100);
}

#[test]
fn a_failed_payment_releases_its_budget() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 20_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    context(VAULT, agent_key(), 2_500);
    assert!(!v.on_near_paid("pay_1".to_string(), U64(2_000), U64(1_000), Err(PromiseError::Failed)));
    assert!(!v.is_paid("pay_1".to_string()));
    assert_eq!(v.get_spending().spent_cents.0, 0);
}

#[test]
fn cents_round_up() {
    assert_eq!(to_cents(1, 6), 1);
    assert_eq!(to_cents(10_000, 6), 1);
    assert_eq!(to_cents(10_001, 6), 2);
    assert_eq!(to_cents(2_000_929, 6), 201);
    assert_eq!(to_cents(1_000_000_000_000_000_000, 18), 100);
}

#[test]
#[should_panic(expected = "This vault is in local mode")]
fn local_vaults_take_no_attestations() {
    let mut v = vault();
    let attestation: DstackAttestation = shade_attestation::attestation::create_mock_dstack_attestation();
    let _ = v.register_agent(attestation, Some(agent_key()), Some("x".to_string()));
}

#[test]
fn the_owner_can_start_a_new_period() {
    let mut v = vault();
    as_agent();
    let o = near_order("pay_1", 20_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    context(accounts(0).as_str(), agent_key(), 3_000);
    v.reset_spending();
    assert_eq!(v.get_spending().spent_cents.0, 0);
}

#[test]
#[should_panic(expected = "Attestation rejected")]
fn tee_vaults_reject_an_attestation_that_is_not_a_genuine_tdx_quote() {
    context(accounts(0).as_str(), agent_key(), 1_000);
    let mut v = Vault::new(
        accounts(0),
        "v1.signer-prod.testnet".parse().unwrap(),
        "near:testnet".to_string(),
        key_of(&payrouta()),
        true,
        U64(86_400_000),
        Policy {
            per_payment_cents: U64(2_500),
            budget_cents: U64(5_000),
            period_ms: U64(86_400_000),
            max_evm_fee_wei: U128(1_000_000_000_000_000),
            agent_gas_allowance: U128(250_000_000_000_000_000_000_000),
        },
    );
    v.approve_measurements(create_mock_full_measurements_hex());
    v.approve_ppid(Ppid::default());
    let _ = v.register_agent(shade_attestation::attestation::create_mock_dstack_attestation(), Some(agent_key()), Some("Agent".to_string()));
}

#[test]
#[should_panic(expected = "This vault requires a TEE attestation")]
fn tee_vaults_take_no_owner_approvals() {
    context(accounts(0).as_str(), agent_key(), 1_000);
    let mut v = Vault::new(
        accounts(0),
        "v1.signer-prod.testnet".parse().unwrap(),
        "near:testnet".to_string(),
        key_of(&payrouta()),
        true,
        U64(86_400_000),
        Policy {
            per_payment_cents: U64(2_500),
            budget_cents: U64(5_000),
            period_ms: U64(86_400_000),
            max_evm_fee_wei: U128(1_000_000_000_000_000),
            agent_gas_allowance: U128(250_000_000_000_000_000_000_000),
        },
    );
    let _ = v.approve_agent(agent_key(), "Agent".to_string());
}

#[test]
fn a_shade_agent_pays_from_its_own_implicit_account() {
    let mut v = vault();
    // The agent's implicit account is its ed25519 key in hex.
    let implicit = hex::encode([9u8; 32]);
    context(&implicit, PublicKey::from_parts(CurveType::ED25519, vec![9u8; 32]).unwrap(), 2_000);
    assert!(v.get_agent(implicit.parse().unwrap()).is_some());
    let o = near_order("pay_shade", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
    assert!(v.is_paid("pay_shade".to_string()));
}

#[test]
#[should_panic(expected = "Not an agent of this vault")]
fn an_unregistered_implicit_account_cannot_pay() {
    let mut v = vault();
    let implicit = hex::encode([4u8; 32]);
    context(&implicit, PublicKey::from_parts(CurveType::ED25519, vec![4u8; 32]).unwrap(), 2_000);
    let o = near_order("pay_x", 1_000_000);
    let _ = v.pay(o.clone(), sign(&payrouta(), &o), None);
}

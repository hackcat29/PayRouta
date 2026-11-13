// PayRouta agent vault.
//
// An AI agent pays PayRouta checkouts from this account, on NEAR directly and
// on EVM chains through NEAR Chain Signatures, and this contract decides what
// it may pay. The agent never holds a key that can move funds:
//
// - Its key is a function-call access key on the vault account that can call
//   only `pay`, with a NEAR allowance for gas. It can't transfer NEAR, add
//   keys, deploy code or call any other contract.
// - The key is added only after the agent proves it runs inside a TEE (an
//   Intel TDX quote whose report data is the key, checked against approved
//   measurements: the Shade Agent attestation), or, in local mode, when the
//   owner approves it.
// - `pay` accepts only payment orders PayRouta signed for a checkout (the
//   merchant, the address to pay, the token and amount), so a prompt-injected
//   agent can't redirect funds to an address of its choosing.
// - The owner's policy is enforced on-chain: allowed merchants, allowed tokens,
//   a per-payment cap, a budget per period, and a cap on EVM gas fees.
// - On EVM chains the contract builds the ERC-20 transfer itself and asks the
//   MPC network (v1.signer) to sign its hash, so the vault's derived EVM
//   address only ever signs transfers this policy allowed.
use near_sdk::{
    AccountId, BorshStorageKey, CurveType, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey,
    env, ext_contract,
    json_types::{U64, U128},
    log, near, require,
    serde_json,
    store::{IterableMap, IterableSet, LookupSet},
};
use shade_attestation::{
    attestation::DstackAttestation,
    measurements::{FullMeasurements, FullMeasurementsHex, create_mock_full_measurements_hex},
    report_data::ReportData,
    tcb_info::HexBytes,
};

pub mod evm;
use evm::{Eip1559, parse_address};

pub type Ppid = HexBytes<16>;

const ORDER_DOMAIN: &[u8] = b"PayRouta agent order v1\n";
const SIGN_GAS: Gas = Gas::from_tgas(15);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const FT_GAS: Gas = Gas::from_tgas(10);
// NEP-145 registration for a NEP-141 token (USDC on NEAR takes 0.00125 NEAR);
// refunded when the receiver is already registered.
const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
// What a Shade Agent attaches to register_agent (shade-agent-js).
const AGENT_STORAGE: NearToken = NearToken::from_millinear(5);
const EVM_MAX_GAS_LIMIT: u64 = 150_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    /// The most one payment may be, in US cents.
    pub per_payment_cents: U64,
    /// The most all payments in one period may add up to, in US cents.
    pub budget_cents: U64,
    pub period_ms: U64,
    /// The most an EVM payment may pay in gas: gas_limit × max_fee_per_gas.
    pub max_evm_fee_wei: U128,
    /// NEAR each agent key may spend on gas before the owner tops it up.
    pub agent_gas_allowance: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub name: String,
    /// "tee" when added by a verified attestation, "local" when the owner approved it.
    pub mode: String,
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: U64,
}

/// A payment order PayRouta signed for one checkout.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Order {
    /// PayRouta's payment id; a vault pays an order once.
    pub id: String,
    /// The merchant's PayRouta id.
    pub merchant: String,
    pub merchant_name: String,
    /// near:mainnet, near:testnet or eip155:<chain id>.
    pub network: String,
    /// A NEP-141 contract on NEAR, an ERC-20 address on EVM chains.
    pub token: String,
    pub pay_to: String,
    /// Base units of the token.
    pub amount: U128,
    pub expires_at_ms: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EvmGas {
    pub nonce: U64,
    pub gas_limit: U64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Spending {
    pub spent_cents: U64,
    pub budget_cents: U64,
    pub period_started_ms: U64,
    pub period_ms: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EvmPayment {
    pub order: String,
    pub network: String,
    /// The signed EIP-1559 transaction; anyone may broadcast it.
    pub raw_transaction: String,
    pub transaction_hash: String,
}

// v1.signer's response for an ECDSA request.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AffinePoint {
    pub affine_point: String,
}
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Scalar {
    pub scalar: String,
}
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MpcSignature {
    pub scheme: Option<String>,
    pub big_r: AffinePoint,
    pub s: Scalar,
    pub recovery_id: u8,
}

#[near(serializers = [json])]
#[derive(Debug)]
pub enum MpcPayload {
    Ecdsa(String),
}
#[near(serializers = [json])]
#[derive(Debug)]
pub struct SignRequest {
    pub payload_v2: MpcPayload,
    pub path: String,
    pub domain_id: u64,
}

#[allow(dead_code)]
#[ext_contract(mpc)]
trait Mpc {
    fn sign(&mut self, request: SignRequest);
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Measurements,
    Ppids,
    Agents,
    Merchants,
    Tokens,
    Paid,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    mpc_contract_id: AccountId,
    /// near:mainnet or near:testnet: the network this vault pays on directly.
    near_network: String,
    /// The derivation path of the vault's EVM address.
    evm_path: String,
    /// PayRouta's order-signing key (ed25519).
    order_signer: PublicKey,
    requires_tee: bool,
    attestation_expiration_ms: u64,
    approved_measurements: IterableSet<FullMeasurementsHex>,
    approved_ppids: IterableSet<Ppid>,
    /// Agent public key ("ed25519:…") → agent.
    agents: IterableMap<String, Agent>,
    merchants: IterableSet<String>,
    /// "<network>|<token>" → decimals. Stablecoins worth one US dollar only,
    /// so a payment's amount is its value in dollars.
    tokens: IterableMap<String, u8>,
    paid: LookupSet<String>,
    policy: Policy,
    period_started_ms: u64,
    spent_cents: u64,
}

fn token_key(network: &str, token: &str) -> String {
    format!("{network}|{}", token.to_lowercase())
}

#[near]
impl Vault {
    #[init]
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner_id: AccountId,
        mpc_contract_id: AccountId,
        near_network: String,
        order_signer: PublicKey,
        requires_tee: bool,
        attestation_expiration_ms: U64,
        policy: Policy,
    ) -> Self {
        require!(near_network == "near:mainnet" || near_network == "near:testnet", "near_network must be near:mainnet or near:testnet");
        require!(order_signer.curve_type() == CurveType::ED25519, "order_signer must be an ed25519 key");
        let mut vault = Self {
            owner_id,
            mpc_contract_id,
            near_network,
            evm_path: "payrouta-agent-vault-evm-1".to_string(),
            order_signer,
            requires_tee,
            attestation_expiration_ms: attestation_expiration_ms.0,
            approved_measurements: IterableSet::new(Key::Measurements),
            approved_ppids: IterableSet::new(Key::Ppids),
            agents: IterableMap::new(Key::Agents),
            merchants: IterableSet::new(Key::Merchants),
            tokens: IterableMap::new(Key::Tokens),
            paid: LookupSet::new(Key::Paid),
            policy,
            period_started_ms: env::block_timestamp_ms(),
            spent_cents: 0,
        };
        if !requires_tee {
            // Local mode: agents carry the mock measurements and PPID.
            vault.approved_measurements.insert(create_mock_full_measurements_hex());
            vault.approved_ppids.insert(Ppid::default());
        }
        vault
    }

    // ---- Agents -------------------------------------------------------------

    /// An agent running in a TEE registers its key with its attestation. The
    /// quote's report data must be the key (32 bytes, then zeros), so only a
    /// key generated inside an approved TEE image gets added. Anyone may
    /// submit it; the attestation is the proof.
    ///
    /// A Shade Agent (shade-agent-js `ShadeClient.register()`) calls this from
    /// its own implicit account with only the attestation: the key is that
    /// account's, and the agent then pays by calling `pay` from it.
    #[payable]
    pub fn register_agent(&mut self, attestation: DstackAttestation, public_key: Option<PublicKey>, name: Option<String>) -> Promise {
        require!(self.requires_tee, "This vault is in local mode: the owner approves agents");
        require!(env::attached_deposit() >= AGENT_STORAGE, "Attach 0.005 NEAR for the agent's storage");
        let public_key = public_key
            .or_else(|| implicit_key(&env::predecessor_account_id()))
            .unwrap_or_else(|| env::panic_str("Pass public_key, or call from the agent's implicit account"));
        let name = name.unwrap_or_else(|| "Shade Agent".to_string());
        let key = ed25519_bytes(&public_key);
        let mut report = [0u8; 64];
        report[..32].copy_from_slice(&key);
        let measurements: Vec<FullMeasurements> = self.approved_measurements.iter().cloned().map(Into::into).collect();
        let ppids: Vec<Ppid> = self.approved_ppids.iter().cloned().collect();
        let accepted = attestation
            .verify(ReportData::from(report), env::block_timestamp_ms() / 1000, &measurements, &ppids)
            .unwrap_or_else(|e| env::panic_str(&format!("Attestation rejected: {e}")));
        self.add_agent(public_key, name, "tee", accepted.measurements.into(), accepted.ppid)
    }

    /// Local mode: the owner approves an agent key without an attestation.
    pub fn approve_agent(&mut self, public_key: PublicKey, name: String) -> Promise {
        self.require_owner();
        require!(!self.requires_tee, "This vault requires a TEE attestation: the agent calls register_agent");
        ed25519_bytes(&public_key);
        self.add_agent(public_key, name, "local", create_mock_full_measurements_hex(), Ppid::default())
    }

    /// Removes the agent and deletes its key.
    pub fn remove_agent(&mut self, public_key: PublicKey) -> Promise {
        self.require_owner();
        let id = String::from(&public_key);
        require!(self.agents.remove(&id).is_some(), "Not an agent of this vault");
        Event::emit("agent_removed", serde_json::json!({ "public_key": id }));
        Promise::new(env::current_account_id()).delete_key(public_key)
    }

    // ---- Paying -------------------------------------------------------------

    /// Pays one PayRouta order, signed by PayRouta, within the policy. On NEAR
    /// the vault transfers the token; on an EVM chain it returns the signed
    /// transaction (EvmPayment) for the agent to broadcast.
    pub fn pay(&mut self, order: String, signature: String, evm: Option<EvmGas>) -> Promise {
        // Agents call through their function-call key on this account, or, as
        // a Shade Agent, from their own implicit account.
        let signer = if env::predecessor_account_id() == env::current_account_id() {
            String::from(&env::signer_account_pk())
        } else {
            implicit_key(&env::predecessor_account_id())
                .map(|k| String::from(&k))
                .unwrap_or_else(|| env::panic_str("Only this vault's agents can pay"))
        };
        let agent = self.agents.get(&signer).unwrap_or_else(|| env::panic_str("Not an agent of this vault")).clone();
        require!(agent.valid_until_ms.0 >= env::block_timestamp_ms(), "The agent's attestation has expired");
        require!(self.approved_measurements.contains(&agent.measurements), "The agent's TEE image is no longer approved");
        require!(self.approved_ppids.contains(&agent.ppid), "The agent's TEE hardware is no longer approved");

        let sig: [u8; 64] = decode_signature(&signature);
        let mut message = ORDER_DOMAIN.to_vec();
        message.extend_from_slice(order.as_bytes());
        let signer_key: [u8; 32] = self.order_signer.as_bytes()[1..].try_into().unwrap();
        require!(env::ed25519_verify(&sig, &message, &signer_key), "The order isn't signed by PayRouta");
        let o: Order = serde_json::from_str(&order).unwrap_or_else(|_| env::panic_str("The order isn't valid JSON"));

        require!(o.expires_at_ms.0 > env::block_timestamp_ms(), "The order has expired");
        require!(!self.paid.contains(&o.id), "This order is already paid");
        require!(self.merchants.contains(&o.merchant), "This merchant isn't on the vault's allow-list");
        let decimals = *self
            .tokens
            .get(&token_key(&o.network, &o.token))
            .unwrap_or_else(|| env::panic_str("This token isn't allowed on that network"));
        require!(o.amount.0 > 0, "The amount must be positive");
        let cents = to_cents(o.amount.0, decimals);
        require!(cents <= self.policy.per_payment_cents.0, "The amount is over the per-payment cap");

        let now = env::block_timestamp_ms();
        if now >= self.period_started_ms + self.policy.period_ms.0 {
            self.period_started_ms = now;
            self.spent_cents = 0;
        }
        require!(self.spent_cents + cents <= self.policy.budget_cents.0, "The payment would exceed the budget for this period");
        self.spent_cents += cents;
        self.paid.insert(o.id.clone());
        let period = self.period_started_ms;
        Event::emit(
            "payment_allowed",
            serde_json::json!({ "order": o.id, "merchant": o.merchant, "network": o.network, "pay_to": o.pay_to, "amount": o.amount, "cents": cents, "agent": signer }),
        );

        if o.network == self.near_network {
            require!(evm.is_none(), "EVM gas settings are for EVM payments");
            let receiver: AccountId = o.pay_to.parse().unwrap_or_else(|_| env::panic_str("pay_to isn't a NEAR account"));
            let token: AccountId = o.token.parse().unwrap_or_else(|_| env::panic_str("token isn't a NEAR account"));
            Promise::new(token)
                .function_call(
                    "storage_deposit".to_string(),
                    serde_json::to_vec(&serde_json::json!({ "account_id": receiver, "registration_only": true })).unwrap(),
                    STORAGE_DEPOSIT,
                    FT_GAS,
                )
                .function_call(
                    "ft_transfer".to_string(),
                    serde_json::to_vec(&serde_json::json!({ "receiver_id": receiver, "amount": o.amount, "memo": format!("PayRouta {}", o.id) })).unwrap(),
                    NearToken::from_yoctonear(1),
                    FT_GAS,
                )
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_near_paid(o.id, U64(cents), U64(period)))
        } else if let Some(chain) = o.network.strip_prefix("eip155:") {
            let gas = evm.unwrap_or_else(|| env::panic_str("EVM payments need nonce and gas settings"));
            require!(gas.gas_limit.0 <= EVM_MAX_GAS_LIMIT, "gas_limit is over 150000");
            require!(gas.max_priority_fee_per_gas.0 <= gas.max_fee_per_gas.0, "max_priority_fee_per_gas is over max_fee_per_gas");
            let fee = (gas.gas_limit.0 as u128).checked_mul(gas.max_fee_per_gas.0).unwrap_or(u128::MAX);
            require!(fee <= self.policy.max_evm_fee_wei.0, "The gas fee is over the vault's cap");
            let tx = Eip1559 {
                chain_id: chain.parse().unwrap_or_else(|_| env::panic_str("Invalid chain id")),
                nonce: gas.nonce.0,
                max_priority_fee_per_gas: gas.max_priority_fee_per_gas.0,
                max_fee_per_gas: gas.max_fee_per_gas.0,
                gas_limit: gas.gas_limit.0,
                token: parse_address(&o.token).unwrap_or_else(|| env::panic_str("token isn't an EVM address")),
                to: parse_address(&o.pay_to).unwrap_or_else(|| env::panic_str("pay_to isn't an EVM address")),
                amount: o.amount.0,
            };
            mpc::ext(self.mpc_contract_id.clone())
                .with_static_gas(SIGN_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .sign(SignRequest { payload_v2: MpcPayload::Ecdsa(hex::encode(tx.signing_hash())), path: self.evm_path.clone(), domain_id: 0 })
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_evm_signed(o.id, o.network, tx, U64(cents), U64(period)))
        } else {
            env::panic_str("Unsupported network")
        }
    }

    #[private]
    pub fn on_near_paid(&mut self, order: String, cents: U64, period: U64, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            Event::emit("payment_sent", serde_json::json!({ "order": order }));
            return true;
        }
        self.release(&order, cents.0, period.0);
        false
    }

    #[private]
    pub fn on_evm_signed(
        &mut self,
        order: String,
        network: String,
        tx: Eip1559,
        cents: U64,
        period: U64,
        #[callback_result] result: Result<MpcSignature, PromiseError>,
    ) -> PromiseOrValue<Option<EvmPayment>> {
        let Ok(sig) = result else {
            self.release(&order, cents.0, period.0);
            return PromiseOrValue::Value(None);
        };
        let big_r = hex::decode(&sig.big_r.affine_point).unwrap_or_default();
        let s: [u8; 32] = hex::decode(&sig.s.scalar).ok().and_then(|v| v.try_into().ok()).unwrap_or_else(|| env::panic_str("Bad signature"));
        require!(big_r.len() == 33, "Bad signature");
        let r: [u8; 32] = big_r[1..].try_into().unwrap();
        let raw = tx.signed(sig.recovery_id, &r, &s);
        let hash = env::keccak256_array(&raw);
        Event::emit("payment_signed", serde_json::json!({ "order": order, "transaction_hash": format!("0x{}", hex::encode(hash)) }));
        PromiseOrValue::Value(Some(EvmPayment {
            order,
            network,
            raw_transaction: format!("0x{}", hex::encode(raw)),
            transaction_hash: format!("0x{}", hex::encode(hash)),
        }))
    }

    // ---- Owner --------------------------------------------------------------

    pub fn set_policy(&mut self, policy: Policy) {
        self.require_owner();
        self.policy = policy;
    }
    /// Starts a new budget period now.
    pub fn reset_spending(&mut self) {
        self.require_owner();
        self.period_started_ms = env::block_timestamp_ms();
        self.spent_cents = 0;
        Event::emit("spending_reset", serde_json::json!({}));
    }
    pub fn allow_merchant(&mut self, merchant: String) {
        self.require_owner();
        self.merchants.insert(merchant);
    }
    pub fn remove_merchant(&mut self, merchant: String) {
        self.require_owner();
        self.merchants.remove(&merchant);
    }
    /// A US-dollar stablecoin the vault may pay with.
    pub fn allow_token(&mut self, network: String, token: String, decimals: u8) {
        self.require_owner();
        require!((2..=24).contains(&decimals), "decimals must be 2 to 24");
        self.tokens.insert(token_key(&network, &token), decimals);
    }
    pub fn remove_token(&mut self, network: String, token: String) {
        self.require_owner();
        self.tokens.remove(&token_key(&network, &token));
    }
    pub fn set_order_signer(&mut self, order_signer: PublicKey) {
        self.require_owner();
        require!(order_signer.curve_type() == CurveType::ED25519, "order_signer must be an ed25519 key");
        self.order_signer = order_signer;
    }
    pub fn approve_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.require_owner();
        self.approved_measurements.insert(measurements);
    }
    pub fn remove_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.require_owner();
        self.approved_measurements.remove(&measurements);
    }
    pub fn approve_ppid(&mut self, ppid: Ppid) {
        self.require_owner();
        self.approved_ppids.insert(ppid);
    }
    pub fn remove_ppid(&mut self, ppid: Ppid) {
        self.require_owner();
        self.approved_ppids.remove(&ppid);
    }

    // ---- Views --------------------------------------------------------------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }
    pub fn get_spending(&self) -> Spending {
        let fresh = env::block_timestamp_ms() >= self.period_started_ms + self.policy.period_ms.0;
        Spending {
            spent_cents: U64(if fresh { 0 } else { self.spent_cents }),
            budget_cents: self.policy.budget_cents,
            period_started_ms: U64(self.period_started_ms),
            period_ms: self.policy.period_ms,
        }
    }
    pub fn get_agents(&self) -> Vec<(String, Agent)> {
        self.agents.iter().map(|(k, a)| (k.clone(), a.clone())).collect()
    }
    /// An agent by its implicit account (as shade-agent-js asks), or None.
    pub fn get_agent(&self, account_id: AccountId) -> Option<Agent> {
        implicit_key(&account_id).and_then(|k| self.agents.get(&String::from(&k)).cloned())
    }
    pub fn get_merchants(&self) -> Vec<String> {
        self.merchants.iter().cloned().collect()
    }
    pub fn get_tokens(&self) -> Vec<(String, u8)> {
        self.tokens.iter().map(|(k, d)| (k.clone(), *d)).collect()
    }
    pub fn is_paid(&self, order: String) -> bool {
        self.paid.contains(&order)
    }
    pub fn get_config(&self) -> serde_json::Value {
        serde_json::json!({
            "owner_id": self.owner_id,
            "mpc_contract_id": self.mpc_contract_id,
            "near_network": self.near_network,
            "evm_path": self.evm_path,
            "order_signer": self.order_signer,
            "requires_tee": self.requires_tee,
            "attestation_expiration_ms": U64(self.attestation_expiration_ms),
        })
    }
}

impl Vault {
    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the owner can do this");
    }

    fn add_agent(&mut self, public_key: PublicKey, name: String, mode: &str, measurements: FullMeasurementsHex, ppid: Ppid) -> Promise {
        require!(name.len() <= 64, "name is over 64 characters");
        let id = String::from(&public_key);
        self.agents.insert(
            id.clone(),
            Agent {
                name,
                mode: mode.to_string(),
                measurements,
                ppid,
                // An attestation expires and the agent re-attests; the owner's
                // approval lasts until the owner removes the agent.
                valid_until_ms: U64(if mode == "tee" { env::block_timestamp_ms() + self.attestation_expiration_ms } else { u64::MAX }),
            },
        );
        Event::emit("agent_added", serde_json::json!({ "public_key": id, "mode": mode }));
        let allowance = near_sdk::Allowance::limited(NearToken::from_yoctonear(self.policy.agent_gas_allowance.0))
            .unwrap_or_else(|| env::panic_str("agent_gas_allowance must be positive"));
        // The key can only call `pay` on this contract.
        Promise::new(env::current_account_id()).add_access_key_allowance(public_key, allowance, env::current_account_id(), "pay")
    }

    fn release(&mut self, order: &str, cents: u64, period: u64) {
        self.paid.remove(&order.to_string());
        if period == self.period_started_ms {
            self.spent_cents = self.spent_cents.saturating_sub(cents);
        }
        Event::emit("payment_failed", serde_json::json!({ "order": order }));
    }
}

/// The ed25519 key of an implicit account (64 lowercase hex characters).
fn implicit_key(account: &AccountId) -> Option<PublicKey> {
    let id = account.as_str();
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    PublicKey::from_parts(CurveType::ED25519, hex::decode(id).ok()?).ok()
}

fn ed25519_bytes(key: &PublicKey) -> [u8; 32] {
    require!(key.curve_type() == CurveType::ED25519, "Agent keys must be ed25519");
    key.as_bytes()[1..].try_into().unwrap()
}

fn decode_signature(value: &str) -> [u8; 64] {
    let hex_part = value.strip_prefix("0x").unwrap_or(value);
    hex::decode(hex_part).ok().and_then(|v| v.try_into().ok()).unwrap_or_else(|| env::panic_str("The order signature must be 64 bytes of hex"))
}

/// Base units of a one-dollar stablecoin as US cents, rounded up.
pub fn to_cents(amount: u128, decimals: u8) -> u64 {
    let unit = 10u128.pow(decimals as u32 - 2);
    let cents = amount.div_ceil(unit);
    u64::try_from(cents).unwrap_or(u64::MAX)
}

struct Event;
impl Event {
    fn emit(event: &str, data: serde_json::Value) {
        log!(
            "EVENT_JSON:{}",
            serde_json::json!({ "standard": "payrouta-agent-vault", "version": "1.0.0", "event": event, "data": [data] })
        );
    }
}

#[cfg(test)]
mod tests;

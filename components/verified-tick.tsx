// The tick beside a merchant's name at checkout: PayRouta has verified who
// they are (lib/merchant/requirements.ts identityVerified). Never shown for
// merchants who haven't been, and nothing replaces it for them.
export function VerifiedTick() {
  return (
    <svg className="verified-tick" role="img" aria-label="Verified by PayRouta" viewBox="0 0 24 24" width="16" height="16">
      <title>Verified by PayRouta</title>
      <path
        fill="#2e37a4"
        d="M12 1.5l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1z"
      />
      <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M7.8 12.3l2.8 2.8 5.6-5.8" />
    </svg>
  );
}

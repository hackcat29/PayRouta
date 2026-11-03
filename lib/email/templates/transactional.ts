// Account mail: sign-up verification, password reset and change, team
// invitations and newsletter confirmation. These are sent because of an action
// the recipient (or their team) took, so they carry no unsubscribe link.
import { esc, greeting, renderBaseTemplate, stripHtmlToText } from "./base";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function render(
  subject: string,
  props: Parameters<typeof renderBaseTemplate>[0],
): RenderedEmail {
  const html = renderBaseTemplate(props);
  return { subject, html, text: stripHtmlToText(html) };
}

const ignore = (what: string) =>
  `<p style="color:#62668a;font-size:13px;margin:24px 0 0;">If you didn't ${what}, you can ignore this email.</p>`;

const linkFallback = (url: string) =>
  `<p style="color:#62668a;font-size:13px;margin:16px 0 0;">Or paste this link into your browser:<br><a href="${esc(url)}" style="word-break:break-all;">${esc(url)}</a></p>`;

export function renderVerifyEmail(p: { name?: string | null; url: string }): RenderedEmail {
  return render("Confirm your email for PayRouta", {
    previewText: "Confirm your email to finish creating your account.",
    headline: "Confirm your email",
    bodyContent: `<p>${greeting(p.name)}</p><p>Confirm this is your email address to finish creating your PayRouta account. The link expires in one hour.</p>`,
    ctaText: "Confirm email",
    ctaUrl: p.url,
    afterCta: linkFallback(p.url) + ignore("create a PayRouta account"),
  });
}

export function renderResetPasswordEmail(p: { name?: string | null; url: string }): RenderedEmail {
  return render("Reset your PayRouta password", {
    previewText: "Use this link to choose a new password.",
    headline: "Reset your password",
    bodyContent: `<p>${greeting(p.name)}</p><p>Someone asked to reset the password for this PayRouta account. Use the button below to choose a new one. The link expires in one hour and works once.</p>`,
    ctaText: "Choose a new password",
    ctaUrl: p.url,
    afterCta: linkFallback(p.url) + ignore("ask for this. Your password hasn't changed"),
  });
}

export function renderPasswordChangedEmail(p: {
  name?: string | null;
  when: Date;
  signInUrl: string;
}): RenderedEmail {
  const when = p.when.toUTCString().replace("GMT", "UTC");
  return render("Your PayRouta password was changed", {
    previewText: `Your password was changed on ${when}.`,
    headline: "Your password was changed",
    bodyContent: `<p>${greeting(p.name)}</p><p>The password for your PayRouta account was changed on ${esc(when)}. We signed you out on every device, so you'll need the new password to sign in again.</p><p><strong>If this wasn't you</strong>, reset your password now and reply to this email so we can secure your account.</p>`,
    ctaText: "Sign in",
    ctaUrl: p.signInUrl,
  });
}

export function renderInvitationEmail(p: {
  orgName?: string | null;
  role: string;
  url: string;
  expires: string;
}): RenderedEmail {
  const team = p.orgName ? esc(p.orgName) : "a team";
  return render(`You're invited to join ${p.orgName || "a team"} on PayRouta`, {
    previewText: `Join ${p.orgName || "the team"} as ${p.role}.`,
    headline: `Join ${p.orgName || "your team"} on PayRouta`,
    bodyContent: `<p>Hi,</p><p>You've been invited to join ${team} on PayRouta as <strong>${esc(p.role)}</strong>. Sign in or create an account with this email address to accept. The invitation expires in ${esc(p.expires)}.</p>`,
    ctaText: "Accept invitation",
    ctaUrl: p.url,
    afterCta: linkFallback(p.url) + ignore("expect an invitation"),
  });
}

export function renderConfirmSubscriptionEmail(p: { name?: string | null; url: string }): RenderedEmail {
  return render("Confirm your PayRouta subscription", {
    previewText: "One click to confirm you want our emails.",
    headline: "Confirm your subscription",
    bodyContent: `<p>${greeting(p.name)}</p><p>Please confirm you want to get emails from PayRouta: product updates and the occasional guide. We won't email you again unless you confirm.</p>`,
    ctaText: "Confirm subscription",
    ctaUrl: p.url,
    afterCta: ignore("sign up"),
  });
}

const codePurpose = {
  "sign-in": ["Your sign-in code", "sign-in code", "Use this code to sign in to PayRouta.", "try to sign in"],
  "email-verification": ["Confirm your email", "confirmation code", "Use this code to confirm your email address.", "create a PayRouta account"],
  "forget-password": ["Reset your password", "password reset code", "Use this code to choose a new password.", "ask to reset your password"],
  "change-email": ["Confirm your new email", "confirmation code", "Use this code to confirm your new email address.", "ask to change your email"],
} as const;

// One-time codes for passwordless sign-in and the other email-OTP flows.
export function renderOneTimeCodeEmail(p: { code: string; type: keyof typeof codePurpose; minutes: number }): RenderedEmail {
  const [headline, noun, intro, action] = codePurpose[p.type];
  return render(`${p.code} is your PayRouta ${noun}`, {
    previewText: `${intro} It expires in ${p.minutes} minutes.`,
    headline,
    bodyContent: `<p>${intro} It expires in ${p.minutes} minutes and works once.</p>
<p style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;letter-spacing:6px;font-weight:700;color:#1e2466;margin:8px 0 20px;">${esc(p.code)}</p>
<p style="color:#62668a;font-size:13px;">Never share this code. PayRouta will never ask you for it.</p>`,
    afterCta: ignore(action),
  });
}

// Provider access requests: an acknowledgement, then an approval (which
// carries the owner invitation) or a decline.
export function renderProviderAccessReceivedEmail(p: { name?: string | null; company: string }): RenderedEmail {
  return render("We've received your PayRouta provider request", {
    previewText: `Our team will review ${p.company}'s request and reply by email.`,
    headline: "Request received",
    bodyContent: `<p>${greeting(p.name)}</p><p>Thanks for asking to connect ${esc(p.company)} to PayRouta. Our partnerships team reviews every request and usually replies within five working days.</p><p>If we can go ahead, we'll email you an invitation to set up your login for the provider workspace. You don't need to do anything until then.</p>`,
    afterCta: ignore("ask to become a PayRouta provider"),
  });
}

export function renderProviderAccessApprovedEmail(p: {
  name?: string | null;
  company: string;
  url: string;
  expires: string;
}): RenderedEmail {
  return render(`${p.company} is approved for the PayRouta provider workspace`, {
    previewText: "Set up your login to start your provider application.",
    headline: "Your provider access is approved",
    bodyContent: `<p>${greeting(p.name)}</p><p>We've set up a provider workspace for <strong>${esc(p.company)}</strong>, with you as its owner. Use the button below to set up your login with this email address. The invitation expires in ${esc(p.expires)}.</p><p>Once you're in, complete your company details, coverage and integration, run the sandbox tests, then submit your application for review. Nothing goes live until we approve it.</p>`,
    ctaText: "Set up your login",
    ctaUrl: p.url,
    afterCta: linkFallback(p.url) + ignore("ask to become a PayRouta provider"),
  });
}

export function renderProviderAccessDeclinedEmail(p: {
  name?: string | null;
  company: string;
  note?: string | null;
}): RenderedEmail {
  return render("Your PayRouta provider request", {
    previewText: `An update on ${p.company}'s request.`,
    headline: "We can't offer access right now",
    bodyContent: `<p>${greeting(p.name)}</p><p>Thank you for your interest in connecting ${esc(p.company)} to PayRouta. We've reviewed your request and can't offer provider access at the moment.</p>${p.note ? `<p>${esc(p.note)}</p>` : ""}<p>If your coverage or licensing changes, you're welcome to ask again.</p>`,
  });
}

export function renderProviderAccessAlertEmail(p: {
  company: string;
  providerType: string;
  country: string;
  url: string;
}): RenderedEmail {
  return render(`Provider access request: ${p.company}`, {
    previewText: `${p.providerType} in ${p.country}`,
    headline: "New provider access request",
    bodyContent: `<p><strong>${esc(p.company)}</strong> (${esc(p.providerType)}, ${esc(p.country)}) asked for provider access.</p>`,
    ctaText: "Review the request",
    ctaUrl: p.url,
  });
}

// A subscription invoice to pay (or a reminder that it is overdue). Sent to
// the merchant's customer on the merchant's behalf.
export function renderInvoiceEmail(p: {
  merchant: string;
  plan: string;
  amount: string;
  due: string;
  url: string;
  reminder: boolean;
}): RenderedEmail {
  const subject = p.reminder ? `Reminder: your ${p.merchant} invoice is due` : `Your ${p.merchant} invoice for ${p.plan}`;
  return render(subject, {
    previewText: `${p.amount} for ${p.plan}, due ${p.due}.`,
    headline: p.reminder ? "Your invoice is overdue" : `Invoice from ${p.merchant}`,
    bodyContent: `<p>Hi,</p><p><strong>${esc(p.amount)}</strong> for ${esc(p.plan)} from ${esc(p.merchant)}, due <strong>${esc(p.due)}</strong>.</p>`,
    ctaText: `Pay ${p.amount}`,
    ctaUrl: p.url,
    afterCta: linkFallback(p.url),
  });
}

"use client";
import { useEffect, useRef } from "react";

type Widget = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "always" | "interaction-only";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

let loading: Promise<void> | undefined;
function load() {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Turnstile did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

// The bot check for a form. A token is good for one submission: call
// `onToken` with the token it gives, send it in the header named by
// `turnstileHeader` (lib/turnstile.ts), then raise `round` to get a fresh
// one. `quiet` shows the widget only if Cloudflare needs the person to
// interact. Renders nothing when no site key is set.
export function Turnstile({
  onToken,
  round = 0,
  quiet = false,
}: {
  onToken: (token: string | null) => void;
  round?: number;
  quiet?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const notify = useRef(onToken);
  useEffect(() => {
    notify.current = onToken;
  });
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let gone = false;
    load()
      .then(() => {
        if (gone || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: turnstileSiteKey,
          action: "turnstile-spin-v2",
          appearance: quiet ? "interaction-only" : "always",
          callback: (token) => notify.current(token),
          "expired-callback": () => notify.current(null),
          "error-callback": () => notify.current(null),
        });
      })
      .catch(() => notify.current(null));
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
    // The widget is rendered once; `quiet` is fixed for a given form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (round && widget.current) window.turnstile?.reset(widget.current);
  }, [round]);
  if (!turnstileSiteKey) return null;
  return <div ref={box} className="turnstile" />;
}

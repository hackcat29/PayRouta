"use client";
// The app's own "Are you sure?" in place of the browser's confirm(): the
// dashboard's look in light and dark mode, centred, keyboard-friendly.
//
//   if (await confirmAction({ title: "Disconnect this account?", confirm: "Disconnect", danger: true })) …
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./step-up.css";

type Options = { title: string; body?: string; confirm: string; cancel?: string; danger?: boolean };

function ConfirmDialog({ title, body, confirm, cancel = "Cancel", danger, onClose }: Options & { onClose: (ok: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="su-dialog"
      aria-labelledby="cd-title"
      aria-describedby={body ? "cd-body" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
    >
      <h2 id="cd-title">{title}</h2>
      {body && <p id="cd-body">{body}</p>}
      <div className="su-actions su-end">
        <button type="button" className="su-secondary" onClick={() => onClose(false)} autoFocus>
          {cancel}
        </button>
        <button type="button" className={danger ? "su-primary su-danger" : "su-primary"} onClick={() => onClose(true)}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}

export function confirmAction(options: Options): Promise<boolean> {
  return new Promise((resolve) => {
    // Inside .portal so the dashboard's colour tokens (and dark mode) apply.
    const host = document.createElement("div");
    host.className = "portal cd-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <ConfirmDialog
        {...options}
        onClose={(ok) => {
          resolve(ok);
          root.unmount();
          host.remove();
        }}
      />,
    );
  });
}

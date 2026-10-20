"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
export function CodeBlock({
  code,
  label = "Proposed interface · JSON",
}: {
  code: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <div className="code-panel">
      <div className="code-top">
        <span>{label}</span>
        <button
          aria-label="Copy code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setStatus("Copied");
            } catch {
              setStatus("Copy unavailable. Select the code to copy.");
            }
          }}
        >
          {status === "Copied" ? <Check size={16} /> : <Copy size={16} />} Copy
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <span className="copy-status" role="status">
        {status}
      </span>
    </div>
  );
}

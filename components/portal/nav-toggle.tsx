"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";

// Opens the sidebar as a drawer on small screens; closes on navigation.
export function NavToggle() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  const [seen, setSeen] = useState(`${pathname}?${search}`);
  const at = `${pathname}?${search}`;
  if (at !== seen) {
    setSeen(at);
    setOpen(false);
  }
  useEffect(() => {
    document.getElementById("ms-app")?.toggleAttribute("data-nav-open", open);
  }, [open]);
  return (
    <button
      type="button"
      className="ms-menu-button"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls="ms-side"
      onClick={() => setOpen(!open)}
    >
      {open ? <X size={20} /> : <Menu size={20} />}
    </button>
  );
}

"use client";
// Page motion driven by attributes, so server components stay server
// components and nothing hides content before JavaScript runs:
//
//   data-reveal           rises into place when it scrolls into view
//   data-reveal="stagger" its children rise one after another
//   data-tilt             leans toward the pointer (devices that hover)
//   data-count="125"      counts up to its number when revealed; the text
//                         already holds the final value ("125+")
//
// Mounted once in the root layout. Reduced motion turns all of it off.
import { useLayoutEffect } from "react";

const SELECTOR = "[data-reveal]";

function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count);
  const text = el.textContent ?? "";
  if (!Number.isFinite(target) || el.dataset.counted) return;
  el.dataset.counted = "1";
  const [before, after] = text.split(el.dataset.count!);
  if (after === undefined) return;
  const decimals = (el.dataset.count!.split(".")[1] ?? "").length;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 1400);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = `${before}${(target * eased).toFixed(decimals)}${after}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function MotionRoot() {
  useLayoutEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const html = document.documentElement;

    const reveal = (el: Element) => {
      el.setAttribute("data-in", "");
      el.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
      if (el instanceof HTMLElement && el.dataset.count) countUp(el);
    };
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          reveal(e.target);
          io.unobserve(e.target);
        }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const watch = (root: ParentNode) =>
      root.querySelectorAll(SELECTOR).forEach((el) => {
        if (el.hasAttribute("data-in")) return;
        // Already on screen at load: show it as it is, no flash.
        const r = el.getBoundingClientRect();
        if (!html.classList.contains("motion") && r.top < innerHeight && r.bottom > 0) reveal(el);
        else io.observe(el);
      });
    watch(document);
    html.classList.add("motion");
    const mo = new MutationObserver((records) =>
      records.forEach((r) =>
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(SELECTOR)) io.observe(n);
          watch(n);
        }),
      ),
    );
    mo.observe(document.body, { childList: true, subtree: true });

    // Tilt toward the pointer.
    const hover = matchMedia("(hover: hover)").matches;
    let tilted: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (tilted && tilted !== el) {
        tilted.style.removeProperty("--rx");
        tilted.style.removeProperty("--ry");
      }
      tilted = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    if (hover) document.addEventListener("pointermove", move, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("pointermove", move);
      html.classList.remove("motion");
    };
  }, []);
  return null;
}

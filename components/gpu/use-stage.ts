"use client";
import { useEffect, useState, type RefObject } from "react";

// When a GPU scene should exist and when it should animate:
// - `near`: the element is within a screen of the viewport (mount the scene).
// - `visible`: on screen and the tab is visible (run the frame loop).
// - `still`: the visitor asked for reduced motion (render one frame).
export function useStage(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setStill(mq.matches);
    motion();
    mq.addEventListener("change", motion);
    const doc = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", doc);
    const nearObs = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "100% 0px" });
    const seenObs = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    nearObs.observe(el);
    seenObs.observe(el);
    return () => {
      mq.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", doc);
      nearObs.disconnect();
      seenObs.disconnect();
    };
  }, [ref]);

  return { near, visible: onScreen && pageVisible, still };
}

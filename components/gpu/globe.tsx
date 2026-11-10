"use client";
// The hero globe, loaded only in the browser once it's near the screen. The
// page never waits on it: until the scene draws, the dotted disc shows.
import dynamic from "next/dynamic";
import { useRef } from "react";
import { useStage } from "./use-stage";

const GlobeCanvas = dynamic(() => import("./globe-canvas"), { ssr: false });

// lift and turn frame the chosen city: radians up from the centre, and
// around to the right (the hero keeps it beside the checkout card).
export function Globe({
  focus,
  className,
  lift,
  turn,
}: {
  focus: string | null;
  className?: string;
  lift?: number;
  turn?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { near, visible, still } = useStage(ref);
  return (
    <div ref={ref} className={`gpu-globe ${className ?? ""}`} aria-hidden="true">
      {near && <GlobeCanvas focus={focus} active={visible} still={still} lift={lift} turn={turn} />}
    </div>
  );
}

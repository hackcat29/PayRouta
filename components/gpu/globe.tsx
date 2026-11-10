"use client";
// The hero globe, loaded only in the browser once it's near the screen. The
// page never waits on it: until the scene draws, the dotted disc shows.
import dynamic from "next/dynamic";
import { useRef } from "react";
import { useStage } from "./use-stage";

const GlobeCanvas = dynamic(() => import("./globe-canvas"), { ssr: false });

export function Globe({ focus, className }: { focus: string | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { near, visible, still } = useStage(ref);
  return (
    <div ref={ref} className={`gpu-globe ${className ?? ""}`} aria-hidden="true">
      {near && <GlobeCanvas focus={focus} active={visible} still={still} />}
    </div>
  );
}

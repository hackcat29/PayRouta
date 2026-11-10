"use client";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { useStage } from "./use-stage";

const LoopCanvas = dynamic(() => import("./loop-canvas"), { ssr: false });

// The brand mark in 3D; decorative, so it's hidden from assistive tech.
export function LoopMark({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { near, visible, still } = useStage(ref);
  return (
    <div ref={ref} className={`gpu-loop ${className ?? ""}`} aria-hidden="true">
      {near && <LoopCanvas active={visible} still={still} />}
    </div>
  );
}

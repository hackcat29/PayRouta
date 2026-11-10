"use client";
import ThreeCanvas from "./three-canvas";
import LoopScene from "./loop-scene";

export default function LoopCanvas({ active, still }: { active: boolean; still: boolean }) {
  return (
    <ThreeCanvas active={active && !still} camera={{ position: [0, 0, 4.4], fov: 36 }}>
      <LoopScene still={still} />
    </ThreeCanvas>
  );
}

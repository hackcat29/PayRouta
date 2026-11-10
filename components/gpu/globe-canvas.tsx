"use client";
import ThreeCanvas from "./three-canvas";
import GlobeScene, { cameraDistance } from "./globe-scene";

export default function GlobeCanvas({ focus, active, still }: { focus: string | null; active: boolean; still: boolean }) {
  return (
    <ThreeCanvas active={active && !still} camera={{ position: [0, 0, cameraDistance], fov: 40 }}>
      <GlobeScene focus={focus} still={still} />
    </ThreeCanvas>
  );
}

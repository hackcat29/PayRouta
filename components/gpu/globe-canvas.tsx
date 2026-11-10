"use client";
import ThreeCanvas from "./three-canvas";
import GlobeScene, { cameraDistance } from "./globe-scene";

export default function GlobeCanvas({
  focus,
  active,
  still,
  lift,
  turn,
}: {
  focus: string | null;
  active: boolean;
  still: boolean;
  lift?: number;
  turn?: number;
}) {
  return (
    <ThreeCanvas active={active && !still} camera={{ position: [0, 0, cameraDistance], fov: 40 }} maxDpr={1.5}>
      <GlobeScene focus={focus} still={still} lift={lift} turn={turn} />
    </ThreeCanvas>
  );
}

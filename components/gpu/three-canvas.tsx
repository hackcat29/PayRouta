"use client";
// React Three Fiber on three.js's WebGPURenderer. Where WebGPU is missing or
// can't present (components/gpu/probe.ts), the renderer runs its WebGL2
// backend instead, so scenes are written once with TSL node materials.
import { Component, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { canPresentWebGPU } from "./probe";

export type ThreeCanvasProps = {
  children: ReactNode;
  /** Run the frame loop (false pauses it; one frame is still drawn on change). */
  active: boolean;
  camera?: { position: [number, number, number]; fov?: number };
  className?: string;
  /** Upper bound on device pixel ratio, for large canvases. */
  maxDpr?: number;
};

// A scene that fails (no GPU, lost context) leaves the page as it was.
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("3D scene disabled:", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function ThreeCanvas({ children, active, camera, className, maxDpr = 1.75 }: ThreeCanvasProps) {
  return (
    <Quiet>
      <Canvas
        className={className}
        frameloop={active ? "always" : "demand"}
        // Brand colours exactly as written: no tone mapping.
        flat
        dpr={[1, maxDpr]}
        camera={{ position: camera?.position ?? [0, 0, 3], fov: camera?.fov ?? 40 }}
        gl={async (props) => {
          const renderer = new WebGPURenderer({
            canvas: props.canvas as HTMLCanvasElement,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            forceWebGL: !(await canPresentWebGPU()),
          });
          await renderer.init();
          renderer.setClearColor(0x000000, 0);
          return renderer as never;
        }}
        // Vertical swipes keep scrolling the page on touch screens.
        style={{ touchAction: "pan-y" }}
      >
        {children}
      </Canvas>
    </Quiet>
  );
}

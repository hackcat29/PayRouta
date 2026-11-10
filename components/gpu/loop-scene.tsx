"use client";
// The Loop mark in three dimensions: the route lifts where it crosses itself,
// a payment runs along it, and the node lights up when it arrives.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { float, fract, smoothstep, step, time, uv, vec3 } from "three/tsl";

const SPEED = 0.28; // laps per second of the payment along the route

// public/brand/payrouta-submark-*.svg, in its 48×48 box (y down).
function route() {
  const p = new THREE.Path();
  p.moveTo(3, 38);
  p.lineTo(12, 38);
  p.bezierCurveTo(20, 38, 26, 34, 29, 27);
  p.bezierCurveTo(32, 19, 28, 10, 20.5, 10);
  p.bezierCurveTo(13, 10, 10, 18, 12.5, 25);
  p.bezierCurveTo(15, 32, 21, 38, 30, 38);
  p.lineTo(35, 38);
  const pts = p.getSpacedPoints(360);
  const n = pts.length - 1;
  // Over at the start, under near the end: the crossing gets real depth.
  return pts.map((q, i) => new THREE.Vector3((q.x - 24) / 14, -(q.y - 26) / 14, 0.34 * Math.cos((Math.PI * i) / n)));
}

export default function LoopScene({ still }: { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const node = useRef<THREE.Mesh>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const { tube, cap, end } = useMemo(() => {
    const pts = route();
    const curve = new THREE.CatmullRomCurve3(pts);
    const radius = 5.5 / 14 / 2;
    const m = new THREE.MeshStandardNodeMaterial({ color: "#f7f4ee", roughness: 0.42, metalness: 0.05 });
    // The payment: a kola glow running from the start to the node.
    const head = fract(time.mul(SPEED)).mul(1.3).sub(0.15);
    const behind = head.sub(uv().x);
    const glow = smoothstep(float(0.3), float(0), behind).mul(step(float(0), behind));
    m.emissiveNode = vec3(0.95, 0.42, 0.11).mul(glow.mul(still ? 0 : 2.4));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 360, radius, 28, false), m);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), m);
    cap.position.copy(pts[0]);
    const end = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), m);
    end.position.copy(pts[pts.length - 1]);
    return { tube, cap, end };
  }, [still]);

  const nodeMat = useMemo(() => new THREE.MeshStandardNodeMaterial({ color: "#f26b1d", roughness: 0.3, metalness: 0.1 }), []);

  useFrame(({ clock, pointer: p }, dt) => {
    pointer.current.x += (p.x - pointer.current.x) * Math.min(1, dt * 3);
    pointer.current.y += (p.y - pointer.current.y) * Math.min(1, dt * 3);
    const t = clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = still ? -0.35 : -0.35 + Math.sin(t * 0.4) * 0.25 + pointer.current.x * 0.45;
      group.current.rotation.x = still ? 0.12 : 0.12 + Math.sin(t * 0.3) * 0.08 - pointer.current.y * 0.3;
      group.current.position.y = still ? 0 : Math.sin(t * 0.8) * 0.04;
    }
    // The node swells as the payment lands.
    if (node.current && !still) {
      const lap = (t * SPEED * 1.3 - 0.15) % 1.3;
      const land = Math.max(0, 1 - Math.abs(lap - 1) * 6);
      node.current.scale.setScalar(1 + land * 0.18);
    }
  });

  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[2, 3, 4]} intensity={2.6} />
      <directionalLight position={[-3, -1, 2]} intensity={0.7} color="#4f8bff" />
      <group ref={group}>
        <primitive object={tube} />
        <primitive object={cap} />
        <primitive object={end} />
        <mesh ref={node} position={[(40 - 24) / 14, -(38 - 26) / 14, -0.34]} material={nodeMat}>
          <sphereGeometry args={[5.5 / 14, 40, 28]} />
        </mesh>
      </group>
    </>
  );
}

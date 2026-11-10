"use client";
// The homepage globe: land drawn in adire dots, the hero checkout's cities,
// and payments arcing between them. Picking a country in the checkout turns
// the globe to it; dragging turns it by hand.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { float, fract, hash, instanceIndex, mix, sin, smoothstep, step, time, uv, vec3 } from "three/tsl";
import { globeCount, globeLand } from "./globe-land";
import { heroCities, hubs, toVec, type GeoPoint } from "./places";

const ink = {
  body: new THREE.Color("#272e7c"),
  dot: new THREE.Color("#f7f4ee"),
  kola: new THREE.Color("#f26b1d"),
  sky: new THREE.Color("#4f8bff"),
  gold: new THREE.Color("#f5b700"),
};

// Land points rebuilt from the bitset (scripts/globe-land.mjs).
function landPoints() {
  const bits = Uint8Array.from(atob(globeLand), (c) => c.charCodeAt(0));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: GeoPoint[] = [];
  for (let i = 0; i < globeCount; i++) {
    if (!(bits[i >> 3] & (1 << (i & 7)))) continue;
    const y = 1 - (2 * (i + 0.5)) / globeCount;
    const lon = (((((golden * i * 180) / Math.PI + 180) % 360) + 360) % 360) - 180;
    out.push({ lat: (Math.asin(y) * 180) / Math.PI, lon });
  }
  return out;
}

function Dots() {
  const mesh = useMemo(() => {
    const points = landPoints();
    const geometry = new THREE.CircleGeometry(0.0075, 6);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const seed = hash(instanceIndex);
    // A few dots in kola, the rest calico, each breathing on its own beat.
    material.colorNode = mix(vec3(ink.dot.r, ink.dot.g, ink.dot.b), vec3(ink.kola.r, ink.kola.g, ink.kola.b), step(0.975, seed));
    material.opacityNode = float(0.5).add(sin(time.mul(1.3).add(seed.mul(40))).mul(0.25));
    const m = new THREE.InstancedMesh(geometry, material, points.length);
    const o = new THREE.Object3D();
    points.forEach((p, i) => {
      o.position.set(...toVec(p, 1.003));
      o.lookAt(o.position.clone().multiplyScalar(2));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, []);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

// A payment in flight: a faint route with a bright head running along it.
function arc(from: GeoPoint, to: GeoPoint, tint: THREE.Color, strength: number, offset: number, speed: number) {
  const a = new THREE.Vector3(...toVec(from));
  const b = new THREE.Vector3(...toVec(to));
  const lift = 1 + a.distanceTo(b) * 0.32;
  const mid = a.clone().add(b).normalize().multiplyScalar(lift);
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const geometry = new THREE.TubeGeometry(curve, 72, 0.0042 * (0.6 + strength * 0.4), 6, false);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.colorNode = vec3(tint.r, tint.g, tint.b);
  const head = fract(time.mul(speed).add(offset)).mul(1.4).sub(0.2);
  const behind = head.sub(uv().x);
  const pulse = smoothstep(float(0.28), float(0), behind).mul(step(float(0), behind));
  material.opacityNode = float(0.1 * strength).add(pulse.mul(strength));
  return new THREE.Mesh(geometry, material);
}

function Arcs({ focus }: { focus: string | null }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const all = [...Object.values(heroCities), ...hubs];
    // Ambient traffic between hubs.
    const pairs: [number, number][] = [
      [6, 0], [7, 1], [8, 2], [9, 3], [10, 4], [11, 5], [12, 14], [13, 2], [14, 1], [6, 10], [1, 3], [4, 8],
    ];
    pairs.forEach(([i, j], n) =>
      g.add(arc(all[i], all[j], n % 3 === 0 ? ink.gold : ink.sky, 0.55, n * 0.137, 0.16 + (n % 4) * 0.03)),
    );
    // From the chosen country, one checkout reaching every other one.
    const from = focus ? heroCities[focus] : null;
    if (from)
      Object.entries(heroCities)
        .filter(([id]) => id !== focus)
        .forEach(([, to], n) => g.add(arc(from, to, ink.kola, 1, n * 0.2, 0.32)));
    return g;
  }, [focus]);
  useEffect(
    () => () =>
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      }),
    [group],
  );
  return <primitive object={group} />;
}

function Cities({ focus }: { focus: string | null }) {
  const nodes = useMemo(() => {
    const g = new THREE.Group();
    const dot = new THREE.CircleGeometry(0.016, 20);
    const ring = new THREE.RingGeometry(0.024, 0.03, 32);
    for (const [id, p] of Object.entries(heroCities)) {
      const on = id === focus;
      const holder = new THREE.Object3D();
      holder.position.set(...toVec(p, 1.006));
      holder.lookAt(holder.position.clone().multiplyScalar(2));
      const fill = new THREE.MeshBasicNodeMaterial({ color: on ? ink.kola : ink.dot });
      holder.add(new THREE.Mesh(dot, fill));
      const halo = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, color: on ? ink.kola : ink.dot });
      // The chosen city sends a ripple out every second or so.
      const r = new THREE.Mesh(ring, halo);
      if (on) {
        halo.opacityNode = float(1).sub(fract(time.mul(0.8)));
        r.userData.ripple = true;
      } else halo.opacity = 0.35;
      holder.add(r);
      g.add(holder);
    }
    return g;
  }, [focus]);
  useFrame(({ clock }) => {
    const s = 1 + ((clock.elapsedTime * 0.8) % 1) * 1.8;
    nodes.traverse((o) => o.userData.ripple && o.scale.setScalar(s));
  });
  return <primitive object={nodes} />;
}

export const cameraDistance = 3.2;

export default function GlobeScene({
  focus,
  still,
  lift = 0.22,
  turn = 0,
}: {
  focus: string | null;
  still: boolean;
  lift?: number;
  turn?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const { gl, invalidate } = useThree();
  const view = useRef({ yaw: 0.4, pitch: 0.25, tYaw: 0.4, tPitch: 0.25, drag: false, idleAt: 0 });

  // Turn to the chosen country.
  useEffect(() => {
    const v = view.current;
    const p = focus ? heroCities[focus] : null;
    if (p) {
      const [x, y, z] = toVec(p);
      const yaw = Math.atan2(-x, z) + turn;
      const pitch = Math.atan2(y, Math.hypot(x, z)) - lift;
      v.tYaw = v.yaw + Math.atan2(Math.sin(yaw - v.yaw), Math.cos(yaw - v.yaw));
      v.tPitch = pitch;
    }
    v.idleAt = performance.now() + 5000;
    if (still) {
      v.yaw = v.tYaw;
      v.pitch = v.tPitch;
    }
    invalidate();
  }, [focus, still, invalidate, lift, turn]);

  // Drag to turn. Touch drags stay horizontal so the page still scrolls.
  useEffect(() => {
    const el = gl.domElement as HTMLCanvasElement;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      view.current.drag = true;
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const v = view.current;
      v.tYaw += (e.clientX - last.x) * 0.006;
      if (e.pointerType === "mouse") v.tPitch = Math.max(-1, Math.min(1, v.tPitch + (e.clientY - last.y) * 0.004));
      last = { x: e.clientX, y: e.clientY };
      invalidate();
    };
    const up = () => {
      last = null;
      view.current.drag = false;
      view.current.idleAt = performance.now() + 3000;
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate]);

  useFrame((_, dt) => {
    const v = view.current;
    if (!still && !v.drag && performance.now() > v.idleAt) v.tYaw -= dt * 0.08;
    const k = still ? 1 : 1 - Math.exp(-dt * 4);
    v.yaw += (v.tYaw - v.yaw) * k;
    v.pitch += (v.tPitch - v.pitch) * k;
    root.current?.rotation.set(v.pitch, v.yaw, 0, "XYZ");
    if (still && (Math.abs(v.tYaw - v.yaw) > 1e-3 || Math.abs(v.tPitch - v.pitch) > 1e-3)) invalidate();
  });

  const body = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ color: ink.body });
    return new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), m);
  }, []);
  // A hairline on the silhouette, which sits at z = 1/d for a camera d away.
  const rim = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ color: ink.dot, transparent: true, opacity: 0.16 });
    const r = Math.sqrt(1 - 1 / cameraDistance ** 2);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 1.002, r * 1.002 + 0.007, 160), m);
    mesh.position.z = 1 / cameraDistance;
    return mesh;
  }, []);

  return (
    <>
      <primitive object={rim} />
      <group ref={root}>
        <primitive object={body} />
        <Dots />
        <Arcs focus={focus} />
        <Cities focus={focus} />
      </group>
    </>
  );
}

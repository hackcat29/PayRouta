/// <reference types="@webgpu/types" />
"use client";
// Any token in, one stablecoin out. Thousands of particles, one per token a
// customer might hold, drift in from the left, gather at the PayRouta node
// and leave as a single stream in the merchant's stablecoin. The pointer
// pushes them aside.
//
// Simulated on the GPU with a TypeGPU compute shader where WebGPU exists; a
// smaller CPU simulation draws the same thing on a 2D canvas elsewhere.
import { useEffect, useRef } from "react";
import { useStage } from "./use-stage";
import { canPresentWebGPU } from "./probe";

// Colours of the tokens coming in, then of the stablecoin going out.
const TOKENS = ["#f26b1d", "#f5b700", "#f7f4ee", "#ff7a59", "#43d1a0", "#e6c79c"];
const STABLE = ["#4f8bff", "#9dbbff"];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const wgslColors = (list: string[]) => list.map((h) => `vec3f(${rgb(h).map((v) => v.toFixed(4)).join(", ")})`).join(", ");

const SHADER_COMMON = /* wgsl */ `
struct Particle { pos: vec2f, vel: vec2f, seed: f32, age: f32, hue: f32, pad: f32 };
struct Params { time: f32, dt: f32, aspect: f32, size: f32, pointer: vec2f, push: f32, count: u32 };
fn rand(s: f32) -> f32 { return fract(sin(s * 12.9898 + 78.233) * 43758.5453); }
`;

const SIM = /* wgsl */ `${SHADER_COMMON}
@group(0) @binding(0) var<storage, read_write> ps: array<Particle>;
@group(0) @binding(1) var<uniform> u: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u.count) { return; }
  var p = ps[i];
  let x = p.pos.x;
  let y = p.pos.y;
  var goal: vec2f;
  if (x < 0.0) {
    let k = clamp(1.0 + x, 0.0, 1.0);
    let wave = sin(y * 5.0 + u.time * 0.6 + p.seed * 6.283) * 0.18 * (1.0 - k);
    goal = vec2f(0.26 + 0.3 * k, -y * (0.35 + 2.8 * k * k) + wave);
  } else {
    let lane = (p.seed - 0.5) * 0.09 + sin(x * 7.0 - u.time * 2.0) * 0.025;
    goal = vec2f(0.72, (lane - y) * 6.0);
  }
  let away = vec2f((p.pos.x - u.pointer.x) * u.aspect, p.pos.y - u.pointer.y);
  let d2 = dot(away, away);
  let force = u.push * exp(-d2 * 30.0) * 3.0;
  p.vel = mix(p.vel, goal, clamp(u.dt * 3.0, 0.0, 1.0)) + normalize(away + vec2f(1e-5)) * force * u.dt;
  p.pos += p.vel * u.dt;
  if (p.pos.x > 0.0 && p.hue >= 0.0) { p.hue = -1.0 - floor(p.seed * 2.0); }
  if (p.pos.x > 1.08) {
    p.pos = vec2f(-1.08 - rand(p.seed + u.time) * 0.15, rand(p.seed * 3.1 + u.time) * 1.9 - 0.95);
    p.vel = vec2f(0.3, 0.0);
    p.hue = floor(rand(p.seed * 7.7 + u.time) * ${TOKENS.length}.0);
  }
  ps[i] = p;
}`;

const DRAW = /* wgsl */ `${SHADER_COMMON}
@group(0) @binding(0) var<storage, read> ps: array<Particle>;
@group(0) @binding(1) var<uniform> u: Params;

struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f, @location(2) alpha: f32 };

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  var quad = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  var tokens = array<vec3f, ${TOKENS.length}>(${wgslColors(TOKENS)});
  var stable = array<vec3f, 2>(${wgslColors(STABLE)});
  let p = ps[i];
  let q = quad[v];
  var o: Out;
  let grow = select(1.0, 1.25, p.hue < 0.0);
  o.pos = vec4f(p.pos + q * vec2f(u.size / u.aspect, u.size) * grow, 0.0, 1.0);
  o.uv = q;
  if (p.hue < 0.0) { o.color = stable[u32(-p.hue - 1.0)]; } else { o.color = tokens[u32(p.hue)]; }
  o.alpha = smoothstep(-1.08, -0.9, p.pos.x) * (1.0 - smoothstep(0.92, 1.06, p.pos.x)) * select(0.75, 0.95, p.hue < 0.0);
  return o;
}

@fragment
fn fs(i: Out) -> @location(0) vec4f {
  let a = (1.0 - smoothstep(0.55, 1.0, length(i.uv))) * i.alpha;
  return vec4f(i.color * a, a);
}`;

type Particle = { x: number; y: number; vx: number; vy: number; seed: number; hue: number };
const rand = (s: number) => {
  const v = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};
function seedParticles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => {
    const seed = Math.random();
    const x = -1.1 + Math.random() * 2.2;
    return {
      x,
      y: x < 0 ? Math.random() * 1.9 - 0.95 : (seed - 0.5) * 0.09,
      vx: 0.3,
      vy: 0,
      seed,
      hue: x < 0 ? Math.floor(rand(i) * TOKENS.length) : -1 - Math.floor(seed * 2),
    };
  });
}

type Sim = { frame(time: number, dt: number, pointer: [number, number], push: number): void; dispose(): void };

// WebGPU through TypeGPU: typed buffers on a TypeGPU root, raw WGSL pipelines.
async function gpuSim(canvas: HTMLCanvasElement, count: number): Promise<Sim | null> {
  if (!(await canPresentWebGPU())) return null;
  const [{ default: tgpu }, d] = await Promise.all([import("typegpu"), import("typegpu/data")]);
  let root;
  try {
    root = await tgpu.init();
  } catch {
    return null;
  }
  const device = root.device;
  const ParticleData = d.struct({ pos: d.vec2f, vel: d.vec2f, seed: d.f32, age: d.f32, hue: d.f32, pad: d.f32 });
  const ParamsData = d.struct({
    time: d.f32,
    dt: d.f32,
    aspect: d.f32,
    size: d.f32,
    pointer: d.vec2f,
    push: d.f32,
    count: d.u32,
  });
  const particles = root
    .createBuffer(
      d.arrayOf(ParticleData, count),
      seedParticles(count).map((p) => ({
        pos: d.vec2f(p.x, p.y),
        vel: d.vec2f(p.vx, p.vy),
        seed: p.seed,
        age: 0,
        hue: p.hue,
        pad: 0,
      })),
    )
    .$usage("storage");
  const params = root.createBuffer(ParamsData).$usage("uniform");
  const context = canvas.getContext("webgpu");
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const simModule = device.createShaderModule({ code: SIM });
  const drawModule = device.createShaderModule({ code: DRAW });
  const sim = device.createComputePipeline({ layout: "auto", compute: { module: simModule, entryPoint: "main" } });
  const draw = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: drawModule, entryPoint: "vs" },
    fragment: {
      module: drawModule,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
  });
  const entries = [
    { binding: 0, resource: { buffer: root.unwrap(particles) } },
    { binding: 1, resource: { buffer: root.unwrap(params) } },
  ];
  const simGroup = device.createBindGroup({ layout: sim.getBindGroupLayout(0), entries });
  const drawGroup = device.createBindGroup({ layout: draw.getBindGroupLayout(0), entries });

  return {
    frame(time, dt, pointer, push) {
      const aspect = canvas.width / Math.max(1, canvas.height);
      const size = (2.6 * devicePixelRatio) / Math.max(1, canvas.height);
      params.write({ time, dt, aspect, size, pointer: d.vec2f(...pointer), push, count });
      const enc = device.createCommandEncoder();
      const c = enc.beginComputePass();
      c.setPipeline(sim);
      c.setBindGroup(0, simGroup);
      c.dispatchWorkgroups(Math.ceil(count / 64));
      c.end();
      const r = enc.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
        ],
      });
      r.setPipeline(draw);
      r.setBindGroup(0, drawGroup);
      r.draw(6, count);
      r.end();
      device.queue.submit([enc.finish()]);
    },
    dispose() {
      root.destroy();
    },
  };
}

// The same flow on the CPU, with fewer particles.
function cpuSim(canvas: HTMLCanvasElement, count: number): Sim | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ps = seedParticles(count);
  return {
    frame(time, dt, [px, py], push) {
      const w = canvas.width;
      const h = canvas.height;
      const aspect = w / Math.max(1, h);
      ctx.clearRect(0, 0, w, h);
      const r = 1.3 * devicePixelRatio;
      for (const p of ps) {
        let gx: number, gy: number;
        if (p.x < 0) {
          const k = Math.min(1, Math.max(0, 1 + p.x));
          const wave = Math.sin(p.y * 5 + time * 0.6 + p.seed * 6.283) * 0.18 * (1 - k);
          gx = 0.26 + 0.3 * k;
          gy = -p.y * (0.35 + 2.8 * k * k) + wave;
        } else {
          const lane = (p.seed - 0.5) * 0.09 + Math.sin(p.x * 7 - time * 2) * 0.025;
          gx = 0.72;
          gy = (lane - p.y) * 6;
        }
        const ax = (p.x - px) * aspect;
        const ay = p.y - py;
        const d2 = ax * ax + ay * ay;
        const len = Math.sqrt(d2) || 1;
        const f = push * Math.exp(-d2 * 30) * 3 * dt;
        const m = Math.min(1, dt * 3);
        p.vx += (gx - p.vx) * m + (ax / len) * f;
        p.vy += (gy - p.vy) * m + (ay / len) * f;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x > 0 && p.hue >= 0) p.hue = -1 - Math.floor(p.seed * 2);
        if (p.x > 1.08) {
          p.x = -1.08 - Math.random() * 0.15;
          p.y = Math.random() * 1.9 - 0.95;
          p.vx = 0.3;
          p.vy = 0;
          p.hue = Math.floor(Math.random() * TOKENS.length);
        }
        const edge = Math.min(1, Math.max(0, (p.x + 1.08) / 0.18)) * Math.min(1, Math.max(0, (1.06 - p.x) / 0.14));
        ctx.globalAlpha = edge * (p.hue < 0 ? 0.95 : 0.75);
        ctx.fillStyle = p.hue < 0 ? STABLE[-p.hue - 1] : TOKENS[p.hue];
        ctx.beginPath();
        ctx.arc(((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h, p.hue < 0 ? r * 1.25 : r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    dispose() {},
  };
}

export function TokenFlow({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { near, visible, still } = useStage(box);
  const simRef = useRef<Sim | null>(null);
  const state = useRef({ pointer: [9, 9] as [number, number], push: 0, time: 0 });

  // Build the simulation once the section comes near.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    let cancelled = false;
    const fit = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    const small = matchMedia("(max-width: 720px)").matches;
    gpuSim(canvas, small ? 9000 : 22000)
      .catch(() => null)
      .then((s) => s ?? cpuSim(canvas, small ? 700 : 1600))
      .then((s) => {
        if (cancelled) return s?.dispose();
        simRef.current = s;
        canvas.dataset.engine = s ? (canvas.getContext("2d") ? "2d" : "webgpu") : "none";
      });
    return () => {
      cancelled = true;
      ro.disconnect();
      simRef.current?.dispose();
      simRef.current = null;
    };
  }, [near]);

  // Run while visible; with reduced motion, settle the flow and hold still.
  useEffect(() => {
    if (!near) return;
    let raf = 0;
    let last = performance.now();
    const st = state.current;
    const tick = (now: number) => {
      const sim = simRef.current;
      if (sim) {
        if (still) {
          for (let i = 0; i < 240; i++) sim.frame((st.time += 1 / 30), 1 / 30, [9, 9], 0);
          return;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        st.push *= 0.94;
        sim.frame((st.time += dt), dt, st.pointer, st.push);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    if (visible || still) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [near, visible, still]);

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    state.current.pointer = [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
    state.current.push = 1;
  };

  return (
    <div ref={box} className={`gpu-flow ${className ?? ""}`} aria-hidden="true">
      <canvas ref={canvasRef} onPointerMove={onMove} />
    </div>
  );
}

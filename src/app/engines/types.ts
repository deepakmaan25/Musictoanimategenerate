// ─────────────────────────────────────────────────────────────────────────────
// Engine module — shared types, frame context, and pure helpers.
// Extracted from Studio.tsx (Track 0). Engines are pure draw functions that
// receive everything they need via EngineFrameCtx — no closure over component
// state — so they can be unit-tested and lazy-loaded independently.
// ─────────────────────────────────────────────────────────────────────────────

// ── Particle / shape state types (persisted across frames via refs) ──────────
export type Star   = { x: number; y: number; z: number; hue: number };
export type Spark  = { angle: number; r: number; speed: number; life: number; ring: number };
export type Sphere = { x: number; y: number; vx: number; vy: number; phase: number; size: number; hue: number };
export type ResonanceNode = { x: number; y: number; hx: number; hy: number; driftA: number; driftR: number;
  driftSpd: number; phase: number; depth: number; hue: number; twinkle: number; size: number };
export type Planet = { angle: number; speed: number; dist: number; size: number; color: number };
export type OrbitBody = { a: number; ecc: number; tilt: number; planeRot: number; angle: number;
  speed: number; hue: number; band: number; dir: number; trail: { x: number; y: number; depth: number }[] };
export type GridDot = { bx: number; by: number; x: number; y: number; d: number };
export type Shockwave = { r: number; maxR: number; speed: number; width: number; strength: number; colorIdx: number };

// A mutable ref cell (matches React's MutableRefObject shape without importing React).
export type Ref<T> = { current: T };

// ── Frame context: everything an engine needs for one draw call ──────────────
export interface EngineFrameCtx {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  freq: Uint8Array;
  tdBuf: Uint8Array | null;           // time-domain buffer (waveform) — bars uses this

  // resolved live parameters
  vrnt: string;
  sens: number;
  perf: boolean;
  bSpeed: number;
  bResp: number;
  liveColors: [string, string, string];
  hxCache: Map<string, string>;

  // section / energy context
  energyMult: number;
  sectionIntensity: number;
  sectionProgress: number;
  currentEnergy: number;
  particleDensity: number;

  // persistent per-engine state refs
  spheresRef: Ref<Sphere[]>;
  starsRef: Ref<Star[]>;
  planetsRef: Ref<Planet[]>;
  cameraTRef: Ref<number>;
  tunnelTRef: Ref<number>;
  solarTRef: Ref<number>;
  prevBassRef: Ref<number>;
  smoothedBurstRef: Ref<number>;
  gridDotsRef: Ref<GridDot[]>;
  shockwavesRef: Ref<Shockwave[]>;
  gridKeyRef: Ref<string>;
  orbitBodiesRef: Ref<OrbitBody[]>;
  tdBufRef: Ref<Uint8Array | null>;
  particleDensRef: Ref<number>;
}

// ── Pure helpers (no component state) ────────────────────────────────────────
export function avg(arr: Uint8Array, start: number, end: number) {
  const e = Math.min(end, arr.length);
  let s = 0;
  for (let i = start; i < e; i++) s += arr[i];
  return (s / Math.max(1, e - start)) / 255;
}

export function hexToRgb(hex: string, cache?: Map<string, string>) {
  if (cache) {
    const hit = cache.get(hex);
    if (hit) return hit;
  }
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(v, 16);
  const result = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  cache?.set(hex, result);
  return result;
}

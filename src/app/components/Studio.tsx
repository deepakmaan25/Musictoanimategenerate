import { useEffect, useMemo, useRef, useState, } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, Upload, Download, ArrowLeft, RotateCw, FileVideo, Check,
        Loader2, AlertCircle, Share2, Monitor, Smartphone, CloudOff, Cloud, X, Trash2,
        Maximize2, Minimize2, Zap, Shuffle, Star, Trash } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { AuthModal } from './AuthModal';
import type { usePersistentProjects } from '../hooks/usePersistentProjects';
import { useAuth } from '../hooks/useAuth';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import { fetchProjectTrack, fetchProjectExports, deleteDBExport } from '../lib/db';
import { getAudioSignedUrl, getExportSignedUrl } from '../lib/storage';
import {
  analyzeTrack,
  getSectionAtTime,
  getSectionProgress,
  sampleEnergyCurve,
  type TrackAnalysis,
  type TrackSection,
} from '../lib/audioAnalysis';
import { recommendEngines, type EngineRecommendation } from '../lib/engineRecommendations';

// ─── Platform helpers ────────────────────────────────────────────────────────
function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
function getExportMode(): 'webm' | 'mp4' | 'server' {
  if (typeof MediaRecorder === 'undefined') return 'server';
  if (isIOSDevice() && isSafariBrowser()) {
    if (MediaRecorder.isTypeSupported('video/mp4')) return 'mp4';
    return 'server';
  }
  return 'webm';
}

// ─── Types ───────────────────────────────────────────────────────────────────
type EngineId =
  | 'bars' | 'radial'
  | 'orbital' | 'depth' | 'terrain' | 'tunnel'
  | 'neon_spheres' | 'fractal' | 'solar';
type Status = 'idle' | 'decoding' | 'ready' | 'error';

type Project = {
  id: string;
  fileName: string;
  duration: number;
  audioBuffer: AudioBuffer;
  engine: EngineId;
};

type ExportJob = {
  id: number;
  storageId?: string;    // original DB/export ID (string) for delete + cloud download
  storagePath?: string;  // Supabase storage path for re-downloading from cloud
  name: string;
  preset: string;
  aspect: string;
  status: 'recording' | 'finalizing' | 'done' | 'error';
  progress: number;
  url?: string;
  blob?: Blob;
  size?: number;
  errorMsg?: string;
};

type Star   = { x: number; y: number; z: number; hue: number };
type Spark  = { angle: number; r: number; speed: number; life: number; ring: number };
type Sphere = { x: number; y: number; vx: number; vy: number; phase: number; size: number; hue: number };
type Planet = { angle: number; speed: number; dist: number; size: number; color: number };

// ─── Constants ───────────────────────────────────────────────────────────────
const ENGINES: { id: EngineId; name: string; description: string; group: '2D' | '3D' }[] = [
  { id: 'bars',        name: 'Spectrum Bars',        description: 'Classic frequency bars across the canvas.',              group: '2D' },
  { id: 'radial',      name: 'Radial Spectrum',       description: 'Bars radiating from the center.',                       group: '2D' },
  { id: 'orbital',     name: 'Orbital Rings',         description: 'Concentric rings tilt and pulse around a glowing core.', group: '3D' },
  { id: 'depth',       name: 'Depth Field Particles', description: 'Cinematic starfield that surges on every beat.',        group: '3D' },
  { id: 'terrain',     name: 'Audio Terrain',         description: 'Wireframe landscape that reacts to every frequency.',  group: '3D' },
  { id: 'tunnel',      name: 'Liquid Aurora',         description: 'Flowing colour curtains that ripple with every frequency.',  group: '3D' },
  { id: 'neon_spheres',name: 'Neon Spheres',          description: 'Glowing spheres wobbling and scaling with audio.',     group: '3D' },
  { id: 'fractal',     name: 'Fractal Kaleidoscope',  description: 'Mirrored tiling pattern; rotation tied to energy.',    group: '3D' },
  { id: 'solar',       name: 'Geometric Pulse',       description: 'Concentric beat rings expand and shatter on every drop.', group: '3D' },
];

// ── Short engine name lookup for preset naming ─────────────────────────────
const ENGINE_LABELS_SHORT: Record<string, string> = {
  bars: 'Bars', radial: 'Radial', orbital: 'Orbital', depth: 'Depth',
  terrain: 'Terrain', tunnel: 'Aurora', neon_spheres: 'Spheres', fractal: 'Fractal', solar: 'Pulse',
};

// ── Per-engine optimal motion defaults ────────────────────────────────────────
type MotionDefaults = { beatSensitivity: number; particleDensity: number; smoothing: number; baseSpeed: number; beatResponse: number };
const ENGINE_MOTION_DEFAULTS: Record<string, MotionDefaults> = {
  bars:         { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  radial:       { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  orbital:      { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  depth:        { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.65, baseSpeed: 1.0, beatResponse: 0.90 },
  terrain:      { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  tunnel:       { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  neon_spheres: { beatSensitivity: 0.8, particleDensity: 0.97, smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  fractal:      { beatSensitivity: 0.8, particleDensity: 1.0,  smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
  solar:        { beatSensitivity: 0.8, particleDensity: 0.95, smoothing: 0.80, baseSpeed: 1.0, beatResponse: 0.90 },
};

// ─── Engine style variants ────────────────────────────────────────────────────
const VARIANTS: Partial<Record<EngineId, { id: string; label: string; description: string }[]>> = {
  bars: [
    { id: 'mirror',        label: 'Mirror',        description: 'Bars grow from centre outward (default)' },
    { id: 'classic',       label: 'Classic',       description: 'Bars rise from the bottom' },
    { id: 'wave',          label: 'Wave',          description: 'Smooth filled frequency curve' },
    { id: 'constellation', label: 'Constellation', description: 'Frequency dots connected by proximity lines' },
  ],
  radial: [
    { id: 'spokes',  label: 'Spokes',   description: 'Bars radiate outward (default)' },
    { id: 'ring',    label: 'Ring',     description: 'Thick pulsing ring around the core' },
    { id: 'burst',   label: 'Burst',    description: 'Petal explosion on every beat' },
    { id: 'dots',    label: 'Dots',     description: 'Frequency dots orbiting a pulsing core' },
  ],
  depth: [
    { id: 'starfield', label: 'Starfield', description: 'Flying through a star tunnel (default)' },
    { id: 'nebula',    label: 'Nebula',    description: 'Slow-drifting glowing cloud of particles' },
    { id: 'vortex',    label: 'Vortex',    description: 'Particles spiral inward on every beat' },
    { id: 'galaxy',    label: 'Galaxy',    description: 'Stars orbit a central core with Keplerian speed' },
  ],
  orbital: [
    { id: 'rings', label: 'Rings', description: 'Tilting concentric rings (default)' },
    { id: 'helix', label: 'Helix', description: 'Stacked rings twist into a DNA double helix' },
    { id: 'web',   label: 'Web',   description: 'Rings laced with radial spokes — spins on every beat' },
    { id: 'pulse', label: 'Pulse', description: 'Rings shockwave-burst outward from core on every beat' },
  ],
  tunnel: [
    { id: 'aurora',   label: 'Aurora',   description: 'Layered horizontal ribbon curtains (default)' },
    { id: 'vertical', label: 'Vertical', description: 'Vertical ribbon columns — like a visualizer waterfall' },
    { id: 'spiral',   label: 'Spiral',   description: 'Vanishing-point rings collapse inward like a tunnel' },
    { id: 'wave',     label: 'Wave',     description: 'Concentric sine waves ripple outward from centre' },
  ],
  solar: [
    { id: 'circle', label: 'Circle',  description: 'Smooth circular expanding rings (default)' },
    { id: 'hex',    label: 'Hex',     description: 'Hexagonal rings on every beat' },
    { id: 'square', label: 'Square',  description: 'Square rings that rotate on beat' },
    { id: 'nova',   label: 'Nova',    description: 'Starburst spikes + rings detonate on every drop' },
  ],
  terrain: [
    { id: 'wireframe', label: 'Wireframe', description: 'Mesh grid lines (default)' },
    { id: 'solid',     label: 'Solid',     description: 'Filled terrain with coloured horizon' },
    { id: 'grid',      label: 'Grid',      description: 'Top-down frequency grid — cells pulse per band' },
    { id: 'ocean',     label: 'Ocean',     description: 'Rolling fluid waves — amplitude tied to bass' },
  ],
  neon_spheres: [
    { id: 'float',  label: 'Float',  description: 'Freeform drifting spheres (default)' },
    { id: 'orbit',  label: 'Orbit',  description: 'Spheres orbit a central glow point' },
    { id: 'burst',  label: 'Burst',  description: 'All spheres explode from centre on every beat' },
    { id: 'ring',   label: 'Ring',   description: 'Spheres locked in a rotating ring formation' },
  ],
  fractal: [
    { id: 'kaleidoscope', label: 'Kaleidoscope', description: 'Mirrored radial burst lines (default)' },
    { id: 'mandala',      label: 'Mandala',      description: 'Petal-shaped organic bloom, beat-reactive' },
    { id: 'crystal',      label: 'Crystal',      description: 'Angular shards refract and rotate with the beat' },
  ],
};

const PALETTES: { name: string; colors: [string, string, string] }[] = [
  { name: 'Sunset', colors: ['#8b5cf6', '#ec4899', '#f59e0b'] },
  { name: 'Ocean',  colors: ['#06b6d4', '#3b82f6', '#8b5cf6'] },
  { name: 'Forest', colors: ['#10b981', '#84cc16', '#fbbf24'] },
  { name: 'Mono',   colors: ['#ffffff', '#9ca3af', '#4b5563'] },
  { name: 'Neon',   colors: ['#f0abfc', '#22d3ee', '#a3e635'] },
  { name: 'Dusk',   colors: ['#fb923c', '#e11d48', '#7c3aed'] },
];

const PRESETS = [
  { id: 'fast', name: 'Social Fast',       w: 720,  h: 1280, fps: 30, label: '720p · 30fps'  },
  { id: 'std',  name: 'Creator Standard',  w: 1080, h: 1920, fps: 30, label: '1080p · 30fps' },
  { id: 'pro',  name: 'Pro Master',        w: 2160, h: 3840, fps: 60, label: '4K · 60fps'    },
];

const ASPECTS: { id: '9:16' | '1:1' | '16:9'; label: string; sub: string }[] = [
  { id: '9:16', label: '9:16', sub: 'TikTok / Reels' },
  { id: '1:1',  label: '1:1',  sub: 'Instagram'      },
  { id: '16:9', label: '16:9', sub: 'YouTube'         },
];

// ─── Utilities ───────────────────────────────────────────────────────────────
function avg(arr: Uint8Array, start: number, end: number) {
  const e = Math.min(end, arr.length);
  let s = 0;
  for (let i = start; i < e; i++) s += arr[i];
  return (s / Math.max(1, e - start)) / 255;
}

function hexToRgb(hex: string, cache?: Map<string,string>) {
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

/**
 * Shift a hex colour's intensity based on section energy.
 * intensity 0.25 (breakdown) → ~0.6× = muted
 * intensity 0.5  (verse)     → ~1.0× = unchanged
 * intensity 1.0  (drop)      → ~1.4× = vivid
 */
function shiftColorIntensity(hex: string, intensity: number): string {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // neutral at intensity=0.5 → scale=1.0; drop at 1.0 → scale=1.4; breakdown at 0.25 → scale=0.6
    const scale = 0.2 + intensity * 1.6;
    const nr = Math.min(255, Math.round(r * scale));
    const ng = Math.min(255, Math.round(g * scale));
    const nb = Math.min(255, Math.round(b * scale));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
  } catch { return hex; }
}

type Persist = ReturnType<typeof usePersistentProjects>;

type StudioProps = {
  initialFile: File | null;
  initialEngine?: EngineId;
  projectId?: string | null;
  persist?: Persist;
  onBack: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────
export function Studio({ initialFile, initialEngine = 'bars', projectId, persist, onBack }: StudioProps) {
  const stored = projectId && persist ? persist.projects[projectId] : null;

  // ── State ─────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [persistedId, setPersistedId] = useState<string | null>(projectId ?? null);

  const [engine, setEngine]                   = useState<EngineId>((stored?.engineId as EngineId) ?? initialEngine);
  const [variant, setVariant]                 = useState<string>(''); // '' = first/default variant
  const [palette, setPalette]                 = useState(stored?.style.palette ?? 0);
  const [beatSensitivity, setBeatSensitivity] = useState(stored?.motion.beatSensitivity ?? 0.8);
  const [particleDensity, setParticleDensity] = useState(stored?.motion.particleDensity ?? 0.6);
  const [smoothing, setSmoothing]             = useState(stored?.motion.smoothing ?? 0.8);
  const [perfMode, setPerfMode]               = useState(false);
  const [baseSpeed, setBaseSpeed]             = useState(0.15);   // gentle cruise by default
  const [beatResponse, setBeatResponse]       = useState(0.55);   // noticeable but not chaotic

  const [playing, setPlaying]       = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [aspect, setAspect]           = useState<'9:16' | '1:1' | '16:9'>('9:16');
  const [presetId, setPresetId]       = useState('std');
  const [clipDuration, setClipDuration] = useState<'full' | 15 | 30 | 60>('full');
  // Loop region — null means no loop set; values are fractions 0–1 of track duration
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd,   setLoopEnd]   = useState<number | null>(null);
  const draggingLoopHandle = useRef<'start' | 'end' | 'region' | null>(null);
  const loopDragOriginX    = useRef(0);
  const loopDragOriginStart = useRef(0);
  const loopDragOriginEnd   = useRef(0);
  const [exports, setExports]         = useState<ExportJob[]>([]);
  const [uploadingToCloud, setUploadingToCloud] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [showSignInNudge, setShowSignInNudge] = useState(false);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [recommendations, setRecommendations] = useState<EngineRecommendation[]>([]);
  const [activeTab, setActiveTab]     = useState<string>('style');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Named presets — persisted to localStorage
  type SavedPreset = { name: string; engineId: string; variant: string; palette: number; motion: { beatSensitivity: number; particleDensity: number; smoothing: number; baseSpeed: number; beatResponse: number } };
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem('ma_saved_presets') || '[]'); } catch { return []; }
  });
  // Crossfade: when engine changes, briefly overlay the previous frame at alpha→0
  const crossfadeRef     = useRef<ImageData | null>(null);
  const crossfadeAlpha   = useRef(0);   // 0=done, 1=start of fade

  const exportCancelRef = useRef(false);  // set true to abort a running export   
  const exportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live section state for React overlay (updated from RAF, not canvas)
  const [activeSectionLabel, setActiveSectionLabel] = useState<string | null>(null);
  const [liveEnergy, setLiveEnergy] = useState(0);

  // ── Live-param refs (RAF closure safety) ──────────────────────────────────
  const engineRef          = useRef<EngineId>(engine);
  const variantRef         = useRef(variant);
  const paletteRef         = useRef(palette);
  const beatSensRef        = useRef(beatSensitivity);
  const particleDensRef    = useRef(particleDensity);
  const perfModeRef        = useRef(perfMode);
  const baseSpeedRef       = useRef(baseSpeed);
  const beatResponseRef    = useRef(beatResponse);
  const playingRef         = useRef(false);

  // ── Audio refs ─────────────────────────────────────────────────────────────
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const cameraWrapperRef = useRef<HTMLDivElement>(null);

  // Camera system refs — written every RAF frame, zero React renders
  const cameraZoomRef        = useRef(1.0);
  const cameraTargetZoomRef  = useRef(1.0);
  const cameraDriftXRef      = useRef(0);
  const cameraDriftYRef      = useRef(0);
  const smoothedEnergyRef    = useRef(0.5);
  const prevSectionLabelRef  = useRef<string | null>(null);
  const lastCameraTransformRef = useRef<string>('');
  // Beat onset detection — first-order difference of bass level
  const prevBassRef          = useRef(0);
  // Smoothed burst — decays over ~8 frames so beat effect lasts visibly
  const smoothedBurstRef     = useRef(0);
  // Throttle section label React updates (every ~500ms, not every frame)
  const sectionUpdateThrottle = useRef(0);
  // FPS tracking
  const fpsFramesRef         = useRef(0);
  const fpsLastTimeRef       = useRef(performance.now());
  const [fps, setFps] = useState(0);
  const [showFps, setShowFps] = useState(false);
  const [showPerfSuggest, setShowPerfSuggest] = useState(false);
  const lowFpsWindowsRef = useRef(0);  // consecutive 500ms windows with fps < 30
  const isDraggingSeekRef = useRef(false);
  const seekBarRef = useRef<HTMLDivElement>(null); // for non-passive touchmove
  const freqBufRef = useRef<Uint8Array | null>(null);   // reused every frame — avoids GC pressure
  const tdBufRef    = useRef<Uint8Array | null>(null);   // time-domain buffer reused for waveform underlay
  // ── Perf: cached per-frame values to avoid redundant computation ──────────
  const ctxRef            = useRef<CanvasRenderingContext2D | null>(null); // cached canvas context
  const liveColorsRef     = useRef<[string,string,string]>(['#8b5cf6','#ec4899','#f59e0b']);
  const prevSectionIntRef = useRef(-1);  // track sectionIntensity changes for liveColors cache
  const prevPalRef        = useRef(-1);  // track palette changes for liveColors cache
  const rgbCache          = useRef<Map<string,string>>(new Map()); // hex → 'r,g,b' string cache
  const currentTimeRef    = useRef(0);   // replaces per-frame setCurrentTime React re-render
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const gainRef      = useRef<GainNode | null>(null);
  const sourceRef    = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef    = useRef(0);
  const rafRef       = useRef<number | null>(null);

  // ── Visual engine state refs ───────────────────────────────────────────────
  const starsRef   = useRef<Star[]>([]);
  const sparksRef  = useRef<Spark[]>([]);
  const spheresRef = useRef<Sphere[]>([]);
  const planetsRef = useRef<Planet[]>([]);
  const tunnelTRef = useRef(0);
  const cameraTRef = useRef(0);
  const solarTRef  = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pendingUploadRef = useRef<{ file: File; audioMeta: { name: string; duration: number; sampleRate?: number }; engineId: string } | null>(null);

  // ── Perf: pre-computed path cache for Aurora ribbons ─────────────────────
  // Avoids re-computing 2160 sin() calls/frame; reused for both stroke and fill
  const ribbonPathCache = useRef<Float32Array[]>([]);  // [ribbon][point*2] = x,y pairs
  const ribbonGradCache = useRef<Map<string, CanvasGradient>>(new Map()); // color→gradient

  // Phase 9 refs — written once after decode, read every RAF frame
  const sectionsRef       = useRef<TrackSection[]>([]);
  const energyCurveRef    = useRef<Float32Array>(new Float32Array(0));
  const energyCurveResRef = useRef(0.1);


   const { user } = useAuth();
  const supabaseSync = useSupabaseSync(user?.id);
  const { sessionExpired, clearExpiredFlag } = supabaseSync;
  
  // ── Export mode (platform-aware, computed once) ────────────────────────────
  const exportMode = useMemo(() => getExportMode(), []);

  // ── Restore persisted custom palette colours on mount ─────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ma_custom_palettes');
      if (saved) {
        const map: Record<number, [string, string, string]> = JSON.parse(saved);
        Object.entries(map).forEach(([idx, cols]) => {
          const i = Number(idx);
          if (PALETTES[i] && Array.isArray(cols) && cols.length === 3) {
            PALETTES[i] = { ...PALETTES[i], colors: cols };
          }
        });
      }
    } catch { /* ignore corrupt data */ }
  }, []);

  // ── Waveform seek bar — computed once per analysis ─────────────────────────
  const waveformPoints = useMemo(() => {
    if (!trackAnalysis?.energyCurve.length) return null;
    const curve = trackAnalysis.energyCurve;
    const N  = 200;    // horizontal sample count
    const VW = 1000;   // viewBox width
    const VH = 28;     // viewBox height (matches h-7 = 28px)
    const cy = VH / 2;
    const amp = cy * 0.82; // max amplitude: 82% of half-height
    const top: string[] = [];
    const bot: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t   = i / N;
      const idx = Math.min(Math.floor(t * (curve.length - 1)), curve.length - 1);
      const v   = curve[idx];
      top.push(`${(t * VW).toFixed(1)},${(cy - v * amp).toFixed(1)}`);
      bot.push(`${(t * VW).toFixed(1)},${(cy + v * amp).toFixed(1)}`);
    }
    // Closed polygon: top sweep L→R, bottom sweep R→L
    return [...top, ...[...bot].reverse()].join(' ');
  }, [trackAnalysis]);

  // ── Sync state → refs (MUST be defined before drawFrame effect) ───────────
  // Reset engine-specific buffers when engine or variant changes
  useEffect(() => {
    starsRef.current = [];
    lowFpsWindowsRef.current = 0;
    ribbonPathCache.current = [];
    ribbonGradCache.current.clear();
    // Apply per-engine optimal motion defaults
    const def = ENGINE_MOTION_DEFAULTS[engine];
    if (def) {
      setBeatSensitivity(def.beatSensitivity);
      setParticleDensity(def.particleDensity);
      setSmoothing(def.smoothing);
      setBaseSpeed(def.baseSpeed);
      setBeatResponse(def.beatResponse);
    }
    // Capture current frame for crossfade before the engine switches
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = ctxRef.current ?? canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (ctx) {
        try { crossfadeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { /* ignore */ }
        crossfadeAlpha.current = 1;
      }
    }
  }, [engine]);
  useEffect(() => {
    starsRef.current = [];
    spheresRef.current = [];
    planetsRef.current = [];
  }, [variant]);
  useEffect(() => { engineRef.current        = engine;          }, [engine]);
  useEffect(() => { variantRef.current       = variant;         }, [variant]);
  useEffect(() => { paletteRef.current       = palette;         }, [palette]);
  useEffect(() => { beatSensRef.current      = beatSensitivity; }, [beatSensitivity]);
  useEffect(() => { particleDensRef.current  = particleDensity; }, [particleDensity]);
  useEffect(() => { perfModeRef.current      = perfMode;        }, [perfMode]);
  useEffect(() => { baseSpeedRef.current     = baseSpeed;       }, [baseSpeed]);
  useEffect(() => { beatResponseRef.current  = beatResponse;    }, [beatResponse]);

  // ── Load file on mount ─────────────────────────────────────────────────────
    useEffect(() => {
    if (initialFile) {
      // New file uploaded from landing page — load directly
      loadFile(initialFile);
    } else if (projectId && !initialFile) {
      // Reopening a saved project — try to reload audio from Supabase Storage
      reloadProjectAudio(projectId);
    }
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update analyser smoothing ──────────────────────────────────────────────
  useEffect(() => {
    if (analyserRef.current) analyserRef.current.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        if (status === 'ready') playing ? pause() : play();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, currentTime - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (project) seek(Math.min(project.duration, currentTime + 5));
      } else if (e.key === 'Escape') {
        if (showOnboarding) {
          setShowOnboarding(false);
          localStorage.setItem('ma_seen_shortcuts', '1');
        } else {
          onBack();
        }
      } else if (e.key === 'm') {
        // Cycle through palettes
        setPalette((p) => (p + 1) % PALETTES.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, playing, currentTime, project, showOnboarding]);
  useEffect(() => {
    if (!persist || !persistedId) return;
    persist.updateProject(persistedId, {
      engineId: engine,
      style: { palette },
      motion: { beatSensitivity, particleDensity, smoothing },
    });
  }, [engine, palette, beatSensitivity, particleDensity, smoothing, persistedId, persist]);

// Fire pending audio upload the moment user signs in / session restores
  useEffect(() => {
    if (!user?.id || !persistedId || !pendingUploadRef.current) return;

    const pending = pendingUploadRef.current;
    pendingUploadRef.current = null;

    supabaseSync
      .uploadAudio(persistedId, pending.file, pending.audioMeta, pending.engineId)
      .catch((err) => console.error('[studio] pending upload ERROR:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, persistedId]);

  // Show sign-in nudge ~2.5s after audio is ready for anonymous users
  useEffect(() => {
    if (status === 'ready' && !user) {
      const t = setTimeout(() => setShowSignInNudge(true), 2500);
      return () => clearTimeout(t);
    }
    if (user) setShowSignInNudge(false);
  }, [status, user]);

  // Show keyboard shortcut coach mark once after first successful load
  useEffect(() => {
    // Never show keyboard shortcut coach mark on touch devices — shortcuts don't apply
    const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (status === 'ready' && !isTouchDevice && !localStorage.getItem('ma_seen_shortcuts')) {
      const t = setTimeout(() => setShowOnboarding(true), 1800);
      return () => clearTimeout(t);
    }
  }, [status]);

  // Supabase autosave — debounced 1.5 s, runs in parallel with local persist
  useEffect(() => {
    if (!persistedId || !project) return;
    supabaseSync.saveConfig(persistedId, {
      engineId: engine,
      style: { palette },
      motion: { beatSensitivity, particleDensity, smoothing },
      audioMeta: { name: project.fileName, duration: project.duration },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, palette, beatSensitivity, particleDensity, smoothing, persistedId, project?.fileName, supabaseSync]);
  

 // ── Redraw static frame when params change ─────────────────────────────────
  // Guard: skip when playing — the RAF loop already renders every frame.
  // Only fire when paused so slider/engine changes update the frozen preview.
  useEffect(() => {
    if (!playingRef.current) drawFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, palette, beatSensitivity, particleDensity, project, aspect, perfMode, baseSpeed, beatResponse]);

  // ─────────────────────────────────────────────────────────────────────────
  // drawFrame — reads ALL live values from refs so RAF loop never goes stale
  // ─────────────────────────────────────────────────────────────────────────
  const drawFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Cache the 2D context — getContext() is a dictionary lookup every call
    // willReadFrequently: true → browser pre-allocates readback buffer, silences warning
    if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
      ctxRef.current = canvas.getContext('2d', { alpha: false, willReadFrequently: true }) ?? null;
    }
   const ctx = ctxRef.current;
    if (!ctx) return;

    // Reset state that any engine may have left dirty — prevents bleed on switch
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const eng     = engineRef.current;
    const vrnt    = variantRef.current;
    const pal     = paletteRef.current;
    const sens    = 0.5 + beatSensRef.current * 1.5;
    const perf    = perfModeRef.current;
    const bSpeed  = baseSpeedRef.current;
    const bResp   = beatResponseRef.current;
    const colors  = PALETTES[pal].colors;
    const w = canvas.width, h = canvas.height;
    const hxCache = rgbCache.current;

    // Solid background — no gradient object allocation (visually identical)
    ctx.fillStyle = 'rgb(12,12,18)';
    ctx.fillRect(0, 0, w, h);

    const analyser = analyserRef.current;
    if (!analyser) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Upload a track to begin', w / 2, h / 2);
      return;
    }

    // Reuse a persistent buffer — avoids GC pressure from 60 allocations/sec
    if (!freqBufRef.current || freqBufRef.current.length !== analyser.frequencyBinCount) {
      freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqBufRef.current);
    const freq = freqBufRef.current;

    // ── Phase 9: section + energy context ─────────────────────────────────
    const playbackSec = audioCtxRef.current
      ? Math.max(0, audioCtxRef.current.currentTime - startedAtRef.current + offsetRef.current)
      : 0;
    const activeSection = getSectionAtTime(sectionsRef.current, playbackSec);
    const sectionProgress = activeSection ? getSectionProgress(activeSection, playbackSec) : 0;
    const currentEnergy = sampleEnergyCurve(energyCurveRef.current, playbackSec, energyCurveResRef.current);
    // energyMult: smoothly scales between 0.6 (low energy) and 1.4 (high energy)
    const energyMult = 0.6 + currentEnergy * 0.8;
    // sectionIntensity: 0=breakdown/intro, 0.5=verse, 1=drop/chorus
    const sectionIntensity = activeSection
      ? (['drop', 'chorus'].includes(activeSection.label) ? 1.0
        : ['verse'].includes(activeSection.label) ? 0.55
        : ['intro', 'outro'].includes(activeSection.label) ? 0.35
        : 0.25) // breakdown
      : 0.5;
    // ─────────────────────────────────────────────────────────────────────

    // ── Camera system ─────────────────────────────────────────────────────
    // Smooth the energy value so the camera never jerks
    smoothedEnergyRef.current += (currentEnergy - smoothedEnergyRef.current) * 0.03;
    const smoothEnergy = smoothedEnergyRef.current;

    // Section-change zoom events
    if (activeSection?.label !== prevSectionLabelRef.current) {
      prevSectionLabelRef.current = activeSection?.label ?? null;
      if (activeSection?.label === 'drop')         cameraTargetZoomRef.current = 1.03;
      else if (activeSection?.label === 'chorus')  cameraTargetZoomRef.current = 1.015;
      else if (activeSection?.label === 'breakdown') cameraTargetZoomRef.current = 0.978;
      else if (activeSection?.label === 'intro' || activeSection?.label === 'outro') cameraTargetZoomRef.current = 0.99;
      else cameraTargetZoomRef.current = 1.0;
    }
    // Breathing zoom — kept subtle so beats remain visible in frame
    const breathTarget = cameraTargetZoomRef.current * (1 + smoothEnergy * 0.010);
    cameraZoomRef.current += (breathTarget - cameraZoomRef.current) * 0.018;

    // Slow sinusoidal drift — amplitude scales with section intensity
    const now = Date.now();
    const driftAmp = 0.003 * (0.3 + sectionIntensity * 0.7);
    cameraDriftXRef.current = Math.sin(now * 0.00034) * driftAmp;
    cameraDriftYRef.current = Math.cos(now * 0.00027) * driftAmp;

    // Apply camera ONLY to 3D engines — 2D engines (bars, radial) get no zoom
    const is3DEngine = ['orbital','depth','terrain','tunnel','neon_spheres','fractal','solar'].includes(eng);
    if (cameraWrapperRef.current) {
      let nextTransform: string;
      if (is3DEngine) {
        const z = cameraZoomRef.current.toFixed(4);
        const dx = (cameraDriftXRef.current * 100).toFixed(3);
        const dy = (cameraDriftYRef.current * 100).toFixed(3);
        nextTransform = `translate(${dx}%, ${dy}%) scale(${z})`;
      } else {
        nextTransform = 'none';
      }
      // Skip write if unchanged — saves a style-recalc per frame
      if (nextTransform !== lastCameraTransformRef.current) {
        cameraWrapperRef.current.style.transform = nextTransform;
        lastCameraTransformRef.current = nextTransform;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Section-reactive colours ──────────────────────────────────────────
    // Recompute ONLY when palette or sectionIntensity changes — not every frame
    if (pal !== prevPalRef.current || sectionIntensity !== prevSectionIntRef.current) {
      prevPalRef.current        = pal;
      prevSectionIntRef.current = sectionIntensity;
      liveColorsRef.current = colors.map(c => shiftColorIntensity(c, sectionIntensity)) as [string,string,string];
      rgbCache.current.clear();          // palette changed → invalidate hex→rgb cache
      ribbonGradCache.current.clear();   // cached ribbon gradients are now stale
    }
    const liveColors = liveColorsRef.current;

    // Throttled React state update for the overlay (not every frame)
    const now2 = Date.now();
    if (now2 - sectionUpdateThrottle.current > 500) {
      sectionUpdateThrottle.current = now2;
      setActiveSectionLabel(activeSection?.label ?? null);
      setLiveEnergy(Math.round(currentEnergy * 100));
      // FPS calculation: frames per second over the throttle window
      const elapsed = now2 - fpsLastTimeRef.current;
      if (elapsed > 0) {
        const measuredFps = Math.round((fpsFramesRef.current / elapsed) * 1000);
        setFps(measuredFps);
        // Auto-perf suggestion: 12 consecutive low windows ≈ 6s of sustained sluggishness
        // Threshold is 25fps (clearly choppy) not 30 (brief dips are normal on heavy engines)
        // Only fires once per session via localStorage flag
        if (measuredFps < 25 && playingRef.current && !perfModeRef.current
            && !localStorage.getItem('ma_perf_suggested')) {
          lowFpsWindowsRef.current += 1;
          if (lowFpsWindowsRef.current >= 12) {
            setShowPerfSuggest(true);
            localStorage.setItem('ma_perf_suggested', '1');
            lowFpsWindowsRef.current = 0;
          }
        } else if (measuredFps >= 25) {
          lowFpsWindowsRef.current = 0;
        }
      }
      fpsFramesRef.current = 0;
      fpsLastTimeRef.current = now2;
    }
    fpsFramesRef.current++;
    // ─────────────────────────────────────────────────────────────────────

    // ── Spectrum Bars ─────────────────────────────────────────────────────
    if (eng === 'bars') {
      const numBars = 96;
      const step = Math.floor(freq.length / numBars);
      const barW = w / numBars;

      // Waveform underlay — all variants share this
      if (!tdBufRef.current || tdBufRef.current.length !== analyser.frequencyBinCount * 2) {
        tdBufRef.current = new Uint8Array(analyser.frequencyBinCount * 2);
      }
      analyser.getByteTimeDomainData(tdBufRef.current);
      const tdData = tdBufRef.current;
      ctx.save();
      ctx.strokeStyle = `rgba(${hexToRgb(liveColors[1], hxCache)}, 0.18)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < tdData.length; i++) {
        const x = (i / tdData.length) * w;
        const y = ((tdData[i] / 128) - 1) * h * 0.13 + h / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      if (vrnt === 'classic') {
        // ── Classic: bars rise from bottom ─────────────────────────────
        for (let i = 0; i < numBars; i++) {
          const v  = (freq[i * step] / 255) * sens * energyMult;
          const bh = v * h * 0.72 * (0.4 + sectionIntensity * 0.6);
          // Use index-based color cycle instead of per-bar gradient (saves 80 gradient allocs/frame)
          ctx.fillStyle = liveColors[i % liveColors.length];
          ctx.globalAlpha = 0.55 + v * 0.45;
          ctx.fillRect(i * barW + 1, h - bh, barW - 2, bh);
        }
        ctx.globalAlpha = 1;
      } else if (vrnt === 'wave') {
        // ── Wave: smooth filled frequency curve ─────────────────────────
        const pts: [number, number][] = [];
        for (let i = 0; i < numBars; i++) {
          const v = (freq[i * step] / 255) * sens * energyMult;
          const bh = v * h * 0.72 * (0.4 + sectionIntensity * 0.6);
          pts.push([i * barW + barW / 2, h - bh]);
        }
        // Top stroke
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, liveColors[0]);
        grad.addColorStop(0.5, liveColors[1]);
        grad.addColorStop(1, `rgba(${hexToRgb(liveColors[2], hxCache)}, 0.2)`);
        ctx.strokeStyle = liveColors[0];
        ctx.lineWidth = 2.5;
        ctx.shadowColor = liveColors[0];
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Fill under curve
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (vrnt === 'constellation') {
        // ── Constellation: frequency dots connected by proximity lines ───
        const numDots = 56;
        const step2 = Math.floor(freq.length / numDots);
        const midY2 = h / 2;
        // Build mirrored dot array
        const cpts: [number, number, number][] = [];
        for (let i = 0; i < numDots; i++) {
          const v = (freq[i * step2] / 255) * sens * energyMult;
          const x = (i / (numDots - 1)) * w;
          const amp = v * h * 0.36 * (0.4 + sectionIntensity * 0.6);
          cpts.push([x, midY2 - amp, v]); // top
          cpts.push([x, midY2 + amp, v]); // bottom (mirror)
        }
        // Draw connecting lines between nearby dots
        const threshold = w * 0.14;
        for (let i = 0; i < cpts.length; i++) {
          for (let j = i + 1; j < cpts.length; j++) {
            const dx = cpts[j][0] - cpts[i][0];
            if (Math.abs(dx) > threshold) continue; // fast X-axis reject
            const dy = cpts[j][1] - cpts[i][1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < threshold) {
              const prox = 1 - dist / threshold;
              const avgV = (cpts[i][2] + cpts[j][2]) * 0.5;
              ctx.globalAlpha = prox * prox * avgV * 0.55;
              ctx.strokeStyle = liveColors[avgV > 0.5 ? 0 : avgV > 0.25 ? 1 : 2];
              ctx.lineWidth = 0.7 + prox * 1.2;
              ctx.beginPath(); ctx.moveTo(cpts[i][0], cpts[i][1]); ctx.lineTo(cpts[j][0], cpts[j][1]); ctx.stroke();
            }
          }
        }
        // Draw glowing star dots
        for (const [x, y, v] of cpts) {
          if (v < 0.035) continue;
          const size = 1.5 + v * 9 * (0.5 + sectionIntensity * 0.5);
          const color = liveColors[v > 0.6 ? 0 : v > 0.3 ? 1 : 2];
          ctx.globalAlpha = 0.45 + v * 0.55;
          ctx.shadowColor = color; ctx.shadowBlur = size * 3.5;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        }
        // Centre line
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.06;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, midY2); ctx.lineTo(w, midY2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        const midY = h / 2;
        // Single gradient outside the loop — was 80 createLinearGradient calls/frame, now 1
        let maxBh = 1;
        for (let i = 0; i < numBars; i++) {
          const bhi = (freq[i * step] / 255) * sens * energyMult * h * 0.36 * (0.4 + sectionIntensity * 0.6);
          if (bhi > maxBh) maxBh = bhi;
        }
        const mirrorGrad = ctx.createLinearGradient(0, midY - maxBh, 0, midY + maxBh);
        mirrorGrad.addColorStop(0,   liveColors[0]);
        mirrorGrad.addColorStop(0.5, liveColors[1]);
        mirrorGrad.addColorStop(1,   liveColors[2]);
        ctx.fillStyle = mirrorGrad;
        for (let i = 0; i < numBars; i++) {
          const v = (freq[i * step] / 255) * sens * energyMult;
          const bh = v * h * 0.36 * (0.4 + sectionIntensity * 0.6);
          if (bh < 1) continue;
          ctx.fillRect(i * barW + 2, midY - bh, barW - 4, bh * 2);
        }
        ctx.strokeStyle = `rgba(255,255,255,0.06)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      }

    // ── Radial Spectrum ───────────────────────────────────────────────────
    } else if (eng === 'radial') {
      const cx = w / 2, cy = h / 2;
      const minDim = Math.min(w, h);
      const baseR = minDim * 0.15;
      const bars = 120;
      const step = Math.floor(freq.length / bars);
      const bass = avg(freq, 0, 8);
      const coreR = baseR * (1 + bass * sens * 0.6);
      // Shared core glow
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.5);
      coreGrad.addColorStop(0, liveColors[0]);
      coreGrad.addColorStop(0.5, `rgba(${hexToRgb(liveColors[1], hxCache)}, 0.4)`);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.arc(cx, cy, coreR * 1.5, 0, Math.PI * 2); ctx.fill();

      if (vrnt === 'ring') {
        // ── Ring: thick pulsing ring ────────────────────────────────────
        const ringBars = 256;
        const rStep = Math.floor(freq.length / ringBars);
        for (let i = 0; i < ringBars; i++) {
          const v = (freq[i * rStep] / 255) * sens * energyMult;
          const r1 = coreR * 1.1;
          const r2 = r1 + v * minDim * 0.32 * (0.5 + sectionIntensity * 0.5);
          const a1 = (i / ringBars) * Math.PI * 2;
          const a2 = ((i + 1) / ringBars) * Math.PI * 2;
          const color = liveColors[i % liveColors.length];
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.7 + v * 0.3;
          ctx.beginPath();
          ctx.arc(cx, cy, r2, a1, a2);
          ctx.arc(cx, cy, r1, a2, a1, true);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (vrnt === 'burst') {
        // ── Burst: petal explosion ─────────────────────────────────────
        const numPetals = 12 + Math.round(sectionIntensity * 6);
        for (let i = 0; i < numPetals; i++) {
          const bandVal = avg(freq, Math.floor(i * freq.length / numPetals), Math.floor((i + 1) * freq.length / numPetals));
          const petalLen = (baseR * 0.5 + bandVal * minDim * 0.38 * sens) * energyMult * (0.6 + sectionIntensity * 0.4);
          const angle = (i / numPetals) * Math.PI * 2;
          const tipX = cx + Math.cos(angle) * petalLen;
          const tipY = cy + Math.sin(angle) * petalLen;
          const cp1X = cx + Math.cos(angle - 0.3) * petalLen * 0.6;
          const cp1Y = cy + Math.sin(angle - 0.3) * petalLen * 0.6;
          const cp2X = cx + Math.cos(angle + 0.3) * petalLen * 0.6;
          const cp2Y = cy + Math.sin(angle + 0.3) * petalLen * 0.6;
          const color = liveColors[i % liveColors.length];
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.55 + bandVal * 0.45;
          ctx.shadowColor = color; ctx.shadowBlur = 8 + bandVal * 20;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, tipX, tipY);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      } else if (vrnt === 'dots') {
        // ── Dots: frequency dots orbiting a pulsing core ────────────────
        const dotN = perf ? 64 : 128;
        const dotStep = Math.floor(freq.length / dotN);
        solarTRef.current += (0.012 + bass * 0.02 * sens) * energyMult;
        const t2 = solarTRef.current;
        for (let i = 0; i < dotN; i++) {
          const v   = (freq[i * dotStep] / 255) * sens;
          const ang = (i / dotN) * Math.PI * 2 + t2 * 0.12;
          // Two concentric rings of dots — inner and outer
          for (const [ring, rMult] of [[0, 1.0], [1, 1.55]] as [number, number][]) {
            const r      = coreR * rMult * (1.35 + v * 1.8 * (0.5 + sectionIntensity * 0.5));
            const dotX   = cx + Math.cos(ang + ring * Math.PI / dotN) * r;
            const dotY   = cy + Math.sin(ang + ring * Math.PI / dotN) * r;
            const color  = liveColors[(i + ring) % liveColors.length];
            const size   = Math.max(0.5, 1.2 + v * 7 * (0.4 + sectionIntensity * 0.6));
            if (v < 0.025) continue;
            ctx.fillStyle   = color;
            ctx.globalAlpha = 0.25 + v * 0.75;
            ctx.shadowColor = color; ctx.shadowBlur = size * 3.5;
            ctx.beginPath(); ctx.arc(dotX, dotY, size, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      } else {
        // ── Spokes (default) ───────────────────────────────────────────
        for (let i = 0; i < bars; i++) {
          const v = (freq[i * step] / 255) * sens * energyMult;
          const len = baseR + v * minDim * 0.35 * (0.4 + sectionIntensity * 0.6);
          const angle = (i / bars) * Math.PI * 2;
          const x1 = cx + Math.cos(angle) * baseR, y1 = cy + Math.sin(angle) * baseR;
          const x2 = cx + Math.cos(angle) * len,   y2 = cy + Math.sin(angle) * len;
          // Color cycles across palette instead of per-spoke gradient
          const spokeColor = liveColors[Math.floor(i / bars * liveColors.length) % liveColors.length];
          ctx.strokeStyle = spokeColor; ctx.lineWidth = 1.5 + v * 2; ctx.lineCap = 'round';
          ctx.shadowColor = spokeColor; ctx.shadowBlur = 4 + v * 12;
          ctx.globalAlpha = 0.5 + v * 0.5;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

    // ── Orbital Rings ─────────────────────────────────────────────────────
    } else if (eng === 'orbital') {
      ctx.fillStyle = 'rgba(8,8,15,0.35)';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      cameraTRef.current += (0.004 + bass * 0.01 * sens) * energyMult;
      const orbitOnset = Math.max(0, bass - prevBassRef.current);
      if (eng === 'orbital') prevBassRef.current = bass;
      if (orbitOnset > 0.05) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + orbitOnset * 2.5);
      smoothedBurstRef.current *= 0.84;
      const burst = smoothedBurstRef.current;

      if (vrnt === 'pulse') {
        // ── Pulse: shockwave rings launch from core on every beat ────────
        if (!planetsRef.current) planetsRef.current = [];
        // Spawn ring on beat onset
        if (orbitOnset > 0.045) {
          const pCount = Math.floor(1 + orbitOnset * 3);
          for (let p = 0; p < pCount && planetsRef.current.length < 24; p++) {
            planetsRef.current.push({
              r:      Math.min(w,h) * 0.04,
              speed:  (2.8 + orbitOnset * 5 + Math.random() * 2) * energyMult,
              alpha:  Math.min(1, 0.55 + orbitOnset * 1.8),
              color:  liveColors[Math.floor(Math.random() * liveColors.length)],
              lw:     1.5 + orbitOnset * 8,
            } as any);
          }
        }
        // Draw background: subtle rotating mesh of 3 standing rings
        for (let i = 0; i < 3; i++) {
          const bv  = avg(freq, i * 20, i * 20 + 20);
          const r   = Math.min(w,h) * (0.14 + i * 0.11) * (1 + bv * sens * 0.22);
          const rot = cameraTRef.current * (0.18 + i * 0.09) * (i % 2 === 0 ? 1 : -1);
          ctx.save();
          ctx.strokeStyle = liveColors[i % liveColors.length];
          ctx.lineWidth   = 0.8 + bv * 2;
          ctx.globalAlpha = 0.12 + bv * 0.28;
          ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1, 0.55);
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        // Shockwave rings expand + fade
        planetsRef.current = (planetsRef.current as any[]).filter((ring: any) => {
          ring.r     += ring.speed;
          ring.alpha *= 0.90;
          ring.lw    *= 0.94;
          if (ring.alpha < 0.02 || ring.r > Math.min(w,h) * 0.7) return false;
          ctx.save();
          ctx.strokeStyle = ring.color;
          ctx.lineWidth   = ring.lw;
          ctx.globalAlpha = ring.alpha * (0.55 + sectionIntensity * 0.45);
          ctx.shadowColor = ring.color; ctx.shadowBlur = 12 + burst * 18;
          ctx.beginPath(); ctx.arc(cx, cy, ring.r, 0, Math.PI * 2); ctx.stroke();
          // Inner fill bloom
          ctx.globalAlpha = ring.alpha * 0.08;
          ctx.fillStyle   = ring.color; ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.arc(cx, cy, ring.r * 0.92, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          return true;
        });
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        // Core
        const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w,h) * 0.07 * (1 + burst * 0.6));
        cG.addColorStop(0, '#ffffff'); cG.addColorStop(0.3, liveColors[0]); cG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cG; ctx.globalAlpha = 0.8 + burst * 0.2;
        ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 16 + burst * 24;
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(w,h) * 0.07 * (1 + burst * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      } else if (vrnt === 'web') {
        // ── Web: concentric rings laced with radial spokes ───────────────
        const spokeN = perf ? 8 : 14;
        const ringN  = perf ? 4 : 7;
        const webRot = cameraTRef.current * 0.22 + burst * 0.4;
        // Rings
        for (let r = 0; r < ringN; r++) {
          const t2     = (r + 1) / ringN;
          const bandV  = avg(freq, Math.floor(t2 * freq.length * 0.5), Math.floor(t2 * freq.length * 0.5) + 8);
          const radius = Math.min(w, h) * 0.08 + t2 * Math.min(w, h) * 0.37 * (0.75 + sectionIntensity * 0.25);
          const liveRadius = radius * (1 + bandV * sens * 0.25);
          const color  = liveColors[r % liveColors.length];
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth   = 0.8 + bandV * 3.5 * sens;
          ctx.globalAlpha = 0.25 + bandV * 0.65;
          ctx.shadowColor = color; ctx.shadowBlur = 5 + bandV * 18;
          ctx.beginPath(); ctx.arc(cx, cy, liveRadius, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        // Spokes radiating from centre to outer ring
        const outerR = Math.min(w, h) * 0.45 * (0.75 + sectionIntensity * 0.25);
        for (let s = 0; s < spokeN; s++) {
          const angle  = (s / spokeN) * Math.PI * 2 + webRot;
          const bandV  = (freq[Math.min(Math.floor(s * freq.length / spokeN), freq.length - 1)] / 255) * sens;
          const color  = liveColors[s % liveColors.length];
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth   = 0.6 + bandV * 2.2;
          ctx.globalAlpha = 0.18 + bandV * 0.52;
          ctx.shadowColor = color; ctx.shadowBlur = 4 + bandV * 12;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
          ctx.stroke();
          ctx.restore();
        }
        // Centre glow
        const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w,h) * 0.06 * (1 + burst * 0.8));
        cG.addColorStop(0, liveColors[0]); cG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cG; ctx.globalAlpha = 0.6 + burst * 0.4;
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(w,h) * 0.06 * (1 + burst * 0.8), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else if (vrnt === 'helix') {        // ── Helix: stacked rings twist into a DNA double helix ──────────
        const helixN = perf ? 9 : 20;
        const bandH  = h / helixN;
        ctx.shadowBlur = 0;
        for (let i = 0; i < helixN; i++) {
          const t2      = i / helixN;
          const ringCY  = bandH * (i + 0.5);
          const freqBand = Math.min(Math.floor(t2 * freq.length * 0.55), freq.length - 1);
          const v       = (freq[freqBand] / 255) * sens;
          // Phase progresses 1.5 full turns across the stack → helix shape
          const phase   = t2 * Math.PI * 3;
          const rot     = cameraTRef.current * 0.65 + phase;
          const tiltFactor = Math.abs(Math.cos(rot)); // 0 = edge-on, 1 = face-on
          const baseR   = Math.min(w, h) * 0.19 * (0.65 + sectionIntensity * 0.35) * (0.75 + v * 0.25);
          const color   = liveColors[i % liveColors.length];

          ctx.save();
          ctx.translate(cx, ringCY);
          ctx.scale(1, Math.max(0.05, tiltFactor));
          ctx.strokeStyle = color;
          ctx.lineWidth   = (1.5 + v * 5.5) * energyMult;
          ctx.globalAlpha = 0.25 + v * 0.75;
          ctx.shadowColor = color; ctx.shadowBlur = (6 + v * 14) * (0.5 + sectionIntensity * 0.5);
          ctx.beginPath(); ctx.arc(0, 0, baseR, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();

          // Backbone strand connecting adjacent rings
          if (i < helixN - 1) {
            const nextPhase = ((i + 1) / helixN) * Math.PI * 3;
            const nextRot   = cameraTRef.current * 0.65 + nextPhase;
            const nextCY    = bandH * (i + 1.5);
            // Two strands at ±90° phase offset
            for (const offset of [0, Math.PI]) {
              const x1 = cx + Math.cos(rot + offset) * baseR;
              const x2 = cx + Math.cos(nextRot + offset) * baseR;
              ctx.globalAlpha = 0.12 + v * 0.18;
              ctx.strokeStyle = color; ctx.lineWidth = 0.9;
              ctx.shadowBlur = 0;
              ctx.beginPath(); ctx.moveTo(x1, ringCY); ctx.lineTo(x2, nextCY); ctx.stroke();
            }
          }
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else {
        // ── Rings (default): concentric tilting orbital rings ────────────
        const tilt = 0.4 + Math.sin(cameraTRef.current * 0.6) * 0.2;
        const coreR = Math.min(w, h) * 0.07 * (1 + bass * sens * 0.6);
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
        coreGrad.addColorStop(0, liveColors[0]); coreGrad.addColorStop(0.4, liveColors[1]); coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = coreGrad; ctx.beginPath(); ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2); ctx.fill();
        const ringCount = perf ? 3 : 8;
        for (let r = 0; r < ringCount; r++) {
          const baseR = Math.min(w, h) * (0.12 + r * 0.07) * (1 + bass * sens * 0.15) * (0.7 + sectionIntensity * 0.3);
          const thickness = (1.5 + mids * 6 * sens + r * 0.4) * energyMult;
          const rot = cameraTRef.current * (0.3 + r * 0.1) + r;
          ctx.save();
          ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1, Math.max(0.15, tilt - r * 0.03));
          ctx.strokeStyle = liveColors[r % liveColors.length];
          ctx.globalAlpha = 0.55 + mids * 0.5;
          ctx.lineWidth = thickness;
          ctx.beginPath(); ctx.arc(0, 0, baseR, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          if (highs > 0.55 && Math.random() < 0.3) {
            sparksRef.current.push({ angle: Math.random() * Math.PI * 2, r: baseR, speed: 0.04 + highs * 0.05, life: 1, ring: r });
          }
        }
        ctx.globalAlpha = 1;
        for (const s of sparksRef.current) {
          s.angle += s.speed; s.life *= 0.96;
          const baseR = Math.min(w, h) * (0.12 + s.ring * 0.07);
          const x = cx + Math.cos(s.angle) * baseR;
          const y = cy + Math.sin(s.angle) * baseR * Math.max(0.15, tilt - s.ring * 0.03);
          ctx.fillStyle = liveColors[2]; ctx.globalAlpha = s.life;
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        sparksRef.current = sparksRef.current.filter((s) => s.life > 0.08);
      }

    // ── Depth Field Particles ────────────────────────────────────────────
    } else if (eng === 'depth') {
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      const bassOnset = Math.max(0, bass - prevBassRef.current);
      prevBassRef.current = bass;
      const isBeat = bassOnset > 0.048;
      if (isBeat) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + bassOnset * 2.2);
      smoothedBurstRef.current *= 0.82;
      const burst = smoothedBurstRef.current;

      const trail = 0.08 + (1 - bResp) * 0.16;
      ctx.fillStyle = `rgba(2,2,8,${trail})`;
      ctx.fillRect(0, 0, w, h);

      const densityScale = 0.5 + sectionIntensity * 0.5;
      const targetCount = Math.floor((perf ? 350 : 1100) * densityScale * (0.35 + particleDensRef.current * 0.65));
      while (starsRef.current.length < targetCount) {
        starsRef.current.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: 0.15 + Math.random() * 0.85, hue: Math.random() });
      }
      starsRef.current.length = Math.min(starsRef.current.length, targetCount + 60);

      const cx = w / 2, cy = h / 2;

      if (vrnt === 'nebula') {
        // ── Nebula: slow drifting colour cloud ──────────────────────────
        ctx.clearRect(0, 0, 0, 0); // no-op, trail already applied above
        for (const s of starsRef.current) {
          // Drift slowly — no focal point, just floating
          s.x += Math.sin(s.z * 12 + mids * 2) * 0.0004 * energyMult;
          s.y += Math.cos(s.z * 9  + bass * 2) * 0.0004 * energyMult;
          // Wrap edges
          if (s.x < -1) s.x += 2; if (s.x > 1) s.x -= 2;
          if (s.y < -1) s.y += 2; if (s.y > 1) s.y -= 2;
          const sx = (s.x * 0.5 + 0.5) * w;
          const sy = (s.y * 0.5 + 0.5) * h;
          // Size pulses with its own hue band
          const bandIdx = Math.floor(s.hue * freq.length * 0.4);
          const bandVal = (freq[Math.min(bandIdx, freq.length - 1)] / 255) * sens;
          const size = (2 + bandVal * 18 * (0.5 + sectionIntensity * 0.5)) * (0.4 + burst * 0.6);
          const color = liveColors[Math.floor(s.hue * liveColors.length)];
          ctx.globalAlpha = 0.25 + bandVal * 0.55;
          ctx.shadowColor = color; ctx.shadowBlur = size * 2.5;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else if (vrnt === 'vortex') {
        // ── Vortex: particles spiral into centre on beats ───────────────
        const baseSpd = 0.00025 + bSpeed * 0.0012;
        const beatSpike = burst * bResp * 0.10 * sens;
        cameraTRef.current += (0.008 + bass * 0.02 * sens) * energyMult; // rotation clock
        for (const s of starsRef.current) {
          const prevX = s.x, prevY = s.y;
          // Spiral inward: shrink radius + rotate
          const r = Math.hypot(s.x, s.y);
          const theta = Math.atan2(s.y, s.x);
          const inSpeed = (baseSpd + beatSpike) * 1.5;
          const newR = r - inSpeed;
          const spinSpeed = 0.012 * energyMult * (0.5 + sectionIntensity * 0.5);
          const newTheta = theta + spinSpeed;
          s.x = Math.cos(newTheta) * Math.max(0.001, newR);
          s.y = Math.sin(newTheta) * Math.max(0.001, newR);
          // Respawn at outer ring
          if (newR <= 0.005) {
            const a = Math.random() * Math.PI * 2;
            const spawnR = 0.7 + Math.random() * 0.3;
            s.x = Math.cos(a) * spawnR; s.y = Math.sin(a) * spawnR;
            s.z = Math.random(); s.hue = Math.random();
            continue;
          }
          const sx = cx + s.x * cx, sy = cy + s.y * cy;
          const proximity = 1 - Math.hypot(s.x, s.y);
          const size = Math.max(0.3, proximity * proximity * (4 + mids * 6 * sens));
          const color = liveColors[Math.floor(s.hue * liveColors.length)];
          ctx.globalAlpha = Math.min(1, proximity * 2) * (0.4 + highs * 0.6);
          // Trail
          if (burst > 0.05) {
            const prevSx = cx + prevX * cx, prevSy = cy + prevY * cy;
            ctx.strokeStyle = color; ctx.lineWidth = size * 0.4;
            ctx.globalAlpha *= 0.7;
            ctx.beginPath(); ctx.moveTo(prevSx, prevSy); ctx.lineTo(sx, sy); ctx.stroke();
            ctx.globalAlpha = Math.min(1, proximity * 2) * (0.4 + highs * 0.6);
          }
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Centre singularity glow
        const singGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w,h) * 0.06 * (1 + burst));
        singGrad.addColorStop(0, liveColors[0]);
        singGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = singGrad; ctx.globalAlpha = 0.6 + burst * 0.4;
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(w,h) * 0.06 * (1 + burst), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

      } else if (vrnt === 'galaxy') {
        // ── Galaxy: stars orbit centre in perspective ellipses ──────────
        // starsRef: {x = angle, y = orbRadius (0-1), z = zDepth, hue = colorIdx}
        const targetG = Math.floor((perf ? 280 : 680) * (0.35 + particleDensRef.current * 0.65));
        while (starsRef.current.length < targetG) {
          const a = Math.random() * Math.PI * 2;
          const rad = 0.08 + Math.pow(Math.random(), 0.6) * 0.88; // cluster toward core
          starsRef.current.push({ x: a, y: rad, z: 0.1 + Math.random() * 0.9, hue: Math.random() });
        }
        starsRef.current.length = Math.min(starsRef.current.length, targetG + 60);

        const baseAngSpd  = 0.0025 + bSpeed * 0.007;
        const beatBoost   = burst * bResp * 0.035;
        const tiltY       = 0.42 + Math.sin(cameraTRef.current * 0.12) * 0.14; // gentle galaxy tilt
        const maxR        = Math.min(w, h) * 0.44;

        for (const s of starsRef.current) {
          // Keplerian: inner stars orbit faster
          const angSpeed = (baseAngSpd + beatBoost) * (0.25 + 0.75 / (s.y * 2 + 0.3)) * energyMult;
          s.x += angSpeed;
          if (s.x > Math.PI * 2) s.x -= Math.PI * 2;

          const sx = cx + Math.cos(s.x) * s.y * maxR;
          const sy = cy + Math.sin(s.x) * s.y * maxR * tiltY;

          const bandIdx  = Math.min(Math.floor(s.hue * freq.length * 0.5), freq.length - 1);
          const bandVal  = (freq[bandIdx] / 255) * sens;
          const size     = Math.max(0.3, (0.4 + s.z * 2.5 + bandVal * 7 * sectionIntensity) * (0.4 + burst * 0.6));
          const color    = liveColors[Math.floor(s.hue * liveColors.length)];

          ctx.globalAlpha = (0.15 + s.z * 0.85) * (0.25 + bandVal * 0.75);
          ctx.shadowColor = color; ctx.shadowBlur = size * 2.2;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;

        // Galactic core glow
        const coreSize = Math.min(w, h) * (0.055 + bass * 0.05 * sens * (0.7 + sectionIntensity * 0.3));
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 3.5);
        coreGrad.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)}, ${0.9 + burst * 0.1})`);
        coreGrad.addColorStop(0.35, `rgba(${hexToRgb(liveColors[1], hxCache)}, 0.35)`);
        coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath(); ctx.arc(cx, cy, coreSize * 3.5, 0, Math.PI * 2); ctx.fill();

      } else {
        const baseSpd = 0.00025 + bSpeed * 0.0012;
        const beatSpike = burst * bResp * 0.10 * sens;
        const speed = (baseSpd + beatSpike) * energyMult;
        const focal = Math.min(w, h) * 0.68;
        for (const s of starsRef.current) {
          const prevZ = s.z;
          s.z -= speed;
          if (s.z <= 0.003) {
            s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2;
            s.z = 0.88 + Math.random() * 0.12; s.hue = Math.random();
            continue;
          }
          const sx = cx + (s.x / s.z) * focal;
          const sy = cy + (s.y / s.z) * focal;
          if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
          const proximity = 1 - s.z;
          const proxSq = proximity * proximity;
          const size = Math.max(0.25, proxSq * (4.5 + mids * 8 * sens));
          const alpha = Math.min(1, proximity * 1.8) * (0.35 + highs * 0.65);
          const color = liveColors[Math.floor(s.hue * liveColors.length)] || liveColors[0];
          ctx.globalAlpha = alpha;
          if (burst > 0.05 && prevZ > 0) {
            const prevSx = cx + (s.x / prevZ) * focal;
            const prevSy = cy + (s.y / prevZ) * focal;
            const trailLen = Math.hypot(sx - prevSx, sy - prevSy);
            if (trailLen > 1.2 && trailLen < 100) {
              ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.4, size * 0.45);
              ctx.lineCap = 'round'; ctx.globalAlpha = alpha * Math.min(1, burst * 1.5);
              ctx.beginPath(); ctx.moveTo(prevSx, prevSy); ctx.lineTo(sx, sy); ctx.stroke();
              ctx.globalAlpha = alpha;
            }
          }
          if (proximity > 0.6 && size > 1.5) { ctx.shadowColor = color; ctx.shadowBlur = size * 3; }
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
        if (isBeat && bassOnset > 0.07) {
          ctx.strokeStyle = liveColors[0]; ctx.lineWidth = 2 + bassOnset * 4;
          ctx.globalAlpha = Math.min(0.85, bassOnset * 3);
          ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.arc(cx, cy, Math.min(w,h) * (0.05 + bassOnset * 0.22), 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
      }

    // ── Audio Terrain (upgraded: fog, cinematic camera, better heights) ──
    } else if (eng === 'terrain') {
      ctx.fillStyle = 'rgba(3,3,12,1)';
      ctx.fillRect(0, 0, w, h);
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);

      // Beat onset for terrain elevation surge
      const terrainOnset = Math.max(0, bass - prevBassRef.current);
      // (prevBassRef is shared; already updated in depth engine if that ran — terrain uses same frame value)
      if (eng === 'terrain') prevBassRef.current = bass;
      const terrainBurst = terrainOnset > 0.05 ? terrainOnset : 0;
      smoothedBurstRef.current = eng === 'terrain'
        ? (terrainBurst > 0 ? Math.min(1, smoothedBurstRef.current + terrainBurst * 1.8) : smoothedBurstRef.current * 0.85)
        : smoothedBurstRef.current;
      const elevBurst = smoothedBurstRef.current;

      cameraTRef.current += (0.016 + bass * 0.022 * sens) * energyMult;
      const cols = perf ? 18 : 40, rows = perf ? 12 : 28;
      const horizon = h * (0.38 + sectionIntensity * 0.06); // horizon rises at drops

      // Sky gradient — skip for grid variant (flat canvas looks better)
      if (vrnt !== 'grid') {
        const sky = ctx.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)}, ${0.18 + highs * 0.4})`);
        sky.addColorStop(0.6, `rgba(${hexToRgb(liveColors[1], hxCache)}, ${0.04 + bass * 0.12})`);
        sky.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizon);
      }

      // Terrain mesh — amplitude scales with sectionIntensity + energyMult + beat burst
      const ampScale = (0.5 + sectionIntensity * 0.5) * energyMult * (1 + elevBurst * 0.6);

      if (vrnt === 'solid') {
        // ── Solid: filled terrain polygons with gradient sky ─────────────
        // Sky gradient above horizon
        const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
        skyGrad.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)}, ${0.35 + highs * 0.45})`);
        skyGrad.addColorStop(0.7, `rgba(${hexToRgb(liveColors[1], hxCache)}, ${0.08 + bass * 0.15})`);
        skyGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, w, horizon);

        // Draw filled terrain from back to front so near rows cover far ones
        for (let r = rows - 1; r >= 0; r--) {
          const t = r / rows;
          const yPersp = horizon + (h - horizon) * Math.pow(t, 1.55);
          const yPerspNext = horizon + (h - horizon) * Math.pow((r + 1) / rows, 1.55);
          const scale = Math.pow(t, 1.3);

          // Build top edge points
          const topPts: [number, number][] = [];
          for (let c = 0; c <= cols; c++) {
            const idx = Math.floor((c / cols) * (freq.length / 2));
            const fv  = (freq[idx] / 255) * sens;
            const bassH     = bass * 130 * scale * sens * (0.4 + fv * 0.6) * ampScale;
            const midRipple = Math.sin((c + cameraTRef.current * 5 + r * 0.7) * 0.6) * mids * 45 * scale * sens * ampScale;
            const shimmer   = Math.sin((c * 4 + cameraTRef.current * 18) * 1.2) * highs * 6 * scale;
            const height    = fv * 55 * scale * ampScale + bassH + midRipple + shimmer;
            topPts.push([(c / cols) * w, yPersp - height]);
          }

          // Filled polygon
          const depth   = 1 - t;
          const c0      = liveColors[r % liveColors.length];
          const c1      = liveColors[(r + 1) % liveColors.length];
          const fillGrad = ctx.createLinearGradient(0, yPersp - 200, 0, yPerspNext);
          fillGrad.addColorStop(0, `rgba(${hexToRgb(c0, hxCache)}, ${0.55 + depth * 0.3})`);
          fillGrad.addColorStop(1, `rgba(${hexToRgb(c1, hxCache)}, ${0.2 + depth * 0.2})`);
          ctx.fillStyle = fillGrad;
          ctx.beginPath();
          ctx.moveTo(0, yPerspNext);
          topPts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(w, yPerspNext);
          ctx.closePath();
          ctx.fill();

          // Bright edge line on top
          ctx.strokeStyle = `rgba(${hexToRgb(liveColors[r % liveColors.length], hxCache)}, ${0.5 + scale * 0.4})`;
          ctx.lineWidth = 1 + scale * 1.5;
          ctx.beginPath();
          topPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
          ctx.stroke();
        }
      } else if (vrnt === 'grid') {
        // ── Grid: top-down frequency grid — cells pulse per band ─────────
        const gCols = perf ? 14 : 22;
        const gRows = perf ? 14 : 22;
        const cellW = w / gCols;
        const cellH = h / gRows;
        cameraTRef.current += (0.012 + bass * 0.016 * sens) * energyMult;
        const gt = cameraTRef.current;

        // Draw dim baseline grid lines so structure is always visible
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        for (let col = 0; col <= gCols; col++) {
          ctx.beginPath(); ctx.moveTo(col * cellW, 0); ctx.lineTo(col * cellW, h); ctx.stroke();
        }
        for (let row = 0; row <= gRows; row++) {
          ctx.beginPath(); ctx.moveTo(0, row * cellH); ctx.lineTo(w, row * cellH); ctx.stroke();
        }

        for (let row = 0; row < gRows; row++) {
          for (let col = 0; col < gCols; col++) {
            const freqIdx = Math.min(Math.floor((col / gCols) * freq.length * 0.65), freq.length - 1);
            const v = Math.max(0.05, (freq[freqIdx] / 255) * sens); // floor at 0.05 so quiet cells still glow faintly
            const ripple = 0.5 + 0.5 * Math.sin(col * 0.9 + row * 0.9 - gt * 4);
            const intensity = Math.min(1, v * ripple * (0.6 + sectionIntensity * 0.4));
            const color = liveColors[(col + Math.floor(row * 0.5)) % liveColors.length];
            const pad   = cellW * (0.12 + (1 - intensity) * 0.22);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.08 + intensity * 0.65; // minimum 8% so cells are always faintly lit
            ctx.shadowColor = color; ctx.shadowBlur = intensity * 18;
            ctx.fillRect(col * cellW + pad, row * cellH + pad, cellW - pad * 2, cellH - pad * 2);
            // Bright border ring
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = intensity * 0.28;
            ctx.strokeRect(col * cellW + 1, row * cellH + 1, cellW - 2, cellH - 2);
          }
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        // Beat flash on entire grid
        if (elevBurst > 0.15) {
          ctx.fillStyle = `rgba(${hexToRgb(liveColors[0], hxCache)}, ${elevBurst * 0.08})`;
          ctx.fillRect(0, 0, w, h);
        }
      } else if (vrnt === 'ocean') {
        // ── Ocean: rolling fluid sine-wave surface from a side view ──────
        const waveRows   = perf ? 6 : 13;
        const waveSteps  = perf ? 60 : 140;
        cameraTRef.current += (0.018 + bass * 0.028 * sens) * energyMult;
        const ot = cameraTRef.current;

        // Draw back-to-front so nearer rows paint over distant ones
        for (let r = 0; r < waveRows; r++) {
          const t2      = r / waveRows;
          const depth   = 1 - t2;                          // 1 = far, 0 = near
          const yBase   = h * (0.28 + t2 * 0.55);         // rows spread across lower 3/4
          const freqLo  = Math.floor(t2 * freq.length * 0.45);
          const bandV   = avg(freq, freqLo, freqLo + 14);
          const color   = liveColors[r % liveColors.length];

          // Wave amplitude driven by bass + band value
          const amp = (28 + bandV * 110 * sens + bass * 60 * sens * sectionIntensity)
                      * (0.35 + t2 * 0.65) * energyMult;
          const waveFreq  = 2.2 + r * 0.55;
          const waveSpeed = ot * (0.9 + r * 0.25);

          // Build wave polygon (top edge + flat bottom)
          ctx.beginPath();
          const pts: [number, number][] = [];
          for (let s = 0; s <= waveSteps; s++) {
            const x = (s / waveSteps) * w;
            const phase1 = (s / waveSteps) * Math.PI * 2 * waveFreq + waveSpeed;
            const phase2 = (s / waveSteps) * Math.PI * 2 * (waveFreq * 0.5) + waveSpeed * 1.4;
            const y = yBase
              - Math.sin(phase1) * amp
              - Math.sin(phase2) * amp * 0.38
              - elevBurst * 55 * (0.3 + t2 * 0.7);        // beat surge lifts all rows
            pts.push([x, y]);
          }
          // Polygon: top wave + bottom fill
          ctx.moveTo(pts[0][0], pts[0][1]);
          pts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();

          // Gradient fill from wave-top to ocean floor
          const wGrad = ctx.createLinearGradient(0, yBase - amp, 0, h);
          wGrad.addColorStop(0,   `rgba(${hexToRgb(color, hxCache)}, ${(0.25 + bandV * 0.35) * (0.4 + sectionIntensity * 0.6)})`);
          wGrad.addColorStop(0.5, `rgba(${hexToRgb(color, hxCache)}, ${0.08 * depth})`);
          wGrad.addColorStop(1,   'rgba(0,0,0,0)');
          ctx.fillStyle   = wGrad;
          ctx.globalAlpha = 0.55 + depth * 0.45;
          ctx.fill();

          // Bright foam edge
          ctx.beginPath();
          pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
          ctx.strokeStyle = color;
          ctx.lineWidth   = 1.2 + bandV * 4.5 * (0.5 + sectionIntensity * 0.5);
          ctx.globalAlpha = 0.45 + bandV * 0.55;
          ctx.shadowColor = color; ctx.shadowBlur = 8 + bandV * 22;
          ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      } else {
        // ── Wireframe (default): mesh grid lines ─────────────────────────
        for (let r = 0; r < rows; r++) {
          const t = r / rows;
          const yPersp = horizon + (h - horizon) * Math.pow(t, 1.55);
          const scale  = Math.pow(t, 1.3);
          const fogFactor = Math.max(0, 1 - t * 2.2);
          const alpha = (0.1 + scale * 0.8) * (1 - fogFactor * 0.75);
          ctx.strokeStyle = `rgba(${hexToRgb(liveColors[r % liveColors.length], hxCache)}, ${alpha})`;
          ctx.lineWidth = 0.5 + scale * 1.8;
          ctx.beginPath();
          for (let c = 0; c <= cols; c++) {
            const idx = Math.floor((c / cols) * (freq.length / 2));
            const fv  = (freq[idx] / 255) * sens;
            const bassH     = bass * 130 * scale * sens * (0.4 + fv * 0.6) * ampScale;
            const midRipple = Math.sin((c + cameraTRef.current * 5 + r * 0.7) * 0.6) * mids * 45 * scale * sens * ampScale;
            const shimmer   = Math.sin((c * 4 + cameraTRef.current * 18) * 1.2) * highs * 6 * scale;
            const height    = fv * 55 * scale * ampScale + bassH + midRipple + shimmer;
            const x = (c / cols) * w, y = yPersp - height;
            if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Atmospheric fog
      const fog = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 55);
      fog.addColorStop(0, 'rgba(3,3,12,0)');
      fog.addColorStop(0.4, `rgba(${hexToRgb(liveColors[0], hxCache)}, ${0.06 + bass * 0.08})`);
      fog.addColorStop(1, 'rgba(3,3,12,0.35)');
      ctx.fillStyle = fog; ctx.fillRect(0, horizon - 30, w, 85);

    // ── Neon Tunnel (upgraded: glow, bass zoom, mids brightness) ─────────
    } else if (eng === 'tunnel') {
      // ── Liquid Aurora — flowing colour curtains ───────────────────────
      ctx.fillStyle = `rgba(2,2,10,${0.18 + (1-sectionIntensity)*0.08})`;
      ctx.fillRect(0, 0, w, h);
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      const tunnelOnset = Math.max(0, bass - prevBassRef.current);
      if (eng === 'tunnel') prevBassRef.current = bass;
      if (tunnelOnset > 0.05) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + tunnelOnset * 2.5);
      smoothedBurstRef.current *= 0.84;
      const burst = smoothedBurstRef.current;
      tunnelTRef.current += (0.004 + mids * 0.008 * sens) * energyMult;
      const t = tunnelTRef.current;
      const cx2 = w / 2;

      // Tunnel variant: circle/square still use tunnel engine but aurora ignores vrnt
      const numRibbons = perf ? 5 : 11;

      if (vrnt === 'vertical') {
        // ── Vertical: columns rising from the bottom ─────────────────────
        const steps = perf ? 36 : 60;
        const pts2  = steps + 1;
        if (ribbonPathCache.current.length !== numRibbons ||
            (ribbonPathCache.current[0]?.length ?? 0) !== pts2 * 2) {
          ribbonPathCache.current = Array.from({ length: numRibbons }, () => new Float32Array(pts2 * 2));
          ribbonGradCache.current.clear();
        }
        for (let ri = 0; ri < numRibbons; ri++) {
          const bandLo  = Math.floor((ri / numRibbons) * freq.length * 0.5);
          const bandHi  = Math.floor(((ri + 1) / numRibbons) * freq.length * 0.5);
          const bandVal = avg(freq, bandLo, bandHi) * sens * energyMult;
          const color   = liveColors[ri % liveColors.length];
          const colX    = w * (0.05 + ri / numRibbons * 0.9);
          const amp     = Math.min(w / 9, (20 + bandVal * w * 0.06) * (0.4 + sectionIntensity * 0.6));
          const freq2   = 2.5 + ri * 0.7;
          const phase   = t * (0.8 + ri * 0.15);
          const piF2    = Math.PI * freq2;
          const piF2h   = Math.PI * freq2 * 0.5;
          const buf     = ribbonPathCache.current[ri];

          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            const sinA = Math.sin(frac * piF2  + phase);
            const sinB = Math.sin(frac * piF2h + phase * 1.3);
            buf[s * 2]     = colX + sinA * amp + sinB * amp * 0.4;
            buf[s * 2 + 1] = frac * h;
          }

          const gradKey = `v|${color}|${h}`;
          let grad = ribbonGradCache.current.get(gradKey);
          if (!grad) {
            grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0,    `rgba(${hexToRgb(color, hxCache)}, 0)`);
            grad.addColorStop(0.15, color);
            grad.addColorStop(0.85, color);
            grad.addColorStop(1,    `rgba(${hexToRgb(color, hxCache)}, 0)`);
            ribbonGradCache.current.set(gradKey, grad);
          }

          const alpha = (0.12 + bandVal * 0.55) * (0.5 + sectionIntensity * 0.5);
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = grad;
          ctx.lineWidth   = 2 + bandVal * 14 * (0.5 + sectionIntensity * 0.5);
          ctx.lineCap     = 'round';
          ctx.shadowColor = color;
          ctx.shadowBlur  = perf ? 0 : Math.min(14, bandVal * 14);
          ctx.beginPath();
          ctx.moveTo(buf[0], buf[1]);
          for (let s = 1; s <= steps; s++) ctx.lineTo(buf[s*2], buf[s*2+1]);
          ctx.stroke();

          if (bandVal > 0.40 && !perf) {
            ctx.shadowBlur  = 0;
            ctx.globalAlpha = alpha * 0.18;
            ctx.fillStyle   = color;
            ctx.beginPath();
            ctx.moveTo(colX, 0);
            for (let s = 0; s <= steps; s++) ctx.lineTo(buf[s*2], buf[s*2+1]);
            ctx.lineTo(colX + amp, h); ctx.lineTo(colX + amp, 0);
            ctx.closePath(); ctx.fill();
          }
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      } else if (vrnt === 'spiral') {
        // ── Spiral: vanishing-point rings collapsing inward ──────────────
        const ringCount = perf ? 10 : 24;
        tunnelTRef.current += (0.012 + bass * 0.022 * sens) * energyMult;
        const speed = tunnelTRef.current;
        for (let i = 0; i < ringCount; i++) {
          // Phase offset makes each ring appear at a different point in the tunnel
          const phase    = (i / ringCount + (speed * 0.18 % 1));
          const normP    = phase % 1; // 0 = far (small), 1 = near (large, fading out)
          const radius   = Math.min(w, h) * 0.04 + normP * Math.min(w, h) * 0.48;
          const bandIdx  = Math.min(Math.floor(normP * freq.length * 0.6), freq.length - 1);
          const bandV    = (freq[bandIdx] / 255) * sens;
          const color    = liveColors[i % liveColors.length];
          const alpha    = (1 - normP) * (0.55 + bandV * 0.45) * (0.5 + sectionIntensity * 0.5);
          // Rotation increases toward camera (larger = faster apparent rotation)
          const rot      = speed * 0.55 * (0.3 + normP * 1.4) + i * (Math.PI * 2 / ringCount);
          // Slight ellipse for perspective feel
          const ry       = radius * (0.62 + normP * 0.38);

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth   = (0.8 + normP * 5.5 + bandV * 4) * (0.5 + sectionIntensity * 0.5);
          ctx.globalAlpha = alpha;
          ctx.shadowColor = color;
          ctx.shadowBlur  = (6 + bandV * 24) * (0.5 + sectionIntensity * 0.5);
          ctx.translate(cx2, h / 2);
          ctx.rotate(rot);
          ctx.beginPath(); ctx.ellipse(0, 0, radius, ry, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        // Vanishing point glow
        const vpGrad = ctx.createRadialGradient(cx2, h/2, 0, cx2, h/2, Math.min(w,h)*0.12*(1+burst*0.6));
        vpGrad.addColorStop(0, liveColors[0]); vpGrad.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = vpGrad; ctx.globalAlpha = 0.5 + burst * 0.5;
        ctx.beginPath(); ctx.arc(cx2, h/2, Math.min(w,h)*0.12*(1+burst*0.6), 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else if (vrnt === 'wave') {
        // ── Wave: concentric sine rings ripple outward from centre ────────
        const waveN   = perf ? 10 : 24;
        tunnelTRef.current += (0.014 + mids * 0.018 * sens) * energyMult;
        const wt = tunnelTRef.current;
        const cxw = w / 2, cyw = h / 2;

        for (let i = 0; i < waveN; i++) {
          // Each ring: radius grows with time, creating a ripple-outward feel
          const phase   = (i / waveN + wt * 0.14) % 1;
          const radius  = phase * Math.min(w, h) * 0.62;
          const bandIdx = Math.min(Math.floor(phase * freq.length * 0.55), freq.length - 1);
          const bandV   = (freq[bandIdx] / 255) * sens;
          const color   = liveColors[i % liveColors.length];
          const alpha   = (1 - phase) * (0.4 + bandV * 0.6) * (0.4 + sectionIntensity * 0.6);

          // Distorted ellipse — sine-warp around perimeter gives "wave" feel
          const steps = perf ? 48 : 96;
          ctx.beginPath();
          for (let s = 0; s <= steps; s++) {
            const angle  = (s / steps) * Math.PI * 2;
            const warp   = 1 + Math.sin(angle * 3 + wt * 2.8) * bandV * 0.22
                             + Math.sin(angle * 5 - wt * 1.6) * bandV * 0.12;
            const rx = cxw + Math.cos(angle) * radius * warp;
            const ry = cyw + Math.sin(angle) * radius * warp * (0.62 + phase * 0.38);
            s === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
          }
          ctx.closePath();
          ctx.strokeStyle = color;
          ctx.lineWidth   = (0.8 + bandV * 4.5 + (1 - phase) * 2) * (0.5 + sectionIntensity * 0.5);
          ctx.globalAlpha = alpha;
          ctx.shadowColor = color; ctx.shadowBlur = 6 + bandV * 22;
          ctx.stroke();
          // Semi-transparent fill bloom on inner rings
          if (phase < 0.35) {
            ctx.fillStyle   = color;
            ctx.globalAlpha = alpha * 0.09;
            ctx.shadowBlur  = 0;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        // Centre glow
        const wvGrad = ctx.createRadialGradient(cxw, cyw, 0, cxw, cyw, Math.min(w,h) * 0.10 * (1 + burst * 0.5));
        wvGrad.addColorStop(0, liveColors[0]); wvGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wvGrad; ctx.globalAlpha = 0.6 + burst * 0.4;
        ctx.beginPath(); ctx.arc(cxw, cyw, Math.min(w,h) * 0.10 * (1 + burst * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

      } else {
        // ── Aurora (default): horizontal ribbons ─────────────────────────
        // OPTIMISED: paths stored in Float32Array (pre-computed once per frame);
        // gradients cached per color; fill reuses computed points; shadowBlur capped.
        const steps = perf ? 36 : 72;  // 72 gives smoother curves at full resolution
        const pts2  = steps + 1;

        // Resize path cache if ribbon count or step count changed
        if (ribbonPathCache.current.length !== numRibbons ||
            (ribbonPathCache.current[0]?.length ?? 0) !== pts2 * 2) {
          ribbonPathCache.current = Array.from({ length: numRibbons },
            () => new Float32Array(pts2 * 2));
          ribbonGradCache.current.clear();
        }

        for (let ri = 0; ri < numRibbons; ri++) {
          const bandLo  = Math.floor((ri / numRibbons) * freq.length * 0.5);
          const bandHi  = Math.floor(((ri + 1) / numRibbons) * freq.length * 0.5);
          const bandVal = avg(freq, bandLo, bandHi) * sens * energyMult;
          const color   = liveColors[ri % liveColors.length];
          const ribbonY = h * (0.1 + ri / numRibbons * 0.8);
          const amp     = Math.min(h / 9, (20 + bandVal * h * 0.06) * (0.4 + sectionIntensity * 0.6));
          const freq2   = 2.5 + ri * 0.7;
          const phase   = t * (0.8 + ri * 0.15);
          const buf     = ribbonPathCache.current[ri];
          // Pre-computed trig multipliers (avoid repeated multiply inside loop)
          const piF2    = Math.PI * freq2;
          const piF2h   = Math.PI * freq2 * 0.5;

          // ── Pre-compute all path points into Float32Array ──────────────
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            buf[s * 2]     = frac * w;
            buf[s * 2 + 1] = ribbonY
              + Math.sin(frac * piF2  + phase) * amp
              + Math.sin(frac * piF2h + phase * 1.3) * amp * 0.4;
          }

          // ── Gradient: cached per color+width key (rarely changes) ──────
          const gradKey = `${color}|${w}`;
          let grad = ribbonGradCache.current.get(gradKey);
          if (!grad) {
            grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0,    `rgba(${hexToRgb(color, hxCache)}, 0)`);
            grad.addColorStop(0.15, color);
            grad.addColorStop(0.85, color);
            grad.addColorStop(1,    `rgba(${hexToRgb(color, hxCache)}, 0)`);
            ribbonGradCache.current.set(gradKey, grad);
          }

          // ── Stroke ─────────────────────────────────────────────────────
          const alpha = (0.12 + bandVal * 0.55) * (0.5 + sectionIntensity * 0.5);
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = grad;
          ctx.lineWidth   = 2 + bandVal * 12 * (0.5 + sectionIntensity * 0.5);
          ctx.lineCap     = 'round';
          ctx.shadowColor = color;
          // Cap at 14: still visibly glowy, but GPU blur kernel is 4× smaller than 58
          ctx.shadowBlur  = perf ? 0 : Math.min(14, bandVal * 14);
          ctx.beginPath();
          ctx.moveTo(buf[0], buf[1]);
          for (let s = 1; s <= steps; s++) ctx.lineTo(buf[s*2], buf[s*2+1]);
          ctx.stroke();

          // ── Fill bloom: reuses buf — zero extra sin() calls ────────────
          if (bandVal > 0.40 && !perf) {
            ctx.shadowBlur  = 0;
            ctx.globalAlpha = alpha * 0.18;
            ctx.fillStyle   = color;
            ctx.beginPath();
            ctx.moveTo(0, ribbonY);
            for (let s = 0; s <= steps; s++) ctx.lineTo(buf[s*2], buf[s*2+1]);
            ctx.lineTo(w, ribbonY + amp); ctx.lineTo(0, ribbonY + amp);
            ctx.closePath(); ctx.fill();
          }
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    } else if (eng === 'neon_spheres') {
      ctx.fillStyle = `rgba(2,2,10,${0.22 + (1 - sectionIntensity) * 0.08})`;
      ctx.fillRect(0, 0, w, h);
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);

      // Beat onset for sphere pulse
      const sphereOnset = Math.max(0, bass - prevBassRef.current);
      if (eng === 'neon_spheres') prevBassRef.current = bass;
      const sphereBeat = sphereOnset > 0.05 ? sphereOnset : 0;

      // Speed scales with section intensity — slow in breakdowns, lively in drops
      const baseMotion = (0.008 + sectionIntensity * 0.016) * energyMult;
      solarTRef.current += baseMotion;

      const N = 6;
      if (spheresRef.current.length < N) {
        spheresRef.current = Array.from({ length: N }, (_, i) => ({
          x: 0.15 + (i / (N - 1)) * 0.7,
          y: 0.25 + Math.random() * 0.5,
          vx: (Math.random() - 0.5) * 0.0015,
          vy: (Math.random() - 0.5) * 0.0015,
          phase: (i / N) * Math.PI * 2,
          size: 0.022 + Math.random() * 0.022,   // was 0.045–0.09, halved
          hue: i / N,
        }));
      }

      const bandStep = Math.floor(freq.length / N);

      // Orbit variant: each sphere orbits the centre at its own radius
      const orbitMode = vrnt === 'orbit';
      const burstMode = vrnt === 'burst';
      const orbitCx = 0.5, orbitCy = 0.5;

      // Burst mode: track how far each sphere has flown from centre
      if (burstMode && sphereBeat > 0.06 && spheresRef.current.length > 0) {
        // On every beat, reset all spheres to centre with random outward velocity
        for (let i = 0; i < N; i++) {
          const sp = spheresRef.current[i];
          const angle = (i / N) * Math.PI * 2 + Math.random() * 0.6;
          const spd   = (0.008 + sphereBeat * 0.014) * (0.7 + Math.random() * 0.6);
          sp.x = 0.5 + (Math.random() - 0.5) * 0.04;
          sp.y = 0.5 + (Math.random() - 0.5) * 0.04;
          sp.vx = Math.cos(angle) * spd;
          sp.vy = Math.sin(angle) * spd;
        }
      }

      for (let i = 0; i < N; i++) {
        const sp  = spheresRef.current[i];
        const be  = avg(freq, i * bandStep, (i + 1) * bandStep);

        if (orbitMode) {
          // Fixed orbital radius per sphere, speed modulated by energy
          const orbitR = 0.12 + i * 0.06 * (0.8 + be * 0.4);
          const orbitSpeed = baseMotion * (0.6 + i * 0.2) * (0.5 + sectionIntensity * 0.5);
          sp.phase += orbitSpeed;
          sp.x = orbitCx + Math.cos(sp.phase) * orbitR;
          sp.y = orbitCy + Math.sin(sp.phase) * orbitR * 0.7;
        } else if (burstMode) {
          // Burst: fly outward then slowly drift back to centre
          sp.vx *= 0.965;
          sp.vy *= 0.965;
          sp.x  += sp.vx;
          sp.y  += sp.vy;
          // Gentle pull back to centre when slow
          const dx = 0.5 - sp.x, dy = 0.5 - sp.y;
          sp.x += dx * 0.008;
          sp.y += dy * 0.008;
          sp.x = Math.max(0.04, Math.min(0.96, sp.x));
          sp.y = Math.max(0.04, Math.min(0.96, sp.y));
        } else if (vrnt === 'ring') {
          // Ring: all spheres equally spaced in a rotating ring formation
          const ringR     = 0.22 + be * 0.06 * (0.6 + sectionIntensity * 0.4);
          const ringAngle = (i / N) * Math.PI * 2 + solarTRef.current * 0.55;
          sp.x = 0.5 + Math.cos(ringAngle) * ringR;
          sp.y = 0.5 + Math.sin(ringAngle) * ringR * 0.62; // slight ellipse for depth
          sp.phase += baseMotion * 0.5;
        } else {
          // Float (default): freeform drift
          const driftSpeed = baseMotion * 0.03;
          sp.x += sp.vx + Math.sin(solarTRef.current * 0.6 + sp.phase) * driftSpeed;
          sp.y += sp.vy + Math.cos(solarTRef.current * 0.45 + sp.phase * 1.3) * driftSpeed;
          sp.x  = Math.max(0.07, Math.min(0.93, sp.x));
          sp.y  = Math.max(0.07, Math.min(0.93, sp.y));
          if (sp.x <= 0.07 || sp.x >= 0.93) sp.vx *= -1;
          if (sp.y <= 0.07 || sp.y >= 0.93) sp.vy *= -1;
        }

        const sx = sp.x * w, sy = sp.y * h;
        const minDim = Math.min(w, h);
        // Size: band energy + beat pulse + section intensity — kept proportional, not screen-filling
        const beatBoost = i === 0 ? (1 + sphereBeat * 1.5) : 1;
        const r = sp.size * minDim * (1 + be * sens * 0.9) * (1 + bass * 0.15) * (0.7 + sectionIntensity * 0.3) * beatBoost;
        const color = liveColors[i % liveColors.length];

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur  = perf ? 0 : Math.min(24, (8 + be * 20 * sens) * (0.6 + sectionIntensity * 0.4));
        // Outer glow layer (no radial gradient — uses shadowBlur which is already set)
        ctx.globalAlpha = (0.45 + be * 0.35) * (0.6 + sectionIntensity * 0.4);
        ctx.fillStyle   = color;
        ctx.beginPath(); ctx.arc(sx, sy, r * 1.6, 0, Math.PI * 2); ctx.fill();
        // Bright core highlight
        ctx.globalAlpha = (0.75 + be * 0.25) * (0.7 + sectionIntensity * 0.3);
        ctx.fillStyle   = '#ffffff';
        ctx.beginPath(); ctx.arc(sx - r * 0.28, sy - r * 0.28, r * 0.22, 0, Math.PI * 2); ctx.fill();

        // Specular highlight
        if (highs > 0.3 && Math.random() < highs * 0.35) {
          ctx.fillStyle = '#ffffff'; ctx.globalAlpha = highs * 0.65;
          ctx.beginPath(); ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.12, 0, Math.PI * 2); ctx.fill();
        }

        // In orbit mode: draw orbit path; in float/burst modes: connection lines between close spheres
        if (orbitMode) {
          // Draw faint orbit ring
          const orbitR = (0.12 + i * 0.06) * Math.min(w, h);
          ctx.strokeStyle = color; ctx.lineWidth = 0.5;
          ctx.globalAlpha = 0.12 + be * 0.15;
          ctx.beginPath(); ctx.ellipse(w * orbitCx, h * orbitCy, orbitR, orbitR * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (sectionIntensity > 0.5) {
          for (let j = i + 1; j < N; j++) {
            const sp2 = spheresRef.current[j];
            const dist = Math.hypot(sp.x - sp2.x, sp.y - sp2.y);
            if (dist < 0.22) {
              const lineAlpha = (0.22 - dist) / 0.22 * 0.4 * sectionIntensity;
              ctx.strokeStyle = color; ctx.lineWidth = 0.8;
              ctx.globalAlpha = lineAlpha;
              ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sp2.x * w, sp2.y * h); ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    // ── Fractal Kaleidoscope (new) ────────────────────────────────────────
    } else if (eng === 'fractal') {
      ctx.fillStyle = 'rgba(2,2,10,0.22)';
      ctx.fillRect(0, 0, w, h);
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      const energy = bass * 0.5 + mids * 0.35 + highs * 0.15;
      solarTRef.current += (0.008 + energy * 0.04 * sens) * energyMult;
      const cx = w / 2, cy = h / 2;

      if (vrnt === 'mandala') {
        // ── Mandala: organic petal bloom, beat-reactive ──────────────────
        const petalN = perf ? 8 : 18;
        const rot    = solarTRef.current * 0.09;
        ctx.save();
        ctx.translate(cx, cy);
        for (let p = 0; p < petalN; p++) {
          ctx.save();
          ctx.rotate(rot + (p / petalN) * Math.PI * 2);
          if (p % 2 === 1) ctx.scale(-1, 1); // mirror every other petal
          const color    = liveColors[p % liveColors.length];
          const petalL   = Math.min(w, h) * (0.19 + bass * 0.10 * sens) * (0.65 + sectionIntensity * 0.35);
          const petalW   = Math.min(w, h) * (0.055 + mids * 0.035 * sens);
          // Filled petal shape (bezier teardrop)
          ctx.fillStyle  = color;
          ctx.globalAlpha = 0.12 + mids * 0.12;
          ctx.shadowColor = color;
          ctx.shadowBlur  = (8 + highs * 18) * (0.45 + sectionIntensity * 0.55);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo( petalW, petalL * 0.32,  petalW, petalL * 0.68, 0, petalL);
          ctx.bezierCurveTo(-petalW, petalL * 0.68, -petalW, petalL * 0.32, 0, 0);
          ctx.fill();
          // Petal outline with glow
          ctx.strokeStyle = color;
          ctx.lineWidth   = 1.2 + bass * 2.5 * sens;
          ctx.globalAlpha = 0.55 + mids * 0.45;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo( petalW, petalL * 0.32,  petalW, petalL * 0.68, 0, petalL);
          ctx.bezierCurveTo(-petalW, petalL * 0.68, -petalW, petalL * 0.32, 0, 0);
          ctx.stroke();
          // Frequency dots along petal spine
          const dotBars = 18;
          const dotStep = Math.floor(freq.length / dotBars);
          for (let b = 0; b < dotBars; b++) {
            const v2    = (freq[b * dotStep] / 255) * sens;
            const t2    = (b + 1) / (dotBars + 1);
            const spineY = petalL * t2;
            const spineX = Math.sin(t2 * Math.PI) * petalW * (0.7 + v2 * 1.4);
            ctx.globalAlpha = v2 * 0.9;
            ctx.fillStyle   = color;
            ctx.shadowBlur  = v2 * 8;
            ctx.beginPath(); ctx.arc(spineX, spineY, 1 + v2 * 3.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
        // Centre jewel
        const jewGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(w,h) * 0.04 * (1 + bass * 0.5));
        jewGrad.addColorStop(0, liveColors[0]); jewGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = jewGrad; ctx.globalAlpha = 0.85;
        ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 20 + bass * 20 * sens;
        ctx.beginPath(); ctx.arc(0, 0, Math.min(w,h) * 0.04 * (1 + bass * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else if (vrnt === 'crystal') {
        // ── Crystal: angular shards refract and rotate with the beat ─────
        const shardN = perf ? 8 : 18;
        const cRot   = solarTRef.current * 0.14;
        ctx.save();
        ctx.translate(cx, cy);

        for (let s = 0; s < shardN; s++) {
          const baseAngle = (s / shardN) * Math.PI * 2 + cRot;
          const freqIdx   = Math.min(Math.floor((s / shardN) * freq.length * 0.6), freq.length - 1);
          const v         = (freq[freqIdx] / 255) * sens;
          const color     = liveColors[s % liveColors.length];
          const len       = Math.min(w, h) * (0.10 + v * 0.30 * (0.5 + sectionIntensity * 0.5));
          const width     = Math.min(w, h) * (0.028 + v * 0.038);
          // Mirror each shard
          for (const flip of [1, -1]) {
            const ang = baseAngle * flip;
            // Shard tip and base points
            const tx = Math.cos(ang) * len;
            const ty = Math.sin(ang) * len;
            const bx1 = Math.cos(ang + Math.PI / 2) * width;
            const by1 = Math.sin(ang + Math.PI / 2) * width;
            const bx2 = Math.cos(ang - Math.PI / 2) * width;
            const by2 = Math.sin(ang - Math.PI / 2) * width;
            // Facet: triangle shard
            // Flat fill (was 36 createLinearGradient calls/frame — fill opacity is subtle anyway)
            ctx.fillStyle   = `rgba(${hexToRgb(color, hxCache)}, ${0.18 + v * 0.28})`;
            ctx.globalAlpha = 0.55 + v * 0.45;
            ctx.shadowColor = color; ctx.shadowBlur = 6 + v * 18;
            ctx.beginPath();
            ctx.moveTo(bx1, by1); ctx.lineTo(tx, ty); ctx.lineTo(bx2, by2); ctx.closePath();
            ctx.fill();
            // Bright edge
            ctx.strokeStyle = color;
            ctx.lineWidth   = 0.8 + v * 3;
            ctx.globalAlpha = 0.4 + v * 0.6;
            ctx.shadowBlur  = 3 + v * 12;
            ctx.stroke();
          }
        }
        // Centre refraction gem
        const gemR = Math.min(w, h) * 0.042 * (1 + bass * sens * 0.5);
        const gemN = 6;
        ctx.strokeStyle = liveColors[0];
        ctx.lineWidth   = 1.5 + bass * 3 * sens;
        ctx.globalAlpha = 0.8 + bass * 0.2;
        ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 14 + bass * 20 * sens;
        ctx.beginPath();
        for (let g = 0; g <= gemN; g++) {
          const a = (g / gemN) * Math.PI * 2 + cRot * 2;
          g === 0 ? ctx.moveTo(Math.cos(a) * gemR, Math.sin(a) * gemR)
                  : ctx.lineTo(Math.cos(a) * gemR, Math.sin(a) * gemR);
        }
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      } else {
        // ── Kaleidoscope (default): mirrored radial burst lines ──────────
        const zoom = Math.min(1.22, 1 + bass * sens * 0.35 * sectionIntensity);
        // Segment count scales with section — 6 at breakdown, up to 12 at drop
        const segs = perf ? 6 : Math.round(6 + sectionIntensity * 6);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(zoom, zoom);
        for (let seg = 0; seg < segs; seg++) {
          ctx.save();
          ctx.rotate((seg / segs) * Math.PI * 2 + solarTRef.current * 0.18);
          if (seg % 2 === 1) ctx.scale(-1, 1);
          const bars = perf ? 24 : 48;
          const step = Math.floor(freq.length / bars);
          const c = liveColors[seg % liveColors.length];
          ctx.strokeStyle = c;
          ctx.shadowColor = c;
          ctx.shadowBlur  = (4 + highs * 14) * (0.5 + sectionIntensity * 0.5);
          ctx.lineWidth   = 1 + bass * 3 * sens;
          ctx.globalAlpha = 0.5 + mids * 0.5;
          ctx.beginPath();
          let first = true;
          for (let b = 0; b < bars; b++) {
            const v = (freq[b * step] / 255) * sens;
            const angle = (b / bars) * Math.PI * 0.45 - 0.225;
            const r2    = Math.min(w, h) * 0.04 + v * Math.min(w, h) * 0.3 * (1 + mids * 0.6) * (0.6 + sectionIntensity * 0.4);
            const r1    = Math.min(w, h) * 0.04;
            if (first) { ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1); first = false; }
            ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
          }
          ctx.stroke();
          ctx.globalAlpha = 0.2 + bass * 0.4;
          ctx.beginPath();
          ctx.arc(0, 0, Math.min(w, h) * 0.04 * (1 + bass * 0.5), -0.225, 0.225);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }

    // ── Solar System (new) ────────────────────────────────────────────────
    } else if (eng === 'solar') {
      // ── Geometric Pulse — layered concentric beat system ─────────────
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      solarTRef.current += (0.006 + bass * 0.018 * sens) * energyMult;
      const t = solarTRef.current;
      const cx = w / 2, cy = h / 2;
      const minDim = Math.min(w, h);

      // Beat onset
      const geoOnset = Math.max(0, bass - prevBassRef.current);
      if (eng === 'solar') prevBassRef.current = bass;
      if (geoOnset > 0.05) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + geoOnset * 2.5);
      smoothedBurstRef.current *= 0.84;
      const burst = smoothedBurstRef.current;

      // Variant shape config
      const sides = vrnt === 'square' ? 4 : vrnt === 'hex' ? 6 : 0;

      // Shape helper — polygon or circle, centred on cx/cy
      const drawShape = (r: number, rot = 0, n = sides) => {
        if (n === 0) { ctx.arc(cx, cy, r, 0, Math.PI * 2); return; }
        for (let s = 0; s <= n; s++) {
          const a = (s / n) * Math.PI * 2 + rot;
          s === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
                  : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      };

      // ── 1. Background ─────────────────────────────────────────────
      if (vrnt === 'nova') {
        // ── Nova: starburst spikes + rings detonate on every drop ────────
        ctx.fillStyle = `rgba(2,2,10,${0.26 + (1 - sectionIntensity) * 0.10})`;
        ctx.fillRect(0, 0, w, h);

        // Spawn nova burst on strong beat
        if (geoOnset > 0.048 && planetsRef.current.length < 24) {
          const spikeN = perf ? 8 : 14;
          planetsRef.current.push({ type: 'nova', r: minDim * 0.04,
            maxR: minDim * (0.38 + geoOnset * 0.42) * (0.6 + sectionIntensity * 0.4),
            alpha: Math.min(1, 0.6 + geoOnset * 1.8), colorIdx: Math.floor(Math.random() * liveColors.length),
            spikeN, rot: t * 0.1, thickness: 2 + geoOnset * 7 } as any);
          // Particle burst
          const pN = perf ? 8 : 18;
          for (let p = 0; p < pN && (sparksRef.current as any[]).length < 140; p++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = (3 + Math.random() * 5 + geoOnset * 5) * (0.5 + sectionIntensity * 0.5);
            (sparksRef.current as any[]).push({ x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              life: 0.9 + Math.random() * 0.1, colorIdx: Math.floor(Math.random() * liveColors.length),
              size: 2 + Math.random() * 3 + geoOnset * 4 });
          }
        }

        // Draw nova bursts
        planetsRef.current = (planetsRef.current as any[]).filter((n: any) => {
          n.r     += (4 + mids * 8 * sens) * energyMult;
          n.alpha *= 0.905;
          if (n.alpha < 0.012 || n.r > n.maxR * 1.2) return false;
          const color = liveColors[n.colorIdx % liveColors.length];
          const sN    = n.spikeN ?? 12;
          ctx.save();
          ctx.translate(cx, cy);
          // Ring
          ctx.strokeStyle = color; ctx.lineWidth = n.thickness * n.alpha * 2.2;
          ctx.globalAlpha = n.alpha; ctx.shadowColor = color; ctx.shadowBlur = 14 + burst * 22;
          ctx.beginPath(); ctx.arc(0, 0, n.r, 0, Math.PI * 2); ctx.stroke();
          // Spikes at ring perimeter
          for (let k = 0; k < sN; k++) {
            const ang = (k / sN) * Math.PI * 2 + n.rot;
            const inner = n.r * 0.88, outer = n.r + minDim * 0.05 * n.alpha;
            ctx.strokeStyle = color; ctx.lineWidth = 1.2 + n.alpha * 2.5;
            ctx.globalAlpha = n.alpha * 0.85; ctx.shadowBlur = 8 + n.alpha * 14;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
            ctx.lineTo(Math.cos(ang) * outer, Math.sin(ang) * outer);
            ctx.stroke();
          }
          ctx.restore();
          return true;
        });

        // Particles
        sparksRef.current = (sparksRef.current as any[]).filter((p: any) => {
          p.x += p.vx; p.y += p.vy; p.vx *= 0.960; p.vy *= 0.960; p.life *= 0.932;
          if (p.life < 0.018) return false;
          const color = liveColors[p.colorIdx % liveColors.length];
          ctx.fillStyle = color; ctx.globalAlpha = p.life * (0.55 + sectionIntensity * 0.45);
          ctx.shadowColor = color; ctx.shadowBlur = p.size * 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
          return true;
        });
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;

        // 4 ambient frequency rings (always visible, no beat needed)
        for (let i = 0; i < 4; i++) {
          const bandV = avg(freq, i * 18, i * 18 + 18);
          const r     = minDim * (0.10 + i * 0.078) * (1 + bandV * sens * 0.35);
          const color = liveColors[i % liveColors.length];
          ctx.strokeStyle = color; ctx.lineWidth = 1.2 + bandV * 3.5;
          ctx.globalAlpha = 0.20 + bandV * 0.55;
          ctx.shadowColor = color; ctx.shadowBlur = 5 + bandV * 18;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;

        // Core
        const nCoreR = minDim * 0.05 * (1 + burst * 0.6);
        const nCoreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, nCoreR);
        nCoreG.addColorStop(0, '#ffffff'); nCoreG.addColorStop(0.3, liveColors[0]); nCoreG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = nCoreG; ctx.globalAlpha = 0.9 + burst * 0.1;
        ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 18 + burst * 28;
        ctx.beginPath(); ctx.arc(cx, cy, nCoreR, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      } else {
      // ── 1. Background ─────────────────────────────────────────────
      ctx.fillStyle = `rgba(2,2,10,${0.32 + (1 - sectionIntensity) * 0.10})`;
      ctx.fillRect(0, 0, w, h);

      // Ambient pulse — wide, very transparent radial bloom
      const ambR   = minDim * (0.58 + burst * 0.14 + currentEnergy * 0.11);
      const ambGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, ambR);
      ambGrd.addColorStop(0,   `rgba(${hexToRgb(liveColors[1], hxCache)}, ${0.08 + burst * 0.09})`);
      ambGrd.addColorStop(0.6, `rgba(${hexToRgb(liveColors[2], hxCache)}, ${0.03 + sectionIntensity * 0.03})`);
      ambGrd.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = ambGrd;
      ctx.beginPath(); ctx.arc(cx, cy, ambR, 0, Math.PI * 2); ctx.fill();

      // ── 2. Frequency spectrum ring ────────────────────────────────
      // 64 outward spikes at inner radius — like a polar spectrum chart
      if (!perf) {
        const specR  = minDim * 0.145;
        const specN  = 64;
        const specStep = Math.max(1, Math.floor(freq.length * 0.5 / specN));
        ctx.save();
        for (let i = 0; i < specN; i++) {
          const v     = (freq[i * specStep] / 255) * sens;
          if (v < 0.04) continue;
          const angle = (i / specN) * Math.PI * 2 - Math.PI / 2;
          const spike = v * minDim * 0.10 * (0.5 + sectionIntensity * 0.5);
          const color = liveColors[i % liveColors.length];
          ctx.strokeStyle = color;
          ctx.lineWidth   = 2 + v * 3;
          ctx.globalAlpha = 0.30 + v * 0.70;
          ctx.shadowColor = color; ctx.shadowBlur = 3 + v * 10;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * specR, cy + Math.sin(angle) * specR);
          ctx.lineTo(cx + Math.cos(angle) * (specR + spike), cy + Math.sin(angle) * (specR + spike));
          ctx.stroke();
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        ctx.restore();
      }

      // ── 3. Spawn beat rings + particle burst ─────────────────────
      if (!planetsRef.current) planetsRef.current = [];
      if (!sparksRef.current)  sparksRef.current  = [];

      if (geoOnset > 0.055) {
        if (planetsRef.current.length < 28) {
          planetsRef.current.push({
            r:        minDim * 0.045,
            maxR:     minDim * (0.32 + geoOnset * 0.40) * (0.65 + sectionIntensity * 0.35),
            alpha:    Math.min(0.98, geoOnset * 2.6),
            colorIdx: Math.floor(Math.random() * liveColors.length),
            sides,
            thickness: 2.5 + geoOnset * 8,
            type:     'ring',
          } as any);
        }
        // Particle burst: outward flying sparks
        const pCount = perf ? 5 : Math.floor(10 + geoOnset * 22);
        for (let p = 0; p < pCount && (sparksRef.current as any[]).length < 140; p++) {
          const angle = Math.random() * Math.PI * 2;
          const spd   = (2 + Math.random() * 4 + geoOnset * 5) * (0.5 + sectionIntensity * 0.5);
          (sparksRef.current as any[]).push({
            x: cx + (Math.random() - 0.5) * 8,
            y: cy + (Math.random() - 0.5) * 8,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            life: 0.88 + Math.random() * 0.12,
            colorIdx: Math.floor(Math.random() * liveColors.length),
            size: 1.8 + Math.random() * 2.8 + geoOnset * 3.5,
          });
        }
      }

      // ── 4. Expand and draw beat rings ─────────────────────────────
      planetsRef.current = (planetsRef.current as any[]).filter((ring: any) => {
        ring.r     += (3.5 + mids * 9 * sens) * energyMult;
        ring.alpha *= 0.91;
        if (ring.alpha < 0.014 || ring.r > ring.maxR * 1.25) return false;

        const color = liveColors[ring.colorIdx % liveColors.length];
        const rot   = t * 0.22;
        ctx.save();
        // Outer glow stroke
        ctx.strokeStyle = color;
        ctx.lineWidth   = ring.thickness * ring.alpha * 2.4;
        ctx.globalAlpha = ring.alpha;
        ctx.shadowColor = color; ctx.shadowBlur = 16 + burst * 24;
        ctx.beginPath(); drawShape(ring.r, rot, ring.sides); ctx.stroke();
        // Subtle fill bloom on the ring interior
        ctx.globalAlpha = ring.alpha * 0.12;
        ctx.fillStyle   = color; ctx.shadowBlur = 0;
        ctx.beginPath(); drawShape(ring.r * 0.90, rot, ring.sides); ctx.fill();
        ctx.restore();
        return true;
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      // ── 5. Particles ──────────────────────────────────────────────
      sparksRef.current = (sparksRef.current as any[]).filter((p: any) => {
        p.x  += p.vx; p.y  += p.vy;
        p.vx *= 0.960; p.vy *= 0.960;
        p.life *= 0.934;
        if (p.life < 0.018) return false;
        const color = liveColors[p.colorIdx % liveColors.length];
        ctx.fillStyle = color;
        ctx.globalAlpha = p.life * (0.55 + sectionIntensity * 0.45);
        ctx.shadowColor = color; ctx.shadowBlur = p.size * 3.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      // ── 6. Standing rings — filled + stroked + glowing ────────────
      const standingCount = perf ? 4 : 6;
      for (let i = 0; i < standingCount; i++) {
        const t2      = (i + 1) / (standingCount + 1);
        const freqLo  = Math.floor(t2 * freq.length * 0.45);
        const bandVal = avg(freq, freqLo, freqLo + 12);
        const baseR   = minDim * (0.115 + i * 0.082);
        const liveR   = baseR * (1 + bandVal * sens * 0.38 * (0.4 + sectionIntensity * 0.6));
        const color   = liveColors[i % liveColors.length];
        const rot     = sides === 0 ? 0 : t * 0.11 + i * (Math.PI / Math.max(sides, 1));

        ctx.save();
        // Glow stroke
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.8 + bandVal * 5.5;
        ctx.globalAlpha = 0.30 + bandVal * 0.70;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 10 + bandVal * 24 + (i === 0 ? burst * 16 : 0);
        ctx.beginPath(); drawShape(liveR, rot); ctx.stroke();

        // Fill — makes rings look solid, not just outlines
        ctx.globalAlpha = (0.05 + bandVal * 0.10) * (0.5 + sectionIntensity * 0.5);
        ctx.fillStyle   = color; ctx.shadowBlur = 0;
        ctx.beginPath(); drawShape(liveR, rot); ctx.fill();

        // Vertex highlight dots for polygon variants
        if (sides > 0 && bandVal > 0.28 && !perf) {
          for (let v2 = 0; v2 < sides; v2++) {
            const a = (v2 / sides) * Math.PI * 2 + rot;
            const hx = cx + Math.cos(a) * liveR;
            const hy = cy + Math.sin(a) * liveR;
            ctx.fillStyle   = '#ffffff';
            ctx.globalAlpha = bandVal * 0.6 * (i === standingCount - 1 ? 1 : 0.4);
            ctx.shadowColor = color; ctx.shadowBlur = 5 + bandVal * 12;
            ctx.beginPath(); ctx.arc(hx, hy, 1.8 + bandVal * 3.5, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      // ── 7. Light rays on strong beats ─────────────────────────────
      if (burst > 0.28 && !perf) {
        const rayN   = sides > 0 ? sides * 2 : 12;
        const rayLen = minDim * (0.38 + burst * 0.22);
        ctx.save();
        for (let r2 = 0; r2 < rayN; r2++) {
          const angle = (r2 / rayN) * Math.PI * 2 + t * 0.07;
          const color = liveColors[r2 % liveColors.length];
          const grd   = ctx.createLinearGradient(
            cx, cy,
            cx + Math.cos(angle) * rayLen,
            cy + Math.sin(angle) * rayLen,
          );
          grd.addColorStop(0, `rgba(${hexToRgb(color, hxCache)}, ${(burst - 0.28) * 0.60})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.strokeStyle = grd;
          ctx.lineWidth   = 0.8 + burst * 2.8;
          ctx.globalAlpha = burst * 0.85;
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * rayLen, cy + Math.sin(angle) * rayLen);
          ctx.stroke();
        }
        ctx.restore(); ctx.globalAlpha = 1;
      }

      // ── 8. Multi-layer core glow ──────────────────────────────────
      const coreR = minDim * 0.058 * (1 + burst * 0.55 + bass * sens * 0.28);
      // Wide outer halo
      const haloGrd = ctx.createRadialGradient(cx, cy, coreR * 0.4, cx, cy, coreR * 4.8);
      haloGrd.addColorStop(0, `rgba(${hexToRgb(liveColors[1], hxCache)}, ${0.14 + burst * 0.18})`);
      haloGrd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haloGrd;
      ctx.beginPath(); ctx.arc(cx, cy, coreR * 4.8, 0, Math.PI * 2); ctx.fill();
      // Bright core
      const coreGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrd.addColorStop(0,    '#ffffff');
      coreGrd.addColorStop(0.22, liveColors[0]);
      coreGrd.addColorStop(0.62, `rgba(${hexToRgb(liveColors[1], hxCache)}, 0.55)`);
      coreGrd.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrd;
      ctx.shadowColor = liveColors[0]; ctx.shadowBlur = 20 + burst * 30;
      ctx.globalAlpha = 0.88 + burst * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      } // end non-nova solar block
    }

    // ── Post-processing ───────────────────────────────────────────────────
    // Engine crossfade: overlay previous frame fading out over ~18 frames
    if (crossfadeAlpha.current > 0 && crossfadeRef.current) {
      ctx.save();
      ctx.globalAlpha = crossfadeAlpha.current;
      ctx.putImageData(crossfadeRef.current, 0, 0);
      ctx.restore();
      crossfadeAlpha.current = Math.max(0, crossfadeAlpha.current - 0.06);
      if (crossfadeAlpha.current <= 0) crossfadeRef.current = null;
    }
    // Drop entry flash: brief white pulse at the very start of a drop/chorus
    if (activeSection && sectionProgress < 0.04 &&
        (activeSection.label === 'drop' || activeSection.label === 'chorus')) {
      const flashAlpha = ((0.04 - sectionProgress) / 0.04) * 0.22;
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
    // Breakdown vignette
    if (activeSection && (activeSection.label === 'breakdown')) {
      const vigAlpha = 0.18 * (1 - sectionProgress * 0.5);
      ctx.fillStyle = `rgba(0,0,0,${vigAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Resize canvas to selected aspect ratio
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Base internal resolution — higher = sharper but more CPU per frame
    // Cap at 720 width to keep RAF cost predictable
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const baseW = perfMode ? 480 : 720;
    const ratio = aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : 16 / 9;
    const targetW = aspect === '9:16' ? Math.round(baseW * 0.6) : baseW;
    canvas.width  = Math.round(targetW * dpr);
    canvas.height = Math.round((targetW / ratio) * dpr);
    drawFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, perfMode]);

  // ─────────────────────────────────────────────────────────────────────────
  // Playback
  // ─────────────────────────────────────────────────────────────────────────
  const stopAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  };

  async function loadFile(file: File, opts: { skipUpload?: boolean } = {}) {
    setStatus('decoding'); setError(null);
    try {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|flac|ogg|m4a)$/i.test(file.name)) {
        throw new Error('Unsupported file type. Try MP3, WAV, or FLAC.');
      }
      if (file.size > 100 * 1024 * 1024) throw new Error('File too large (max 100 MB).');
      const arrayBuffer = await file.arrayBuffer();
      const ctx = audioCtxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (audioBuffer.duration < 1) throw new Error('Audio is too short.');
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = smoothing;
      analyserRef.current = analyser;
      const gain = ctx.createGain();
      gainRef.current = gain;
      analyser.connect(gain).connect(ctx.destination);
      const newProj: Project = { id: `prj_${Date.now()}`, fileName: file.name, duration: audioBuffer.duration, audioBuffer, engine: initialEngine };
      setProject(newProj); setStatus('ready');

      // Capture thumbnail after first frame renders (~300ms)
      setTimeout(() => {
        if (canvasRef.current) {
          try {
            const thumb = canvasRef.current.toDataURL('image/jpeg', 0.55);
            if (persist && persistedId) {
              persist.updateProject(persistedId, { style: { ...(persist.projects[persistedId]?.style ?? {}), thumbnail: thumb } });
            }
          } catch { /* cross-origin canvas — skip silently */ }
        }
      }, 350);

      // ── Phase 9: offline analysis — Web Worker with main-thread fallback ──
      (() => {
        // Copy channel data out of AudioBuffer before any async boundary
        const channelData: Float32Array[] = [];
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          channelData.push(new Float32Array(audioBuffer.getChannelData(ch)));
        }

        const applyAnalysis = (r: {
          sections: typeof import('../lib/audioAnalysis').analyzeTrackSections extends (...a: any[]) => infer R ? R : never;
          energyCurve: number[];
          energyCurveResolution: number;
          bpm: number;
          avgEnergy: number;
          spectralCentroid: number;
          mood: string;
        }) => {
          sectionsRef.current       = r.sections;
          energyCurveRef.current    = new Float32Array(r.energyCurve);
          energyCurveResRef.current = r.energyCurveResolution;
          setTrackAnalysis({
            sections: r.sections,
            energyCurve: new Float32Array(r.energyCurve),
            energyCurveResolution: r.energyCurveResolution,
            bpm: r.bpm,
            avgEnergy: r.avgEnergy,
            spectralCentroid: r.spectralCentroid,
            mood: r.mood as import('../lib/audioAnalysis').MoodLabel,
          });
          setRecommendations(recommendEngines(
            r.mood as import('../lib/audioAnalysis').MoodLabel,
            r.bpm,
            3,
            r.avgEnergy,
            r.spectralCentroid,
          ));
        };

        // Main-thread fallback (used if Worker fails or is unsupported)
        const runOnMainThread = () => {
          setTimeout(() => {
            try {
              const mockBuffer = {
                sampleRate: audioBuffer.sampleRate,
                length: channelData[0]?.length ?? 0,
                duration: audioBuffer.duration,
                numberOfChannels: channelData.length,
                getChannelData: (ch: number) => channelData[ch] ?? new Float32Array(0),
              } as unknown as AudioBuffer;
              const analysis = analyzeTrack(mockBuffer);
              applyAnalysis({
                ...analysis,
                energyCurve: Array.from(analysis.energyCurve),
                mood: analysis.mood as string,
              });
            } catch (err) {
              console.warn('[studio] main-thread analysis failed:', err);
            }
          }, 0);
        };

        // Try worker first
        try {
          const worker = new Worker(
            new URL('../workers/analysisWorker.ts', import.meta.url),
            { type: 'module' }
          );

          // 20 s watchdog — fall back to main thread if worker hangs
          const watchdog = setTimeout(() => {
            console.warn('[studio] worker watchdog fired — falling back to main thread');
            worker.terminate();
            runOnMainThread();
          }, 20_000);

          worker.onmessage = (e) => {
            clearTimeout(watchdog);
            worker.terminate();
            if (!e.data.ok) {
              console.warn('[studio] worker reported error:', e.data.error, '— falling back to main thread');
              runOnMainThread();
              return;
            }
            applyAnalysis(e.data);
          };

          worker.onerror = (err) => {
            clearTimeout(watchdog);
            console.warn('[studio] worker onerror — falling back to main thread:', err.message);
            worker.terminate();
            runOnMainThread();
          };

          // Transfer buffers to worker (zero-copy)
          const transferList = channelData.map(ch => ch.buffer);
          worker.postMessage(
            { channelData, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration },
            transferList
          );
        } catch (err) {
          // Worker not supported (e.g. some iOS WebViews) — fall back
          console.warn('[studio] could not start worker — falling back to main thread:', err);
          runOnMainThread();
        }
      })();
      // ─────────────────────────────────────────────────────────────────────

       const audioMeta = { name: file.name, duration: audioBuffer.duration, sampleRate: audioBuffer.sampleRate };
 
      if (persist && !persistedId) {
        const created = persist.createProject(audioMeta, engine);
        setPersistedId(created.id);
 
        if (!opts.skipUpload) {
          if (user?.id) {
            setUploadingToCloud(true);
            supabaseSync
              .uploadAudio(created.id, file, audioMeta, engine)
              .then(() => { setUploadingToCloud(false); })
              .catch((err) => { console.error('[studio] uploadAudio ERROR:', err); setUploadingToCloud(false); });
          } else {
            console.log('[studio] user not ready yet — storing pending upload for project:', created.id);
            pendingUploadRef.current = { file, audioMeta, engineId: engine };
          }
        }
      } else if (persist && persistedId) {
        persist.updateProject(persistedId, { audioMeta });
 
        if (!opts.skipUpload) {
          if (user?.id) {
            setUploadingToCloud(true);
            supabaseSync
              .uploadAudio(persistedId, file, audioMeta, engine)
              .then(() => { setUploadingToCloud(false); })
              .catch((err) => { console.error('[studio] uploadAudio ERROR:', err); setUploadingToCloud(false); });
          } else {
            console.log('[studio] user not ready yet — storing pending upload for project:', persistedId);
            pendingUploadRef.current = { file, audioMeta, engineId: engine };
          }
        }
      }
} catch (e: any) {
      setStatus('error'); setError(e.message || 'Failed to decode audio.');
    }
  } 

   const reloadProjectAudio = async (projId: string) => {
    setStatus('decoding');
    try {
      // 1. Get track metadata from DB
      const track = await fetchProjectTrack(projId);
      if (!track?.storage_path) {
        // No audio stored yet — show idle state, user can re-upload
        setStatus('idle');
        return;
      }
 
      // 2. Get a signed URL from Supabase Storage
      const signedUrl = await getAudioSignedUrl(track.storage_path, 3600);
      if (!signedUrl) {
        setStatus('idle');
        return;
      }
 
      // 3. Fetch the audio blob
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error('Failed to fetch audio from storage');
      const blob = await response.blob();
 
      // 4. Reconstruct a File object and call loadFile (skip re-upload — already in Storage)
      const file = new File([blob], track.filename, { type: track.mime_type || 'audio/mpeg' });
      await loadFile(file, { skipUpload: true });
 
      // 5. Restore export history from DB
      const dbExports = await fetchProjectExports(projId);
if (dbExports.length > 0) {
        const restored: ExportJob[] = dbExports.map((e) => ({
          id: Number(e.id) || Date.now(),
          storageId: e.id,
          storagePath: e.storage_path,
          name: `${track.filename.replace(/\.[^.]+$/, '')}_${e.aspect_ratio?.replace(':', 'x') ?? ''}_${e.quality_preset ?? ''}`,
          preset: e.quality_preset ?? '',
          aspect: e.aspect_ratio ?? '9:16',
          status: 'done' as const,
          progress: 100,
          url: undefined,
          size: e.size_bytes ?? undefined,
        }));
        setExports(restored);
      }
 
    } catch (err) {
      console.error('[studio] reloadProjectAudio failed:', err);
      // Non-fatal — just show idle so user can re-upload
      setStatus('idle');
    }
  };
  
  
  const play = async () => {
    if (!project || !audioCtxRef.current || !analyserRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = project.audioBuffer;
    src.connect(analyserRef.current);
    src.onended = () => {
      if (sourceRef.current === src) { playingRef.current = false; setPlaying(false); offsetRef.current = 0; }
    };
    src.start(0, offsetRef.current);
    startedAtRef.current = ctx.currentTime - offsetRef.current;
    sourceRef.current = src;
    playingRef.current = true;
    setPlaying(true);
    runVisualizationLoop();
  };

  const pause = () => {
    if (!sourceRef.current || !audioCtxRef.current) return;
    offsetRef.current = audioCtxRef.current.currentTime - startedAtRef.current;
    try { sourceRef.current.stop(); } catch {}
    sourceRef.current.disconnect(); sourceRef.current = null;
    playingRef.current = false;
    setPlaying(false);
    // Draw one more frame so the canvas shows the paused state
    setTimeout(drawFrame, 16);
  };

  const seek = (t: number) => {
    const wasPlaying = playingRef.current;
    if (wasPlaying) pause();
    offsetRef.current = Math.max(0, Math.min(t, project?.duration ?? 0));
    setCurrentTime(offsetRef.current);
    if (wasPlaying) play(); else drawFrame();
  };

  const runVisualizationLoop = () => {
    let lastTimeUpdate = 0;
    const tick = (rafTs: number) => {
      drawFrame();
      // Throttle React time state to 4× per second — avoids 60 re-renders/sec
      if (audioCtxRef.current && playingRef.current) {
        const t = audioCtxRef.current.currentTime - startedAtRef.current + offsetRef.current;
        currentTimeRef.current = t;
        if (rafTs - lastTimeUpdate > 250) {
          setCurrentTime(t);
          lastTimeUpdate = rafTs;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // File picker
  // ─────────────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null);
  const onPickFile   = () => fileInputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { stopAudio(); setPlaying(false); playingRef.current = false; offsetRef.current = 0; loadFile(file); }
  };

  const canvasAreaRef = useRef<HTMLDivElement>(null); // target element for fullscreen

  const toggleFullscreen = () => {
    if (isFullscreen) {
      // Exit — try native first, then CSS fallback
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      setIsFullscreen(false);
      return;
    }
    // Enter — try native fullscreen on the canvas area element
    const el = canvasAreaRef.current;
    const supportsFS = !!el?.requestFullscreen;
    if (supportsFS && el) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {
        // Native failed (permissions/iOS) → CSS fullscreen
        setIsFullscreen(true);
      });
    } else {
      // iOS Safari / unsupported → CSS fullscreen overlay
      setIsFullscreen(true);
    }
  };
  // Sync when user presses Esc (native fullscreen exit)
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Non-passive touchmove on seek bar — React handlers are passive by default,
  // so e.preventDefault() throws. Attach manually with { passive: false }.
  useEffect(() => {
    const el = seekBarRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (!isDraggingSeekRef.current || !project) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const touch = e.touches[0];
      seek(Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * project.duration);
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // ── Project config JSON export / import ───────────────────────────────────
  // ── Randomize: pick random engine + variant + palette ─────────────────────
  const randomize = () => {
    const engineIds = ENGINES.map(e => e.id);
    const newEng = engineIds[Math.floor(Math.random() * engineIds.length)];
    const variants = VARIANTS[newEng];
    const newVariant = variants ? variants[Math.floor(Math.random() * variants.length)].id : '';
    const newPalette = Math.floor(Math.random() * PALETTES.length);
    setEngine(newEng); setVariant(newVariant); setPalette(newPalette);
  };

  // ── Named presets ──────────────────────────────────────────────────────────
  const saveCurrentPreset = (name: string) => {
    const preset: SavedPreset = {
      name, engineId: engine, variant, palette,
      motion: { beatSensitivity, particleDensity, smoothing, baseSpeed, beatResponse },
    };
    const updated = [...savedPresets.filter(p => p.name !== name), preset];
    setSavedPresets(updated);
    localStorage.setItem('ma_saved_presets', JSON.stringify(updated));
  };
  const loadPreset = (preset: SavedPreset) => {
    setEngine(preset.engineId as EngineId); setVariant(preset.variant); setPalette(preset.palette);
    setBeatSensitivity(preset.motion.beatSensitivity); setParticleDensity(preset.motion.particleDensity);
    setSmoothing(preset.motion.smoothing); setBaseSpeed(preset.motion.baseSpeed); setBeatResponse(preset.motion.beatResponse);
  };
  const deletePreset = (name: string) => {
    const updated = savedPresets.filter(p => p.name !== name);
    setSavedPresets(updated);
    localStorage.setItem('ma_saved_presets', JSON.stringify(updated));
  };

  const exportProjectConfig = () => {
    const config = {
      version: 1,
      engineId: engine,
      variant,
      palette,
      customPalettes: (() => { try { return JSON.parse(localStorage.getItem('ma_custom_palettes') || '{}'); } catch { return {}; } })(),
      motion: { beatSensitivity, particleDensity, smoothing, baseSpeed, beatResponse },
      aspect,
      presetId,
      clipDuration,
      trackName: project?.fileName ?? null,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${(project?.fileName ?? 'project').replace(/\.[^.]+$/, '')}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProjectConfig = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const c = JSON.parse(e.target?.result as string);
        if (c.version !== 1) throw new Error('Unknown config version');
        if (c.engineId)                       setEngine(c.engineId as EngineId);
        if (c.variant !== undefined)          setVariant(c.variant);
        if (typeof c.palette === 'number')    setPalette(c.palette);
        if (c.customPalettes && typeof c.customPalettes === 'object') {
          Object.entries(c.customPalettes).forEach(([idx, cols]) => {
            const i = Number(idx);
            if (PALETTES[i] && Array.isArray(cols) && (cols as unknown[]).length === 3)
              PALETTES[i] = { ...PALETTES[i], colors: cols as [string, string, string] };
          });
          try { localStorage.setItem('ma_custom_palettes', JSON.stringify(c.customPalettes)); } catch { /* ignore */ }
        }
        if (c.motion) {
          if (typeof c.motion.beatSensitivity === 'number') setBeatSensitivity(c.motion.beatSensitivity);
          if (typeof c.motion.particleDensity  === 'number') setParticleDensity(c.motion.particleDensity);
          if (typeof c.motion.smoothing        === 'number') setSmoothing(c.motion.smoothing);
          if (typeof c.motion.baseSpeed        === 'number') setBaseSpeed(c.motion.baseSpeed);
          if (typeof c.motion.beatResponse     === 'number') setBeatResponse(c.motion.beatResponse);
        }
        if (c.aspect)       setAspect(c.aspect);
        if (c.presetId)     setPresetId(c.presetId);
        if (c.clipDuration) setClipDuration(c.clipDuration);
      } catch (err) {
        console.error('[studio] config import failed:', err);
      }
    };
    reader.readAsText(file);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Export — platform-aware
  // ─────────────────────────────────────────────────────────────────────────
  const startExport = async () => {
    if (!project || !canvasRef.current || !audioCtxRef.current || !analyserRef.current) return;
    const preset = PRESETS.find((p) => p.id === presetId)!;

    // Use loop region if set, otherwise fall back to clipDuration
    const loopActive = loopStart !== null && loopEnd !== null;
    const exportStartSec = loopActive ? (loopStart! * project.duration) : 0;
    const dur = loopActive
      ? Math.min((loopEnd! - loopStart!) * project.duration, 180)
      : (clipDuration === 'full' ? Math.min(project.duration, 180) : (clipDuration as number));

    const trackName = project.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const aspectLabel = aspect === '9:16' ? 'TikTok' : aspect === '1:1' ? 'Square' : 'YouTube';
    const job: ExportJob = {
      id: Date.now(),
      name: `${trackName} · ${aspectLabel} · ${preset.name}`,
      preset: preset.name, aspect, status: 'recording', progress: 0,
    };
    setExports((x) => [...x, job]);
    setActiveTab('export'); // show progress immediately

    if (persist && persistedId) {
      persist.addExport(persistedId, {
        id: String(job.id), createdAt: Date.now(),
        type: exportMode === 'mp4' ? 'mp4' : 'webm',
        status: 'recording', aspectRatio: aspect,
        resolution: `${preset.w}x${preset.h}`, duration: dur, qualityPreset: preset.name,
      });
    }

    // iOS/Safari with no MediaRecorder support → show helpful message
    if (exportMode === 'server') {
      setExports((x) => x.map((j) => j.id === job.id
        ? { ...j, status: 'error', progress: 0, errorMsg: 'Direct recording is not supported on this browser. Please open on desktop Chrome/Firefox or Android Chrome.' }
        : j));
      if (persist && persistedId) persist.updateExport(persistedId, String(job.id), { status: 'error', errorMessage: 'Browser not supported' });
      return;
    }

    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current.disconnect(); }

    // Resize canvas to actual export resolution — preview renders at ~432px, export must be full preset size
    const exportCanvas = canvasRef.current!;
    const prevCanvasW  = exportCanvas.width;
    const prevCanvasH  = exportCanvas.height;
    const prevPerfMode = perfModeRef.current;
    exportCanvas.width  = preset.w;
    exportCanvas.height = preset.h;
    perfModeRef.current = false; // always full quality during export

    const dest = ctx.createMediaStreamDestination();
    const src  = ctx.createBufferSource();
    src.buffer = project.audioBuffer;
    src.connect(analyserRef.current);
    analyserRef.current.connect(dest);
    sourceRef.current = src;
    src.start(0, exportStartSec);
    startedAtRef.current = ctx.currentTime;
    offsetRef.current = exportStartSec;
    playingRef.current = true;
    setPlaying(true);
    runVisualizationLoop();

  // Feature-detect requestFrame (Chrome/Edge only — not Firefox/Safari)
    // captureStream(0) = manual frame control; captureStream(fps) = timed fallback
    const _testCanvas = document.createElement('canvas');
    const _testTrack = _testCanvas.captureStream(0).getVideoTracks()[0] as any;
    const supportsRequestFrame = typeof _testTrack?.requestFrame === 'function';
    _testTrack?.stop();

    const canvasStream = canvasRef.current!.captureStream(supportsRequestFrame ? 0 : preset.fps);
    const videoTrack = canvasStream.getVideoTracks()[0] as any;
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

    // Choose mimeType: MP4 on iOS Safari if supported, WebM elsewhere
    const mimeType = exportMode === 'mp4'
      ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(mixed, {
        mimeType,
        videoBitsPerSecond: preset.id === 'pro' ? 30_000_000 : preset.id === 'std' ? 15_000_000 : 6_000_000,
        audioBitsPerSecond: 320_000,
      });
    } catch (err) {
      console.error('MediaRecorder init failed:', err);
      setExports((x) => x.map((j) => j.id === job.id
        ? { ...j, status: 'error', progress: 0, errorMsg: 'Recording failed to start. Try a different browser.' }
        : j));
      return;
    }

    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
      setExports((x) => x.map((j) => j.id === job.id
        ? { ...j, status: 'error', progress: j.progress, errorMsg: 'Recording error. Try exporting on desktop.' }
        : j));
      try { src.stop(); } catch {}
      playingRef.current = false; setPlaying(false);
    };
       exportCancelRef.current = false; // reset before starting
       recorder.onstop = () => {
      // Clear export interval if still running (e.g. stopped externally)
      if (exportIntervalRef.current) {
        clearInterval(exportIntervalRef.current);
        exportIntervalRef.current = null;
      }
      // If cancelled, discard blob and mark as error
      if (exportCancelRef.current) {
        exportCanvas.width = prevCanvasW; exportCanvas.height = prevCanvasH;
        perfModeRef.current = prevPerfMode;
        setExports((x) => x.filter((j) => j.id !== job.id));
        exportCancelRef.current = false;
        return;
      }

      const ext  = exportMode === 'mp4' ? 'mp4' : 'webm';
      const type = exportMode === 'mp4' ? 'video/mp4' : 'video/webm';
      // Restore canvas to preview resolution after successful export
      exportCanvas.width = prevCanvasW; exportCanvas.height = prevCanvasH;
      perfModeRef.current = prevPerfMode;
      const blob = new Blob(chunks, { type });
      const url  = URL.createObjectURL(blob);
 
      setExports((x) =>
        x.map((j) =>
          j.id === job.id ? { ...j, status: 'done', progress: 100, url, blob, size: blob.size } : j
        )
      );
      // Auto-switch to History tab so user immediately sees the download button
      setActiveTab('exports');
 
      // Local persist (existing)
      if (persist && persistedId) {
        persist.updateExport(persistedId, String(job.id), { status: 'ready', sizeBytes: blob.size });
      }
 
      // Supabase persist (new) — fire-and-forget, does NOT block the download
      if (persistedId) {
        const preset = PRESETS.find((p) => p.id === presetId);
        supabaseSync
          .saveExport(persistedId, {
            exportId: String(job.id),
            exportType: ext as 'webm' | 'mp4',
            aspectRatio: aspect,
            resolution: preset ? `${preset.w}x${preset.h}` : '',
            qualityPreset: preset?.name ?? presetId,
            durationSecs: dur,
            blob,
            sizeBytes: blob.size,
          })
          .catch((err) => console.warn('[studio] export save failed silently:', err));
      }
    };
    
recorder.start(200);

    const startedAt = performance.now();
    const frameMs = 1000 / preset.fps;

    if (supportsRequestFrame) {
      // ── Frame-accurate path (Chrome / Edge) ───────────────────────────────
      // setInterval renders + commits every frame at the exact target fps.
      // No rAF loop competing for GPU — eliminates the stutter/lag entirely.
      exportIntervalRef.current = setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;

        if (exportCancelRef.current || elapsed >= dur) {
          clearInterval(exportIntervalRef.current!);
          exportIntervalRef.current = null;
          if (!exportCancelRef.current) {
            setExports((x) => x.map((j) =>
              j.id === job.id ? { ...j, status: 'finalizing', progress: 100 } : j));
            recorder.stop();
            try { src.stop(); } catch {}
            playingRef.current = false; setPlaying(false);
          }
          return;
        }

        // Render the frame then immediately commit it to the recording stream
        drawFrame();
        videoTrack.requestFrame();

        const pct = Math.min(100, (elapsed / dur) * 100);
        setExports((x) => x.map((j) => j.id === job.id ? { ...j, progress: pct } : j));
      }, frameMs);

    } else {
      // ── Fallback path (Firefox / Safari) ─────────────────────────────────
      // captureStream(fps) samples asynchronously — imperfect but unavoidable
      // without requestFrame support. Keep existing rAF approach for these browsers.
      runVisualizationLoop();
      const tick = () => {
        const elapsed = (performance.now() - startedAt) / 1000;
        const pct = Math.min(100, (elapsed / dur) * 100);
        setExports((x) => x.map((j) => j.id === job.id ? { ...j, progress: pct } : j));
        if (elapsed >= dur) {
          setExports((x) => x.map((j) =>
            j.id === job.id ? { ...j, status: 'finalizing', progress: 100 } : j));
          recorder.stop();
          try { src.stop(); } catch {}
          playingRef.current = false; setPlaying(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Export management
  // ─────────────────────────────────────────────────────────────────────────
  const deleteExport = (jobId: number, storageId?: string) => {
    setExports((x) => x.filter((j) => j.id !== jobId));
    if (storageId) deleteDBExport(storageId).catch(() => {});
    if (persist && persistedId) persist.updateExport(persistedId, String(jobId), { status: 'error' });
  };

  const downloadCloudExport = async (job: ExportJob) => {
    if (!job.storagePath) return;
    setExports((x) => x.map((j) => j.id === job.id ? { ...j, status: 'recording' } : j)); // show loading
    const url = await getExportSignedUrl(job.storagePath, 3600);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      const ext = job.storagePath.endsWith('.mp4') ? 'mp4' : 'webm';
      a.download = `${job.name}.${ext}`;
      a.click();
    }
    setExports((x) => x.map((j) => j.id === job.id ? { ...j, status: 'done' } : j));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const pct = project ? Math.max(0, Math.min(100, (currentTime / project.duration) * 100)) : 0;

  const exportModeLabel = exportMode === 'webm'
    ? '⚡ Fast in-browser · WebM'
    : exportMode === 'mp4'
      ? '📱 Mobile recording · MP4'
      : '⚠️ Unsupported browser';

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────

 return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-black via-gray-950 to-black text-white overflow-hidden">
 
      {/* ── Top bar (fixed height) ──────────────────────────────── */}
      <div className="shrink-0 border-b border-white/10 px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button variant="ghost" onClick={onBack} className="text-gray-200 hover:bg-white/10 shrink-0 h-8 px-2">
            <ArrowLeft className="size-4 mr-1" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold truncate flex items-center gap-1.5 sm:gap-2">
              <span className="truncate">{project?.fileName || 'New project'}</span>
              {user && (
                <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 hidden sm:inline"
                  style={{
                    background: uploadingToCloud ? 'rgba(251,191,36,0.12)' : 'rgba(16,185,129,0.12)',
                    color: uploadingToCloud ? 'rgb(251,191,36)' : 'rgb(16,185,129)',
                  }}>
                  {uploadingToCloud ? '⏫ uploading' : '☁ synced'}
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-400 truncate">
              {project ? `${fmt(project.duration)} · ${ENGINES.find((e) => e.id === engine)!.name}` : 'No track loaded'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Button variant="ghost" onClick={randomize} title="Randomize engine, style & palette"
            className="border border-white/15 text-gray-300 hover:bg-white/10 shrink-0 h-8 w-8 p-0">
            <Shuffle className="size-3.5" />
          </Button>
          <Button variant="outline" onClick={onPickFile}
            className="border-white/20 text-white hover:bg-white/10 shrink-0 h-8 w-8 sm:w-auto sm:px-3 text-xs p-0 sm:p-auto">
            <Upload className="size-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Replace</span>
          </Button>
          <Button variant="ghost" onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen (F)'}
            className="border border-white/15 text-gray-300 hover:bg-white/10 shrink-0 h-8 w-8 p-0">
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>
 
      {/* ── Main content: two fixed zones on mobile — canvas (fixed) + controls (scrollable) ── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
 
        {/* Canvas + transport — FIXED height on mobile so controls below can scroll freely */}
        <div ref={canvasAreaRef}
             className={`flex flex-col shrink-0 lg:flex-1 lg:min-h-0 lg:h-auto
                        ${isFullscreen
                          ? 'fixed inset-0 z-50 bg-black flex-1 !p-0 !gap-0'  // CSS fullscreen fallback (works on iOS)
                          : 'p-2 sm:p-3 lg:p-4 gap-2 lg:gap-3 overflow-hidden'}`}
             style={{
               height: isFullscreen ? '100%' : (
                 // Desktop: no inline height — CSS flex handles it
                 typeof window !== 'undefined' && window.innerWidth >= 1024 ? undefined :
                 // Mobile fixed heights
                 // 9:16  reduced by 20% from 70vh/476px
                 // 1:1   ×2 of original
                 // 16:9  ×2 of original
                 aspect === '9:16' ? 'min(56vh, 380px)'
                 : aspect === '1:1' ? 'min(100vw, 520px)'
                 : 'min(92vw, 560px)'
               ),
             }}>
 
          {/* Canvas viewport — constrained to available space, never overflows */}
          <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          <div
            className="relative rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0"
            style={{
              // Fit inside available box while preserving aspect ratio
              aspectRatio: aspect === '9:16' ? '9 / 16' : aspect === '1:1' ? '1 / 1' : '16 / 9',
              maxWidth:  '100%',
              maxHeight: '100%',
              width:  aspect === '16:9' ? '100%' : 'auto',
              height: aspect === '16:9' ? 'auto' : '100%',
            }}
          >
            <AnimatePresence>
              {status === 'decoding' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 bg-black/80 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="size-7 animate-spin text-purple-400" />
                  <div className="text-sm">Analyzing audio…</div>
                </motion.div>
              )}
              {status === 'error' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 bg-black/85 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <AlertCircle className="size-7 text-red-400" />
                  <div className="font-semibold text-sm">Couldn't read this file</div>
                  <div className="text-xs text-gray-400 max-w-sm">{error}</div>
                  <Button onClick={onPickFile} size="sm" className="bg-white text-gray-900 hover:bg-gray-100">
                    <RotateCw className="size-3.5 mr-1.5" /> Try another file
                  </Button>
                </motion.div>
              )}
              {status === 'idle' && !project && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center gap-3 text-center">
                  <Upload className="size-7 text-gray-300" />
                  <div className="font-semibold text-sm">No track loaded</div>
                  <Button onClick={onPickFile} size="sm" className="bg-white text-gray-900 hover:bg-gray-100">
                    Upload a track
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {/* Canvas — camera wrapper enables zoom/drift via CSS transform */}
            <div
              ref={cameraWrapperRef}
              className="absolute inset-0 will-change-transform"
              style={{ transformOrigin: '50% 50%' }}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full"
              />
            </div>

            {/* Section label overlay — React layer, NOT recorded into video */}
            {status === 'ready' && activeSectionLabel && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
                <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded uppercase ${
                  activeSectionLabel === 'drop'      ? 'bg-amber-500/25 text-amber-300' :
                  activeSectionLabel === 'chorus'    ? 'bg-purple-500/25 text-purple-300' :
                  activeSectionLabel === 'breakdown' ? 'bg-blue-500/20 text-blue-300' :
                  'bg-white/10 text-white/50'
                }`}>{activeSectionLabel}</span>
                <span className="text-[10px] text-white/30 tabular-nums">{liveEnergy}%</span>
              </div>
            )}

            {/* FPS overlay — only when toggled in Motion tab */}
            {showFps && status === 'ready' && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 pointer-events-none">
                <span className={`text-[10px] font-bold tabular-nums ${
                  fps >= 50 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-red-400'
                }`}>{fps} fps</span>
              </div>
            )}

            {/* Auto-perf suggestion — shown after 2s of sustained low FPS */}
            {showPerfSuggest && !perfMode && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto w-[88%] max-w-[300px]">
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-black/85 border border-amber-400/25 backdrop-blur-sm shadow-2xl">
                  <span className="text-amber-400 text-base shrink-0">⚡</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-white/90 font-medium leading-tight">Playback running slow</p>
                    <p className="text-[10px] text-white/50 mt-0.5">Enable Performance Mode for smoother animation</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => { setPerfMode(true); setShowPerfSuggest(false); setActiveTab('motion'); }}
                      className="px-2 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-300 text-[10px] font-semibold transition-colors">
                      Enable
                    </button>
                    <button onClick={() => setShowPerfSuggest(false)}
                      className="text-white/30 hover:text-white/60 transition-colors">
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Keyboard shortcut coach mark — shown once after first track load */}
            {showOnboarding && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
                <div className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-black/80 border border-white/10 backdrop-blur-sm shadow-2xl min-w-[200px]">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] font-bold tracking-widest uppercase text-white/40">Keyboard shortcuts</span>
                    <button
                      onClick={() => { setShowOnboarding(false); localStorage.setItem('ma_seen_shortcuts', '1'); }}
                      className="text-white/30 hover:text-white/70 transition-colors ml-3">
                      <X className="size-3" />
                    </button>
                  </div>
                  {[
                    { key: 'Space / K', label: 'Play · Pause' },
                    { key: '← →',       label: 'Seek ±5 seconds' },
                    { key: 'M',          label: 'Mute toggle' },
                    { key: 'Esc',        label: 'Stop playback' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70 border border-white/10">{key}</kbd>
                      <span className="text-[10px] text-white/50">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fullscreen floating transport — only visible in fullscreen mode */}
            {isFullscreen && status === 'ready' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-black/70 border border-white/10 backdrop-blur-md shadow-2xl">
                  <button onClick={() => (playing ? pause() : play())}
                    className="size-9 rounded-full bg-white text-gray-900 flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0">
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                  <span className="text-xs text-gray-300 tabular-nums shrink-0">{fmt(currentTime)} / {fmt(project?.duration ?? 0)}</span>
                  {/* Mini seek bar */}
                  <div className="w-32 sm:w-48 relative h-5 cursor-pointer"
                    onClick={(e) => {
                      if (!project) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      seek(((e.clientX - rect.left) / rect.width) * project.duration);
                    }}>
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-white/20 rounded-full" />
                    <div className="absolute top-1/2 -translate-y-1/2 h-0.5 bg-white rounded-full" style={{ width: `${pct}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 size-2.5 -ml-1.5 rounded-full bg-white shadow"
                      style={{ left: `${pct}%` }} />
                  </div>
                  <button onClick={toggleFullscreen}
                    className="text-gray-400 hover:text-white transition-colors">
                    <Minimize2 className="size-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>{/* end centering flex wrapper */}

          {/* Sign-in nudge — shown once to anonymous users after audio loads */}
          {showSignInNudge && !user && !isFullscreen && (
            <div className="shrink-0 flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs">
              <span className="flex-1 text-gray-300">
                Sign in to save this project and access it from any device.
              </span>
              <Button
                size="sm"
                className="h-7 text-xs bg-white text-gray-900 hover:bg-gray-100 shrink-0"
                onClick={() => setAuthModalOpen(true)}
              >
                Sign in
              </Button>
              <button
                className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                onClick={() => setShowSignInNudge(false)}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Transport bar (fixed height) — hidden in fullscreen, replaced by floating overlay */}
          {!isFullscreen && <div className="shrink-0 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-3">
              <Button size="icon" disabled={!project} onClick={() => (playing ? pause() : play())}
                title="Play / Pause  (Space or K)"
                className="rounded-full size-9 bg-white text-gray-900 hover:bg-gray-100 disabled:opacity-40 shrink-0">
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
              <div className="text-xs text-gray-300 tabular-nums shrink-0 min-w-[70px]">
                {fmt(currentTime)} / {fmt(project?.duration ?? 0)}
              </div>
              {/* Loop region toggle */}
              {project && (
                <button
                  title={loopStart !== null ? 'Clear loop region' : 'Set loop region around playhead (±15s)'}
                  onClick={() => {
                    if (loopStart !== null) {
                      setLoopStart(null); setLoopEnd(null);
                    } else {
                      const dur = project.duration;
                      const center = currentTime / dur;
                      const half = Math.min(15 / dur, 0.4);
                      setLoopStart(Math.max(0, center - half));
                      setLoopEnd(Math.min(1, center + half));
                    }
                  }}
                  className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                    loopStart !== null
                      ? 'bg-purple-500/25 border-purple-500/50 text-purple-300'
                      : 'bg-white/5 border-white/15 text-gray-400 hover:text-gray-200 hover:bg-white/10'
                  }`}>
                  <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 8h12M10 5l3 3-3 3M6 5 3 8l3 3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {loopStart !== null ? 'Clear' : 'Loop'}
                </button>
              )}
              <div ref={seekBarRef}
                className="flex-1 relative h-7 cursor-pointer select-none"
                title={loopStart !== null ? 'Drag handles to adjust loop region' : 'Seek  (← → arrow keys)'}
                onMouseDown={(e) => {
                  if (!project) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

                  // Check if clicking near a loop handle
                  if (loopStart !== null && loopEnd !== null) {
                    const startX = loopStart * rect.width;
                    const endX   = loopEnd   * rect.width;
                    const clickX = e.clientX - rect.left;
                    if (Math.abs(clickX - startX) < 10) {
                      draggingLoopHandle.current = 'start';
                      loopDragOriginX.current = e.clientX;
                      loopDragOriginStart.current = loopStart;
                      loopDragOriginEnd.current = loopEnd;
                      return;
                    }
                    if (Math.abs(clickX - endX) < 10) {
                      draggingLoopHandle.current = 'end';
                      loopDragOriginX.current = e.clientX;
                      loopDragOriginStart.current = loopStart;
                      loopDragOriginEnd.current = loopEnd;
                      return;
                    }
                    // Clicking inside region — drag the whole region
                    if (clickX > startX && clickX < endX) {
                      draggingLoopHandle.current = 'region';
                      loopDragOriginX.current = e.clientX;
                      loopDragOriginStart.current = loopStart;
                      loopDragOriginEnd.current = loopEnd;
                      return;
                    }
                  }
                  // Regular seek
                  isDraggingSeekRef.current = true;
                  seek(frac * project.duration);
                }}
                onMouseMove={(e) => {
                  if (!project) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

                  if (draggingLoopHandle.current && loopStart !== null && loopEnd !== null) {
                    const delta = (e.clientX - loopDragOriginX.current) / rect.width;
                    const minLen = 2 / project.duration; // min 2s loop
                    if (draggingLoopHandle.current === 'start') {
                      setLoopStart(Math.max(0, Math.min(loopDragOriginStart.current + delta, loopDragOriginEnd.current - minLen)));
                    } else if (draggingLoopHandle.current === 'end') {
                      setLoopEnd(Math.max(loopDragOriginStart.current + minLen, Math.min(1, loopDragOriginEnd.current + delta)));
                    } else {
                      // region drag
                      const span = loopDragOriginEnd.current - loopDragOriginStart.current;
                      const ns   = Math.max(0, Math.min(1 - span, loopDragOriginStart.current + delta));
                      setLoopStart(ns); setLoopEnd(ns + span);
                    }
                    return;
                  }
                  if (isDraggingSeekRef.current) seek(frac * project.duration);
                }}
                onMouseUp={() => { isDraggingSeekRef.current = false; draggingLoopHandle.current = null; }}
                onMouseLeave={() => { isDraggingSeekRef.current = false; draggingLoopHandle.current = null; }}
                onTouchStart={(e) => {
                  if (!project) return;
                  isDraggingSeekRef.current = true;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const touch = e.touches[0];
                  seek(Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * project.duration);
                }}
                onTouchEnd={() => { isDraggingSeekRef.current = false; }}>
                {waveformPoints ? (
                  /* Waveform visualizer — polygon computed once, only clip rects update per frame */
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 28"
                    preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="wfGrad" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                      <clipPath id="wfPlayed">
                        <rect x="0" y="0" width={Math.max(0, pct * 10)} height="28" />
                      </clipPath>
                      <clipPath id="wfUnplayed">
                        <rect x={Math.max(0, pct * 10)} y="0" width={Math.max(0, 1000 - pct * 10)} height="28" />
                      </clipPath>
                    </defs>
                    {/* Unplayed portion — dim white */}
                    <polygon points={waveformPoints} fill="rgba(255,255,255,0.10)" clipPath="url(#wfUnplayed)" />
                    {/* Played portion — brand gradient */}
                    <polygon points={waveformPoints} fill="url(#wfGrad)" opacity="0.80" clipPath="url(#wfPlayed)" />
                  </svg>
                ) : (
                  /* Fallback plain bar when no track loaded */
                  <>
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-white/10 rounded-full" />
                    <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full" style={{ width: `${pct}%` }} />
                  </>
                )}
                {/* Playhead thumb */}
                <div className="absolute top-1/2 -translate-y-1/2 size-3 -ml-1.5 rounded-full bg-white shadow-lg"
                  style={{ left: `${pct}%` }} />

                {/* Section boundary tick marks on the waveform */}
                {trackAnalysis && project && trackAnalysis.sections.map((sec, i) => {
                  if (i === 0) return null; // skip start
                  const tickPct = (sec.startSec / project.duration) * 100;
                  const color =
                    sec.label === 'drop'      ? '#f59e0b' :
                    sec.label === 'chorus'    ? '#a855f7' :
                    sec.label === 'verse'     ? '#3b82f6' :
                    sec.label === 'breakdown' ? '#6366f1' : '#ffffff';
                  return (
                    <div key={i} className="absolute top-0 bottom-0 w-px opacity-70 pointer-events-none"
                      style={{ left: `${tickPct}%`, background: color }} />
                  );
                })}

                {/* Loop region overlay — rendered above waveform, below playhead */}
                {loopStart !== null && loopEnd !== null && (
                  <>
                    <div className="absolute top-0 bottom-0 pointer-events-none rounded-sm"
                      style={{
                        left:    `${loopStart * 100}%`,
                        width:   `${(loopEnd - loopStart) * 100}%`,
                        background: 'rgba(168,85,247,0.18)',
                        borderTop: '1.5px solid rgba(168,85,247,0.7)',
                        borderBottom: '1.5px solid rgba(168,85,247,0.7)',
                      }} />
                    {/* Start handle */}
                    <div className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-10"
                      style={{ left: `${loopStart * 100}%` }}>
                      <div className="w-1 h-5 rounded-full bg-purple-400 shadow-lg shadow-purple-500/40" />
                    </div>
                    {/* End handle */}
                    <div className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-10"
                      style={{ left: `${loopEnd * 100}%` }}>
                      <div className="w-1 h-5 rounded-full bg-purple-400 shadow-lg shadow-purple-500/40" />
                    </div>
                    {/* Duration label — only if region is wide enough */}
                    {(loopEnd - loopStart) > 0.12 && (
                      <div className="absolute pointer-events-none text-[9px] text-purple-300 font-medium"
                        style={{ left: `${(loopStart + loopEnd) / 2 * 100}%`, top: '50%', transform: 'translate(-50%, -50%)' }}>
                        {fmt((loopEnd - loopStart) * (project?.duration ?? 0))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Section jump chips — best 4 by energy score only */}
            {trackAnalysis && project && (() => {
              // Score each section: drops/choruses are worth most
              const scoredSections = trackAnalysis.sections
                .filter(s => ['drop','chorus','verse','breakdown'].includes(s.label))
                .map(s => ({
                  ...s,
                  score: s.energyScore * (
                    s.label === 'drop'   ? 2.0 :
                    s.label === 'chorus' ? 1.6 :
                    s.label === 'verse'  ? 1.0 : 0.7
                  ),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 4)
                .sort((a, b) => a.startSec - b.startSec); // restore time order

              if (scoredSections.length === 0) return null;
              const labelColor: Record<string, string> = {
                drop:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
                chorus:    'bg-purple-500/20 text-purple-300 border-purple-500/30',
                verse:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
                breakdown: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
              };
              return (
                <div className="flex items-center gap-1.5 flex-wrap px-1 mt-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-white/25 shrink-0">Jump</span>
                  {scoredSections.map((sec, i) => (
                    <button key={i} onClick={() => seek(sec.startSec)}
                      className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${labelColor[sec.label] ?? 'bg-white/10 text-white/50 border-white/10'} hover:opacity-80 transition-opacity whitespace-nowrap`}>
                      {sec.label} {fmt(sec.startSec)}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>}{/* end transport bar */}
        </div>
 
        {/* Controls panel — scrollable on mobile (sits below fixed canvas), fixed sidebar on desktop */}
        {!isFullscreen && (
        <div className="flex-1 min-h-0 overflow-y-auto border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col
                        lg:overflow-hidden lg:flex-none lg:w-[340px] xl:w-[360px]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <TabsList className="grid grid-cols-5 w-full bg-white/5 rounded-none border-b border-white/10 shrink-0 h-10
                                  sticky top-0 z-10 lg:relative lg:top-auto backdrop-blur-sm">
              <TabsTrigger value="style"   className="text-[10px] sm:text-xs">Style</TabsTrigger>
              <TabsTrigger value="motion"  className="text-[10px] sm:text-xs">Motion</TabsTrigger>
              <TabsTrigger value="color"   className="text-[10px] sm:text-xs">Color</TabsTrigger>
              <TabsTrigger value="export"  className="text-[10px] sm:text-xs">Export</TabsTrigger>
              <TabsTrigger value="exports" className="text-[10px] sm:text-xs">History</TabsTrigger>
            </TabsList>

            {/* Session expiry banner — shown when autosave silently failed */}
            {sessionExpired && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-400/20 text-xs text-amber-300">
                <AlertCircle className="size-3.5 shrink-0" />
                <span className="flex-1">Session expired — sign in to resume saving.</span>
                <Button
                  size="sm"
                  className="h-6 text-[11px] px-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/30"
                  onClick={() => setAuthModalOpen(true)}
                >
                  Sign in
                </Button>
              </div>
            )}
 
            {/* Tab content scroll container */}
            <div className="flex-1 overflow-y-auto min-h-0">
 
              {/* ── Style ───────────────────────────────────────── */}
              <TabsContent value="style" className="p-4 space-y-4 mt-0">

                {/* ── Recommendations (shown after analysis completes) ── */}
                {recommendations.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-purple-300 mb-2 flex items-center gap-1.5">
                      <span>✦</span> Recommended for this track
                      {trackAnalysis && (
                        <span className="ml-auto text-gray-500 normal-case tracking-normal">
                          {trackAnalysis.bpm} BPM · {trackAnalysis.mood}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {recommendations.map((rec) => {
                        const engineName = ENGINES.find(e => e.id === rec.engineId)?.name ?? rec.engineId;
                        return (
                          <button
                            key={rec.engineId}
                            title={rec.reason}
                            onClick={() => setEngine(rec.engineId)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                              engine === rec.engineId
                                ? 'bg-purple-500/30 border-purple-400/60 text-purple-100'
                                : 'bg-purple-500/10 border-purple-400/20 text-purple-300 hover:bg-purple-500/20'
                            }`}
                          >
                            {engineName}
                            <span className="text-[9px] opacity-60">★</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Track analysis info ── */}
                {trackAnalysis && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2.5">
                    {/* Stats row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="text-center">
                        <div className="text-lg font-bold tabular-nums text-white">{trackAnalysis.bpm}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">BPM</div>
                      </div>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <div className="text-sm font-semibold capitalize text-purple-300">{trackAnalysis.mood}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Mood</div>
                      </div>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <div className="text-sm font-semibold text-white">{trackAnalysis.sections.length}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Sections</div>
                      </div>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <div className="text-sm font-semibold text-white">{Math.round(trackAnalysis.avgEnergy * 100)}%</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Energy</div>
                      </div>
                    </div>

                    {/* Energy curve mini-visualizer */}
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Track intensity</div>
                      <div className="relative h-8 rounded overflow-hidden bg-black/20">
                        <svg width="100%" height="100%" viewBox="0 0 300 32" preserveAspectRatio="none"
                          className="absolute inset-0">
                          <defs>
                            <linearGradient id="ec" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#7C3AED" />
                              <stop offset="50%" stopColor="#EC4899" />
                              <stop offset="100%" stopColor="#06B6D4" />
                            </linearGradient>
                          </defs>
                          <polyline
                            fill="rgba(124,58,237,0.15)"
                            stroke="url(#ec)"
                            strokeWidth="1.5"
                            points={(() => {
                              const curve = trackAnalysis.energyCurve;
                              const step = Math.max(1, Math.floor(curve.length / 150));
                              const pts: string[] = ['0,32'];
                              for (let i = 0; i < curve.length; i += step) {
                                const x = (i / curve.length) * 300;
                                const y = 32 - curve[i] * 28;
                                pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                              }
                              pts.push('300,32');
                              return pts.join(' ');
                            })()}
                          />
                        </svg>
                        {/* Section markers */}
                        {trackAnalysis.sections.map((sec, i) => {
                          const totalDur = trackAnalysis.sections[trackAnalysis.sections.length - 1].endSec;
                          const x = (sec.startSec / totalDur) * 100;
                          const isHighEnergy = sec.label === 'drop' || sec.label === 'chorus';
                          return (
                            <div key={i} className="absolute top-0 bottom-0 w-px opacity-60"
                              style={{
                                left: `${x}%`,
                                background: isHighEnergy ? '#f59e0b' : sec.label === 'breakdown' ? '#3b82f6' : 'rgba(255,255,255,0.2)',
                              }}
                              title={sec.label}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-600">0:00</span>
                        <span className="text-[10px] text-gray-600">
                          {Math.floor(trackAnalysis.sections[trackAnalysis.sections.length - 1]?.endSec / 60)}:
                          {Math.floor(trackAnalysis.sections[trackAnalysis.sections.length - 1]?.endSec % 60).toString().padStart(2,'0')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {(['2D', '3D'] as const).map((group) => (
                  <div key={group} className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-2 px-1">
                      {group === '3D' ? '3D · Immersive' : 'Classic'}
                      {group === '3D' && <span className="px-1.5 py-0.5 text-[9px] rounded bg-purple-500/20 text-purple-200 border border-purple-400/30">NEW</span>}
                    </div>
                    {ENGINES.filter((e) => e.group === group).map((e) => (
                      <div key={e.id}>
                        <button onClick={() => setEngine(e.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all text-xs ${engine === e.id ? 'bg-white text-gray-900 border-white' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                          <div className="font-semibold flex items-center justify-between">
                            {e.name}
                            {VARIANTS[e.id] && <span className="text-[9px] opacity-40 font-normal">{VARIANTS[e.id]!.length} styles</span>}
                          </div>
                          <div className={`text-[11px] mt-0.5 ${engine === e.id ? 'text-gray-600' : 'text-gray-400'}`}>{e.description}</div>
                        </button>

                        {/* Variant chips — only shown when this engine is selected */}
                        {engine === e.id && VARIANTS[e.id] && (
                          <div className="mt-1.5 ml-1 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                            <div className="flex flex-wrap gap-1.5">
                              {VARIANTS[e.id]!.map((v) => {
                                const active = variant === v.id || (variant === '' && v === VARIANTS[e.id]![0]);
                                return (
                                  <button
                                    key={v.id}
                                    onClick={() => setVariant(v.id === VARIANTS[e.id]![0].id ? '' : v.id)}
                                    title={v.description}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                                      active
                                        ? 'bg-purple-500/25 border-purple-400/50 text-purple-200'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                                    }`}
                                  >
                                    {v.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1.5">
                              {VARIANTS[e.id]!.find(v => variant === v.id || (variant === '' && v === VARIANTS[e.id]![0]))?.description}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </TabsContent>
 
              {/* ── Motion ──────────────────────────────────────── */}
              <TabsContent value="motion" className="p-4 space-y-5 mt-0">
                <Slider label="Beat sensitivity" value={beatSensitivity} onChange={setBeatSensitivity} min={0} max={1} step={0.01} />
                <Slider label="Particle density" value={particleDensity} onChange={setParticleDensity} min={0} max={1} step={0.01} />
                <Slider label="Smoothing" value={smoothing} onChange={setSmoothing} min={0} max={0.95} step={0.01} />
                {engine === 'depth' && (
                  <div className="space-y-4 border-t border-white/10 pt-4">
                    <div className="text-[10px] uppercase tracking-wider text-purple-300">Depth Field</div>
                    <Slider label="Base travel speed" value={baseSpeed} onChange={setBaseSpeed} min={0} max={1} step={0.01} />
                    <p className="text-[11px] text-gray-500 -mt-3">Low = dreamy drift. High = constant rush.</p>
                    <Slider label="Beat responsiveness" value={beatResponse} onChange={setBeatResponse} min={0} max={1} step={0.01} />
                    <p className="text-[11px] text-gray-500 -mt-3">Controls warp surge on each beat. Sweet spot: 40–65%.</p>
                  </div>
                )}
                <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium">Performance mode</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Reduces detail for low-power devices.</div>
                  </div>
                  <input type="checkbox" checked={perfMode} onChange={(e) => setPerfMode(e.target.checked)} className="size-4 accent-purple-500" />
                </label>
                <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium">Show FPS counter</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Diagnostic overlay. Green = 50+, amber = 30+, red = struggling.</div>
                  </div>
                  <input type="checkbox" checked={showFps} onChange={(e) => setShowFps(e.target.checked)} className="size-4 accent-purple-500" />
                </label>
              </TabsContent>
 
              {/* ── Color ───────────────────────────────────────── */}
              <TabsContent value="color" className="p-4 space-y-2 mt-0">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-3">Palette</div>
                {PALETTES.map((p, i) => (
                  <button key={p.name} onClick={() => setPalette(i)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all ${palette === i ? 'bg-white/15 border-white/40' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                    <div className="flex gap-1">
                      {p.colors.map((c) => <span key={c} className="size-5 rounded" style={{ background: c }} />)}
                    </div>
                    <span className="text-xs flex-1 text-left">{p.name}</span>
                    {palette === i && <Check className="size-3.5 text-emerald-400" />}
                  </button>
                ))}

                {/* Custom palette */}
                <div className="pt-2 border-t border-white/10 mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Custom colours</div>
                  <div className="flex gap-2 items-center">
                    {([0,1,2] as const).map((slot) => (
                      <label key={slot} className="flex flex-col items-center gap-1 cursor-pointer">
                        <div className="size-9 rounded-lg border border-white/20 overflow-hidden relative"
                          style={{ background: PALETTES[palette].colors[slot] }}>
                          <input type="color"
                            value={PALETTES[palette].colors[slot]}
                            onChange={(e) => {
                              const newColors = [...PALETTES[palette].colors] as [string,string,string];
                              newColors[slot] = e.target.value;
                              PALETTES[palette] = { ...PALETTES[palette], colors: newColors };
                              // Persist custom colours to localStorage
                              try {
                                const saved = JSON.parse(localStorage.getItem('ma_custom_palettes') || '{}');
                                saved[palette] = newColors;
                                localStorage.setItem('ma_custom_palettes', JSON.stringify(saved));
                              } catch { /* ignore */ }
                              paletteRef.current = palette;
                              setPalette(palette);
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </div>
                        <span className="text-[9px] text-gray-500">{['Low','Mid','High'][slot]}</span>
                      </label>
                    ))}
                    <button onClick={() => {
                      const defaults: [string,string,string][] = [
                        ['#8b5cf6','#ec4899','#f59e0b'],
                        ['#06b6d4','#3b82f6','#8b5cf6'],
                        ['#10b981','#84cc16','#fbbf24'],
                        ['#ffffff','#9ca3af','#4b5563'],
                      ];
                      PALETTES[palette] = { name: PALETTES[palette].name, colors: defaults[palette % 4] };
                      // Clear persisted custom colours for this palette
                      try {
                        const saved = JSON.parse(localStorage.getItem('ma_custom_palettes') || '{}');
                        delete saved[palette];
                        Object.keys(saved).length > 0
                          ? localStorage.setItem('ma_custom_palettes', JSON.stringify(saved))
                          : localStorage.removeItem('ma_custom_palettes');
                      } catch { /* ignore */ }
                      setPalette(p => p);
                    }} className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 underline">
                      Reset
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">Click a swatch to pick a custom colour. Changes are saved automatically.</p>
                </div>
              </TabsContent>
 
              {/* ── Export (settings) ───────────────────────────── */}
              <TabsContent value="export" className="p-4 space-y-4 mt-0">
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${exportMode === 'server' ? 'bg-amber-500/10 border-amber-400/30 text-amber-300' : 'bg-white/5 border-white/10 text-gray-300'}`}>
                  {exportMode === 'webm' && <Monitor className="size-3 text-emerald-400 shrink-0" />}
                  {exportMode === 'mp4' && <Smartphone className="size-3 text-blue-400 shrink-0" />}
                  {exportMode === 'server' && <AlertCircle className="size-3 text-amber-400 shrink-0" />}
                  {exportModeLabel}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Aspect ratio</div>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    {ASPECTS.map((a) => (
                      <button key={a.id} onClick={() => setAspect(a.id)}
                        className={`p-2 rounded-lg border text-left ${aspect === a.id ? 'bg-white text-gray-900 border-white' : 'bg-white/5 border-white/15 hover:bg-white/10'}`}>
                        <div className="font-semibold text-xs">{a.label}</div>
                        <div className="text-[10px] opacity-70 hidden sm:block">{a.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Clip duration</div>
                  {loopStart !== null && loopEnd !== null ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/15 border border-purple-500/30">
                      <svg className="size-3 text-purple-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 8h12M10 5l3 3-3 3M6 5 3 8l3 3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-purple-300 font-medium">Loop region active</p>
                        <p className="text-[10px] text-purple-300/60">
                          {fmt(loopStart * (project?.duration ?? 0))} → {fmt(loopEnd * (project?.duration ?? 0))} · {fmt((loopEnd - loopStart) * (project?.duration ?? 0))}
                        </p>
                      </div>
                      <button onClick={() => { setLoopStart(null); setLoopEnd(null); }}
                        className="text-purple-400/60 hover:text-purple-300 transition-colors text-[10px]">Clear</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                      {(['full', 15, 30, 60] as const).map((d) => (
                        <button key={String(d)} onClick={() => setClipDuration(d)}
                          className={`py-1.5 rounded-lg border text-xs text-center ${clipDuration === d ? 'bg-white text-gray-900 border-white' : 'bg-white/5 border-white/15 hover:bg-white/10'}`}>
                          {d === 'full' ? 'Full' : `${d}s`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Quality</div>
                  <div className="space-y-1.5">
                    {PRESETS.map((p) => (
                      <button key={p.id} onClick={() => setPresetId(p.id)}
                        className={`w-full text-left p-2.5 rounded-lg border text-xs ${presetId === p.id ? 'bg-white/15 border-white/40 ring-1 ring-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-gray-400 text-[11px]">{p.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <Button disabled={!project || status !== 'ready' || exportMode === 'server'}
                  onClick={startExport}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50">
                  <FileVideo className="size-4 mr-2" /> Start export
                </Button>
                {project && status === 'ready' && (
                  <p className="text-[11px] text-gray-500 text-center">
                    {(() => {
                      const dur = clipDuration === 'full' ? Math.min(project.duration, 180) : (clipDuration as number);
                      const preset = PRESETS.find(p => p.id === presetId);
                      const lo = preset ? Math.round(dur * preset.w * preset.h * 0.000002) : 0;
                      const hi = lo * 2;
                      return `~${Math.ceil(dur)}s to record · approx ${lo}–${hi} MB`;
                    })()}
                  </p>
                )}
                {exportMode === 'server' && (
                  <p className="text-xs text-amber-400/80">Use Chrome or Firefox on desktop for recording.</p>
                )}

                {/* ── Project config backup ─────────────────────────── */}
                <div className="pt-2 border-t border-white/10 mt-1">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Project config</div>
                  <div className="flex gap-2">
                    <button onClick={exportProjectConfig}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 transition-colors">
                      <Download className="size-3" /> Save config
                    </button>
                    <button onClick={() => configFileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 transition-colors">
                      <Upload className="size-3" /> Load config
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1.5">Save and restore engine, palette &amp; motion settings as a JSON file.</p>
                </div>

                {/* ── Named presets ────────────────────────────── */}
                <div className="pt-2 border-t border-white/10 mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Saved presets</div>
                  {savedPresets.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-2">
                      {savedPresets.map((p) => (
                        <div key={p.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/8">
                          <span className="flex-1 text-[11px] text-gray-300 truncate">{p.name}</span>
                          <button onClick={() => loadPreset(p)} title="Load preset"
                            className="text-[10px] text-purple-400 hover:text-purple-300 px-1.5 py-0.5 rounded hover:bg-purple-500/10 transition-colors">
                            Load
                          </button>
                          <button onClick={() => deletePreset(p.name)} title="Delete preset"
                            className="text-gray-600 hover:text-red-400 transition-colors">
                            <Trash className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const name = window.prompt('Name this preset:', `${ENGINE_LABELS_SHORT[engine] ?? engine} ${new Date().toLocaleDateString()}`);
                      if (name?.trim()) saveCurrentPreset(name.trim());
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 transition-colors">
                    <Star className="size-3" /> Save current as preset
                  </button>
                  <p className="text-[10px] text-gray-600 mt-1.5">Presets save engine, variant, palette &amp; all motion settings.</p>
                </div>
              </TabsContent>
 
        {/* ── History tab ─────────────────────────────────── */}
              <TabsContent value="exports" className="p-4 mt-0">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-3">Export history</div>
                {exports.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileVideo className="size-8 text-gray-600 mb-3" />
                    <p className="text-xs text-gray-400">No exports yet</p>
                    <p className="text-[11px] text-gray-500 mt-1">Use the Export tab to render your first video</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {exports.map((j) => {
                      const ext = j.storagePath?.endsWith('.mp4') ? 'mp4'
                                : exportMode === 'mp4' ? 'mp4' : 'webm';
                      const isCloud = !j.url && !!j.storagePath;
                      return (
                        <div key={j.id} className="rounded-xl border bg-white/5 border-white/10 p-3">
                          <div className="flex items-start gap-2.5 mb-2">
                            <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                              <FileVideo className="size-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold truncate">{j.name}.{ext}</div>
                              <div className="text-[11px] text-gray-400">{j.preset} · {j.aspect}{j.size ? ` · ${(j.size / (1024 * 1024)).toFixed(1)} MB` : ''}</div>
                            </div>
                            {/* Delete button — always visible */}
                            {(j.status === 'done' || j.status === 'error') && (
                              <button
                                onClick={() => deleteExport(j.id, j.storageId)}
                                className="size-6 flex items-center justify-center rounded hover:bg-red-500/15 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                                title="Delete export"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                            {j.status !== 'done' && j.status !== 'error' && (
                              <Badge className="bg-amber-500/20 border-amber-400/30 text-amber-200 capitalize text-[10px]">{j.status}</Badge>
                            )}
                          </div>
                          {j.status !== 'done' && j.status !== 'error' && (
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2">
                              <div className="h-full bg-gradient-to-r from-purple-400 to-pink-400 transition-all" style={{ width: `${j.progress}%` }} />
                            </div>
                          )}
                          {(j.status === 'recording' || j.status === 'finalizing') && (
                            <Button size="sm" variant="outline"
                              className="w-full h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 mb-2"
                            onClick={() => {
                                exportCancelRef.current = true;
                                if (exportIntervalRef.current) {
                                  clearInterval(exportIntervalRef.current);
                                  exportIntervalRef.current = null;
                                }
                                recorderRef.current?.stop();
                              }}>
                              Cancel export
                            </Button>
                          )}
                          {j.status === 'error' && j.errorMsg && (
                            <div className="text-[11px] text-red-400 flex items-center gap-1 mb-2">
                              <CloudOff className="size-3 shrink-0" /> {j.errorMsg}
                            </div>
                          )}
                          {j.status === 'done' && (
                            <div className="flex gap-2">
                              {j.url ? (
                                /* Local blob — download + optional cloud download if also synced */
                                <>
                                  <a href={j.url} download={`${j.name}.${ext}`} className="flex-1">
                                    <Button size="sm" className="w-full bg-white text-gray-900 hover:bg-gray-100 h-7 text-xs">
                                      <Download className="size-3 mr-1" /> Download
                                    </Button>
                                  </a>
                                  {j.storagePath && (
                                    <Button size="sm" variant="outline"
                                      className="border-white/20 text-white hover:bg-white/10 h-7 text-xs"
                                      title="Open shareable page (link valid 7 days)"
                                      onClick={async () => {
                                        const url = await getExportSignedUrl(j.storagePath!, 604800); // 7 days
                                        if (url) {
                                          const params = new URLSearchParams({
                                            v: url,
                                            n: project?.fileName?.replace(/\.[^.]+$/, '') ?? 'Track',
                                            e: engine,
                                            a: j.aspect ?? aspect,
                                          });
                                          window.open(`/share?${params}`, '_blank');
                                        }
                                      }}>
                                      <Share2 className="size-3 mr-1" /> Share
                                    </Button>
                                  )}
                                </>
                              ) : isCloud ? (
                                /* Cloud-stored export — re-generate signed URL */
                                <Button size="sm"
                                  className="flex-1 bg-white/10 hover:bg-white/15 text-white h-7 text-xs border border-white/20"
                                  onClick={() => downloadCloudExport(j)}>
                                  <Cloud className="size-3 mr-1" /> Download from cloud
                                </Button>
                              ) : (
                                <span className="text-[11px] text-gray-500 flex items-center gap-1">
                                  <CloudOff className="size-3" /> No file available
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

            </div>{/* closes flex-1 overflow-y-auto */}
          </Tabs>
        </div>
        )}{/* end !isFullscreen */}
        </div>
      {/* Hidden file inputs */}
      <input ref={configFileInputRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importProjectConfig(f);
          e.target.value = '';
        }} />
      <AuthModal open={authModalOpen} onClose={() => { setAuthModalOpen(false); clearExpiredFlag(); }} />
    </div>
  );
}

      

// ─── Slider helper component ─────────────────────────────────────────────────
function Slider({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">{label}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
      <div className="text-xs text-gray-400 mt-1">{Math.round(value * 100)}%</div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { drawEngine } from '../engines';
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
  storageId?: string;
  storagePath?: string;
  name: string;
  trackName?: string;
  engineId?: EngineId;
  preset: string;
  aspect: string;
  status: 'recording' | 'finalizing' | 'done' | 'downloading' | 'error';
  progress: number;
  url?: string;
  blob?: Blob;
  size?: number;
  thumbnail?: string;
  errorMsg?: string;
};

// Engine types + draw dispatcher live in ./engines (Track 0 extraction)
import type { Star as StarParticle, Spark, Sphere, Planet, OrbitBody, GridDot, Shockwave } from '../engines/types';

// ─── Constants ───────────────────────────────────────────────────────────────
const ENGINES: { id: EngineId; name: string; description: string; group: '2D' | '3D' }[] = [
  { id: 'bars',        name: 'Spectrum Bars',        description: 'Classic frequency bars across the canvas.',              group: '2D' },
  { id: 'radial',      name: 'Radial Spectrum',       description: 'Bars radiating from the center.',                       group: '2D' },
  { id: 'orbital',     name: 'Orbital Rings',         description: 'Concentric rings tilt and pulse around a glowing core.', group: '3D' },
  { id: 'depth',       name: 'Depth Field Particles', description: 'Cinematic starfield that surges on every beat.',        group: '3D' },
  { id: 'terrain',     name: 'Audio Terrain',         description: 'Wireframe landscape that reacts to every frequency.',  group: '3D' },
  { id: 'tunnel',      name: 'Liquid Aurora',         description: 'Flowing colour curtains that ripple with every frequency.',  group: '3D' },
  { id: 'neon_spheres',name: 'Resonance Field',        description: 'Frequency-reactive 3D lattice — strings glow with tension.',  group: '3D' },
  { id: 'fractal',     name: 'Fractal Kaleidoscope',  description: 'Mirrored tiling pattern; rotation tied to energy.',    group: '3D' },
  { id: 'solar',       name: 'Geometric Pulse',       description: 'Concentric beat rings expand and shatter on every drop.', group: '3D' },
];

// ── Short engine name lookup for preset naming ─────────────────────────────
const ENGINE_LABELS_SHORT: Record<string, string> = {
  bars: 'Bars', radial: 'Radial', orbital: 'Orbital', depth: 'Depth',
  terrain: 'Terrain', tunnel: 'Aurora', neon_spheres: 'Field', fractal: 'Fractal', solar: 'Pulse',
};

// ENGINE_COLORS uses inline CSS values (not Tailwind classes) to avoid purging in production
const ENGINE_COLORS: Record<string, { bg: string; border: string; text: string; chip: string; chipBorder: string; chipText: string }> = {
  bars:         { bg: 'rgba(6,182,212,0.15)',   border: 'rgba(34,211,238,0.50)',   text: '#67e8f9', chip: 'rgba(6,182,212,0.20)',   chipBorder: 'rgba(34,211,238,0.40)',   chipText: '#a5f3fc' },
  radial:       { bg: 'rgba(139,92,246,0.15)',  border: 'rgba(167,139,250,0.50)',  text: '#c4b5fd', chip: 'rgba(139,92,246,0.20)',  chipBorder: 'rgba(167,139,250,0.40)',  chipText: '#ddd6fe' },
  orbital:      { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(96,165,250,0.50)',   text: '#93c5fd', chip: 'rgba(59,130,246,0.20)',  chipBorder: 'rgba(96,165,250,0.40)',   chipText: '#bfdbfe' },
  depth:        { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(129,140,248,0.50)',  text: '#a5b4fc', chip: 'rgba(99,102,241,0.20)',  chipBorder: 'rgba(129,140,248,0.40)',  chipText: '#c7d2fe' },
  terrain:      { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(52,211,153,0.50)',   text: '#6ee7b7', chip: 'rgba(16,185,129,0.20)',  chipBorder: 'rgba(52,211,153,0.40)',   chipText: '#a7f3d0' },
  tunnel:       { bg: 'rgba(20,184,166,0.15)',  border: 'rgba(45,212,191,0.50)',   text: '#5eead4', chip: 'rgba(20,184,166,0.20)',  chipBorder: 'rgba(45,212,191,0.40)',   chipText: '#99f6e4' },
  neon_spheres: { bg: 'rgba(20,184,166,0.15)',  border: 'rgba(45,212,191,0.50)',   text: '#5eead4', chip: 'rgba(20,184,166,0.20)',  chipBorder: 'rgba(45,212,191,0.40)',   chipText: '#99f6e4' },
  fractal:      { bg: 'rgba(217,70,239,0.15)',  border: 'rgba(232,121,249,0.50)',  text: '#f0abfc', chip: 'rgba(217,70,239,0.20)',  chipBorder: 'rgba(232,121,249,0.40)',  chipText: '#f5d0fe' },
  solar:        { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(251,191,36,0.50)',   text: '#fcd34d', chip: 'rgba(245,158,11,0.20)',  chipBorder: 'rgba(251,191,36,0.40)',   chipText: '#fde68a' },
};

// ── Per-engine optimal motion defaults ────────────────────────────────────────
type MotionDefaults = { beatSensitivity: number; particleDensity: number; smoothing: number; baseSpeed: number; beatResponse: number };
const ENGINE_MOTION_DEFAULTS: Record<string, MotionDefaults> = {
  bars:         { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  radial:       { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  orbital:      { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  depth:        { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  terrain:      { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  tunnel:       { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  neon_spheres: { beatSensitivity: 0.95, particleDensity: 0.97, smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  fractal:      { beatSensitivity: 0.95, particleDensity: 1.0,  smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
  solar:        { beatSensitivity: 0.95, particleDensity: 0.95, smoothing: 0.82, baseSpeed: 1.0, beatResponse: 0.90 },
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
    { id: 'orbit', label: 'Orbit', description: 'Luminous bodies trace tilted orbits, leaving comet trails (default)' },
    { id: 'helix', label: 'Helix', description: 'Stacked rings twist into a DNA double helix' },
  ],
  tunnel: [
    { id: 'curtains', label: 'Curtains', description: 'Vertical curtains of light sway and drape (default)' },
    { id: 'ribbons',  label: 'Ribbons',  description: 'Horizontal flowing light bands wave across the screen' },
  ],
  solar: [
    { id: 'radial', label: 'Radial',  description: 'Shockwaves ripple through concentric dot rings (default)' },
    { id: 'square', label: 'Grid',    description: 'Shockwaves ripple through a square dot grid' },
  ],
  terrain: [
    { id: 'wireframe', label: 'Wireframe', description: 'Mesh grid lines (default)' },
    { id: 'solid',     label: 'Solid',     description: 'Filled terrain with coloured horizon' },
    { id: 'grid',      label: 'Grid',      description: 'Top-down frequency grid — cells pulse per band' },
    { id: 'ocean',     label: 'Ocean',     description: 'Rolling fluid waves — amplitude tied to bass' },
  ],
  neon_spheres: [
    { id: 'constellation', label: 'Constellation', description: 'Particles drift freely, connecting into a living web (default)' },
    { id: 'orbits',        label: 'Orbits',        description: 'Particles travel in concentric circular currents' },
  ],
  fractal: [
    { id: 'kaleido', label: 'Kaleidoscope', description: 'True mirror symmetry across wedges (default)' },
    { id: 'tree',    label: 'Recursive Tree', description: 'Fractal branches grow & pulse from the centre' },
    { id: 'spiro',   label: 'Spirograph', description: 'Layered harmonograph rose curves morph with the music' },
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
  const [beatSensitivity, setBeatSensitivity] = useState(stored?.motion.beatSensitivity ?? 0.95);
  const [particleDensity, setParticleDensity] = useState(stored?.motion.particleDensity ?? 0.6);
  const [smoothing, setSmoothing]             = useState(stored?.motion.smoothing ?? ENGINE_MOTION_DEFAULTS[initialEngine]?.smoothing ?? 0.82);
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
  const starsRef   = useRef<StarParticle[]>([]);
  const sparksRef  = useRef<Spark[]>([]);
  const spheresRef = useRef<Sphere[]>([]);
  const planetsRef = useRef<Planet[]>([]);
  const tunnelTRef = useRef(0);
  const cameraTRef = useRef(0);
  const solarTRef  = useRef(0);
  const orbitBodiesRef = useRef<OrbitBody[]>([]);
  const gridDotsRef   = useRef<GridDot[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const gridKeyRef    = useRef<string>('');
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
    // ── Render the selected engine (extracted to ./engines) ───────────────
    // Fill the time-domain buffer here (Studio owns the analyser); bars uses it.
    if (!tdBufRef.current || tdBufRef.current.length !== analyser.frequencyBinCount * 2) {
      tdBufRef.current = new Uint8Array(analyser.frequencyBinCount * 2);
    }
    analyser.getByteTimeDomainData(tdBufRef.current);

    drawEngine(eng, {
      ctx, w, h, freq, tdBuf: tdBufRef.current,
      vrnt, sens, perf, bSpeed, bResp, liveColors, hxCache,
      energyMult, sectionIntensity, sectionProgress, currentEnergy,
      particleDensity: particleDensRef.current,
      spheresRef, starsRef, planetsRef, cameraTRef, tunnelTRef, solarTRef,
      prevBassRef, smoothedBurstRef, gridDotsRef, shockwavesRef, gridKeyRef,
      orbitBodiesRef, tdBufRef, particleDensRef,
    });

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
          trackName: track.filename.replace(/\.[^.]+$/, ''),
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
      trackName,
      engineId: engine,
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

  // Detect requestFrame directly on the real canvas stream — no throwaway canvas needed.
    // captureStream(0) gives manual control; we check if the track supports requestFrame.
    // If not (Firefox/Safari), stop it and recreate at target fps for the timed fallback.
    const canvasStream = canvasRef.current!.captureStream(0);
    const videoTrack = canvasStream.getVideoTracks()[0] as any;
    const supportsRequestFrame = typeof videoTrack?.requestFrame === 'function';

    const finalStream = supportsRequestFrame
      ? canvasStream
      : (() => {
          canvasStream.getVideoTracks().forEach(t => t.stop());
          return canvasRef.current!.captureStream(preset.fps);
        })();
    const mixed = new MediaStream([...finalStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

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

      // PATCH 3: capture poster frame BEFORE resizing canvas back to preview
      let posterDataUrl: string | undefined;
      try { posterDataUrl = exportCanvas.toDataURL('image/jpeg', 0.55); } catch { /* cross-origin — skip */ }

      // Restore canvas to preview resolution after successful export
      exportCanvas.width = prevCanvasW; exportCanvas.height = prevCanvasH;
      perfModeRef.current = prevPerfMode;
      const blob = new Blob(chunks, { type });
      const url  = URL.createObjectURL(blob);

      setExports((x) =>
        x.map((j) =>
          j.id === job.id ? { ...j, status: 'done', progress: 100, url, blob, size: blob.size, thumbnail: posterDataUrl } : j
        )
      );
      // Auto-switch to History tab so user immediately sees the download button
      setActiveTab('exports');
      // Brief ring-flash on History tab to confirm export completion
      setTimeout(() => {
        const el = document.querySelector('[data-value="exports"]');
        if (el) { el.classList.add('ring-1', 'ring-emerald-400/60'); setTimeout(() => el.classList.remove('ring-1','ring-emerald-400/60'), 1800); }
      }, 120);

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
        (finalStream.getVideoTracks()[0] as any).requestFrame();

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
    setExports((x) => x.map((j) => j.id === job.id ? { ...j, status: 'downloading' } : j));
    const url = await getExportSignedUrl(job.storagePath, 3600);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      const ext = job.storagePath.endsWith('.mp4') ? 'mp4' : 'webm';
      a.download = `${job.trackName ?? job.name}.${ext}`;
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
              {project ? (
                <span>
                  {fmt(project.duration)} · <span style={{ color: ENGINE_COLORS[engine]?.text ?? '#9ca3af' }}>{ENGINES.find((e) => e.id === engine)!.name}</span>
                </span>
              ) : 'No track loaded'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Button variant="ghost" onClick={randomize} title="Randomize engine, style & palette"
            className="border border-white/15 text-gray-300 hover:bg-white/10 shrink-0 h-8 w-8 p-0">
            <Shuffle className="size-3.5" />
          </Button>
          <Button variant="ghost" onClick={onPickFile}
            className="border border-white/15 text-gray-200 hover:bg-white/10 shrink-0 h-8 w-8 sm:w-auto sm:px-3 text-xs p-0 sm:p-auto">
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
                 // Mobile: use dvh so the canvas fills real visible viewport (avoids address bar cutoff)
                 // 9:16 (hero format) gets 78% — immersive portrait preview, still leaves room for transport
                 // 1:1  gets natural square via vw cap
                 // 16:9 gets a wide bar
                 aspect === '9:16' ? 'min(78dvh, 78vh, 560px)'
                 : aspect === '1:1' ? 'min(88vw, 420px)'
                 : 'min(96vw, 520px)'
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
                  className="absolute inset-0 z-10 bg-black/85 flex flex-col items-center justify-center gap-4 px-6">
                  {/* Animated waveform bars skeleton */}
                  <div className="flex items-end gap-1 h-10">
                    {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 1.0, 0.5].map((h, i) => (
                      <div key={i} className="w-1.5 rounded-full bg-purple-400/60 animate-pulse"
                        style={{ height: `${h * 100}%`, animationDelay: `${i * 80}ms` }} />
                    ))}
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold text-white">Analyzing audio</div>
                    <div className="text-[11px] text-gray-400 mt-1">Detecting BPM, mood, and drop points…</div>
                  </div>
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
                  activeSectionLabel === 'drop'      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/25' :
                  activeSectionLabel === 'chorus'    ? 'bg-violet-500/25 text-violet-200 border border-violet-400/25' :
                  activeSectionLabel === 'breakdown' ? 'bg-blue-500/20 text-blue-200 border border-blue-400/20' :
                  activeSectionLabel === 'verse'     ? 'bg-white/10 text-white/60 border border-white/10' :
                  'bg-white/8 text-white/40 border border-white/8'
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
                        <stop offset="0%" stopColor="#D8FF3E" />
                        <stop offset="100%" stopColor="#C2E82B" />
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
                    sec.label === 'chorus'    ? '#D8FF3E' :
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
                        background: 'rgba(216,255,62,0.16)',
                        borderTop: '1.5px solid rgba(216,255,62,0.7)',
                        borderBottom: '1.5px solid rgba(216,255,62,0.7)',
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
                          {trackAnalysis.bpm} BPM · <span className={`capitalize font-medium ${
                            trackAnalysis.mood === 'energetic' || trackAnalysis.mood === 'powerful' ? 'text-amber-300' :
                            trackAnalysis.mood === 'melancholic' || trackAnalysis.mood === 'dreamy' ? 'text-blue-300' :
                            trackAnalysis.mood === 'dark' ? 'text-red-400' :
                            trackAnalysis.mood === 'euphoric' || trackAnalysis.mood === 'uplifting' ? 'text-emerald-300' :
                            'text-purple-300'
                          }`}>{trackAnalysis.mood}</span>
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
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all hover:opacity-90"
                            style={engine === rec.engineId
                              ? { background: ENGINE_COLORS[rec.engineId]?.bg ?? 'rgba(216,255,62,0.16)', borderColor: ENGINE_COLORS[rec.engineId]?.border ?? 'rgba(216,255,62,0.45)', color: ENGINE_COLORS[rec.engineId]?.text ?? '#D8FF3E' }
                              : { background: ENGINE_COLORS[rec.engineId]?.chip ?? 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)', color: ENGINE_COLORS[rec.engineId]?.chipText ?? '#cbd5e1' }}
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
                          className="w-full text-left px-3 py-2.5 rounded-lg border transition-all text-xs"
                          style={engine === e.id
                            ? { background: ENGINE_COLORS[e.id]?.bg ?? 'rgba(255,255,255,0.10)', borderColor: ENGINE_COLORS[e.id]?.border ?? 'rgba(255,255,255,0.40)' }
                            : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.10)' }}>
                          <div className="font-semibold flex items-center justify-between"
                            style={{ color: engine === e.id ? (ENGINE_COLORS[e.id]?.text ?? '#ffffff') : '#ffffff' }}>
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
                                    className="px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all"
                                    style={active
                                      ? { background: ENGINE_COLORS[e.id]?.chip ?? 'rgba(216,255,62,0.16)', borderColor: ENGINE_COLORS[e.id]?.chipBorder ?? 'rgba(216,255,62,0.45)', color: ENGINE_COLORS[e.id]?.chipText ?? '#D8FF3E' }
                                      : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.10)', color: '#9ca3af' }}
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
                        className="p-2 rounded-lg border text-left transition-colors"
                        style={aspect === a.id
                          ? { background: ENGINE_COLORS[engine]?.bg ?? 'rgba(255,255,255,0.10)', borderColor: ENGINE_COLORS[engine]?.border ?? 'rgba(255,255,255,0.40)' }
                          : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.15)' }}>
                        <div className="font-semibold text-xs" style={{ color: aspect === a.id ? (ENGINE_COLORS[engine]?.text ?? '#ffffff') : '#ffffff' }}>{a.label}</div>
                        <div className="text-[9px] sm:text-[10px] leading-tight break-words" style={{ opacity: aspect === a.id ? 0.75 : 0.55 }}>{a.sub}</div>
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
                        className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${presetId === p.id ? 'bg-white/15 border-white/40 ring-1 ring-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Zap className={`size-3 shrink-0 ${p.id === 'pro' ? 'text-amber-400' : p.id === 'std' ? 'text-purple-400' : 'text-emerald-400'}`} />
                            <span className="font-semibold">{p.name}</span>
                            {p.id === 'std' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/25 text-purple-300 font-bold tracking-wide">Recommended</span>}
                          </div>
                          {presetId === p.id && <Check className="size-3 text-white shrink-0" />}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-gray-400 text-[11px]">{p.label}</span>
                          <span className="text-gray-500 text-[10px]">
                            ~{Math.round(((p.id === 'pro' ? 30_000_000 : p.id === 'std' ? 15_000_000 : 6_000_000) * Math.min(project?.duration ?? 30, clipDuration === 'full' ? (project?.duration ?? 30) : (clipDuration as number))) / 8 / 1024 / 1024 + 0.04 * Math.min(project?.duration ?? 30, clipDuration === 'full' ? (project?.duration ?? 30) : (clipDuration as number)) / 1024 / 1024)}MB
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <Button disabled={!project || status !== 'ready' || exportMode === 'server'}
                  onClick={startExport}
                  className="w-full h-11 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 shadow-lg shadow-purple-900/40">
                  <FileVideo className="size-4 mr-2" />
                  {aspect === '9:16' ? 'Export for TikTok / Reels' : aspect === '1:1' ? 'Export for Instagram' : 'Export for YouTube'}
                </Button>
                {project && status === 'ready' && (() => {
                  const dur = clipDuration === 'full' ? Math.min(project.duration, 180) : (clipDuration as number);
                  const rec = Math.round(dur);
                  const ready = Math.round(dur * 1.2);
                  return (
                    <p className="text-[10px] text-center text-gray-500 mt-1">Records {rec}s · ready in ~{ready}s</p>
                  );
                })()}
                
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
              <TabsContent value="exports" className="mt-0">
                {/* ── Empty state ── */}
                {exports.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center px-6">
                    <div className="size-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                      <FileVideo className="size-5 text-gray-400" />
                    </div>
                    <div className="text-sm font-semibold text-white/80 mb-1">No exports yet</div>
                    <div className="text-xs text-gray-500 max-w-[200px] mb-4">Exports appear here so you can download or share them any time.</div>
                    <button onClick={() => setActiveTab('export')}
                      className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1">
                      Go to Export <span aria-hidden>→</span>
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {[...exports].reverse().map((job) => {
                      const aspectW = job.aspect === '9:16' ? 'w-10' : job.aspect === '1:1' ? 'w-14' : 'w-20';
                      const isActive = job.status === 'recording' || job.status === 'finalizing';
                      const isDownloading = job.status === 'downloading';
                      const isError = job.status === 'error';
                      const engineLabel = job.engineId ? (ENGINE_LABELS_SHORT[job.engineId] ?? job.engineId) : null;
                      const platformLabel = job.aspect === '9:16' ? 'TikTok / Reels' : job.aspect === '1:1' ? 'Instagram' : 'YouTube';
                      const fileSizeMB = job.size ? (job.size / 1024 / 1024).toFixed(1) : null;
                      const ext = job.storagePath?.endsWith('.mp4') ? 'mp4' : job.url?.includes('mp4') ? 'mp4' : 'webm';
                      return (
                        <div key={job.id} className="group flex gap-3 p-3.5 hover:bg-white/[0.03] transition-colors">
                          {/* Thumbnail */}
                          <div className={`relative ${aspectW} shrink-0 rounded-lg overflow-hidden bg-white/5 border border-white/10 self-start`}
                            style={{ aspectRatio: job.aspect === '9:16' ? '9/16' : job.aspect === '1:1' ? '1/1' : '16/9' }}>
                            {job.thumbnail ? (
                              <img src={job.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <FileVideo className="size-3 text-gray-600" />
                              </div>
                            )}
                            {/* Aspect badge */}
                            <div className="absolute bottom-0.5 left-0.5">
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-black/70 text-white/70">{job.aspect}</span>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-[12px] text-white truncate mb-0.5">
                              {job.trackName ?? job.name}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                              {engineLabel && (
                                <span className="text-[10px] text-gray-400">{engineLabel}</span>
                              )}
                              {engineLabel && <span className="text-[10px] text-gray-600">·</span>}
                              <span className="text-[10px] text-gray-400">{platformLabel}</span>
                              <span className="text-[10px] text-gray-600">·</span>
                              <span className="text-[10px] text-gray-500">{job.preset}</span>
                              {fileSizeMB && (
                                <>
                                  <span className="text-[10px] text-gray-600">·</span>
                                  <span className="text-[10px] text-gray-500">{fileSizeMB} MB · .{ext}</span>
                                </>
                              )}
                            </div>

                            {/* Progress */}
                            {isActive && (
                              <div className="mb-2">
                                <div className="h-2.5 bg-white/10 rounded-full overflow-hidden mb-1.5">
                                  <div className="export-progress-shimmer h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${job.progress}%`,
                                      background: '#D8FF3E',
                                    }} />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-medium text-gray-300">
                                    {job.status === 'finalizing' ? 'Finalizing…' : `Recording · ${Math.round(job.progress)}%`}
                                  </span>
                                  <button onClick={() => {
                                    exportCancelRef.current = true;
                                    recorderRef.current?.stop();
                                  }} className="flex items-center gap-1 text-[10px] font-medium text-gray-300 px-2 py-1 rounded-md border border-white/15 bg-white/5 hover:bg-red-500/15 hover:border-red-400/40 hover:text-red-300 transition-colors shrink-0">
                                    <X className="size-2.5" /> Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Error state */}
                            {isError && (
                              <div className="flex items-start gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/20 mb-2">
                                <AlertCircle className="size-3 text-red-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-red-300 leading-tight">{job.errorMsg || 'Export failed'}</span>
                              </div>
                            )}

                            {/* Actions */}
                            {job.status === 'done' && (
                              <div className="flex items-center gap-2">
                                {job.url ? (
                                  <a href={job.url} download={`${job.trackName ?? job.name}.${ext}`}
                                    className="flex items-center gap-1 text-[11px] font-medium text-purple-400 hover:text-purple-300 transition-colors">
                                    <Download className="size-3" /> Download
                                  </a>
                                ) : job.storagePath ? (
                                  <button onClick={() => downloadCloudExport(job)}
                                    disabled={isDownloading}
                                    className="flex items-center gap-1 text-[11px] font-medium text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50">
                                    {isDownloading ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
                                    {isDownloading ? 'Downloading…' : 'Download'}
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-gray-600 flex items-center gap-1">
                                    <CloudOff className="size-3" /> File expired
                                  </span>
                                )}
                                {job.url && typeof navigator.share !== 'undefined' && (
                                  <button onClick={async () => {
                                    if (!job.blob) return;
                                    try {
                                      const file = new File([job.blob], `${job.trackName ?? job.name}.${ext}`, { type: job.blob.type });
                                      if (navigator.canShare?.({ files: [file] })) {
                                        await navigator.share({ files: [file] });
                                      }
                                    } catch {}
                                  }} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 transition-colors">
                                    <Share2 className="size-3" /> Share
                                  </button>
                                )}
                              </div>
                            )}
                            {isDownloading && (
                              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                                <Loader2 className="size-3 animate-spin" /> Downloading from cloud…
                              </div>
                            )}
                          </div>

                          {/* Delete button */}
                          <button onClick={() => deleteExport(job.id, job.storageId)}
                            className="shrink-0 size-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 self-start mt-0.5"
                            title="Delete">
                            <Trash2 className="size-3" />
                          </button>
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
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-gray-400">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-gray-200">{Math.round(value * 100)}%</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}

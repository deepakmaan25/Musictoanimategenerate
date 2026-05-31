// ─── engineRecommendations.ts ─────────────────────────────────────────────────
import type { MoodLabel } from './audioAnalysis';

export type EngineId =
  | 'bars' | 'radial' | 'orbital' | 'depth'
  | 'terrain' | 'tunnel' | 'neon_spheres' | 'fractal' | 'solar';

export interface EngineRecommendation {
  engineId: EngineId;
  score: number;   // 0–1 normalised
  reason: string;
}

// ─── Mood base scores ─────────────────────────────────────────────────────────
// Deliberately spread to create clear winners per mood
const MOOD_SCORES: Record<EngineId, Record<MoodLabel, number>> = {
  tunnel:       { aggressive: 0.95, euphoric: 0.65, calm: 0.15, dark: 0.70, bright: 0.45 },
  depth:        { aggressive: 0.60, euphoric: 0.85, calm: 0.65, dark: 0.75, bright: 0.75 },
  fractal:      { aggressive: 0.85, euphoric: 0.75, calm: 0.30, dark: 0.95, bright: 0.55 },
  radial:       { aggressive: 0.90, euphoric: 0.65, calm: 0.25, dark: 0.45, bright: 0.65 },
  neon_spheres: { aggressive: 0.45, euphoric: 0.95, calm: 0.55, dark: 0.50, bright: 0.95 },
  bars:         { aggressive: 0.75, euphoric: 0.55, calm: 0.45, dark: 0.45, bright: 0.70 },
  orbital:      { aggressive: 0.40, euphoric: 0.65, calm: 0.95, dark: 0.75, bright: 0.55 },
  terrain:      { aggressive: 0.35, euphoric: 0.40, calm: 0.90, dark: 0.85, bright: 0.40 },
  solar:        { aggressive: 0.85, euphoric: 0.70, calm: 0.40, dark: 0.60, bright: 0.75 },
};

// ─── BPM bonuses — large enough to actually change the ranking ────────────────
const BPM_HIGH = 128;  // >128 = fast
const BPM_LOW  = 90;   // <90 = slow
const BPM_MID_LO = 90, BPM_MID_HI = 128; // 90-128 = mid

const BPM_BONUS: Partial<Record<EngineId, {
  highBPM?: number; midBPM?: number; lowBPM?: number
}>> = {
  tunnel:       { highBPM: 0.35 },
  radial:       { highBPM: 0.28 },
  fractal:      { highBPM: 0.22 },
  bars:         { highBPM: 0.18, midBPM: 0.10 },
  depth:        { midBPM: 0.20 },
  neon_spheres: { midBPM: 0.18 },
  terrain:      { lowBPM: 0.32 },
  solar:        { lowBPM: 0.28 },
  orbital:      { lowBPM: 0.22 },
};

// ─── Energy bonuses ───────────────────────────────────────────────────────────
// High avgEnergy → reactive engines; Low avgEnergy → ambient engines
const HIGH_ENERGY_BONUS: Partial<Record<EngineId, number>> = {
  tunnel: 0.15, radial: 0.12, bars: 0.10, fractal: 0.08,
};
const LOW_ENERGY_BONUS: Partial<Record<EngineId, number>> = {
  terrain: 0.15, solar: 0.12, orbital: 0.10, depth: 0.08,
};

// ─── Spectral centroid bonuses ───────────────────────────────────────────────
// High centroid = bright/treble-heavy → engines with fine detail read better
const HIGH_CENTROID_BONUS: Partial<Record<EngineId, number>> = {
  neon_spheres: 0.12, fractal: 0.10, depth: 0.08,
};
const LOW_CENTROID_BONUS: Partial<Record<EngineId, number>> = {
  terrain: 0.12, tunnel: 0.08, bars: 0.08,
};

// ─── Reason strings ───────────────────────────────────────────────────────────
function buildReason(
  id: EngineId, mood: MoodLabel, bpm: number,
  avgEnergy: number, spectralCentroid: number,
): string {
  const bpmStr = bpm > BPM_HIGH ? `${bpm} BPM (fast)` : bpm < BPM_LOW ? `${bpm} BPM (slow)` : `${bpm} BPM`;
  const energyStr = avgEnergy > 0.65 ? 'high energy' : avgEnergy < 0.35 ? 'soft energy' : 'mid energy';
  const notes: Record<EngineId, string> = {
    tunnel:       'tunnel depth amplifies fast, driving tracks',
    depth:        'starfield rushes with every beat transient',
    fractal:      'kaleidoscope complexity suits dark, layered music',
    radial:       'radial bursts fire sharply on percussive hits',
    neon_spheres: 'spheres bounce and glow with melodic movement',
    bars:         'spectrum bars reveal every frequency in the mix',
    orbital:      'orbital motion flows well with sustained ambient sound',
    terrain:      'terrain waves rise with bass and rhythm slowly',
    solar:        'geometric ring bursts fire hard on every drop and beat',
  };
  return `${mood} mood · ${bpmStr} · ${energyStr} — ${notes[id]}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function recommendEngines(
  mood: MoodLabel,
  bpm: number,
  topN = 3,
  avgEnergy = 0.5,
  spectralCentroid = 0.5,
): EngineRecommendation[] {
  const engines = Object.keys(MOOD_SCORES) as EngineId[];

  const raw = engines.map((id) => {
    let score = MOOD_SCORES[id][mood];

    // BPM — these bonuses are large enough to flip rankings
    const bpmBonus = BPM_BONUS[id];
    if (bpmBonus) {
      if (bpmBonus.highBPM && bpm > BPM_HIGH) score += bpmBonus.highBPM;
      if (bpmBonus.lowBPM  && bpm < BPM_LOW)  score += bpmBonus.lowBPM;
      if (bpmBonus.midBPM  && bpm >= BPM_MID_LO && bpm <= BPM_MID_HI) score += bpmBonus.midBPM;
    }

    // Energy
    if (avgEnergy > 0.60) score += HIGH_ENERGY_BONUS[id] ?? 0;
    if (avgEnergy < 0.38) score += LOW_ENERGY_BONUS[id]  ?? 0;

    // Spectral centroid
    if (spectralCentroid > 0.60) score += HIGH_CENTROID_BONUS[id] ?? 0;
    if (spectralCentroid < 0.40) score += LOW_CENTROID_BONUS[id]  ?? 0;

    return {
      engineId: id,
      score,
      reason: buildReason(id, mood, bpm, avgEnergy, spectralCentroid),
    };
  });

  raw.sort((a, b) => b.score - a.score);

  const maxScore = raw[0]?.score ?? 1;
  return raw.slice(0, topN).map(r => ({
    ...r,
    score: maxScore > 0 ? r.score / maxScore : r.score,
  }));
}

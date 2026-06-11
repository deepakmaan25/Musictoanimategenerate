import { useState, useMemo, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, Sparkles, Wand2, Play, Download, Music, Palette, Layers, Zap,
  Heart, Music2, Clock, ArrowRight, Sun, Moon, Trash2, LogOut, Cloud,
  ChevronLeft, ChevronRight, FolderOpen, ExternalLink, FileVideo, Loader2
} from 'lucide-react';
import { Button } from './components/ui/button';
const Studio = lazy(() => import('./components/Studio').then(m => ({ default: m.Studio })));
import { AuthModal } from './components/AuthModal';
import { AuthCallback } from './components/AuthCallback';
import { SharePage } from './components/SharePage';
import { useTheme } from './hooks/useTheme';
import { usePersistentProjects, type StoredProject } from './hooks/usePersistentProjects';
import { useAuth } from './hooks/useAuth';
import { fetchUserProjects, deleteDBProject, dbProjectToStored, upsertProject } from './lib/db';

type StudioEngine = 'bars' | 'radial' | 'depth' | 'orbital' | 'terrain' | 'tunnel' | 'neon_spheres' | 'fractal' | 'solar';

const ENGINES: {
  id: string; studio: StudioEngine; name: string; icon: React.ReactNode;
  description: string; moods: string[]; gradient: string;
  previewStyle: 'bars' | 'radial' | 'tunnel' | 'terrain' | 'particles' | 'rings' | 'spheres' | 'fractal' | 'solar';
}[] = [
  { id: 'radial_spectrum', studio: 'radial', previewStyle: 'radial', name: 'Radial Spectrum', icon: <Layers className="size-4" />, description: 'Circular frequency visualization with dynamic color shifts.', moods: ['High-Energy', 'Futuristic'], gradient: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)' },
  { id: 'depth_field', studio: 'depth', previewStyle: 'particles', name: 'Depth Field', icon: <Sparkles className="size-4" />, description: 'Cinematic starfield that surges on every beat.', moods: ['Dreamy', 'Chill'], gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)' },
  { id: 'geometric_pulse', studio: 'solar', previewStyle: 'solar', name: 'Geometric Pulse', icon: <Zap className="size-4" />, description: 'Concentric beat-rings expand and shatter on every drop.', moods: ['Aggressive', 'High-Energy'], gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' },
  { id: 'neon_tunnel',    studio: 'tunnel',      previewStyle: 'tunnel',    name: 'Liquid Aurora',    icon: <Wand2 className="size-4" />,   description: 'Flowing aurora ribbons that ripple with every frequency.', moods: ['Dreamy', 'Cinematic'],     gradient: 'linear-gradient(135deg, #06b6d4 0%, #a855f7 100%)' },
  { id: 'audio_terrain', studio: 'terrain', previewStyle: 'terrain', name: 'Audio Terrain', icon: <Music2 className="size-4" />, description: 'Wireframe landscape that rises with your track.', moods: ['Cinematic', 'Instrumental'], gradient: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' },
  { id: 'orbital_rings', studio: 'orbital', previewStyle: 'rings', name: 'Orbital Rings', icon: <Layers className="size-4" />, description: 'Concentric rings tilt and pulse around a neon core.', moods: ['Dreamy', 'Futuristic'], gradient: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)' },
  { id: 'neon_spheres', studio: 'neon_spheres', previewStyle: 'field',   name: 'Resonance Field', icon: <Sparkles className="size-4" />, description: 'A 3D lattice of nodes whose strings glow with frequency tension.', moods: ['Melodic', 'Instrumental'], gradient: 'linear-gradient(135deg, #14b8a6 0%, #6366f1 100%)' },
  { id: 'fractal_kaleido', studio: 'fractal', previewStyle: 'fractal', name: 'Kaleidoscope', icon: <Palette className="size-4" />, description: 'Mirrored fractal patterns synced to music energy.', moods: ['Trippy', 'Instrumental'], gradient: 'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)' },
  { id: 'spectrum_bars',  studio: 'bars',    previewStyle: 'bars',    name: 'Spectrum Bars', icon: <Zap className="size-4" />,     description: 'Classic frequency bars — every beat, every frequency, instant.', moods: ['High-Energy', 'Vocal-Heavy'], gradient: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)' },
];

const PROJECTS_PER_PAGE = 6;

function StudioLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--hero-bg-gradient)', color: 'var(--text-muted)' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-sm">Loading studio…</span>
      </div>
    </div>
  );
}

export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') return <AuthCallback />;
  if (typeof window !== 'undefined' && window.location.pathname === '/share') return <SharePage />;
  return <LandingApp />;
}

function LandingApp() {
  const { theme, toggle: toggleTheme } = useTheme();
  const persist = usePersistentProjects();
  const { user, signOut } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [cloudProjectIds, setCloudProjectIds] = useState<Set<string>>(new Set());
  const [projectPage, setProjectPage] = useState(0);
  const isIOS = useMemo(() => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent), []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setProjectPage(0);
    (async () => {
      try {
        const dbProjects = await fetchUserProjects(user.id);
        if (!cancelled) {
          const ids = new Set<string>();
          for (const p of dbProjects) { persist.importProject(dbProjectToStored(p)); ids.add(p.id); }
          setCloudProjectIds(ids);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [view, setView] = useState<'landing' | 'studio'>('landing');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(persist.lastOpenedProjectId);
  const [studioEngine, setStudioEngine] = useState<StudioEngine>('bars');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openPicker = (engine?: StudioEngine) => { if (engine) setStudioEngine(engine); fileInputRef.current?.click(); };
  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setPendingFile(file); setActiveProjectId(null); setView('studio'); }
    e.target.value = '';
  };
  const openExisting = (id: string) => { setActiveProjectId(id); setPendingFile(null); persist.setLastOpened(id); setView('studio'); };
  const handleDeleteProject = useCallback(async (id: string) => {
    persist.deleteProject(id);
    setCloudProjectIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    if (user?.id) await deleteDBProject(id);
  }, [persist, user?.id]);

  const handleRenameProject = useCallback(async (id: string, title: string) => {
    persist.renameProject(id, title);
    if (user?.id) {
      const project = persist.projects[id];
      if (!project) return;
      await upsertProject({
        id,
        user_id: user.id,
        title,
        engine_id: project.engineId,
        style_config: project.style as Record<string, unknown>,
        motion_config: project.motion as Record<string, unknown>,
        audio_meta: project.audioMeta,
      });
    }
  }, [persist, user?.id]);
  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setCloudProjectIds(new Set());
    setSigningOut(false);
  };

  const projectList = useMemo(() => {
    if (!user?.id) return [];
    return Object.values(persist.projects).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [persist.projects, user?.id]);

  const totalPages = Math.ceil(projectList.length / PROJECTS_PER_PAGE);
  const pagedProjects = projectList.slice(projectPage * PROJECTS_PER_PAGE, (projectPage + 1) * PROJECTS_PER_PAGE);

  if (view === 'studio') {
    return (
      <Suspense fallback={<StudioLoadingFallback />}>
        <Studio initialFile={pendingFile} initialEngine={studioEngine} projectId={activeProjectId} persist={persist} onBack={() => setView('landing')} />
      </Suspense>
    );
  }

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen" style={{ background: 'var(--hero-bg-gradient)', color: 'var(--text-strong)' }}>
      <input ref={fileInputRef} type="file"
        accept={isIOS ? undefined : 'audio/*,audio/mpeg,.mp3,.m4a,.wav,.flac,.ogg'}
        hidden onChange={onFileSelected} />

      {/* ── NAVBAR ──────────────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-40 h-14 backdrop-blur-xl border-b"
        style={{ background: 'var(--nav-bg)', borderColor: 'var(--surface-glass-border)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 select-none">
            {/* Brand icon — purple/pink gradient with waveform bars */}
            <div className="size-7 rounded-lg shrink-0 flex items-end justify-center gap-[2px] px-1 pb-1"
              style={{ background: 'var(--hero-cta-gradient)' }}>
              <span className="w-[3px] rounded-sm bg-white/90" style={{ height: '45%' }} />
              <span className="w-[3px] rounded-sm bg-white"    style={{ height: '80%' }} />
              <span className="w-[3px] rounded-sm bg-white"    style={{ height: '100%' }} />
              <span className="w-[3px] rounded-sm bg-white/90" style={{ height: '60%' }} />
            </div>
            <span className="font-semibold tracking-tight text-sm" style={{ color: 'var(--text-strong)' }}>Music Animate</span>
            <span className="hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded-md uppercase tracking-widest border"
              style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-muted)' }}>
              Beta
            </span>
          </a>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                {/* Avatar — neutral, no gradient, subtle identity marker */}
                <button
                  onClick={() => document.getElementById('projects-section')?.scrollIntoView({ behavior: 'smooth' })}
                  title={user.email ?? 'My projects'}
                  className="size-8 rounded-full text-xs font-bold flex items-center justify-center shrink-0 border"
                  style={{
                    background: 'var(--surface-glass)',
                    borderColor: 'var(--surface-glass-border)',
                    color: 'var(--text-strong)',
                  }}>
                  {(user.email ?? 'U')[0].toUpperCase()}
                </button>
                {/* Sign out — ghost text, lowest visual weight */}
                <button onClick={handleSignOut} disabled={signingOut}
                  className="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all disabled:opacity-50 hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}>
                  {signingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
                <button onClick={handleSignOut} disabled={signingOut}
                  className="flex sm:hidden size-8 rounded-lg items-center justify-center disabled:opacity-50 hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}>
                  {signingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                </button>
              </>
            ) : (
              <button onClick={() => setAuthOpen(true)}
                className="h-8 px-3 rounded-lg text-xs font-medium border"
                style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-strong)' }}>
                Sign in
              </button>
            )}
            {/* New project — secondary style, outline with brand colour, NOT full gradient */}
            <button onClick={() => openPicker()}
              className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all hover:opacity-90"
              style={{
                background: 'var(--btn-secondary-bg)',
                borderColor: 'var(--btn-secondary-border)',
                color: 'var(--btn-secondary-text)',
              }}>
              <Upload className="size-3.5" />
              <span className="hidden sm:inline">New project</span>
              <span className="sm:hidden">New</span>
            </button>
            <button onClick={toggleTheme} aria-label="Toggle theme"
              className="size-8 rounded-lg border flex items-center justify-center shrink-0"
              style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-muted)' }}>
              {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)'
        }} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(168,85,247,0.12) 0%, transparent 70%)' }} />

        <div className="max-w-3xl mx-auto text-center relative">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>

            <div className="inline-flex items-center gap-2 mb-10 px-4 py-1.5 rounded-full text-xs font-medium border"
              style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-muted)' }}>
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              AI-powered audio visualization
            </div>

            <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] mb-6 leading-[0.9]"
              style={{ color: 'var(--text-strong)' }}>
              Your sound,<br />
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--hero-text-gradient)' }}>
                visualized.
              </span>
            </h1>

            <p className="text-base md:text-lg max-w-xl mx-auto mb-10 leading-relaxed"
              style={{ color: 'var(--text-muted)' }}>
              Upload any track. Choose from 9 visual engines. Export beat-perfect
              animations for TikTok, Reels, and YouTube — in seconds.
            </p>

            {/* ONE primary CTA */}
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => openPicker()}
              className="inline-flex items-center gap-2 sm:gap-3 px-6 sm:px-8 h-12 sm:h-14 rounded-2xl text-sm sm:text-base font-semibold text-white"
              style={{ background: 'var(--hero-cta-gradient)', boxShadow: 'var(--accent-glow)' }}>
              <Upload className="size-4 sm:size-5" />
              Upload your track
              <ArrowRight className="size-4 opacity-70" />
            </motion.button>

            <p className="mt-5 text-xs" style={{ color: 'var(--text-muted)' }}>
              MP3 · WAV · FLAC · up to 100 MB · runs entirely in your browser
              {!user && (
                <> · <button onClick={() => setAuthOpen(true)} className="underline underline-offset-2 hover:opacity-80">Sign in to save work</button></>
              )}
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── MY PROJECTS (signed-in only, inline) ──────────────────────── */}
      {user && (
        <section id="projects-section" className="px-6 pb-16 border-t"
          style={{ borderColor: 'var(--surface-glass-border)' }}>
          <div className="max-w-7xl mx-auto pt-12">

            {/* Section header — NO duplicate CTA here */}
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-1.5"
                  style={{ color: 'var(--text-muted)' }}>Your projects</p>
                <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-strong)' }}>
                  {projectList.length === 0
                    ? 'No projects yet'
                    : `${projectList.length} saved project${projectList.length !== 1 ? 's' : ''}`}
                </h2>
              </div>
              {/* Pagination controls — only when needed */}
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {projectPage + 1} / {totalPages}
                  </span>
                  <button onClick={() => setProjectPage(p => Math.max(0, p - 1))}
                    disabled={projectPage === 0}
                    className="size-8 rounded-lg border flex items-center justify-center disabled:opacity-30"
                    style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-strong)' }}>
                    <ChevronLeft className="size-4" />
                  </button>
                  <button onClick={() => setProjectPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={projectPage === totalPages - 1}
                    className="size-8 rounded-lg border flex items-center justify-center disabled:opacity-30"
                    style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-strong)' }}>
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Empty state */}
            {projectList.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-24 rounded-2xl border border-dashed"
                style={{ borderColor: 'var(--surface-glass-border)' }}>
                <div className="size-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'var(--surface-glass)' }}>
                  <FolderOpen className="size-6" style={{ color: 'var(--text-muted)' }} />
                </div>
                <p className="font-medium mb-1" style={{ color: 'var(--text-strong)' }}>No projects yet</p>
                <p className="text-sm mb-6 text-center max-w-xs" style={{ color: 'var(--text-muted)' }}>
                  Use the "New project" button in the header to get started
                </p>
              </motion.div>
            )}

            {/* Project grid */}
            {pagedProjects.length > 0 && (
              <AnimatePresence mode="wait">
                <motion.div key={projectPage}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pagedProjects.map((p, i) => (
                    <motion.div key={p.id}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}>
                      <ProjectCard
                        project={p}
                        isSynced={cloudProjectIds.has(p.id)}
                        onOpen={() => openExisting(p.id)}
                        onRename={(title) => handleRenameProject(p.id, title)}
                        onDelete={() => handleDeleteProject(p.id)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </section>
      )}

      {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
      <section className="px-6 py-20 border-t" style={{ borderColor: 'var(--surface-glass-border)', background: 'var(--section-bg)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--text-muted)' }}>How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-strong)' }}>
              Three steps to magic.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
            {[
              { n: '01', title: 'Upload audio', body: 'Any MP3, WAV, or FLAC. Decoded entirely in your browser — nothing leaves your device.', icon: <Upload className="size-5" /> },
              { n: '02', title: 'Choose your engine', body: '9 visual styles tuned for different moods. Dial in color, motion speed, and beat sensitivity.', icon: <Palette className="size-5" /> },
              { n: '03', title: 'Export & share', body: 'Render up to 4K in 9:16, 1:1, or 16:9. Perfect for TikTok, Reels, and YouTube.', icon: <Download className="size-5" /> },
            ].map((step, i) => (
              <motion.div key={step.n} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1 }}>
                <div className="h-full p-6 rounded-2xl border"
                  style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-glass-border)' }}>
                  <div className="flex items-start justify-between mb-5">
                    <div className="size-10 rounded-xl flex items-center justify-center"
                      style={{ background: 'var(--step-icon-bg)', color: 'var(--step-icon-color)' }}>
                      {step.icon}
                    </div>
                    <span className="text-3xl font-black tabular-nums select-none"
                      style={{ color: 'var(--surface-glass-border)', lineHeight: 1 }}>{step.n}</span>
                  </div>
                  <h3 className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>{step.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VISUAL ENGINES ──────────────────────────────────────────────── */}
      <section className="px-6 py-20 border-t" style={{ borderColor: 'var(--surface-glass-border)' }}>
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--text-muted)' }}>Visual engines</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-strong)' }}>
              9 distinct styles. Pick your vibe.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ENGINES.map((engine, i) => (
              <motion.div key={engine.id}
                initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.04 }}>
                <EngineCard engine={engine} onUse={() => openPicker(engine.studio)} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <footer className="px-6 py-8 border-t" style={{ borderColor: 'var(--surface-glass-border)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4 text-xs"
          style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-2">
            <div className="size-4 rounded" style={{ background: 'var(--hero-cta-gradient)' }} />
            © 2026 Music Animate
          </div>
          <div className="flex gap-5">
            <a href="/privacy" className="hover:opacity-80 transition-opacity">Privacy</a>
            <a href="/terms" className="hover:opacity-80 transition-opacity">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, isSynced, onOpen, onRename, onDelete }: {
  project: StoredProject; isSynced: boolean; onOpen: () => void;
  onRename: (title: string) => void; onDelete: () => void;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  const exportCount = Object.keys(project.exports).length;
  const engine = ENGINES.find(e => e.studio === project.engineId) ?? ENGINES[0];
  const displayTitle = project.title ?? project.audioMeta.name.replace(/\.[^.]+$/, '');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== displayTitle) onRename(trimmed);
    else setDraft(displayTitle); // revert if blank or unchanged
    setEditing(false);
  };

  return (
    <div className="rounded-2xl border overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-lg"
      style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-card-border, var(--surface-glass-border))' }}>
      {/* Engine gradient header bar */}
      <div className="h-1 w-full" style={{ background: engine.gradient }} />

      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 sm:size-10 rounded-xl shrink-0 overflow-hidden relative"
            style={{ background: engine.gradient }}>
            {project.style?.thumbnail ? (
              <img src={project.style.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="size-4 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { setDraft(displayTitle); setEditing(false); }
                }}
                onClick={e => e.stopPropagation()}
                className="w-full text-sm font-semibold bg-transparent border-b outline-none mb-1 leading-snug"
                style={{ color: 'var(--text-strong)', borderColor: 'var(--hero-cta-gradient)' }}
              />
            ) : (
              <p
                className="font-semibold text-sm leading-snug truncate mb-1 cursor-text"
                title="Double-click to rename"
                style={{ color: 'var(--text-strong)' }}
                onDoubleClick={e => { e.stopPropagation(); setDraft(displayTitle); setEditing(true); }}
              >
                {displayTitle}
              </p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Clock className="size-3" />{fmt(project.audioMeta.duration)}
              </span>
              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <FileVideo className="size-3" />{exportCount} export{exportCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          {/* Delete — always visible, not hover-only (mobile needs tap, not hover) */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="size-8 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-red-500/15 active:bg-red-500/20"
            style={{ color: 'var(--text-muted)' }}
            title="Delete project"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[11px] px-2 py-0.5 rounded-md border font-medium"
            style={{ background: 'var(--surface-glass)', borderColor: 'var(--surface-glass-border)', color: 'var(--text-muted)' }}>
            {engine.name}
          </span>
          {isSynced && (
            <span className="text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1"
              style={{ background: 'rgba(16,185,129,0.1)', color: 'rgb(16,185,129)' }}>
              <Cloud className="size-2.5" /> synced
            </span>
          )}
        </div>

        {/* Primary action — secondary style, not full gradient */}
        <button onClick={onOpen}
          className="w-full h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:opacity-80 text-white"
          style={{ background: 'var(--hero-cta-gradient)', boxShadow: '0 2px 12px -4px rgba(124,58,237,0.4)' }}>
          <ExternalLink className="size-3.5" /> Open project
        </button>
      </div>
    </div>
  );
}

// ─── Compact engine card ──────────────────────────────────────────────────────

function EngineCard({ engine, onUse }: { engine: typeof ENGINES[number]; onUse: () => void }) {
  return (
    <button onClick={onUse}
      className="group w-full text-left flex items-center gap-4 p-4 rounded-2xl border transition-all hover:translate-y-[-1px]"
      style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-glass-border)' }}>
      <div className="size-14 rounded-xl shrink-0 overflow-hidden relative" style={{ background: engine.gradient }}>
        <EnginePreview style={engine.previewStyle} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span style={{ color: 'var(--text-muted)' }}>{engine.icon}</span>
          <span className="font-semibold text-sm" style={{ color: 'var(--text-strong)' }}>{engine.name}</span>
        </div>
        <p className="text-xs leading-relaxed line-clamp-1 mb-2" style={{ color: 'var(--text-muted)' }}>{engine.description}</p>
        <div className="flex gap-1">
          {engine.moods.map(m => (
            <span key={m} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}>{m}</span>
          ))}
        </div>
      </div>
      <span className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0 text-xs font-semibold text-white px-3 h-7 rounded-lg flex items-center whitespace-nowrap"
        style={{ background: engine.gradient }}>Use</span>
    </button>
  );
}

// ─── Engine preview animations ────────────────────────────────────────────────

function EnginePreview({ style }: { style: string }) {
  const bars = [0.3, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6, 0.35];
  if (style === 'bars') return (
    <div className="absolute inset-0 flex items-end justify-center gap-[2px] px-2 pb-1.5">
      {bars.map((h, i) => <div key={i} className="flex-1 rounded-sm bg-white/70"
        style={{ height: `${h * 80}%`, animation: `bA ${0.6 + i * 0.1}s ease-in-out infinite alternate`, animationDelay: `${i * 0.08}s` }} />)}
      <style>{`@keyframes bA{from{transform:scaleY(.4)}to{transform:scaleY(1)}}`}</style>
    </div>
  );
  if (style === 'radial') return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[18,13,8].map((r,i) => <div key={i} className="absolute rounded-full border border-white/60"
        style={{ width:r*2.4, height:r*2.4, animation:`rA ${1+i*0.3}s ease-in-out infinite alternate`, animationDelay:`${i*0.2}s` }} />)}
      <div className="size-3 rounded-full bg-white/80" />
      <style>{`@keyframes rA{from{transform:scale(.85);opacity:.5}to{transform:scale(1.1);opacity:1}}`}</style>
    </div>
  );
  if (style === 'tunnel') return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[24,18,12,7].map((r,i) => <div key={i} className="absolute rounded-full border border-white/50"
        style={{ width:r*2, height:r*2, animation:`tA 1.5s ease-in-out infinite`, animationDelay:`${i*0.35}s` }} />)}
      <style>{`@keyframes tA{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.15);opacity:.4}}`}</style>
    </div>
  );
  if (style === 'terrain') return (
    <div className="absolute inset-0 flex items-end">
      <svg viewBox="0 0 56 28" className="w-full" fill="none">
        <polyline points="0,22 7,16 14,20 21,10 28,14 35,8 42,12 49,6 56,10" stroke="white" strokeOpacity=".7" strokeWidth="1.5"
          style={{ animation:'terA 2s ease-in-out infinite alternate' }} />
        <polyline points="0,26 7,22 14,24 21,18 28,22 35,16 42,20 49,14 56,18" stroke="white" strokeOpacity=".3" strokeWidth="1" />
        <style>{`@keyframes terA{from{transform:translateY(0)}to{transform:translateY(-3px)}}`}</style>
      </svg>
    </div>
  );
  if (style === 'particles') return (
    <div className="absolute inset-0">
      {[...Array(8)].map((_,i) => <div key={i} className="absolute rounded-full bg-white"
        style={{ width:2+(i%3), height:2+(i%3), left:`${15+(i*9)%70}%`, top:`${20+(i*13)%60}%`, opacity:.4+(i%4)*.15, animation:`pA ${1.5+i*0.2}s ease-in-out infinite alternate`, animationDelay:`${i*0.15}s` }} />)}
      <style>{`@keyframes pA{from{transform:translateY(0)}to{transform:translateY(-5px)}}`}</style>
    </div>
  );
  if (style === 'rings') return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[22,15,8].map((r,i) => <div key={i} className="absolute rounded-full border border-white/60"
        style={{ width:r*2, height:r*2, transform:`rotate(${i*20}deg)scaleY(0.5)`, animation:`ringA ${2+i*0.5}s ease-in-out infinite alternate`, animationDelay:`${i*0.3}s` }} />)}
      <div className="size-2.5 rounded-full bg-white/90" />
      <style>{`@keyframes ringA{from{transform:rotate(0deg)scaleY(.45)}to{transform:rotate(15deg)scaleY(.6)}}`}</style>
    </div>
  );
  if (style === 'field') return (
    <div className="absolute inset-0 flex items-center justify-center" style={{perspective:'200px'}}>
      <svg viewBox="0 0 80 80" width="80" height="80" style={{transform:'rotateX(28deg) rotateY(-18deg)', overflow:'visible'}}>
        {/* Grid edges */}
        {[[10,20,40,20],[40,20,70,20],[10,40,40,40],[40,40,70,40],[10,60,40,60],[40,60,70,60],
          [10,20,10,40],[10,40,10,60],[40,20,40,40],[40,40,40,60],[70,20,70,40],[70,40,70,60]].map(([x1,y1,x2,y2],i)=>(
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(94,234,212,0.45)" strokeWidth="0.8"/>
        ))}
        {/* Nodes — alternate colours */}
        {[[10,20,0],[40,20,1],[70,20,0],[10,40,1],[40,40,0],[70,40,1],[10,60,0],[40,60,1],[70,60,0]].map(([x,y,c],i)=>(
          <circle key={i} cx={x} cy={y} r="3.5"
            fill={c ? '#818cf8' : '#5eead4'}
            style={{filter:'blur(0.5px)',animation:`rNode 1.8s ease-in-out infinite alternate`,animationDelay:`${i*0.22}s`}}/>
        ))}
      </svg>
      <style>{`@keyframes rNode{from{r:2.5;opacity:.5}to{r:5;opacity:1}}`}</style>
    </div>
  );
  if (style === 'fractal') return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ animation:'fracA 4s linear infinite' }}>
      {[0,45,90,135].map((a,i) => <div key={i} className="absolute bg-white/60"
        style={{ width:1.5, height:18, transformOrigin:'bottom center', transform:`rotate(${a}deg)`, top:'50%', left:'50%', marginLeft:-0.75, marginTop:-18 }} />)}
      <div className="size-2 rounded-full bg-white/80 relative z-10" />
      <style>{`@keyframes fracA{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (style === 'solar') return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[8,16,24].map((r,i) => (
        <div key={i} className="absolute rounded-full border border-white"
          style={{ width:r*2, height:r*2, opacity: 0.35 + i*0.18,
            animation:`geoA ${0.9 + i*0.35}s ease-out infinite`,
            animationDelay:`${i*0.28}s` }} />
      ))}
      <div className="size-3 rounded-full bg-white/90" style={{ boxShadow:'0 0 8px 3px rgba(255,255,255,.5)' }} />
      <style>{`@keyframes geoA{0%{transform:scale(.5);opacity:.9}100%{transform:scale(1.6);opacity:0}}`}</style>
    </div>
  );
  return null;
}

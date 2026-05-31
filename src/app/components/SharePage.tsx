/**
 * SharePage — public-facing video share page
 * Route: /share?v=<signedUrl>&n=<trackName>&e=<engineId>&a=<aspect>
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Play, Pause, Volume2, VolumeX } from 'lucide-react';

const ENGINE_META: Record<string, { label: string; gradient: string; glow: string }> = {
  bars:         { label: 'Spectrum Bars',       gradient: 'linear-gradient(135deg,#f97316 0%,#ef4444 100%)',  glow: 'rgba(249,115,22,0.30)'  },
  radial:       { label: 'Radial Spectrum',      gradient: 'linear-gradient(135deg,#8b5cf6 0%,#ec4899 100%)', glow: 'rgba(139,92,246,0.30)'  },
  orbital:      { label: 'Orbital Rings',        gradient: 'linear-gradient(135deg,#a855f7 0%,#3b82f6 100%)', glow: 'rgba(168,85,247,0.30)'  },
  depth:        { label: 'Depth Field',          gradient: 'linear-gradient(135deg,#3b82f6 0%,#06b6d4 100%)', glow: 'rgba(59,130,246,0.30)'  },
  terrain:      { label: 'Audio Terrain',        gradient: 'linear-gradient(135deg,#10b981 0%,#06b6d4 100%)', glow: 'rgba(16,185,129,0.30)'  },
  tunnel:       { label: 'Liquid Aurora',        gradient: 'linear-gradient(135deg,#06b6d4 0%,#a855f7 100%)', glow: 'rgba(6,182,212,0.30)'   },
  neon_spheres: { label: 'Neon Spheres',         gradient: 'linear-gradient(135deg,#ec4899 0%,#f59e0b 100%)', glow: 'rgba(236,72,153,0.30)'  },
  fractal:      { label: 'Fractal Kaleidoscope', gradient: 'linear-gradient(135deg,#8b5cf6 0%,#d946ef 100%)', glow: 'rgba(139,92,246,0.30)'  },
  solar:        { label: 'Geometric Pulse',      gradient: 'linear-gradient(135deg,#f59e0b 0%,#ec4899 100%)', glow: 'rgba(245,158,11,0.30)'  },
};
const DEFAULT_META = ENGINE_META.radial;

const ASPECT_LABELS: Record<string, string> = {
  '9:16': 'TikTok · Reels',
  '1:1':  'Instagram',
  '16:9': 'YouTube',
};

export function SharePage() {
  const params    = new URLSearchParams(window.location.search);
  const videoUrl  = params.get('v') ?? '';
  const trackName = decodeURIComponent(params.get('n') ?? 'Untitled Track');
  const engineId  = params.get('e') ?? '';
  const aspect    = (params.get('a') ?? '9:16') as '9:16' | '1:1' | '16:9';
  const meta      = ENGINE_META[engineId] ?? DEFAULT_META;

  const videoRef   = useRef<HTMLVideoElement>(null);
  const [playing,   setPlaying]   = useState(false);
  const [muted,     setMuted]     = useState(true);
  const [progress,  setProgress]  = useState(0);
  const [duration,  setDuration]  = useState(0);
  const [loaded,    setLoaded]    = useState(false);
  const [error,     setError]     = useState(false);
  const [unmuteHint,setUnmuteHint]= useState(false);

  useEffect(() => {
    document.title = `${trackName} — Music Animate`;

    // OG meta tags for social sharing previews
    const metas: [string, string, string][] = [
      ['property', 'og:title',            `${trackName} — Music Animate`],
      ['property', 'og:description',      `${meta.label} visualization · Made with Music Animate`],
      ['property', 'og:url',              window.location.href],
      ['property', 'og:type',             'video.other'],
      ['name',     'twitter:card',        'summary_large_image'],
      ['name',     'twitter:title',       `${trackName} — Music Animate`],
      ['name',     'twitter:description', `${meta.label} visualization`],
    ];
    const injected: HTMLMetaElement[] = [];
    metas.forEach(([attr, name, val]) => {
      const el = document.createElement('meta');
      el.setAttribute(attr, name);
      el.setAttribute('content', val);
      el.setAttribute('data-ma-share', '1');
      document.head.appendChild(el);
      injected.push(el);
    });

    const style = document.createElement('style');
    style.id = 'ma-share-styles';
    style.textContent = `
      @keyframes spin { to { transform: rotate(360deg) } }
      @keyframes ma-drift {
        0%,100% { transform:translate(-2%,-2%) scale(1.06); }
        33%      { transform:translate( 2%,-1%) scale(1.08); }
        66%      { transform:translate(-1%, 2%) scale(1.07); }
      }
      @keyframes ma-in { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
      .ma-drift { animation: ma-drift 16s ease-in-out infinite; }
      .ma-in    { animation: ma-in 0.5s ease both; }
    `;
    if (!document.getElementById('ma-share-styles')) document.head.appendChild(style);
    return () => {
      document.getElementById('ma-share-styles')?.remove();
      injected.forEach(el => el.remove());
    };
  }, [trackName]);

  // Auto-play muted once video metadata is ready
  const handleCanPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    setLoaded(true);
    if (v.duration && isFinite(v.duration)) setDuration(v.duration);
    v.muted = true;
    v.play().then(() => {
      setPlaying(true);
      setUnmuteHint(true);
      setTimeout(() => setUnmuteHint(false), 3400);
    }).catch(() => {});
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * v.duration;
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  if (!videoUrl) return (
    <div style={{ minHeight:'100vh', background:'#07070e', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Inter',system-ui,sans-serif" }}>
      <div style={{ textAlign:'center' }}>
        <p style={{ color:'rgba(255,255,255,0.3)', fontSize:14 }}>No video found.</p>
        <a href="/" style={{ color:'#a78bfa', fontSize:12, marginTop:12, display:'inline-block' }}>← Back to Music Animate</a>
      </div>
    </div>
  );

  const is916 = aspect === '9:16';
  const is11  = aspect === '1:1';

  return (
    <div style={{ minHeight:'100vh', background:'#07070e', overflowX:'hidden', fontFamily:"'Inter',system-ui,sans-serif", color:'#fff' }}>

      {/* Ambient blob */}
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', overflow:'hidden' }} aria-hidden="true">
        <div className="ma-drift" style={{
          position:'absolute', inset:'-15%',
          background:`radial-gradient(ellipse 65% 50% at 50% 40%, ${meta.glow} 0%, transparent 70%)`,
        }} />
      </div>

      {/* Nav */}
      <nav style={{ position:'relative', zIndex:20, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', maxWidth:900, margin:'0 auto' }}>
        <a href="/" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none' }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#a855f7 0%,#ec4899 50%,#f59e0b 100%)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg viewBox="0 0 16 16" style={{ width:16, height:16, fill:'white' }} aria-hidden="true">
              <rect x="1.5" y="8"  width="2.5" height="7" rx="1" />
              <rect x="5.5" y="4"  width="2.5" height="11" rx="1" />
              <rect x="9.5" y="6"  width="2.5" height="9" rx="1" />
              <rect x="13"  y="10" width="2.5" height="5" rx="1" />
            </svg>
          </div>
          <span style={{ color:'rgba(255,255,255,0.55)', fontSize:14, fontWeight:500 }}>Music Animate</span>
        </a>
        <a href="/" style={{ fontSize:11, fontWeight:500, padding:'6px 14px', borderRadius:20, border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.45)', background:'rgba(255,255,255,0.04)', textDecoration:'none', transition:'all .15s' }}
          onMouseEnter={e=>{(e.currentTarget as HTMLAnchorElement).style.color='rgba(255,255,255,0.85)';(e.currentTarget as HTMLAnchorElement).style.borderColor='rgba(255,255,255,0.22)';}}
          onMouseLeave={e=>{(e.currentTarget as HTMLAnchorElement).style.color='rgba(255,255,255,0.45)';(e.currentTarget as HTMLAnchorElement).style.borderColor='rgba(255,255,255,0.12)';}}>
          Create yours →
        </a>
      </nav>

      {/* Main */}
      <main style={{ position:'relative', zIndex:10, display:'flex', flexDirection:'column', alignItems:'center', padding: is916 ? '8px 16px 64px' : '8px 16px 64px' }}>
        <div className="ma-in" style={{
          display:'flex', flexDirection: (!is916 && !is11) ? 'row' : 'column',
          gap: 28, width:'100%',
          maxWidth: is916 ? 400 : is11 ? 520 : 900,
          alignItems: (!is916 && !is11) ? 'flex-start' : 'center',
          flexWrap:'wrap',
        }}>

          {/* Video */}
          <div style={{
            position:'relative', borderRadius:16, overflow:'hidden',
            background:'#0a0a14', flexShrink:0,
            width: is916 ? '100%' : is11 ? '100%' : 'auto',
            flex: (!is916 && !is11) ? '1 1 0' : undefined,
            aspectRatio: is916 ? '9/16' : is11 ? '1/1' : '16/9',
            boxShadow:`0 0 90px -18px ${meta.glow}, 0 0 0 1px rgba(255,255,255,0.07)`,
          }}>
            {/* Inset border */}
            <div style={{ position:'absolute', inset:0, borderRadius:'inherit', boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.07)', pointerEvents:'none', zIndex:10 }} />

            {/* Loading */}
            {!loaded && !error && (
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, zIndex:20, background:'#0a0a14' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', border:'2px solid rgba(255,255,255,0.08)', borderTopColor:'rgba(255,255,255,0.55)' animation:'spin 0.8s linear infinite' }} />
                <p style={{ fontSize:11, color:'rgba(255,255,255,0.22)' }}>Loading…</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, zIndex:20, background:'#0a0a14', padding:'0 24px' }}>
                <p style={{ fontSize:14, color:'rgba(255,255,255,0.5)', fontWeight:500 }}>Link expired</p>
                <p style={{ fontSize:12, color:'rgba(255,255,255,0.25)', textAlign:'center', lineHeight:1.5 }}>This share link has expired.<br/>Ask the creator to share a new one.</p>
              </div>
            )}

            <video
              ref={videoRef} src={videoUrl} loop playsInline muted={muted}
              style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
              onCanPlay={handleCanPlay}
              onLoadedMetadata={() => { const v=videoRef.current; if(v&&isFinite(v.duration)) setDuration(v.duration); }}
              onTimeUpdate={() => { const v=videoRef.current; if(v&&v.duration) setProgress((v.currentTime/v.duration)*100); }}
              onError={() => setError(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />

            {/* Unmute hint */}
            {unmuteHint && loaded && (
              <div style={{
                position:'absolute', top:12, left:'50%', transform:'translateX(-50%)',
                zIndex:30, pointerEvents:'none', padding:'6px 14px',
                borderRadius:20, fontSize:11, color:'rgba(255,255,255,0.65)', fontWeight:500,
                background:'rgba(0,0,0,0.55)', border:'1px solid rgba(255,255,255,0.1)',
                backdropFilter:'blur(8px)', whiteSpace:'nowrap',
              }}>🔇 Tap 🔊 to unmute</div>
            )}

            {/* Overlay controls */}
            {loaded && (
              <>
                <button style={{ position:'absolute', inset:0, zIndex:5, cursor:'pointer', background:'none', border:'none' }} onClick={toggle} aria-label="Play/Pause" />

                {/* Bottom gradient */}
                <div style={{ position:'absolute', inset:'auto 0 0 0', zIndex:20, paddingTop:40, background:'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)' }}>
                  {/* Seek bar */}
                  <div style={{ margin:'0 12px 8px', height:20, display:'flex', alignItems:'center', cursor:'pointer', position:'relative' }}
                    onClick={seekTo}>
                    <div style={{ height:4, width:'100%', background:'rgba(255,255,255,0.15)', borderRadius:99, position:'relative', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:99, background:meta.gradient, width:`${progress}%`, transition:'width 0.1s linear' }} />
                    </div>
                  </div>
                  {/* Controls */}
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 12px 12px' }}>
                    <button onClick={toggle} style={{ width:32, height:32, borderRadius:'50%', background:'rgba(255,255,255,0.12)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {playing ? <Pause style={{ width:14, height:14, color:'white' }} /> : <Play style={{ width:14, height:14, color:'white' }} />}
                    </button>
                    <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontVariantNumeric:'tabular-nums', flex:1 }}>
                      {fmt((progress/100)*duration)} / {fmt(duration)}
                    </span>
                    <button onClick={toggleMute} style={{ width:28, height:28, borderRadius:'50%', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {muted ? <VolumeX style={{ width:14, height:14, color:'rgba(255,255,255,0.4)' }} /> : <Volume2 style={{ width:14, height:14, color:'rgba(255,255,255,0.4)' }} />}
                    </button>
                  </div>
                </div>

                {/* Centre play indicator when paused */}
                {!playing && (
                  <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:6, pointerEvents:'none' }}>
                    <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.15)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Play style={{ width:22, height:22, color:'white', marginLeft:3 }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Track info */}
          <div style={{
            display:'flex', flexDirection: (!is916 && !is11) ? 'column' : 'row',
            flexWrap:'wrap', gap:20, alignItems: (!is916 && !is11) ? 'flex-start' : 'center',
            width: is916 || is11 ? '100%' : 220, flexShrink:0,
            paddingTop: (!is916 && !is11) ? 4 : 0,
          }}>
            {/* Name + badges */}
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:20, fontWeight:600, lineHeight:1.3, margin:'0 0 10px', wordBreak:'break-word' }}
                title={trackName}>{trackName}</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {engineId && ENGINE_META[engineId] && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.75)', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:meta.gradient, flexShrink:0 }} />
                    {meta.label}
                  </span>
                )}
                {ASPECT_LABELS[aspect] && (
                  <span style={{ padding:'4px 10px', borderRadius:20, fontSize:11, color:'rgba(255,255,255,0.3)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)' }}>
                    {aspect} · {ASPECT_LABELS[aspect]}
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display:'flex', flexDirection: (!is916 && !is11) ? 'column' : 'row', gap:10, flexShrink:0 }}>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(videoUrl);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${trackName}.${videoUrl.includes('.mp4') ? 'mp4' : 'webm'}`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  } catch {
                    window.open(videoUrl, '_blank');
                  }
                }}
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 20px', borderRadius:12, fontSize:13, fontWeight:600, color:'white', background:meta.gradient, border:'none', cursor:'pointer', whiteSpace:'nowrap', minWidth:130, transition:'opacity .15s' }}
                onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.opacity='0.88'}
                onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.opacity='1'}>
                <Download style={{ width:14, height:14, flexShrink:0 }} /> Download
              </button>
              {/* Copy link */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href).then(() => {
                    const btn = document.getElementById('ma-copy-btn');
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy link'; }, 2000); }
                  }).catch(() => {});
                }}
                id="ma-copy-btn"
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 20px', borderRadius:12, fontSize:13, fontWeight:500, color:'rgba(255,255,255,0.55)', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', whiteSpace:'nowrap', minWidth:130, transition:'all .15s' }}
                onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.color='rgba(255,255,255,0.88)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.2)';}}
                onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.color='rgba(255,255,255,0.55)';(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.1)';}}>
                Copy link
              </button>
              <a href="/"
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 20px', borderRadius:12, fontSize:13, fontWeight:500, color:'rgba(255,255,255,0.55)', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', textDecoration:'none', whiteSpace:'nowrap', minWidth:130, transition:'all .15s' }}
                onMouseEnter={e=>{(e.currentTarget as HTMLAnchorElement).style.color='rgba(255,255,255,0.88)';(e.currentTarget as HTMLAnchorElement).style.borderColor='rgba(255,255,255,0.2)';}}
                onMouseLeave={e=>{(e.currentTarget as HTMLAnchorElement).style.color='rgba(255,255,255,0.55)';(e.currentTarget as HTMLAnchorElement).style.borderColor='rgba(255,255,255,0.1)';}}>
                Make yours →
              </a>
              <p style={{ fontSize:10, color:'rgba(255,255,255,0.2)', lineHeight:1.5, marginTop:4 }}>
                Link valid 7 days · Download to keep permanently
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p style={{ marginTop:56, fontSize:11, color:'rgba(255,255,255,0.16)', textAlign:'center' }}>
          Made with{' '}
          <a href="/" style={{ color:'rgba(167,139,250,0.5)', textDecoration:'none' }}
            onMouseEnter={e=>(e.currentTarget as HTMLAnchorElement).style.color='rgba(167,139,250,0.9)'}
            onMouseLeave={e=>(e.currentTarget as HTMLAnchorElement).style.color='rgba(167,139,250,0.5)'}>
            Music Animate
          </a>
          {' '}· Visualize Your Sound
        </p>
      </main>
    </div>
  );
}

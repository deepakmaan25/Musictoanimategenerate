import type { EngineFrameCtx } from './types';
import { avg, hexToRgb } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// drawEngine — dispatches to the correct visual engine for one frame.
// Extracted verbatim from Studio.tsx's drawFrame; all state arrives via `fc`
// so the body is unchanged. Locals are destructured below to keep the engine
// code identical to its in-component form (minimises diff & regression risk).
// ─────────────────────────────────────────────────────────────────────────────
export function drawEngine(eng: string, fc: EngineFrameCtx): void {
  const {
    ctx, w, h, freq, vrnt, sens, perf, bSpeed, bResp,
    liveColors, hxCache, energyMult, sectionIntensity, sectionProgress,
    currentEnergy, particleDensity,
    spheresRef, starsRef, planetsRef, cameraTRef, tunnelTRef, solarTRef,
    prevBassRef, smoothedBurstRef, gridDotsRef, shockwavesRef, gridKeyRef,
    orbitBodiesRef, tdBufRef, particleDensRef,
  } = fc;
    if (eng === 'bars') {
      const numBars = 96;
      const step = Math.floor(freq.length / numBars);
      const barW = w / numBars;

      // Waveform underlay — buffer is filled by Studio (owns the analyser) and
      // passed in via fc.tdBuf; fall back gracefully if absent.
      const tdData = fc.tdBuf;
      if (tdData) {
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
      }

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
      prevBassRef.current = bass;
      if (orbitOnset > 0.025) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + (0.5 + orbitOnset * 3.0));
      smoothedBurstRef.current *= 0.82;
      const burst = smoothedBurstRef.current;

      if (vrnt === 'helix') {
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
        // ── Orbiting bodies (default): luminous bodies on tilted elliptical
        //    orbits leaving comet trails. Active frequency bands trail longer
        //    & glow brighter. Smooth, graceful flow; gentle swell on beats. ──
        const minDim = Math.min(w, h);
        const NORBIT = perf ? 5 : 7;

        // Lazy-init orbits (rebuild only if count changes)
        if (!orbitBodiesRef.current || orbitBodiesRef.current.length !== NORBIT) {
          orbitBodiesRef.current = Array.from({ length: NORBIT }, (_, i) => {
            const tt = NORBIT > 1 ? i / (NORBIT - 1) : 0;
            return {
              a:        0.16 + tt * 0.30,
              ecc:      0.15 + Math.random() * 0.25,
              tilt:     0.30 + tt * 0.45,
              planeRot: i * 0.6 + Math.random() * 0.5,
              angle:    Math.random() * Math.PI * 2,
              speed:    0.9 - tt * 0.5,
              hue:      tt,
              band:     tt,
              dir:      i % 2 === 0 ? 1 : -1,
              trail:    [] as { x: number; y: number; depth: number }[],
            };
          });
        }
        const orbits = orbitBodiesRef.current;

        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 0;

        // Faint orbit paths (behind bodies)
        for (let oi = 0; oi < orbits.length; oi++) {
          const o = orbits[oi];
          const col = liveColors[Math.floor(o.hue * liveColors.length) % liveColors.length];
          ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},0.06)`;
          ctx.lineWidth = 1;
          ctx.save();
          ctx.translate(cx, cy); ctx.rotate(o.planeRot); ctx.scale(1, o.tilt);
          const A = o.a * minDim, B = A * (1 - o.ecc);
          ctx.beginPath(); ctx.ellipse(0, 0, A, B, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }

        // Central core halo (behind bodies)
        const coreR = minDim * 0.05 * (1 + burst * 0.5 + bass * sens * 0.3);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 5);
        cg.addColorStop(0,   `rgba(${hexToRgb(liveColors[0], hxCache)},${0.18 + burst * 0.18})`);
        cg.addColorStop(0.4, `rgba(${hexToRgb(liveColors[1], hxCache)},0.06)`);
        cg.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cx, cy, coreR * 5, 0, Math.PI * 2); ctx.fill();

        // Bodies + comet trails
        for (let oi = 0; oi < orbits.length; oi++) {
          const o = orbits[oi];
          // band value for this body
          const bLo = Math.floor(o.band * freq.length * 0.45);
          const bv  = Math.min(1, avg(freq, bLo, bLo + 16) * sens);

          // advance — music-driven: slow drift baseline, strong surge on energy/beats
          const drive = 0.35 + bass * 1.6 + mids * 0.8 + burst * 1.2;   // audio dominates motion
          o.angle += o.dir * 0.016 * (0.4 + o.speed * 0.8) * drive * energyMult;

          // position on tilted, rotated ellipse
          const A = o.a * minDim, B = A * (1 - o.ecc);
          const ex = Math.cos(o.angle) * A;
          const ey = Math.sin(o.angle) * B * o.tilt;
          const cr = Math.cos(o.planeRot), sr = Math.sin(o.planeRot);
          const px = cx + ex * cr - ey * sr;
          const py = cy + ex * sr + ey * cr;
          const depth = Math.sin(o.angle);            // +behind / -front
          const depthF = 0.6 - depth * 0.4;           // front brighter/bigger

          // record trail (length driven by band activity + beats)
          o.trail.push({ x: px, y: py, depth });
          const maxTrail = Math.floor(10 + bv * 40 + burst * 24);
          while (o.trail.length > maxTrail) o.trail.shift();

          const col = liveColors[Math.floor(o.hue * liveColors.length) % liveColors.length];
          const rgbCol = hexToRgb(col, hxCache);

          // trail
          for (let i = 1; i < o.trail.length; i++) {
            const tt = i / o.trail.length;
            const a = tt * tt * (0.10 + bv * 0.5 + burst * 0.1);
            if (a < 0.005) continue;
            ctx.strokeStyle = `rgba(${rgbCol},${a})`;
            ctx.lineWidth = 0.5 + tt * (1.5 + bv * 3);
            ctx.beginPath();
            ctx.moveTo(o.trail[i - 1].x, o.trail[i - 1].y);
            ctx.lineTo(o.trail[i].x, o.trail[i].y);
            ctx.stroke();
          }

          // body halo + core — pulses clearly with band energy + beats
          const size = (2.6 + bv * 7) * depthF * (1 + burst * 0.9 + bass * 0.4);
          if (!perf) {
            const g = ctx.createRadialGradient(px, py, 0, px, py, size * 3);
            g.addColorStop(0, `rgba(${rgbCol},${(0.35 + bv * 0.55 + burst * 0.3) * depthF})`);
            g.addColorStop(1, `rgba(${rgbCol},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(px, py, size * 3, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = `rgba(${rgbCol},${Math.min(1, 0.7 + bv * 0.5) * depthF})`;
          ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${0.6 * depthF})`;
          ctx.beginPath(); ctx.arc(px, py, size * 0.4, 0, Math.PI * 2); ctx.fill();
        }

        // Bright core (front) — flashes white on beats
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * (1 + burst * 0.5));
        coreGrad.addColorStop(0,   '#ffffff');
        coreGrad.addColorStop(0.3, `rgba(${hexToRgb(liveColors[0], hxCache)},${Math.min(1, 0.85 + burst * 0.15)})`);
        coreGrad.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath(); ctx.arc(cx, cy, coreR * (1 + burst * 0.5), 0, Math.PI * 2); ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }

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
        ctx.globalCompositeOperation = 'lighter'; ctx.shadowBlur = 0;
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
          const nAlpha = 0.25 + bandVal * 0.55;
          const ng = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 2.2);
          ng.addColorStop(0, `rgba(${hexToRgb(color, hxCache)},${nAlpha})`);
          ng.addColorStop(1, `rgba(${hexToRgb(color, hxCache)},0)`);
          ctx.fillStyle = ng;
          ctx.beginPath(); ctx.arc(sx, sy, size * 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.shadowBlur = 0;

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

        ctx.globalCompositeOperation = 'lighter';
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

          const gAlpha = (0.15 + s.z * 0.85) * (0.25 + bandVal * 0.75);
          if (size > 1.6) {
            const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 2.4);
            gg.addColorStop(0, `rgba(${hexToRgb(color, hxCache)},${gAlpha * 0.6})`);
            gg.addColorStop(1, `rgba(${hexToRgb(color, hxCache)},0)`);
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(sx, sy, size * 2.4, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = gAlpha;
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
        ctx.globalCompositeOperation = 'source-over';

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
          if (proximity > 0.6 && size > 1.5) {
            ctx.globalCompositeOperation = 'lighter';
            const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 2.6);
            sg.addColorStop(0, `rgba(${hexToRgb(color, hxCache)},${alpha * 0.5})`);
            sg.addColorStop(1, `rgba(${hexToRgb(color, hxCache)},0)`);
            ctx.fillStyle = sg;
            ctx.beginPath(); ctx.arc(sx, sy, size * 2.6, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = alpha;
          }
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (isBeat && bassOnset > 0.07) {
          const ringR = Math.min(w,h) * (0.05 + bassOnset * 0.22);
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = liveColors[0];
          ctx.globalAlpha = Math.min(0.4, bassOnset * 1.4);
          ctx.lineWidth = 6 + bassOnset * 10;
          ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();  // soft wide glow
          ctx.globalAlpha = Math.min(0.85, bassOnset * 3);
          ctx.lineWidth = 2 + bassOnset * 4;
          ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();  // crisp core
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
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
      // ── Liquid Aurora — flowing light curtains ───────────────────────────
      // Vertical curtains of light sway, fold, and drape; brightness ripples
      // downward. Glow via layered additive fills (NO shadowBlur) — smooth and
      // cheap. Calm flow between beats; curtains flare wide & bright on hits.
      const bass  = avg(freq, 0, 16);
      const mids  = avg(freq, 16, 80);
      const highs = avg(freq, 80, 200);
      const energy = Math.min(1, bass * 0.5 + mids * 0.32 + highs * 0.18);

      const aurOnset = Math.max(0, bass - prevBassRef.current);
      prevBassRef.current = bass;
      if (aurOnset > 0.05) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + (0.8 + energy * 0.4));
      smoothedBurstRef.current *= 0.86;
      const burst = smoothedBurstRef.current;

      tunnelTRef.current += (0.30 + mids * 0.4) * 0.016 * Math.max(0.5, energyMult);
      const t = tunnelTRef.current;

      const minDim = Math.min(w, h);
      const NCURTAIN = perf ? 7 : 11;
      const SEG = perf ? 16 : 26;
      if (vrnt === 'ribbons') {
        // ── Ribbons: horizontal flowing light bands (variant) ──────────────
        const NRIB = perf ? 5 : 6;
        const RSEG = perf ? 26 : 40;
        if (!spheresRef.current || spheresRef.current.length !== NRIB
            || (spheresRef.current as unknown as ResonanceNode[])[0]?.depth !== 7) {
          spheresRef.current = Array.from({ length: NRIB }, (_, i) => ({
            x: 0, y: 0, vx: 0, vy: 0,
            hx: (i + 0.5) / NRIB, hy: 0.04 + Math.random() * 0.04,
            driftA: Math.random() * Math.PI * 2, driftR: 0,
            driftSpd: 0.2 + Math.random() * 0.3, phase: Math.random() * Math.PI * 2,
            depth: 7, hue: i / NRIB, twinkle: 0, size: 0,
          })) as unknown as Sphere[];
        }
        const ribs = spheresRef.current as unknown as ResonanceNode[];
        ctx.fillStyle = `rgba(2,2,10,${0.22 + (1 - sectionIntensity) * 0.06})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 0;
        for (let ri = 0; ri < NRIB; ri++) {
          const r = ribs[ri];
          r.driftA += r.driftSpd * 0.016 * (0.6 + mids * 0.7);
          const bandLo = Math.floor((ri / NRIB) * freq.length * 0.5);
          const drive = Math.min(1, avg(freq, bandLo, bandLo + 20) * sens * energyMult);
          const col = liveColors[Math.floor(r.hue * liveColors.length) % liveColors.length];
          const rgbCol = hexToRgb(col, hxCache);
          const thick = minDim * (0.04 + drive * 0.05 + burst * 0.03);
          let pL = 0, pTy = 0, pBy = 0;
          for (let s = 0; s <= RSEG; s++) {
            const f = s / RSEG, x = f * w;
            const wave = Math.sin(f * 4 + r.driftA) * r.hy * h * (1 + bass * 0.6)
                       + Math.sin(f * 7 - r.driftA * 1.3) * r.hy * 0.5 * h * drive;
            const yC = r.hx * h + wave;
            const ripple = 0.5 + 0.5 * Math.sin(f * 6 - t * 2 + r.driftA);
            const a = (0.05 + drive * 0.22 + burst * 0.12) * ripple * Math.sin(f * Math.PI);
            const half = thick * (0.4 + 0.6 * Math.sin(f * Math.PI));
            if (s > 0 && a > 0.004) {
              const g = ctx.createLinearGradient(0, yC - half, 0, yC + half);
              g.addColorStop(0, `rgba(${rgbCol},0)`);
              g.addColorStop(0.5, `rgba(${rgbCol},${a})`);
              g.addColorStop(1, `rgba(${rgbCol},0)`);
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.moveTo(pL, pTy); ctx.lineTo(x, yC - half);
              ctx.lineTo(x, yC + half); ctx.lineTo(pL, pBy);
              ctx.closePath(); ctx.fill();
            }
            pL = x; pTy = yC - half; pBy = yC + half;
          }
          ctx.strokeStyle = `rgba(${rgbCol},${0.10 + drive * 0.25})`;
          ctx.lineWidth = 1.2 + drive * 2;
          ctx.beginPath();
          for (let s = 0; s <= RSEG; s++) {
            const f = s / RSEG;
            const wave = Math.sin(f * 4 + r.driftA) * r.hy * h * (1 + bass * 0.6)
                       + Math.sin(f * 7 - r.driftA * 1.3) * r.hy * 0.5 * h * drive;
            if (s === 0) ctx.moveTo(f * w, r.hx * h + wave); else ctx.lineTo(f * w, r.hx * h + wave);
          }
          ctx.stroke();
        }
        if (burst > 0.05) {
          const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
          g.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)},${burst * 0.18})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.6);
        }
      } else {


      // Lazy-init curtains (stored in spheresRef — unused by other engines here)
      if (!spheresRef.current || spheresRef.current.length !== NCURTAIN) {
        spheresRef.current = Array.from({ length: NCURTAIN }, (_, i) => ({
          x: 0, y: 0, vx: 0, vy: 0,
          hx: (i + 0.5) / NCURTAIN,                     // baseX
          hy: 0.06 + Math.random() * 0.05,              // width fraction
          driftA:   Math.random() * Math.PI * 2,        // swayPhase
          driftR:   0,                                  // (unused)
          driftSpd: 0.25 + Math.random() * 0.3,         // swaySpd
          phase:    Math.random() * Math.PI * 2,        // foldPhase
          depth:    0,                                  // (unused)
          hue:      i / NCURTAIN,
          twinkle:  0,
          size: 0,
        })) as unknown as Sphere[];
      }
      const curtains = spheresRef.current as unknown as ResonanceNode[];

      // Background + trail fade + faint top-sky wash
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(2,2,10,${0.26 + (1 - sectionIntensity) * 0.06})`;
      ctx.fillRect(0, 0, w, h);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   `rgba(${hexToRgb(liveColors[0], hxCache)},${0.08 + energy * 0.08})`);
      sky.addColorStop(0.5, `rgba(${hexToRgb(liveColors[2], hxCache)},${0.03 + energy * 0.04})`);
      sky.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;

      for (let ci = 0; ci < NCURTAIN; ci++) {
        const c = curtains[ci];
        c.driftA += c.driftSpd * 0.016 * (0.6 + mids * 0.7);
        c.phase  += 0.016 * (0.4 + bass * 0.8);

        // frequency band driving this curtain
        const bandLo = Math.floor((ci / NCURTAIN) * freq.length * 0.5);
        const bandHi = Math.floor(((ci + 1) / NCURTAIN) * freq.length * 0.5);
        const drive  = Math.min(1, avg(freq, bandLo, bandHi) * sens * energyMult);
        const col    = liveColors[Math.floor(c.hue * liveColors.length) % liveColors.length];
        const rgbCol = hexToRgb(col, hxCache);

        const sway  = Math.sin(c.driftA) * 0.04 * (1 + bass * 0.8) + Math.sin(t * 0.5) * 0.02;
        const cxN   = c.hx + sway;
        const widthPx = c.hy * w * (1.4 + drive * 1.0 + burst * 0.6);   // wider, fuller curtains

        let prevLX = 0, prevRX = 0, prevY = 0;
        for (let s = 0; s <= SEG; s++) {
          const f = s / SEG;
          const fold = Math.sin(f * 3.0 + c.phase) * 0.03 * (0.5 + drive)
                     + Math.sin(f * 6.0 - c.phase * 1.4) * 0.015 * drive;
          const xPx = (cxN + fold) * w;
          const wHere = widthPx * (0.25 + 0.75 * Math.pow(f, 0.6));
          const lx = xPx - wHere * 0.5, rx = xPx + wHere * 0.5;
          const ripple = 0.5 + 0.5 * Math.sin(f * 5.0 - t * 2.2 + c.driftA);
          const vertFade = Math.sin(f * Math.PI);
          const a = (0.10 + drive * 0.40 + burst * 0.22 + energy * 0.10) * ripple * vertFade;
          const yPx = f * h;
          if (s > 0 && a > 0.004) {
            const g = ctx.createLinearGradient(lx, 0, rx, 0);
            g.addColorStop(0,   `rgba(${rgbCol},0)`);
            g.addColorStop(0.5, `rgba(${rgbCol},${a})`);
            g.addColorStop(1,   `rgba(${rgbCol},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(prevLX, prevY); ctx.lineTo(prevRX, prevY);
            ctx.lineTo(rx, yPx); ctx.lineTo(lx, yPx);
            ctx.closePath(); ctx.fill();
          }
          prevLX = lx; prevRX = rx; prevY = yPx;
        }

        // crisp core filament down the curtain
        ctx.strokeStyle = `rgba(${rgbCol},${0.20 + drive * 0.45 + burst * 0.2})`;
        ctx.lineWidth = 1.5 + drive * 3;
        ctx.beginPath();
        for (let s = 0; s <= SEG; s++) {
          const f = s / SEG;
          const fold = Math.sin(f * 3.0 + c.phase) * 0.03 * (0.5 + drive)
                     + Math.sin(f * 6.0 - c.phase * 1.4) * 0.015 * drive;
          const xPx = (cxN + fold) * w, yPx = f * h;
          if (s === 0) ctx.moveTo(xPx, yPx); else ctx.lineTo(xPx, yPx);
        }
        ctx.stroke();
      }

      // beat flare across the top
      if (burst > 0.04) {
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
        g.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)},${burst * 0.30})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.6);
      }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    } else if (eng === 'neon_spheres') {
      // ── Resonance Field — drifting particle constellation ────────────────
      // Particles drift on slow individual orbits, bob on a shared low-freq
      // current, and connect with soft additive-glow proximity lines. Calm,
      // hypnotic base motion; beats punch through with a clear visible kick.
      const bass  = avg(freq, 0, 14);
      const mids  = avg(freq, 14, 70);
      const highs = avg(freq, 70, 200);
      const energy = Math.min(1, bass * 0.5 + mids * 0.32 + highs * 0.18);

      const onset = Math.max(0, bass - prevBassRef.current);
      prevBassRef.current = bass;
      if (onset > 0.04) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + (0.85 + energy * 0.45));
      smoothedBurstRef.current *= 0.86;             // punchier envelope
      const burst = smoothedBurstRef.current;

      cameraTRef.current += (0.18 + mids * 0.4) * 0.016 * energyMult;
      const t = cameraTRef.current;

      const cx = w / 2, cy = h / 2;
      const minDim = Math.min(w, h);

      const COUNT = perf ? 44 : 68;
      if (!spheresRef.current || spheresRef.current.length !== COUNT) {
        spheresRef.current = Array.from({ length: COUNT }, () => ({
          x: 0, y: 0, vx: 0, vy: 0,
          hx: Math.random() * 2 - 1,
          hy: Math.random() * 2 - 1,
          driftA:   Math.random() * Math.PI * 2,
          driftR:   0.04 + Math.random() * 0.10,
          driftSpd: 0.15 + Math.random() * 0.35,
          phase:    Math.random() * Math.PI * 2,
          depth:    0.4 + Math.random() * 0.6,
          hue:      Math.random(),
          twinkle:  Math.random() * Math.PI * 2,
          size: 0,
        })) as unknown as Sphere[];
      }
      const nodes = spheresRef.current as unknown as ResonanceNode[];

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(5,5,12,${0.20 + (1 - sectionIntensity) * 0.06})`;
      ctx.fillRect(0, 0, w, h);

      const fieldR = minDim * (0.52 + bass * 0.12 * sens + burst * 0.14);  // wider spread, beats push out
      const breath = 1 - burst * 0.18;                                     // stronger beat pull

      if (vrnt === 'orbits') {
        // ── Orbits: particles travel in concentric circular currents ───────
        // Derive a ring index + direction from each node's existing fields so
        // no re-init is needed. Alternating rings counter-rotate.
        const RINGS = 4;
        // faint current-ring guides
        ctx.globalCompositeOperation = 'lighter';
        for (let ring = 0; ring < RINGS; ring++) {
          const rr = (0.18 + ring * 0.12) * minDim * (1 + bass * 0.06 * sens);
          ctx.strokeStyle = `rgba(${hexToRgb(liveColors[ring % liveColors.length], hxCache)},0.05)`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        }
        for (let i = 0; i < COUNT; i++) {
          const n = nodes[i];
          const ring = i % RINGS;
          const dir = ring % 2 === 0 ? 1 : -1;
          n.driftA += dir * n.driftSpd * 0.016 * (0.6 + mids * 0.8) * (1 + bass * 0.4);
          const rr = (0.18 + ring * 0.12 + (n.hue - 0.5) * 0.04) * minDim
                   * (1 + bass * 0.08 * sens + burst * 0.10);
          n.x = cx + Math.cos(n.driftA) * rr;
          n.y = cy + Math.sin(n.driftA) * rr;
          n.twinkle += 0.016 * (1.5 + highs * 4);
        }
      } else {
        for (let i = 0; i < COUNT; i++) {
          const n = nodes[i];
          n.driftA += n.driftSpd * 0.016 * (0.6 + mids * 0.8);
          const dx  = Math.cos(n.driftA) * n.driftR;
          const dy  = Math.sin(n.driftA * 0.8) * n.driftR;
          const bob = Math.sin(t * 0.7 + n.phase) * 0.05 * (0.5 + energy * 0.5);
          const px  = (n.hx + dx) * breath;
          const py  = (n.hy + dy + bob) * breath;
          n.x = cx + px * fieldR;
          n.y = cy + py * fieldR;
          n.twinkle += 0.016 * (1.5 + highs * 4);
        }
      }

      const maxDist = minDim * (0.20 + mids * 0.06);
      const maxD2   = maxDist * maxDist;
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;
      for (let i = 0; i < COUNT; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < COUNT; j++) {
          const b = nodes[j];
          const ddx = a.x - b.x, ddy = a.y - b.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > maxD2) continue;
          const d = Math.sqrt(d2);
          const closeness = 1 - d / maxDist;
          const sparkle = 0.6 + 0.4 * Math.sin(a.twinkle + b.twinkle) * highs;
          const alpha = closeness * closeness * (0.16 + energy * 0.30 + burst * 0.14) * sparkle;
          if (alpha < 0.004) continue;
          const col = liveColors[(i + j) % liveColors.length];
          ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},${alpha})`;
          ctx.lineWidth = 0.9 + closeness * 1.8;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }

      for (let i = 0; i < COUNT; i++) {
        const n = nodes[i];
        const col = liveColors[Math.floor(n.hue * liveColors.length) % liveColors.length];
        const rgbCol = hexToRgb(col, hxCache);
        const tw = 0.7 + 0.3 * Math.sin(n.twinkle);
        const baseSize = (2.6 + n.depth * 3.6) * (1 + burst * 0.45);   // larger, more prominent particles
        const glow = baseSize * (3.0 + bass * 2.2 + burst * 2.4);
        if (!perf) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glow);
          g.addColorStop(0, `rgba(${rgbCol},${0.26 * tw * (0.6 + energy * 0.6)})`);
          g.addColorStop(1, `rgba(${rgbCol},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(n.x, n.y, glow, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${rgbCol},${Math.min(1, 1.05 * tw)})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, baseSize * (0.85 + n.depth * 0.45), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.7 * tw * n.depth})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, baseSize * 0.42, 0, Math.PI * 2); ctx.fill();
      }

      if (burst > 0.06) {
        const ringR = fieldR * (0.45 + (1 - burst) * 0.8);
        const col = liveColors[0];
        const g = ctx.createRadialGradient(cx, cy, ringR * 0.65, cx, cy, ringR * 1.3);
        g.addColorStop(0,   'rgba(0,0,0,0)');
        g.addColorStop(0.7, `rgba(${hexToRgb(col, hxCache)},${burst * 0.20})`);
        g.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, ringR * 1.3, 0, Math.PI * 2); ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    } else if (eng === 'fractal') {
      // ── Fractal Kaleidoscope — three recursive/symmetric variants ────────
      ctx.fillStyle = vrnt === 'spiro' ? 'rgba(3,3,12,0.10)' : 'rgba(3,3,12,0.24)';
      ctx.fillRect(0, 0, w, h);
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      solarTRef.current += (0.008 + (bass * 0.5 + mids * 0.35 + highs * 0.15) * 0.04 * sens) * energyMult;
      const t = solarTRef.current;
      const cx = w / 2, cy = h / 2;
      const minDim = Math.min(w, h);

      const fracOnset = Math.max(0, bass - prevBassRef.current);
      prevBassRef.current = bass;
      if (fracOnset > 0.05) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + fracOnset * 2.2);
      smoothedBurstRef.current *= 0.87;
      const burst = smoothedBurstRef.current;

      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;

      if (vrnt === 'tree') {
        // ── Recursive Tree: fractal branches grow radially, pulse with music
        const arms = perf ? 4 : 6;
        const maxDepth = perf ? 4 : 5;
        const baseLen = minDim * (0.16 + bass * 0.06 * sens);
        const spread = 0.5 + mids * 0.5 + Math.sin(t * 0.6) * 0.15;
        const branch = (x: number, y: number, ang: number, len: number, depth: number) => {
          if (depth > maxDepth || len < 3) return;
          const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
          const col = liveColors[depth % liveColors.length];
          const a = (0.15 + mids * 0.3) * (1 - depth / (maxDepth + 2));
          ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},${a + burst * 0.1})`;
          ctx.lineWidth = Math.max(0.6, (maxDepth - depth) * 0.9 * (1 + burst * 0.3));
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
          if (depth >= maxDepth - 1) {
            const fv = [bass, mids, highs][depth % 3];
            ctx.fillStyle = `rgba(${hexToRgb(col, hxCache)},${0.4 + fv * 0.5})`;
            ctx.beginPath(); ctx.arc(ex, ey, 1.5 + fv * 3, 0, Math.PI * 2); ctx.fill();
          }
          const nl = len * (0.62 + highs * 0.12);
          branch(ex, ey, ang - spread, nl, depth + 1);
          branch(ex, ey, ang + spread, nl, depth + 1);
        };
        for (let a = 0; a < arms; a++) {
          branch(cx, cy, (a / arms) * Math.PI * 2 + t * 0.1, baseLen, 0);
        }
        const jr = minDim * 0.03 * (1 + bass * 0.6);
        const jg = ctx.createRadialGradient(cx, cy, 0, cx, cy, jr * 2);
        jg.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)},${0.8 + burst * 0.2})`);
        jg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = jg; ctx.beginPath(); ctx.arc(cx, cy, jr * 2, 0, Math.PI * 2); ctx.fill();

      } else if (vrnt === 'spiro') {
        // ── Spirograph: layered harmonograph rose curves morph with music ──
        const layers = perf ? 2 : 3;
        for (let L = 0; L < layers; L++) {
          const fv = [bass, mids, highs][L];
          const col = liveColors[L % liveColors.length];
          const R = minDim * (0.30 - L * 0.04);
          const k = 2 + L + Math.round(mids * 3);
          const steps = perf ? 160 : 240;
          ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},${0.25 + fv * 0.45 + burst * 0.1})`;
          ctx.lineWidth = 1 + fv * 2.5;
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const th = (i / steps) * Math.PI * 2;
            const r = R * (0.5 + 0.5 * Math.sin(k * th + t * (0.5 + L * 0.4))) * (0.7 + fv * 0.5);
            const x = cx + Math.cos(th + t * 0.1 * L) * r;
            const y = cy + Math.sin(th + t * 0.1 * L) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        const kk = 2 + Math.round(mids * 3);
        for (let i = 0; i < kk * 2; i++) {
          const th = (i / (kk * 2)) * Math.PI * 2 + t * 0.5;
          const r = minDim * 0.30 * (0.5 + 0.5 * Math.sin(kk * th + t * 0.5)) * (0.7 + bass * 0.5);
          const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
          const col = liveColors[i % liveColors.length];
          ctx.fillStyle = `rgba(${hexToRgb(col, hxCache)},${0.5 + bass * 0.4})`;
          ctx.beginPath(); ctx.arc(x, y, 2 + bass * 4, 0, Math.PI * 2); ctx.fill();
        }
        const jr = minDim * 0.025 * (1 + bass * 0.5 + burst * 0.4);
        const jg = ctx.createRadialGradient(cx, cy, 0, cx, cy, jr * 2.5);
        jg.addColorStop(0, '#ffffff');
        jg.addColorStop(0.4, `rgba(${hexToRgb(liveColors[0], hxCache)},1)`);
        jg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = jg; ctx.beginPath(); ctx.arc(cx, cy, jr * 2.5, 0, Math.PI * 2); ctx.fill();

      } else {
        // ── Kaleidoscope (default): true mirror symmetry across wedges ─────
        const wedges = (perf ? 6 : 8) + Math.round(burst * 4);
        const rot = t * 0.15;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
        const half = Math.PI / wedges;
        for (let s = 0; s < wedges; s++) {
          ctx.save();
          ctx.rotate((s / wedges) * Math.PI * 2);
          if (s % 2 === 1) ctx.scale(1, -1);
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, minDim * 0.6, -half, half); ctx.closePath(); ctx.clip();
          for (let k = 0; k < 3; k++) {
            const fv = [bass, mids, highs][k];
            const ang = Math.sin(t * (0.4 + k * 0.3) + k) * 0.5;
            const rr = minDim * (0.12 + k * 0.13) * (1 + fv * 0.5);
            const x = Math.cos(ang) * rr, y = Math.sin(ang * 1.3) * rr * 0.5;
            const size = minDim * (0.04 + fv * 0.06) * (1 + burst * 0.3);
            const col = liveColors[k % liveColors.length];
            const g = ctx.createRadialGradient(x, y, 0, x, y, size);
            g.addColorStop(0, `rgba(${hexToRgb(col, hxCache)},${0.5 + fv * 0.4})`);
            g.addColorStop(1, `rgba(${hexToRgb(col, hxCache)},0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},${0.2 + fv * 0.4})`;
            ctx.lineWidth = 1 + fv * 2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
        const jr = minDim * 0.04 * (1 + bass * 0.5 + burst * 0.4);
        const jg = ctx.createRadialGradient(cx, cy, 0, cx, cy, jr);
        jg.addColorStop(0, '#ffffff');
        jg.addColorStop(0.4, `rgba(${hexToRgb(liveColors[0], hxCache)},1)`);
        jg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = jg; ctx.beginPath(); ctx.arc(cx, cy, jr, 0, Math.PI * 2); ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    } else if (eng === 'solar') {
      // ── Geometric Pulse — concentric shockwave grid ──────────────────────
      // A field of dots; each beat fires an expanding shockwave that ripples
      // through the grid, snapping dots brighter/larger as the front passes.
      // Overlapping waves interfere. Clean rotating polygon core anchors center.
      // Punchy: sharp wavefront, fast settle. No shadowBlur — additive glow.
      const bass = avg(freq, 0, 16), mids = avg(freq, 16, 80), highs = avg(freq, 80, 200);
      solarTRef.current += (0.6 + bass * 0.6 * sens) * 0.016 * Math.max(0.5, energyMult);  // keeps moving when quiet
      const t = solarTRef.current;
      const cx = w / 2, cy = h / 2;
      const minDim = Math.min(w, h);
      const spacing = minDim / 16;
      const gridRadial = vrnt !== 'square';  // default ('') and 'radial' → radial grid; only 'square' → square grid

      const geoOnset = Math.max(0, bass - prevBassRef.current);
      prevBassRef.current = bass;
      if (geoOnset > 0.025) smoothedBurstRef.current = Math.min(1, smoothedBurstRef.current + (0.85 + geoOnset * 2.6));
      smoothedBurstRef.current *= 0.80;                       // snappier, punchier decay
      const burst = smoothedBurstRef.current;

      // ── Lazy-build dot grid (rebuilds if size/topology changes) ─────────
      const gridKey = `${Math.round(w)}x${Math.round(h)}|${gridRadial ? 'r' : 's'}`;
      if (gridKeyRef.current !== gridKey) {
        gridKeyRef.current = gridKey;
        const arr: GridDot[] = [];
        if (!gridRadial) {
          const cols = Math.ceil(w / spacing) + 2, rows = Math.ceil(h / spacing) + 2;
          const ox = (w - (cols - 1) * spacing) / 2, oy = (h - (rows - 1) * spacing) / 2;
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const x = ox + c * spacing, y = oy + r * spacing;
            arr.push({ bx: x, by: y, x, y, d: Math.hypot(x - cx, y - cy) });
          }
        } else {
          arr.push({ bx: cx, by: cy, x: cx, y: cy, d: 0 });
          const rings = 10;
          for (let ri = 1; ri <= rings; ri++) {
            const rr = ri * spacing, n = Math.max(6, ri * 6);
            for (let k = 0; k < n; k++) {
              const a = (k / n) * Math.PI * 2;
              const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
              arr.push({ bx: x, by: y, x, y, d: rr });
            }
          }
        }
        gridDotsRef.current = arr;
      }
      const dots = gridDotsRef.current;

      // ── Spawn shockwave on beat ─────────────────────────────────────────
      if (geoOnset > 0.025) {
        const strength = Math.min(1, 0.75 + geoOnset * 2.0);
        shockwavesRef.current.push({
          r: minDim * 0.02, maxR: minDim * 0.85,
          speed: minDim * (0.013 + strength * 0.011), width: spacing * 2.4,
          strength, colorIdx: Math.floor(Math.random() * liveColors.length),
        });
        if (shockwavesRef.current.length > 10) shockwavesRef.current.shift();
      }
      // advance + cull waves
      for (const wv of shockwavesRef.current) { wv.r += wv.speed; wv.strength *= 0.992; }
      shockwavesRef.current = shockwavesRef.current.filter(wv => wv.r < wv.maxR && wv.strength > 0.05);
      const waves = shockwavesRef.current;

      // ── Background trail fade ───────────────────────────────────────────
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(3,3,10,${0.30 + (1 - sectionIntensity) * 0.08})`;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;

      // ── Draw dots displaced/brightened by passing shockwaves ────────────
      for (let di = 0; di < dots.length; di++) {
        const dot = dots[di];
        let push = 0, bright = 0;
        for (let wi = 0; wi < waves.length; wi++) {
          const wv = waves[wi];
          const diff = Math.abs(dot.d - wv.r);
          if (diff < wv.width) {
            const f = 1 - diff / wv.width;
            const e = f * f * wv.strength;       // sharp leading edge
            push += e * spacing * 0.45;
            bright += e;
          }
        }
        if (bright > 1.4) bright = 1.4;
        // Ambient life: a slow breathing ripple travels the grid even in silence,
        // so the engine never looks dead between beats.
        const ambient = 0.10 + 0.10 * Math.sin(dot.d * 0.025 - t * 1.6)        // travelling ring
                      + 0.05 * Math.sin(dot.d * 0.06 + t * 0.9);               // counter-wave
        const shimmer = 0.10 * Math.sin(dot.d * 0.03 - t * 3) * (0.3 + mids);  // music adds on top
        const a = 0.12 + ambient + shimmer + bright * 1.1;
        const ang = Math.atan2(dot.by - cy, dot.bx - cx);
        dot.x = dot.bx + Math.cos(ang) * push;
        dot.y = dot.by + Math.sin(ang) * push;

        if (a <= 0.02) continue;
        const col = liveColors[Math.floor(dot.d / spacing) % liveColors.length];
        const rgbCol = hexToRgb(col, hxCache);
        const size = 2.0 + bright * 4.0 + (bright > 0.5 ? bright * 1.8 : 0);
        if (bright > 0.08 && !perf) {
          const g = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, size * 3.4);
          g.addColorStop(0, `rgba(${rgbCol},${bright * 0.65})`);
          g.addColorStop(1, `rgba(${rgbCol},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(dot.x, dot.y, size * 3.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${rgbCol},${a})`;
        ctx.beginPath(); ctx.arc(dot.x, dot.y, size, 0, Math.PI * 2); ctx.fill();
        if (bright > 0.45) {
          ctx.fillStyle = `rgba(255,255,255,${(bright - 0.45) * 1.0})`;
          ctx.beginPath(); ctx.arc(dot.x, dot.y, size * 0.5, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── Crisp shockwave ring outlines ───────────────────────────────────
      for (let wi = 0; wi < waves.length; wi++) {
        const wv = waves[wi];
        const col = liveColors[wv.colorIdx % liveColors.length];
        ctx.strokeStyle = `rgba(${hexToRgb(col, hxCache)},${wv.strength * 0.7})`;
        ctx.lineWidth = 1.5 + wv.strength * 3.5;
        ctx.beginPath(); ctx.arc(cx, cy, wv.r, 0, Math.PI * 2); ctx.stroke();
      }

      // ── Geometric core: clean rotating polygon ──────────────────────────
      const idlePulse = 1 + Math.sin(t * 1.4) * 0.08;   // gentle breathing when quiet
      const coreR = minDim * 0.05 * idlePulse * (1 + burst * 0.7 + bass * 0.3);
      const sides = 6, rot = t * 0.4 + burst * 0.5;
      const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4);
      hg.addColorStop(0, `rgba(${hexToRgb(liveColors[0], hxCache)},${0.10 + burst * 0.18})`);
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(cx, cy, coreR * 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${hexToRgb(liveColors[0], hxCache)},${0.7 + burst * 0.3})`;
      ctx.lineWidth = 2 + burst * 3;
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2 + rot;
        const rr = coreR * (1 + burst * 0.2);
        if (s === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.8 + burst * 0.2})`;
      ctx.beginPath(); ctx.arc(cx, cy, coreR * 0.32, 0, Math.PI * 2); ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
}

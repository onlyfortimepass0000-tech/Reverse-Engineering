/**
 * FIRST LIGHT — shared particle world for s4 (375-524) and s5 (525-550).
 * Everything is a pure function of the GLOBAL frame: any frame renders alone,
 * concurrency-safe. Owned by the s4 builder; s5 imports renderSphereFrame()
 * and must not change its signature.
 */
import { noise3D } from "@remotion/noise";
import { Easing } from "remotion";
import {
  BONE_RGB,
  CENTER,
  EXPO_IN,
  EXPO_OUT,
  FOCAL,
  IN_OUT,
  SINE_IN_OUT,
  VERMILION_RGB,
  clamp01,
  drawFlare,
  drawStar,
  lerp,
  prog,
  project,
  smoothstep,
} from "./film";
import { rng } from "./motion";

export const N = 4096;
export const SPHERE_R = 320;
export const SPHERE_Z = -2500;
export const TILT_DEG = 16;
export const GLYPH_CHARS = ["0", "1", "{", "}", ";", "="];
export const SHUTTER = 0.5;

/* ------------------------------------------------------------------ */
/* Precomputed seeded particle data                                    */
/* ------------------------------------------------------------------ */
const startX = new Float32Array(N);
const startY = new Float32Array(N);
const startZ = new Float32Array(N);
const fibX = new Float32Array(N);
const fibY = new Float32Array(N);
const fibZ = new Float32Array(N);
const startTime = new Float32Array(N);
/** -1 = plain dot, otherwise index into GLYPH_CHARS. */
const glyphIdx = new Int8Array(N);

(() => {
  const r = rng(7);
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2;
    const rad = 300 + 2300 * Math.sqrt(r());
    startX[i] = Math.cos(a) * rad;
    startY[i] = Math.sin(a) * rad;
    startZ[i] = -300 - 8700 * r();
    const y = 1 - (2 * (i + 0.5)) / N;
    const rr = Math.sqrt(1 - y * y);
    const phi = i * 2.39996;
    fibX[i] = Math.cos(phi) * rr;
    fibY[i] = y;
    fibZ[i] = Math.sin(phi) * rr;
    // (Kept for rng-sequence stability; the glyph subset is chosen below.)
    if (r() < 0.08) r();
    glyphIdx[i] = -1;
  }
  // CODE MATTER subset: a seeded 8% (328 particles), chosen by random
  // sequential Poisson-disk rejection on the unit sphere so no two glyphs
  // ever sit close enough to overlap on screen.
  {
    const gr = rng(8);
    const order = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(gr() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    const target = Math.round(N * 0.08);
    const MIN_CHORD2 = 0.15 * 0.15;
    const chosen: number[] = [];
    for (const i of order) {
      if (chosen.length >= target) break;
      let ok = true;
      for (const j of chosen) {
        const dx = fibX[i] - fibX[j];
        const dy = fibY[i] - fibY[j];
        const dz = fibZ[i] - fibZ[j];
        if (dx * dx + dy * dy + dz * dz < MIN_CHORD2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen.push(i);
      glyphIdx[i] = Math.floor(gr() * GLYPH_CHARS.length);
    }
  }
  // Rank by distance to (unrotated, tilted) target: nearest first.
  const ta = (TILT_DEG * Math.PI) / 180;
  const ca = Math.cos(ta);
  const sa = Math.sin(ta);
  const dist: { i: number; d: number }[] = [];
  for (let i = 0; i < N; i++) {
    const tx = fibX[i] * SPHERE_R;
    const ty = (fibY[i] * ca - fibZ[i] * sa) * SPHERE_R;
    const tz = (fibY[i] * sa + fibZ[i] * ca) * SPHERE_R + SPHERE_Z;
    const dx = startX[i] - tx;
    const dy = startY[i] - ty;
    const dz = startZ[i] - tz;
    dist.push({ i, d: Math.sqrt(dx * dx + dy * dy + dz * dz) });
  }
  dist.sort((a, b) => a.d - b.d);
  dist.forEach((e, rank) => {
    startTime[e.i] = 400 + 30 * (rank / (N - 1));
  });
})();

/* ------------------------------------------------------------------ */
/* Closed-form world parameters                                        */
/* ------------------------------------------------------------------ */

/** Sphere spin angle in degrees (closed-form integral of angular velocity). */
export const thetaDeg = (f: number) => {
  if (f <= 400) return 0;
  if (f <= 465) return 0.4 * (f - 400);
  if (f <= 524) {
    const q = (f - 465) / 59;
    return 26 + 0.4 * (f - 465) + 23.6 * q ** 3;
  }
  // s5: angular velocity 1.6 -> 9 deg/f with Easing.in(quad) over 524-551.
  const ff = Math.min(f, 551);
  const q = (ff - 524) / 27;
  const base = 73.2 + 1.6 * (ff - 524) + 66.6 * q ** 3;
  return base + (f > 551 ? 9 * (f - 551) : 0);
};

/** Angular velocity (deg/frame). */
export const omegaDeg = (f: number) => thetaDeg(f) - thetaDeg(f - 1);

/** Beat pulses on R at 465, 480, 495, 510. */
export const pulse = (f: number) => {
  let m = 1;
  for (const b of [465, 480, 495, 510]) {
    if (f >= b && f < b + 10) {
      m += 0.05 * (1 - Easing.out(Easing.quad)((f - b) / 10));
    }
  }
  return m;
};

/** Radius factor for the s5 collapse. */
export const rfAt = (f: number) =>
  f < 525 ? 1 : 1 - EXPO_IN(clamp01((f - 525) / 26));

/** Entry speed of the fly-through: d/df of -1400*easeOutCubic at 375 = 140 px/f. */
export const ENTRY_SPEED = 140;

export const camera4 = (f: number) => {
  const p = clamp01((f - 375) / 30);
  // Before 375 the camera keeps the s3 exit velocity (140/f), so the very
  // first frame already carries full-speed streaks (no velocity seam).
  const camZ = f < 375 ? ENTRY_SPEED * (375 - f) : -1400 * (1 - (1 - p) ** 3);
  const roll = f < 375 ? -5 : -5 * (1 - EXPO_OUT(p));
  const zoom = f < 430 ? 0.94 : f >= 524 ? 1.06 : 0.94 + 0.12 * SINE_IN_OUT((f - 430) / 94);
  return { camZ, roll, zoom };
};

/** Assembly progress of particle i at frame f (0..1, IN_OUT eased). */
export const assembly = (i: number, f: number) =>
  IN_OUT(clamp01((f - startTime[i]) / 40));

/** World-space position and frontness of particle i at frame f. */
export const particleAt = (i: number, f: number) => {
  const th = (thetaDeg(f) * Math.PI) / 180;
  const ta = (TILT_DEG * Math.PI) / 180;
  const R = SPHERE_R * pulse(f) * rfAt(f);
  // rotate about Y
  const x1 = fibX[i] * Math.cos(th) + fibZ[i] * Math.sin(th);
  const z1 = -fibX[i] * Math.sin(th) + fibZ[i] * Math.cos(th);
  // tilt about X
  const y2 = fibY[i] * Math.cos(ta) - z1 * Math.sin(ta);
  const z2 = fibY[i] * Math.sin(ta) + z1 * Math.cos(ta);
  const tx = x1 * R;
  const ty = y2 * R;
  const tz = z2 * R + SPHERE_Z;
  const front = (z2 + 1) / 2;
  const p = assembly(i, f);
  if (p <= 0) {
    return { x: startX[i], y: startY[i], z: startZ[i], front: 0.5, p: 0 };
  }
  const sw = 260 * Math.sin(Math.PI * p);
  const n = i * 0.013;
  const t = f * 0.02;
  return {
    x: lerp(startX[i], tx, p) + noise3D("swx", n, 0, t) * sw,
    y: lerp(startY[i], ty, p) + noise3D("swy", n, 1, t) * sw,
    z: lerp(startZ[i], tz, p) + noise3D("swz", n, 2, t) * sw,
    front: lerp(0.5, front, p),
    p,
  };
};

/** Number of particles at assembly progress >= 0.98 (for the counter). */
export const assembledCount = (f: number) => {
  let c = 0;
  for (let i = 0; i < N; i++) if (assembly(i, f) >= 0.98) c++;
  return c;
};

/** Vermilion core glow params (screen radius px, alpha). */
export const coreGlow = (f: number) => {
  if (f < 525) {
    return { r: 200, a: 0.45 * prog(f, 455, 524, SINE_IN_OUT) };
  }
  const t = EXPO_IN(clamp01((f - 525) / 26));
  return { r: lerp(200, 36, t), a: lerp(0.45, 1.0, t) };
};

/** Particle colour mix toward vermilion (s5 543-551). */
export const vermilionMix = (f: number) => prog(f, 543, 551, IN_OUT);

/** Counter geometry (spec: centred x=960, baseline y=884, mono 20px). */
export const COUNTER = { x: 960, baseline: 884 } as const;

/**
 * Counter visibility: fades up 400-410 (s4), fades out 525-535 (s5).
 * The sphere renderer uses it to knock particles back under the counter
 * so `4096 / 4096` stays legible over the sphere's lower limb.
 */
export const counterOpacity = (f: number) =>
  f < 525 ? prog(f, 400, 410, SINE_IN_OUT) : 1 - prog(f, 525, 535, SINE_IN_OUT);

/** Counter text for frame f, e.g. `0792 / 4096`. */
export const counterText = (f: number) =>
  `${String(assembledCount(f)).padStart(4, "0")} / ${N}`;


/* ------------------------------------------------------------------ */
/* Glyph sprites (rasterised once, only after the mono face is loaded) */
/* ------------------------------------------------------------------ */
let sprites: HTMLCanvasElement[] | null = null;
const SPRITE_PX = 18;
const SPRITE_SCALE = 2;
const SPRITE_FONT = `400 ${SPRITE_PX * SPRITE_SCALE}px "JetBrains Mono"`;
const getSprites = (): HTMLCanvasElement[] | null => {
  if (sprites) return sprites;
  if (typeof document === "undefined") return null;
  // Never cache a fallback-font raster: if the face is not ready yet, the
  // glyph particles simply stay dots for this frame.
  if (document.fonts && !document.fonts.check(SPRITE_FONT)) return null;
  const s = SPRITE_PX * SPRITE_SCALE;
  sprites = GLYPH_CHARS.map((ch) => {
    const c = document.createElement("canvas");
    c.width = Math.round(s * 1.2);
    c.height = Math.round(s * 1.4);
    const ctx = c.getContext("2d")!;
    ctx.font = SPRITE_FONT;
    ctx.fillStyle = `rgb(${BONE_RGB.join(",")})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, c.width / 2, c.height / 2);
    return c;
  });
  return sprites;
};

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */
export type SphereRenderOptions = {
  /** Draw the inherited s3 flare/star decay (s4 only). */
  inheritFlare?: boolean;
};

/** Alpha buckets (batched 'lighter' draws, no depth sort). */
const B = 8;
/** Trail stroke width classes (px). */
const WIDTHS = [1, 1.4, 1.9, 2.5, 3.2];
/** Trail taper, head to tail: thirds of the streak at these alpha factors. */
const TAPER = [0.8, 0.45, 0.18];
const nearestWidth = (w: number) => {
  let best = 0;
  for (let k = 1; k < WIDTHS.length; k++) {
    if (Math.abs(WIDTHS[k] - w) < Math.abs(WIDTHS[best] - w)) best = k;
  }
  return best;
};
const bucket = (a: number) => Math.min(B - 1, Math.floor(a * B));

/**
 * Draws one frame of the particle world for GLOBAL frame f (375..550).
 * Clears the canvas to transparent first. Frozen signature: s5 depends on it.
 *
 * Every particle is a head dot plus a tapered trail covering its screen motion
 * over the 180-degree shutter (SHUTTER of the f-1 -> f displacement, capped at
 * 240px). The trail grows continuously from zero length, so there is no
 * dot/streak pop. Code-glyph particles cross-fade in from their dot over
 * frontness 0.65-0.78 (no pop as the sphere turns).
 */
export const renderSphereFrame = (
  ctx: CanvasRenderingContext2D,
  f: number,
  opts: SphereRenderOptions = {},
) => {
  ctx.clearRect(0, 0, 1920, 1080);
  if (f >= 551) return;

  const cam = camera4(f);
  const camPrev = camera4(f - 1);
  const focal = FOCAL * cam.zoom;
  const focalPrev = FOCAL * camPrev.zoom;
  const rf = rfAt(f);
  const collapseFade = f < 525 ? 1 : smoothstep(0, 0.3, rf);
  const vm = vermilionMix(f);
  const col = [0, 1, 2].map((k) =>
    Math.round(lerp(BONE_RGB[k], VERMILION_RGB[k], vm)),
  );
  const rgb = `rgb(${col[0]},${col[1]},${col[2]})`;
  const glyphGate = smoothstep(0.55, 0.8, rf) * (1 - vm);
  const sp = glyphGate > 0 ? getSprites() : null;
  const ko = counterOpacity(f);
  const koY = COUNTER.baseline - 7;

  const dotPaths: Path2D[] = Array.from({ length: B }, () => new Path2D());
  const trailPaths: Path2D[][] = WIDTHS.map(() =>
    Array.from({ length: B }, () => new Path2D()),
  );
  const glyphDraws: { s: number; x: number; y: number; size: number; a: number }[] = [];

  for (let i = 0; i < N; i++) {
    const a = particleAt(i, f);
    const pa = project(a.x, a.y, a.z, cam.camZ, 0, cam.roll, focal);
    if (!pa) continue;
    if (pa.x < -300 || pa.x > 2220 || pa.y < -300 || pa.y > 1380) continue;
    const near = focal / pa.depth;

    const flyAlpha = 0.15 + 0.7 * (1 - smoothstep(900, 9000, pa.depth));
    const sphereAlpha = 0.2 + 0.65 * a.front;
    let alpha = lerp(flyAlpha, sphereAlpha, a.p) * collapseFade;
    // Soft knock-back under the counter so it never fights the lower limb.
    // Code glyphs are fully suppressed there (a glyph beside the digits would
    // misread as part of the number); they fall back to knocked-back dots.
    let koMask = 0;
    if (ko > 0) {
      const ex = (pa.x - COUNTER.x) / 195;
      const ey = (pa.y - koY) / 36;
      const d2 = ex * ex + ey * ey;
      if (d2 < 1) {
        koMask = ko * (1 - smoothstep(0.25, 1, d2));
        alpha *= 1 - 0.85 * koMask;
      }
    }
    if (alpha <= 0.01) continue;
    alpha = Math.min(1, alpha);

    // Fly-through: 1-2px by proximity. Sphere: the spec's depth-cued dot.
    const lineW = 1 + clamp01((near - 0.4) / 1.6);
    const sphereR = Math.max(1.0, 1.1 * near * (0.7 + 0.6 * a.front));
    const r = lerp(Math.max(0.9, lineW * 0.6), sphereR, a.p);

    // Code matter: glyph sprite cross-fade.
    let k = 0;
    if (sp && glyphIdx[i] >= 0) {
      k =
        smoothstep(0.65, 0.78, a.front) *
        smoothstep(0.9, 1, a.p) *
        glyphGate *
        (1 - Math.min(1, koMask * 1.6));
      if (k > 0.01) {
        const size = SPRITE_PX * near * (0.7 + 0.6 * a.front);
        glyphDraws.push({ s: glyphIdx[i], x: pa.x, y: pa.y, size, a: alpha * k });
      }
    }
    const da = alpha * (1 - k);
    if (da < 0.01) continue;

    dotPaths[bucket(da)].moveTo(pa.x + r, pa.y);
    dotPaths[bucket(da)].arc(pa.x, pa.y, r, 0, Math.PI * 2);

    const b = particleAt(i, f - 1);
    const pb = project(b.x, b.y, b.z, camPrev.camZ, 0, camPrev.roll, focalPrev);
    if (!pb) continue;
    const dx = (pa.x - pb.x) * SHUTTER;
    const dy = (pa.y - pb.y) * SHUTTER;
    const len = Math.sqrt(dx * dx + dy * dy);
    const L = Math.min(len, 240) - r * 0.6; // trail starts at the dot's rim
    if (L <= 0.25) continue;
    const ux = -dx / len;
    const uy = -dy / len;
    const wi = nearestWidth(lerp(lineW, Math.min(2 * r, 3.2) * 0.8, a.p));
    const x0 = pa.x + ux * r * 0.6;
    const y0 = pa.y + uy * r * 0.6;
    for (let s = 0; s < 3; s++) {
      const sa = da * TAPER[s];
      if (sa < 0.02) continue;
      const p = trailPaths[wi][bucket(sa)];
      p.moveTo(x0 + (ux * L * s) / 3, y0 + (uy * L * s) / 3);
      p.lineTo(x0 + (ux * L * (s + 1)) / 3, y0 + (uy * L * (s + 1)) / 3);
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rgb;
  ctx.strokeStyle = rgb;
  ctx.lineCap = "butt";
  for (let q = 0; q < B; q++) {
    ctx.globalAlpha = (q + 0.5) / B;
    ctx.fill(dotPaths[q]);
    for (let w = 0; w < WIDTHS.length; w++) {
      ctx.lineWidth = WIDTHS[w];
      ctx.stroke(trailPaths[w][q]);
    }
  }
  if (sp && glyphDraws.length) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const g of glyphDraws) {
      const img = sp[g.s];
      const h = g.size * 1.4;
      const w = g.size * 1.2;
      ctx.globalAlpha = Math.min(1, g.a);
      ctx.drawImage(img, g.x - w / 2, g.y - h / 2, w, h);
    }
  }
  ctx.restore();

  // Vermilion core at the sphere centre.
  const core = coreGlow(f);
  if (core.a > 0.003) {
    const c = project(0, 0, SPHERE_Z, cam.camZ, 0, cam.roll, focal);
    if (c) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, core.r);
      g.addColorStop(0, `rgba(255,61,31,${core.a})`);
      g.addColorStop(0.4, `rgba(255,61,31,${core.a * 0.4})`);
      g.addColorStop(1, "rgba(255,61,31,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, core.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Inherited s3 light: flare 0.7 -> 0, 1600 -> 2200 over 375-383; star glow
  // r 120 -> 0 over 375-387 (both EXPO_OUT).
  if (opts.inheritFlare && f < 388) {
    const t = prog(f, 375, 383, EXPO_OUT);
    drawFlare(ctx, { width: lerp(1600, 2200, t), alpha: lerp(0.7, 0, t) });
    const ts = prog(f, 375, 387, EXPO_OUT);
    drawStar(ctx, {
      glowR: lerp(120, 0, ts),
      glowA: 0.9,
      coreR: lerp(2.5, 0, ts),
      x: CENTER.x,
      y: CENTER.y,
    });
  }
};

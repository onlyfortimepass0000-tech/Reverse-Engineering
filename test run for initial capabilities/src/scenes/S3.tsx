/**
 * s3 — STRUCTURE: the corridor of brackets (global 225-374).
 *
 * One 1920x1080 canvas. Same world, projection and floor as s2 (film.ts):
 * the camera speed-ramps (camZ_s3) down a fogged graphite floor, through five
 * billboarded Instrument Serif bracket pairs, toward a vanishing star that
 * blooms into an anamorphic flare on the cut.
 *
 * Local frame = global - 225 (mounted in a <Sequence from={225}>). All maths
 * below runs on the GLOBAL frame `g` (fractional during motion-blur sampling).
 */
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  EXPO_IN,
  EXPO_OUT,
  PALETTE,
  SINE_IN_OUT,
  camSpeed_s3,
  camX_s3,
  camZ_s3,
  drawFlare,
  drawFloor,
  drawStar,
  floorFog,
  floorY_s3,
  half,
  lerp,
  planeToWorld,
  prog,
  project,
  projectSegment,
  roll_s3,
  smoothstep,
  useFontsReady,
  type PlaneState,
} from "../film/film";
import { rng } from "../film/motion";

const START = 225;
const W = 1920;
const H = 1080;

/* ------------------------------------------------------------------ */
/* Camera / floor state                                                 */
/* ------------------------------------------------------------------ */
const planeAt = (g: number): PlaneState => ({
  thDeg: 90,
  Yo: floorY_s3(g),
  camZ: camZ_s3(g),
  camX: camX_s3(g),
  roll: roll_s3(g),
});

/** Transverse floor lines fade out before they can strobe (296-322). */
const transverseFade = (g: number) => 1 - smoothstep(296, 322, g);

/* ------------------------------------------------------------------ */
/* Speed dashes                                                         */
/* ------------------------------------------------------------------ */
const DASH_COUNT = 220;
const DASH_REPEAT = 9000;
const DASH_BUCKETS = 16;
const DASHES = (() => {
  const r = rng(0x53a7);
  return Array.from({ length: DASH_COUNT }, () => {
    const side = r() < 0.5 ? -1 : 1;
    const X = side * (140 + r() * (2400 - 140));
    const Z0 = r() * DASH_REPEAT;
    return { X, Z0 };
  });
})();
const dashFadeIn = (g: number) => prog(g, 296, 312, SINE_IN_OUT);

/* ------------------------------------------------------------------ */
/* Brackets                                                             */
/* ------------------------------------------------------------------ */
const BRACKET_PX = 700;
const BRACKET_FONT = (px: number) => `400 ${px}px "Instrument Serif", serif`;
const PAIRS: { Z: number; open: string; close: string }[] = [
  { Z: -1600, open: "{", close: "}" },
  { Z: -2800, open: "(", close: ")" },
  { Z: -4000, open: "[", close: "]" },
  { Z: -5200, open: "(", close: ")" },
  { Z: -6400, open: "{", close: "}" },
];
const BRACKET_X = 460;
const BRACKET_Y = -40;
const RISE = 260;
const CULL = 160;

/** Glyph-centre offsets at 700px, from measured ink bounds (font must be loaded). */
type GlyphM = { cx: number; cy: number };
const glyphCache = new Map<string, GlyphM>();
let measureCtx: CanvasRenderingContext2D | null = null;
const glyphM = (ch: string): GlyphM => {
  const hit = glyphCache.get(ch);
  if (hit) return hit;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const c = measureCtx!;
  c.font = BRACKET_FONT(BRACKET_PX);
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  const m = c.measureText(ch);
  // Ink spans x in [-left, right], y in [-ascent, descent] around the origin.
  const v = {
    cx: (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
    cy: (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2,
  };
  glyphCache.set(ch, v);
  return v;
};

/** Pair k materialises at 228 + 7k over 22 frames (EXPO_OUT). */
const entrance = (g: number, k: number) => prog(g, 228 + 7 * k, 250 + 7 * k, EXPO_OUT);
const fogA = (depth: number) => Math.min(1, Math.max(0.06, 1.15 - depth / 4800));

/**
 * Rack focus: focus sits on the nearest pair still ahead (min 500); as that
 * pair leaves the frame (depth 650 -> 380) focus pulls to the next one. The
 * pull is eased over those few frames rather than cut, so nothing pops.
 */
const focusDepth = (camZ: number) => {
  const ahead = PAIRS.map((p) => camZ - p.Z).filter((d) => d > CULL);
  if (ahead.length === 0) return 500;
  const d0 = ahead[0];
  const d1 = ahead.length > 1 ? ahead[1] : d0;
  const w = 1 - smoothstep(380, 650, d0);
  return Math.max(500, lerp(d0, d1, w));
};

type PairSample = { x: number; y: number; px: number; alpha: number };

/** One bracket pair's opener/closer at (possibly fractional) global time t. */
const pairAt = (k: number, t: number): [PairSample, PairSample] | null => {
  const pair = PAIRS[k];
  const camZ = camZ_s3(t);
  const depth = camZ - pair.Z;
  if (depth < CULL) return null;
  const e = entrance(t, k);
  if (e <= 0) return null;
  const alpha = fogA(depth) * smoothstep(CULL, 400, depth) * e;
  if (alpha < 0.002) return null;
  const Y = BRACKET_Y + RISE * (1 - e);
  const camX = camX_s3(t);
  const roll = roll_s3(t);
  const a = project(-BRACKET_X, Y, pair.Z, camZ, camX, roll);
  const b = project(BRACKET_X, Y, pair.Z, camZ, camX, roll);
  if (!a || !b) return null;
  const px = BRACKET_PX * a.scale;
  return [
    { x: a.x, y: a.y, px, alpha },
    { x: b.x, y: b.y, px, alpha },
  ];
};

/** Rack-focus + entrance blur (px) for pair k at time t. */
const pairBlur = (k: number, t: number) => {
  const camZ = camZ_s3(t);
  const depth = camZ - PAIRS[k].Z;
  const e = entrance(t, k);
  return Math.min(8, Math.abs(depth - focusDepth(camZ)) / 300) + 12 * (1 - e);
};

/**
 * Offscreen W x H canvases, created once per tab and fully cleared before every
 * use (scratch buffers only, no state carried between frames). Accumulation
 * buffers ask for float16 storage where Chrome supports it, so averaging many
 * faint samples does not band.
 */
type Buf = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
const bufs = new Map<string, Buf>();
const buffer = (name: string, float = false): Buf => {
  const hit = bufs.get(name);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = ((float
    ? canvas.getContext("2d", { colorType: "float16" } as unknown as CanvasRenderingContext2DSettings)
    : null) ?? canvas.getContext("2d"))!;
  const b = { canvas, ctx };
  bufs.set(name, b);
  return b;
};

const MAX_SAMPLES = 40;

/**
 * Brackets, back to front. Each pair is accumulated over a trailing shutter
 * of `shutterLen` frames on its own layer (N sub-frame samples, N from its
 * on-screen travel, so fast passes smear instead of strobing and slow ones
 * cost one draw), then composited once through its focus blur.
 */
const drawBrackets = (ctx: CanvasRenderingContext2D, g: number, shutterLen: number) => {
  const roll = roll_s3(g);
  const rollRad = (roll * Math.PI) / 180;
  const { canvas: layer, ctx: lc } = buffer("pair", true);
  for (let k = PAIRS.length - 1; k >= 0; k--) {
    const now = pairAt(k, g);
    const then = pairAt(k, g - shutterLen);
    if (!now && !then) continue;
    let n = 1;
    let travel = 0;
    if (now && then && shutterLen > 0) {
      travel = Math.hypot(now[0].x - then[0].x, now[0].y - then[0].y) + 0.5 * Math.abs(now[0].px - then[0].px);
      n = Math.max(1, Math.min(MAX_SAMPLES, Math.ceil(travel / 1.5)));
    } else if (shutterLen > 0) {
      n = MAX_SAMPLES;
    }
    // When the travel outruns the sample budget, soften by the sample spacing
    // so the smear reads as continuous rather than striated.
    const spacing = n > 1 ? travel / (n - 1) : 0;
    const blur = pairBlur(k, g) + Math.max(0, spacing - 1.5) * 0.5;
    // Accumulate the samples as neutral coverage (white, additive alpha/n =
    // the average), then tint once: per-channel rounding of a coloured
    // accumulation would drift the Bone toward pink or green.
    lc.clearRect(0, 0, W, H);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    lc.save();
    lc.globalCompositeOperation = "lighter";
    lc.fillStyle = "#FFFFFF";
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? g : g - shutterLen * (1 - i / (n - 1));
      const s = pairAt(k, t);
      if (!s) continue;
      const pair = PAIRS[k];
      for (let j = 0; j < 2; j++) {
        const q = s[j];
        const ch = j === 0 ? pair.open : pair.close;
        const rx = 0.5 * q.px;
        const ry = 0.6 * q.px;
        if (q.x + rx < 0 || q.x - rx > W || q.y + ry < 0 || q.y - ry > H) continue;
        x0 = Math.min(x0, q.x - rx);
        x1 = Math.max(x1, q.x + rx);
        y0 = Math.min(y0, q.y - ry);
        y1 = Math.max(y1, q.y + ry);
        const m = glyphM(ch);
        const sc = q.px / BRACKET_PX;
        lc.globalAlpha = q.alpha / n;
        lc.font = BRACKET_FONT(q.px);
        lc.setTransform(1, 0, 0, 1, q.x, q.y);
        if (rollRad !== 0) lc.rotate(rollRad);
        lc.fillText(ch, -m.cx * sc, -m.cy * sc);
      }
    }
    lc.restore();
    if (x1 <= x0) continue;
    lc.save();
    lc.globalCompositeOperation = "source-in";
    lc.fillStyle = PALETTE.bone;
    lc.fillRect(0, 0, W, H);
    lc.restore();
    const pad = Math.ceil(blur * 3 + 4);
    const bx = Math.max(0, Math.floor(x0) - pad);
    const by = Math.max(0, Math.floor(y0) - pad);
    const bw = Math.min(W, Math.ceil(x1) + pad) - bx;
    const bh = Math.min(H, Math.ceil(y1) + pad) - by;
    if (bw <= 0 || bh <= 0) continue;
    ctx.save();
    ctx.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : "none";
    ctx.drawImage(layer, bx, by, bw, bh, bx, by, bw, bh);
    ctx.restore();
  }
};

/* ------------------------------------------------------------------ */
/* World drawing (everything except the screen-fixed star + flare)      */
/* ------------------------------------------------------------------ */
/** Floor, s2's first line and the speed dashes: everything on the ground plane. */
const drawWorld = (ctx: CanvasRenderingContext2D, g: number) => {
  const plane = planeAt(g);
  const tf = transverseFade(g);

  /* 1. Graphite floor. Before 296 this is exactly s2's single drawFloor call. */
  if (tf >= 1) {
    drawFloor(ctx, { plane, transverseAlpha: (k) => (k === 0 ? 0 : 1) });
  } else {
    drawFloor(ctx, { plane, transverseAlpha: () => 0 });
    if (tf > 0) {
      // Transverse lines on their own layer so the fade is continuous
      // (drawFloor buckets alpha in 1/8 steps).
      const { canvas: layer, ctx: lc } = buffer("transverse");
      lc.clearRect(0, 0, W, H);
      drawFloor(lc, { plane, transverseAlpha: (k) => (k === 0 ? 0 : 1), longitudinalAlpha: () => 0 });
      ctx.save();
      ctx.globalAlpha = tf;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
  }

  /* 2. s2's Bone first line (v = 0), still on the floor until the camera passes it
   * (it sits under the bottom letterbox bar the whole time). */
  const seg = projectSegment(planeToWorld(-960, 0, plane), planeToWorld(960, 0, plane), plane.camZ, plane.camX, plane.roll);
  if (seg && seg[0].y - 1 < H) {
    const y = half(seg[0].y);
    ctx.fillStyle = PALETTE.bone;
    const x0 = Math.max(0, seg[0].x);
    const x1 = Math.min(W, seg[1].x);
    if (x1 > x0) ctx.fillRect(x0, y - 1, x1 - x0, 2);
  }

  /* 3. Speed dashes: Bone, on the floor, length proportional to speed. */
  const fade = dashFadeIn(g);
  if (fade > 0) {
    const v = camSpeed_s3(g);
    const L = Math.min(560, Math.max(8, 2.4 * v));
    const Y = plane.Yo;
    const paths: (Path2D | null)[] = new Array(DASH_BUCKETS).fill(null);
    for (const d of DASHES) {
      const depth = (((d.Z0 + plane.camZ) % DASH_REPEAT) + DASH_REPEAT) % DASH_REPEAT;
      const Zw = plane.camZ - depth;
      const s = projectSegment([d.X, Y, Zw], [d.X, Y, Zw + L], plane.camZ, plane.camX, plane.roll);
      if (!s) continue;
      const fog = floorFog((s[0].depth + s[1].depth) / 2);
      if (fog <= 0.01) continue;
      const minX = Math.min(s[0].x, s[1].x);
      const maxX = Math.max(s[0].x, s[1].x);
      const minY = Math.min(s[0].y, s[1].y);
      const maxY = Math.max(s[0].y, s[1].y);
      if (maxX < -10 || minX > W + 10 || maxY < -10 || minY > H + 10) continue;
      const b = Math.min(DASH_BUCKETS - 1, Math.floor(fog * DASH_BUCKETS));
      const p = paths[b] ?? (paths[b] = new Path2D());
      p.moveTo(s[0].x, s[0].y);
      p.lineTo(s[1].x, s[1].y);
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = PALETTE.bone;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let b = 0; b < DASH_BUCKETS; b++) {
      const p = paths[b];
      if (!p) continue;
      ctx.globalAlpha = 0.55 * ((b + 0.5) / DASH_BUCKETS) * fade;
      ctx.stroke(p);
    }
    ctx.restore();
  }
};

/* ------------------------------------------------------------------ */
/* Motion blur 352-374: manual 5-sample accumulation                    */
/* ------------------------------------------------------------------ */
const MB_START = 352;
const MB_OFFSETS = [-0.8, -0.6, -0.4, -0.2, 0];
/** The shutter opens over 352-356 so the blur engages without a visible step. */
const shutter = (g: number) => prog(g, MB_START, MB_START + 4, SINE_IN_OUT);

const drawScene = (ctx: CanvasRenderingContext2D, g: number) => {
  ctx.clearRect(0, 0, W, H);

  if (g >= MB_START) {
    const { canvas: sample, ctx: sc } = buffer("sample");
    const { canvas: acc, ctx: ac } = buffer("acc", true);
    ac.clearRect(0, 0, W, H);
    const sh = shutter(g);
    for (const o of MB_OFFSETS) {
      sc.clearRect(0, 0, W, H);
      drawWorld(sc, g + o * sh);
      ac.save();
      ac.globalCompositeOperation = "lighter";
      ac.globalAlpha = 1 / MB_OFFSETS.length;
      ac.drawImage(sample, 0, 0);
      ac.restore();
    }
    ctx.drawImage(acc, 0, 0);
  } else {
    drawWorld(ctx, g);
  }

  /* Brackets: 180-degree shutter (0.5 f) throughout so the fast passes never
   * strobe, widening to the spec's 0.8 f as the 5-sample blur engages. */
  drawBrackets(ctx, g, lerp(0.5, 0.8, shutter(g)));

  /* Star and flare: screen-fixed light, drawn last and never motion-blurred,
   * so frame 374 hands s4 the exact peak values. */
  // s2 ends on an empty sky, so the star is born on the 225 downbeat and
  // breathes up over 20 frames (alpha 0 at 225: the cut stays seamless).
  const born = prog(g, 225, 245, SINE_IN_OUT);
  const ts = prog(g, 330, 374, EXPO_IN);
  if (born > 0) {
    ctx.save();
    ctx.globalAlpha = born;
    drawStar(ctx, { glowR: lerp(18, 120, ts), glowA: lerp(0.5, 0.9, ts) });
    ctx.restore();
  }
  if (g >= 366) {
    const tf = prog(g, 366, 374, EXPO_IN);
    drawFlare(ctx, { width: lerp(300, 1600, tf), alpha: 0.7 * tf });
  }
};

export const S3: React.FC = () => {
  const g = useCurrentFrame() + START;
  const ready = useFontsReady([`400 ${BRACKET_PX}px "Instrument Serif"`]);
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (!ready) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, g);
  }, [g, ready]);

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ink }}>
      <canvas ref={ref} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
    </AbsoluteFill>
  );
};

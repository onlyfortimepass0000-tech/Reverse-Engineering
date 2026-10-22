/**
 * FIRST LIGHT — shared film module. Single source of truth for palette, easing,
 * cameras, projection, floor drawing, flare/star, fonts gate and title layout.
 * Scene builders: treat this file as READ-ONLY. Every function is a pure
 * function of the GLOBAL frame unless stated otherwise.
 */
import { useEffect, useState } from "react";
import { Easing, interpolate, useDelayRender } from "remotion";
import { fontsLoaded } from "./fonts";
import { ease } from "./motion";

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
export const PALETTE = {
  ink: "#07070A",
  black: "#000000",
  graphite: "#3A3A42",
  ash: "#8A8A93",
  bone: "#EFEAE0",
  vermilion: "#FF3D1F",
  ember: "#FF8A3D",
  hot: "#FFF4E8",
} as const;

export const BONE_RGB = [239, 234, 224] as const;
export const VERMILION_RGB = [255, 61, 31] as const;

/* ------------------------------------------------------------------ */
/* Easing                                                              */
/* ------------------------------------------------------------------ */
export const EXPO_OUT = ease.expoOut;
export const EXPO_IN = ease.expoIn;
export const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const SNAP = Easing.bezier(0.7, 0, 0.2, 1);
export const SINE_IN_OUT = Easing.bezier(0.37, 0, 0.63, 1);

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Eased progress of `f` across [f0, f1], clamped. */
export const prog = (
  f: number,
  f0: number,
  f1: number,
  easing: (t: number) => number = (t) => t,
) => easing(clamp01((f - f0) / (f1 - f0)));

/* ------------------------------------------------------------------ */
/* Scene boundaries (global frames, inclusive)                         */
/* ------------------------------------------------------------------ */
export const SCENE_RANGES = {
  s1: [0, 119],
  s2: [120, 224],
  s3: [225, 374],
  s4: [375, 524],
  s5: [525, 599],
  s6: [600, 704],
  s7: [705, 839],
} as const;

/* ------------------------------------------------------------------ */
/* 3D projection                                                       */
/*   World: X right, Y DOWN (relative to camera eye height), Zw negative */
/*   is away from the viewer. Camera sits at (camX, 0, camZ) looking   */
/*   toward -Z. depth = camZ - Zw. At camZ=0, Zw=-1100 the scale is 1:1. */
/* ------------------------------------------------------------------ */
export const FOCAL = 1100;
export const CENTER = { x: 960, y: 540 } as const;
export const NEAR = 60;

export type Projected = { x: number; y: number; scale: number; depth: number };

export const project = (
  X: number,
  Y: number,
  Zw: number,
  camZ: number,
  camX = 0,
  rollDeg = 0,
  focal = FOCAL,
): Projected | null => {
  const depth = camZ - Zw;
  if (depth < NEAR) return null;
  const s = focal / depth;
  let x = (X - camX) * s;
  let y = Y * s;
  if (rollDeg !== 0) {
    const r = (rollDeg * Math.PI) / 180;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    const rx = x * c - y * sn;
    const ry = x * sn + y * c;
    x = rx;
    y = ry;
  }
  return { x: CENTER.x + x, y: CENTER.y + y, scale: s, depth };
};

type V3 = [number, number, number];

/**
 * Projects a 3D segment, clipping it against the near plane (depth >= NEAR)
 * BEFORE projection, so nothing explodes when a vertex passes the camera.
 * Returns null if fully behind the near plane.
 */
export const projectSegment = (
  a: V3,
  b: V3,
  camZ: number,
  camX = 0,
  rollDeg = 0,
  focal = FOCAL,
): [Projected, Projected] | null => {
  const da = camZ - a[2];
  const db = camZ - b[2];
  if (da < NEAR && db < NEAR) return null;
  let p = a;
  let q = b;
  if (da < NEAR) {
    const t = (NEAR - da) / (db - da);
    p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, camZ - NEAR];
  } else if (db < NEAR) {
    const t = (NEAR - db) / (da - db);
    q = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, camZ - NEAR];
  }
  const pa = project(p[0], p[1], p[2], camZ, camX, rollDeg, focal);
  const pb = project(q[0], q[1], q[2], camZ, camX, rollDeg, focal);
  if (!pa || !pb) return null;
  return [pa, pb];
};

/** Round to 0.5px to stop thin lines shimmering. */
export const half = (v: number) => Math.round(v * 2) / 2;

/** Depth fog used by all floor geometry. */
export const floorFog = (depth: number) => 1 - smoothstep(2200, 7500, depth);

/* ------------------------------------------------------------------ */
/* Plane (s2 grid -> s3 floor)                                         */
/*   plane point (u, v) -> X = u, Y = Yo + v cos(th), Zw = -1100 + v sin(th) */
/*   th = 0, Yo = 0, camZ = 0 is exactly the flat 1:1 frame.           */
/* ------------------------------------------------------------------ */
export type PlaneState = {
  thDeg: number;
  Yo: number;
  camZ: number;
  camX?: number;
  roll?: number;
};

export const planeToWorld = (u: number, v: number, st: PlaneState): V3 => {
  const th = (st.thDeg * Math.PI) / 180;
  return [u, st.Yo + v * Math.cos(th), -1100 + v * Math.sin(th)];
};

export const GRID = 120;
// Wider than the spec's ±24 so the floor's side edge never shows inside the fog range.
export const PLANE_U = [-56, 56] as const; // longitudinal line indices m (u = 120m)
export const PLANE_K = [-130, 8] as const; // transverse line indices k (v = 120k)
export const PLANE_V_RANGE = [-15600, 960] as const;
export const PLANE_U_RANGE = [-6720, 6720] as const;

export type FloorOptions = {
  plane: PlaneState;
  color?: string;
  lineWidth?: number;
  /** Global alpha multiplier. */
  alpha?: number;
  /** Per-line alpha for transverse lines (v = 120k). Return 0 to skip. */
  transverseAlpha?: (k: number) => number;
  /** Per-line alpha for longitudinal lines (u = 120m). Return 0 to skip. */
  longitudinalAlpha?: (m: number) => number;
  /** Optional drawn extent in u for transverse line k (for draw-on). */
  transverseExtent?: (k: number) => [number, number];
  /** Optional drawn extent in v for longitudinal line m (for draw-on). */
  longitudinalExtent?: (m: number) => [number, number];
  /** Segment length in plane units for fog/clipping. */
  segment?: number;
  fog?: boolean;
};

const strokeProjected = (
  ctx: CanvasRenderingContext2D,
  seg: [Projected, Projected],
) => {
  ctx.moveTo(half(seg[0].x), half(seg[0].y));
  ctx.lineTo(half(seg[1].x), half(seg[1].y));
};

/**
 * Draws the shared grid/floor plane. Lines are split into `segment`-unit
 * pieces, each clipped at the near plane and fogged by its own depth.
 * Alpha is bucketed (8 levels) so the whole floor is ~16 strokes.
 */
export const drawFloor = (ctx: CanvasRenderingContext2D, o: FloorOptions) => {
  const {
    plane,
    color = PALETTE.graphite,
    lineWidth = 1.25,
    alpha = 1,
    transverseAlpha = () => 1,
    longitudinalAlpha = () => 1,
    transverseExtent = () => [PLANE_U_RANGE[0], PLANE_U_RANGE[1]],
    longitudinalExtent = () => [PLANE_V_RANGE[0], PLANE_V_RANGE[1]],
    segment = 600,
    fog = true,
  } = o;
  const camX = plane.camX ?? 0;
  const roll = plane.roll ?? 0;
  const BUCKETS = 8;
  const paths: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
  const used = new Array(BUCKETS).fill(false);

  const addSeg = (a: V3, b: V3, lineAlpha: number) => {
    const seg = projectSegment(a, b, plane.camZ, camX, roll);
    if (!seg) return;
    const midDepth = (seg[0].depth + seg[1].depth) / 2;
    const fa = lineAlpha * alpha * (fog ? floorFog(midDepth) : 1);
    if (fa <= 0.004) return;
    // Cheap off-screen reject.
    const minX = Math.min(seg[0].x, seg[1].x);
    const maxX = Math.max(seg[0].x, seg[1].x);
    const minY = Math.min(seg[0].y, seg[1].y);
    const maxY = Math.max(seg[0].y, seg[1].y);
    if (maxX < -50 || minX > 1970 || maxY < -50 || minY > 1130) return;
    const bi = Math.min(BUCKETS - 1, Math.floor(fa * BUCKETS));
    const p = paths[bi];
    p.moveTo(half(seg[0].x), half(seg[0].y));
    p.lineTo(half(seg[1].x), half(seg[1].y));
    used[bi] = true;
  };

  // Transverse lines: v = 120k, spanning u extent.
  for (let k = PLANE_K[0]; k <= PLANE_K[1]; k++) {
    const la = transverseAlpha(k);
    if (la <= 0) continue;
    const [u0, u1] = transverseExtent(k);
    if (u1 <= u0) continue;
    const v = k * GRID;
    // Transverse lines are at constant depth; one segment is enough unless clipped.
    addSeg(planeToWorld(u0, v, plane), planeToWorld(u1, v, plane), la);
  }
  // Longitudinal lines: u = 120m, spanning v extent in `segment` pieces.
  for (let m = PLANE_U[0]; m <= PLANE_U[1]; m++) {
    const la = longitudinalAlpha(m);
    if (la <= 0) continue;
    const [v0, v1] = longitudinalExtent(m);
    if (v1 <= v0) continue;
    const u = m * GRID;
    for (let v = v0; v < v1; v += segment) {
      const ve = Math.min(v1, v + segment);
      addSeg(planeToWorld(u, v, plane), planeToWorld(u, ve, plane), la);
    }
  }

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "butt";
  ctx.strokeStyle = color;
  for (let i = 0; i < BUCKETS; i++) {
    if (!used[i]) continue;
    ctx.globalAlpha = (i + 0.5) / BUCKETS;
    ctx.stroke(paths[i]);
  }
  ctx.restore();
};

export { strokeProjected };

/* ------------------------------------------------------------------ */
/* Cameras                                                             */
/* ------------------------------------------------------------------ */

/** s2 forward dolly: starts at 200. camZ(224) = -201.6, speed 16.8 px/f. */
export const camZ_s2 = (f: number) => (f < 200 ? 0 : -0.35 * (f - 200) ** 2);

/** s3 speed ramp: continuous with s2 at 225 (-218.75, ~16.9 px/f) -> ~142 px/f at 374. */
export const camZ_s3 = (f: number) => {
  const p = (f - 225) / 149;
  return -218.75 - 7200 * (0.35 * p + 0.65 * p ** 4);
};
export const camSpeed_s3 = (f: number) => {
  const p = (f - 225) / 149;
  return (7200 * (0.35 + 2.6 * p ** 3)) / 149;
};
/** Unified forward camera across s2 and s3 (global frame). */
export const camZ_floor = (f: number) => (f < 225 ? camZ_s2(f) : camZ_s3(f));
/** s3 lateral sway and roll. */
export const camX_s3 = (f: number) => 36 * Math.sin((f - 225) / 38);
export const roll_s3 = (f: number) =>
  interpolate(f, [300, 374], [0, -5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
/** s3 floor height: 380 -> 330 over 240-374. */
export const floorY_s3 = (f: number) =>
  interpolate(f, [240, 374], [380, 330], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SINE_IN_OUT,
  });

/* s1 SVG viewBox camera ------------------------------------------------ */
export type CamS1 = { s: number; cx: number; cy: number };

/** Number of glyphs typed by global frame f (s1): one every 3 frames from 45. */
export const typedCountS1 = (f: number) =>
  f < 45 ? 0 : Math.max(0, Math.min(10, Math.floor((f - 45) / 3) + 1));
/** Cursor centre x in world units (s1). */
export const cursorCenterXS1 = (f: number) => 786 + 38.4 * typedCountS1(f);

export const camS1 = (f: number): CamS1 => {
  if (f < 45) {
    const s = interpolate(f, [0, 44], [6.0, 5.7], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease.camera,
    });
    return { s, cx: 786, cy: 540 };
  }
  if (f <= 78) {
    const e = ease.expoInOut(clamp01((f - 45) / (78 - 45)));
    const s = lerp(5.7, 1.0, e);
    let track = 0;
    for (let d = 0; d < 4; d++) track += cursorCenterXS1(f - d);
    track /= 4;
    return { s, cx: lerp(track, 960, e), cy: 540 };
  }
  const s = interpolate(f, [78, 119], [1.0, 1.05], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SINE_IN_OUT,
  });
  return { s, cx: 960, cy: 540 };
};

export const viewBoxS1 = (c: CamS1) =>
  `${c.cx - 960 / c.s} ${c.cy - 540 / c.s} ${1920 / c.s} ${1080 / c.s}`;

export const worldToScreen = (c: CamS1, wx: number, wy: number) => ({
  x: 960 + (wx - c.cx) * c.s,
  y: 540 + (wy - c.cy) * c.s,
});

/* ------------------------------------------------------------------ */
/* Star + anamorphic flare (s3 exit, s4 entrance)                      */
/* ------------------------------------------------------------------ */
export const drawStar = (
  ctx: CanvasRenderingContext2D,
  { glowR, glowA, coreR = 2.5, x = CENTER.x, y = CENTER.y }: {
    glowR: number;
    glowA: number;
    coreR?: number;
    x?: number;
    y?: number;
  },
) => {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (glowR > 0.5 && glowA > 0.003) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(239,234,224,${glowA})`);
    g.addColorStop(0.25, `rgba(239,234,224,${glowA * 0.45})`);
    g.addColorStop(0.6, `rgba(239,234,224,${glowA * 0.1})`);
    g.addColorStop(1, "rgba(239,234,224,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  if (coreR > 0) {
    ctx.fillStyle = PALETTE.bone;
    ctx.beginPath();
    ctx.arc(x, y, coreR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

export const drawFlare = (
  ctx: CanvasRenderingContext2D,
  { width, alpha, x = CENTER.x, y = CENTER.y }: {
    width: number;
    alpha: number;
    x?: number;
    y?: number;
  },
) => {
  if (alpha <= 0.003 || width <= 1) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
  g.addColorStop(0, "rgba(239,234,224,0)");
  g.addColorStop(0.5, `rgba(239,234,224,${alpha})`);
  g.addColorStop(1, "rgba(239,234,224,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - width / 2, y - 1, width, 2);
  // Soft twin: 24px tall at 30%.
  const g2 = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
  g2.addColorStop(0, "rgba(239,234,224,0)");
  g2.addColorStop(0.5, `rgba(239,234,224,${alpha * 0.3})`);
  g2.addColorStop(1, "rgba(239,234,224,0)");
  ctx.filter = "blur(6px)";
  ctx.fillStyle = g2;
  ctx.fillRect(x - width / 2, y - 12, width, 24);
  ctx.restore();
};

/* ------------------------------------------------------------------ */
/* Fonts gate                                                          */
/* ------------------------------------------------------------------ */
export const FONT_SPECS = [
  '400 64px "JetBrains Mono"',
  '300 19px "JetBrains Mono"',
  '400 200px "Instrument Serif"',
  'italic 400 200px "Instrument Serif"',
];

/** Blocks the render until the given font specs are loaded. Returns readiness. */
export const useFontsReady = (specs: string[] = FONT_SPECS) => {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading film fonts"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Wait until @remotion/fonts has REGISTERED every face; document.fonts.load()
    // alone resolves immediately (with []) if it runs before registration.
    fontsLoaded
      .then(() => Promise.all(specs.map((s) => document.fonts.load(s))))
      .then(() => document.fonts.ready)
      .then(() => {
        if (cancelled) return;
        setReady(true);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
};

/* ------------------------------------------------------------------ */
/* Title layout: "First Light."                                        */
/* ------------------------------------------------------------------ */
export const TITLE_FONT_SIZE = 200;
export const TITLE_TRACKING_PX = -0.005 * TITLE_FONT_SIZE; // -1px
export const TITLE_BASELINE = 552;
export const TITLE_HAIRLINE_Y = 622;
export const TITLE_DOT_D = 24;

export type TitleGlyph = { ch: string; italic: boolean; left: number; width: number };
export type TitleLayout = {
  left: number;
  W: number;
  wF: number;
  wL: number;
  P: { x: number; y: number };
  hairline: { x0: number; x1: number; y: number };
  baseline: number;
  glyphs: TitleGlyph[];
};

let measureCtx: CanvasRenderingContext2D | null = null;
const measure = (text: string, italic: boolean) => {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  const ctx = measureCtx!;
  ctx.font = `${italic ? "italic " : ""}400 ${TITLE_FONT_SIZE}px "Instrument Serif"`;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${TITLE_TRACKING_PX}px`;
  return ctx.measureText(text).width;
};

let cachedTitle: TitleLayout | null = null;

/** Must be called only after useFontsReady() reports true. */
export const TITLE_LAYOUT = (): TitleLayout => {
  if (cachedTitle) return cachedTitle;
  const real =
    document.fonts.check(`400 ${TITLE_FONT_SIZE}px "Instrument Serif"`) &&
    document.fonts.check(`italic 400 ${TITLE_FONT_SIZE}px "Instrument Serif"`);
  const first = "First ";
  const light = "Light";
  const wF = measure(first, false);
  const wL = measure(light, true);
  const W = wF + wL + 8 + TITLE_DOT_D;
  const left = 960 - W / 2;
  const glyphs: TitleGlyph[] = [];
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === " ") continue;
    glyphs.push({
      ch,
      italic: false,
      left: left + measure(first.slice(0, i + 1), false) - measure(ch, false),
      width: measure(ch, false),
    });
  }
  for (let j = 0; j < light.length; j++) {
    glyphs.push({
      ch: light[j],
      italic: true,
      left: left + wF + measure(light.slice(0, j + 1), true) - measure(light[j], true),
      width: measure(light[j], true),
    });
  }
  const layout: TitleLayout = {
    left,
    W,
    wF,
    wL,
    P: { x: left + wF + wL + 8 + TITLE_DOT_D / 2, y: 540 },
    hairline: { x0: left - 24, x1: left + W + 24, y: TITLE_HAIRLINE_Y },
    baseline: TITLE_BASELINE,
    glyphs,
  };
  // Never cache a layout measured with a fallback face.
  if (real) cachedTitle = layout;
  return layout;
};

/* ------------------------------------------------------------------ */
/* s5 / s6 shared constants                                            */
/* ------------------------------------------------------------------ */
export const S5_DOT = { x: 1114, y: 540, d: 14 } as const;

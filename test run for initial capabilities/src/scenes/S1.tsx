/**
 * s1 — NULL: `let light;` (global frames 0-119; local frame == global frame).
 *
 * One SVG whose viewBox is the camera (glyphs re-rasterise crisp at 6x), plus a
 * screen-space layer for the vermilion cursor, placed through worldToScreen so
 * it can detach from the camera at 98 and land pixel-exact on (960,540).
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  EXPO_IN,
  EXPO_OUT,
  IN_OUT,
  PALETTE,
  camS1,
  clamp01,
  prog,
  typedCountS1,
  useFontsReady,
  viewBoxS1,
  worldToScreen,
  type CamS1,
} from "../film/film";
import { MONO } from "../film/fonts";
import { ease } from "../film/motion";

/* ------------------------------------------------------------------ */
/* World layout                                                         */
/* ------------------------------------------------------------------ */
const L1 = "let light;";
const L1_X0 = 768;
const L1_ADV = 38.4; // 0.6em at 64px
const L1_BASE = 563;
const L1_SIZE = 64;
// 'let', space and ';' are Ash; 'light' is Bone.
const L1_FILL = (k: number) => (k >= 4 && k <= 8 ? PALETTE.bone : PALETTE.ash);

const L2 = "← undefined";
const L2_X0 = 768;
const L2_ADV = 19.2; // 0.6em at 32px
const L2_BASE = 626;
const L2_SIZE = 32;

const CUR_W = 36;
const CUR_H = 70;
const CUR_TOP = 505;
const BAR_W = 36;
const BAR_H = 4;

const FONT_SPECS_S1 = ['400 64px "JetBrains Mono"', '400 32px "JetBrains Mono"'];

/** Exact-endpoint lerp (returns b exactly at t = 1, so the bar lands on integers). */
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

/* ------------------------------------------------------------------ */
/* Camera (local refinement of film.ts camS1, see report)               */
/* ------------------------------------------------------------------ */
/**
 * trackX = analytic (continuous) mean of the cursor-centre x over [f-3, f].
 * The cursor steps +38.4 every 3 frames from 45, so the 3-frame continuous mean
 * is exactly a linear ramp 786 -> 1170 over 45..75. film.ts averages 4 discrete
 * samples instead, which makes the camera velocity stutter 1:1:2 (55/55/110 px
 * per frame at 5.7x) while the giant letterforms slide past the lens.
 */
const trackX = (f: number) => 786 + (L1_ADV / 3) * Math.min(30, Math.max(0, f - 45));

/**
 * Same expoInOut / endpoints as camS1, but s is interpolated in log space
 * (constant perceived zoom rate): the pull-out reads as one even move instead of
 * the leftmost glyph racing to the frame edge (x = 20px at f59) and whipping back.
 */
const cam = (f: number): CamS1 => {
  if (f < 45 || f > 78) return camS1(f);
  const e = ease.expoInOut(clamp01((f - 45) / (78 - 45)));
  const s = e >= 1 ? 1 : Math.pow(5.7, 1 - e);
  return { s, cx: mix(trackX(f), 960, e), cy: 540 };
};

/* ------------------------------------------------------------------ */
/* Cursor                                                               */
/* ------------------------------------------------------------------ */
const quadOut = (t: number) => 1 - (1 - t) * (1 - t);
/** Square-wave blink softened by 2-frame ramps: on-frame 0.75 -> 1, off-frame 0.25 -> 0. */
const rise = (f: number, a: number) => quadOut(clamp01((f - (a - 1)) / 2));
const fall = (f: number, b: number) => 1 - quadOut(clamp01((f - (b - 1)) / 2));
const cursorOpacity = (f: number) =>
  Math.max(rise(f, 15) * fall(f, 23), rise(f, 30) * fall(f, 38), rise(f, 45));

type Rect = { x: number; y: number; w: number; h: number; blur: number };

const cursorRect = (f: number): Rect => {
  if (f < 98) {
    const c = cam(f);
    const tl = worldToScreen(c, L1_X0 + L1_ADV * typedCountS1(f), CUR_TOP);
    return { x: tl.x, y: tl.y, w: CUR_W * c.s, h: CUR_H * c.s, blur: 4 * c.s };
  }
  // Detached into pure screen space from 98.
  const c98 = cam(98);
  const c0 = worldToScreen(c98, L1_X0 + L1_ADV * 10 + CUR_W / 2, CUR_TOP + CUR_H / 2);
  const e1 = prog(f, 98, 108, IN_OUT);
  const e2 = prog(f, 100, 114, IN_OUT);
  const w = mix(CUR_W * c98.s, BAR_W, e1);
  const h = mix(CUR_H * c98.s, BAR_H, e1);
  const cx = mix(c0.x, 960, e2);
  const cy = mix(c0.y, 540, e2);
  return { x: cx - w / 2, y: cy - h / 2, w, h, blur: 4 * c98.s };
};

/* ------------------------------------------------------------------ */
/* Glyph collapse (96-111)                                              */
/* ------------------------------------------------------------------ */
/** j = ordinal among the 19 non-space glyphs (line 1 then line 2). */
const collapse = (f: number, j: number) => 1 - prog(f, 96 + 0.5 * j, 102 + 0.5 * j, EXPO_IN);

const textProps = {
  fontFamily: MONO,
  fontWeight: 400,
  textRendering: "geometricPrecision" as const,
  style: { fontKerning: "none", fontVariantLigatures: "none", willChange: "auto" } as React.CSSProperties,
};

export const S1: React.FC = () => {
  const f = useCurrentFrame();
  const ready = useFontsReady(FONT_SPECS_S1);
  const c = cam(f);
  const typed = typedCountS1(f);

  // Line 1 glyphs (typed hard-on, collapsing left to right).
  const line1: React.ReactNode[] = [];
  let j = 0;
  for (let k = 0; k < L1.length; k++) {
    const ch = L1[k];
    if (ch === " ") continue;
    const jj = j++;
    if (k >= typed) continue;
    const sy = collapse(f, jj);
    if (sy <= 0.002) continue;
    line1.push(
      <text
        key={`a${k}`}
        x={L1_X0 + L1_ADV * k}
        y={L1_BASE}
        fontSize={L1_SIZE}
        fill={L1_FILL(k)}
        opacity={sy}
        transform={sy < 1 ? `translate(0 ${L1_BASE}) scale(1 ${sy}) translate(0 ${-L1_BASE})` : undefined}
        {...textProps}
      >
        {ch}
      </text>,
    );
  }

  // Line 2: the console answers (76-84), then collapses.
  const a2 = prog(f, 76, 84, EXPO_OUT);
  const line2: React.ReactNode[] = [];
  if (a2 > 0) {
    for (let k = 0; k < L2.length; k++) {
      const ch = L2[k];
      if (ch === " ") continue;
      const jj = j++;
      const sy = collapse(f, jj);
      if (sy <= 0.002) continue;
      line2.push(
        <text
          key={`b${k}`}
          x={L2_X0 + L2_ADV * k}
          y={L2_BASE}
          fontSize={L2_SIZE}
          fill={PALETTE.ash}
          opacity={sy}
          transform={sy < 1 ? `translate(0 ${L2_BASE}) scale(1 ${sy}) translate(0 ${-L2_BASE})` : undefined}
          {...textProps}
        >
          {ch}
        </text>,
      );
    }
  }

  const op = cursorOpacity(f);
  const r = cursorRect(f);
  const haloOp = 0.45 * op * (1 - prog(f, 98, 108, IN_OUT));

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ink }}>
      {ready ? (
        <svg
          width={1920}
          height={1080}
          viewBox={viewBoxS1(c)}
          style={{ position: "absolute", left: 0, top: 0, willChange: "auto", overflow: "hidden" }}
        >
          <g>{line1}</g>
          {line2.length ? (
            <g opacity={a2} transform={`translate(0 ${10 * (1 - a2)})`}>
              {line2}
            </g>
          ) : null}
        </svg>
      ) : null}

      {/* Screen-space cursor layer. */}
      {op > 0.001 && haloOp > 0.002 ? (
        <div
          style={{
            position: "absolute",
            left: r.x,
            top: r.y,
            width: r.w,
            height: r.h,
            backgroundColor: PALETTE.vermilion,
            opacity: haloOp,
            filter: `blur(${r.blur}px)`,
          }}
        />
      ) : null}
      {op > 0.001 ? (
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={PALETTE.vermilion} opacity={op} />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};

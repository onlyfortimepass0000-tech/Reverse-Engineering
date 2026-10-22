/**
 * s2 — THE LINE: origin, grid, and the fall into a floor (global 120-224).
 *
 * One 1920x1080 canvas. Every line lives on the film.ts plane
 * (u, v) -> X = u, Y = Yo + v cos th, Zw = -1100 + v sin th, which at
 * th = 0, Yo = 0, camZ = 0 is exactly the flat 1:1 frame. The flat Swiss grid
 * (120-188) and the tilted floor (188-224) are therefore the same drawing,
 * through drawFloor(), so nothing re-registers when the page starts to fall.
 *
 * Local frame = global - 120 (mounted in a <Sequence from={120}>). All maths
 * below runs on the GLOBAL frame `g`.
 */
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolateColors, useCurrentFrame } from "remotion";
import {
  EXPO_OUT,
  PALETTE,
  SINE_IN_OUT,
  SNAP,
  camZ_s2,
  clamp01,
  drawFloor,
  half,
  lerp,
  planeToWorld,
  prog,
  projectSegment,
  useFontsReady,
  type PlaneState,
} from "../film/film";
import { MONO } from "../film/fonts";

const START = 120;
const W = 1920;
const H = 1080;
const CX = 960;
const CY = 540;

/** drawFloor's top alpha bucket ((7 + 0.5) / 8): every locally drawn graphite
 * line uses it too, so a line handed from local drawing to drawFloor never steps. */
const LINE_ALPHA = 15 / 16;
const GRAPHITE_RGB = "58,58,66";
const RULE_EASE = Easing.out(Easing.poly(4));
/** Trailing half-frame shutter used for the speed tips of fast draw-ons. */
const SHUTTER = 0.5;

/* ------------------------------------------------------------------ */
/* Timeline (global frames)                                             */
/* ------------------------------------------------------------------ */
const TILT0 = 188;
const TILT_LEN = 36;

/** Tilt progress: SNAP over 188-224 (lands with zero angular velocity). */
const tiltE = (g: number) => (g <= TILT0 ? 0 : SNAP(clamp01((g - TILT0) / TILT_LEN)));

const planeAt = (g: number): PlaneState => {
  const e = tiltE(g);
  return { thDeg: 90 * e, Yo: 380 * e, camZ: camZ_s2(g) };
};

/** 120-134: the bar stretches edge to edge. */
const barP = (g: number) => prog(g, 120, 134, SNAP);
const barW = (g: number) => lerp(36, 1920, barP(g));
const barH = (g: number) => lerp(4, 2, barP(g));
const barColor = (g: number) =>
  interpolateColors(prog(g, 120, 134, SINE_IN_OUT), [0, 1], [PALETTE.vermilion, PALETTE.bone]);

/** 140-162: rule k (1..3) peels off the centre line to y = 540 +/- 120k. */
const ruleP = (g: number, k: number) => prog(g, 140 + 3 * (k - 1), 156 + 3 * (k - 1), RULE_EASE);

/** 150-176: column m draws from y = 540 outward, half-length 0 -> 540. */
const colL = (g: number, m: number) => {
  const a = 150 + 1.5 * Math.abs(m);
  return 540 * prog(g, a, a + 14, EXPO_OUT);
};
/** Column fully drawn for the whole shutter interval: handed to drawFloor. */
const colDone = (g: number, m: number) => g - SHUTTER >= 150 + 1.5 * Math.abs(m) + 14;

/* ------------------------------------------------------------------ */
/* Origin label `(0, 0)`                                               */
/* ------------------------------------------------------------------ */
const LABEL = "(0, 0)";
const LABEL_SIZE = 18;
const LABEL_STEP = 0.6 * LABEL_SIZE + 0.06 * LABEL_SIZE; // mono advance + 0.06em tracking
const LABEL_X = 972;
const LABEL_BASE = 528;

/** Per-character fade-up 166-172, whole-label fade-out 180-186. */
const labelChar = (g: number, i: number) => {
  const a = prog(g, 166 + 0.5 * i, 169.5 + 0.5 * i, EXPO_OUT);
  const out = 1 - prog(g, 180, 186, SINE_IN_OUT);
  return { op: a * out, dy: 5 * (1 - a) };
};

/* ------------------------------------------------------------------ */
/* Drawing                                                              */
/* ------------------------------------------------------------------ */
const drawScene = (ctx: CanvasRenderingContext2D, g: number) => {
  ctx.clearRect(0, 0, W, H);
  const flat = g < TILT0;
  const plane = planeAt(g);

  /* 1. Graphite plane: landed rules + columns (flat), the whole floor (tilt). */
  if (g >= 140) {
    if (flat) {
      drawFloor(ctx, {
        plane,
        transverseAlpha: (k) => {
          const a = Math.abs(k);
          return a >= 1 && a <= 3 && ruleP(g, a) >= 1 ? 1 : 0;
        },
        // Finished columns only; columns still drawing on are stroked locally (3.).
        longitudinalAlpha: (m) => (Math.abs(m) <= 8 && colDone(g, m) ? 1 : 0),
        longitudinalExtent: () => [-540, 540],
      });
    } else {
      // The full plane: |k| >= 4 and |m| > 8 were hidden (alpha 0) before 188;
      // in the flat frame they sit off-screen or under the letterbox, so they
      // switch on invisibly and swing into view as the page falls.
      drawFloor(ctx, {
        plane,
        transverseAlpha: (k) => (k === 0 ? 0 : 1), // v = 0 is the Bone first line
      });
    }
  }

  if (flat) {
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineWidth = 1.25;

    /* 2. Rules in flight: crisp line + a faint trailing speed streak. */
    for (let k = 1; k <= 3; k++) {
      const p = ruleP(g, k);
      if (p <= 0 || p >= 1) continue;
      const pPrev = ruleP(g - SHUTTER, k);
      for (const s of [-1, 1]) {
        const y = CY + s * 120 * k * p;
        const yPrev = CY + s * 120 * k * pPrev;
        const len = Math.abs(y - yPrev);
        if (len > 1.5) {
          const gr = ctx.createLinearGradient(0, yPrev, 0, y);
          gr.addColorStop(0, `rgba(${GRAPHITE_RGB},0)`);
          gr.addColorStop(1, `rgba(${GRAPHITE_RGB},${0.32 * LINE_ALPHA})`);
          ctx.fillStyle = gr;
          ctx.fillRect(0, Math.min(y, yPrev), W, len);
        }
        ctx.globalAlpha = LINE_ALPHA;
        ctx.strokeStyle = PALETTE.graphite;
        ctx.beginPath();
        ctx.moveTo(0, half(y));
        ctx.lineTo(W, half(y));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /* 3. Columns drawing on: one stroke per column, solid to the length reached
     * when the (trailing, half-frame) shutter opened, fading to the current
     * tip. A single stroke, so there is no seam where the tip meets the body. */
    for (let m = -8; m <= 8; m++) {
      if (colDone(g, m)) continue;
      const L1 = colL(g, m);
      if (L1 < 0.5) continue;
      const L0 = colL(g - SHUTTER, m);
      const x = half(CX + 120 * m);
      const y0 = half(CY - L1);
      const y1 = half(CY + L1);
      const t = clamp01((L1 - L0) / (2 * L1));
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, `rgba(${GRAPHITE_RGB},0)`);
      gr.addColorStop(t, `rgba(${GRAPHITE_RGB},${LINE_ALPHA})`);
      gr.addColorStop(1 - t, `rgba(${GRAPHITE_RGB},${LINE_ALPHA})`);
      gr.addColorStop(1, `rgba(${GRAPHITE_RGB},0)`);
      ctx.strokeStyle = gr;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 4. The first line (v = 0), always on top. */
  if (g < 134) {
    // The cursor bar stretching edge to edge, vermilion cooling to Bone.
    const col = barColor(g);
    const h = barH(g);
    const wSolid = barW(g - SHUTTER);
    const wNow = barW(g);
    const top = CY - h / 2;
    const x0 = CX - wNow / 2;
    const t = (wNow - wSolid) / 2 / wNow;
    if (t * wNow > 0.5) {
      // Speed-tapered tips in the same fill as the body (no seam).
      const rgb = col.match(/\d+(\.\d+)?/g)!.slice(0, 3).join(",");
      const gr = ctx.createLinearGradient(x0, 0, x0 + wNow, 0);
      gr.addColorStop(0, `rgba(${rgb},0)`);
      gr.addColorStop(t, `rgba(${rgb},1)`);
      gr.addColorStop(1 - t, `rgba(${rgb},1)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gr;
    } else {
      ctx.fillStyle = col;
    }
    ctx.fillRect(x0, top, wNow, h);
  } else {
    const seg = projectSegment(planeToWorld(-960, 0, plane), planeToWorld(960, 0, plane), plane.camZ);
    if (seg) {
      const y = half(seg[0].y);
      if (y - 1 < H) {
        ctx.fillStyle = PALETTE.bone;
        const x0 = Math.max(0, seg[0].x);
        const x1 = Math.min(W, seg[1].x);
        ctx.fillRect(x0, y - 1, x1 - x0, 2);
      }
    }
  }
};

export const S2: React.FC = () => {
  const g = useCurrentFrame() + START;
  const ready = useFontsReady(['400 18px "JetBrains Mono"']);
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, g);
  }, [g]);

  const showLabel = ready && g >= 166 && g < 186;

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ink }}>
      <canvas ref={ref} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
      {showLabel ? (
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "hidden" }}>
          {LABEL.split("").map((ch, i) => {
            if (ch === " ") return null;
            const { op, dy } = labelChar(g, i);
            if (op <= 0.002) return null;
            return (
              <text
                key={i}
                x={LABEL_X + LABEL_STEP * i}
                y={LABEL_BASE + dy}
                fill={PALETTE.ash}
                opacity={op}
                fontFamily={MONO}
                fontWeight={400}
                fontSize={LABEL_SIZE}
                style={{ fontVariantNumeric: "tabular-nums", fontKerning: "none", fontVariantLigatures: "none" }}
              >
                {ch}
              </text>
            );
          })}
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};

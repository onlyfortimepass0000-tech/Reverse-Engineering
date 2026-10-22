import { Trail } from "@remotion/motion-blur";
import { noise2D } from "@remotion/noise";
import React from "react";
import { AbsoluteFill, Easing, useCurrentFrame } from "remotion";
import {
  EXPO_OUT,
  IN_OUT,
  PALETTE,
  S5_DOT,
  SCENE_RANGES,
  SINE_IN_OUT,
  TITLE_LAYOUT,
  clamp01,
  lerp,
  prog,
  useFontsReady,
} from "../film/film";
import { MONO } from "../film/fonts";
import { rng } from "../film/motion";

/**
 * s6 IGNITION (600-704). DOM/CSS composition, local frame = global - 600.
 * Every value below is a pure function of the GLOBAL frame `f`.
 */
const START = SCENE_RANGES.s6[0];

/* Easing.inOut(Easing.exp) is 0.000488 at t=0 and 0.99951 at t=1. Normalise it
 * so the sun lands on P (and the horizon on the hairline) exactly. */
const expInOutRaw = Easing.inOut(Easing.exp);
const E0 = expInOutRaw(0);
const E1 = expInOutRaw(1);
const EXP_IN_OUT = (t: number) => (expInOutRaw(clamp01(t)) - E0) / (E1 - E0);
const OUT_CUBIC = Easing.out(Easing.cubic);
const IN_CUBIC = Easing.in(Easing.cubic);
const OUT_QUAD = Easing.out(Easing.quad);

const BLEED: React.CSSProperties = { position: "absolute", left: -40, top: -40, width: 2000, height: 1160 };

const BONE = (a: number) => `rgba(239,234,224,${a})`;
const VERM = (a: number) => `rgba(255,61,31,${a})`;

/* ------------------------------------------------------------------ */
/* Camera: punch 1.00 -> 1.10 (600-604), pull-out to 1.00 (604-676),   */
/* noise shake 600-610. Origin (960, 600).                             */
/* ------------------------------------------------------------------ */
const camera = (f: number) => {
  const s =
    f < 604
      ? lerp(1, 1.1, prog(f, 600, 604, EXPO_OUT))
      : lerp(1.1, 1, prog(f, 604, 676, IN_OUT));
  const q = clamp01((f - 600) / 10);
  const amp = (1 - q) ** 2;
  const n = f * 0.9;
  return {
    s,
    x: noise2D("shake", n, 0) * 14 * amp,
    y: noise2D("shake", 0, n + 37.3) * 14 * amp,
    r: noise2D("shake-r", n, 0) * 0.5 * amp,
  };
};

/* ------------------------------------------------------------------ */
/* Sun: centre + diameter                                              */
/* ------------------------------------------------------------------ */
const sunState = (f: number, P: { x: number; y: number }) => {
  if (f < 602) return { cx: S5_DOT.x, cy: S5_DOT.y, d: 220 };
  if (f <= 632) {
    const e = prog(f, 602, 632, EXPO_OUT);
    return { cx: lerp(S5_DOT.x, 960, e), cy: lerp(S5_DOT.y, 690, e), d: lerp(220, 1160, e) };
  }
  if (f <= 678) {
    return { cx: 960, cy: lerp(690, 662, prog(f, 632, 678, SINE_IN_OUT)), d: 1160 };
  }
  const e = EXP_IN_OUT((f - 678) / 26);
  return { cx: lerp(960, P.x, e), cy: lerp(662, P.y, e), d: lerp(1160, 24, e) };
};

/** Bloom box-shadow: blur, spread, alpha. */
const bloom = (f: number) => {
  if (f <= 678) {
    const e = prog(f, 600, 630, EXPO_OUT);
    return { blur: lerp(140, 60, e), spread: lerp(40, 10, e), a: lerp(0.6, 0.35, e) };
  }
  const e = EXP_IN_OUT((f - 678) / 26);
  return { blur: lerp(60, 14, e), spread: lerp(10, 0, e), a: lerp(0.35, 0.5, e) };
};

/** Hot-core stop: 55% -> 0% over 600-640 (the sun settles into flat Bass vermilion). */
const hotStop = (f: number) => lerp(55, 0, prog(f, 600, 640, IN_OUT));

/* ------------------------------------------------------------------ */
/* Horizon: 2px Bone line at y=690 drawn out 604-628, then (678-704)   */
/* rises to the 1px title hairline at row 622 spanning x0..x1.         */
/* ------------------------------------------------------------------ */
const HORIZON_HALF = 964; // just past the frame edges at camera scale 1
const horizon = (f: number, hair: { x0: number; x1: number; y: number }) => {
  const draw = prog(f, 604, 628, EXPO_OUT);
  let x0 = 960 - HORIZON_HALF * draw;
  let x1 = 960 + HORIZON_HALF * draw;
  let top = 689;
  let h = 2;
  if (f > 678) {
    const e = EXP_IN_OUT((f - 678) / 26);
    x0 = lerp(x0, hair.x0, e);
    x1 = lerp(x1, hair.x1, e);
    top = lerp(689, hair.y, e);
    h = lerp(2, 1, e);
  }
  return { x0, x1, top, h, clipY: top + h / 2 };
};

/* ------------------------------------------------------------------ */
/* Rays: soft conic wedges revealed by a radial mask                   */
/* ------------------------------------------------------------------ */
const raysRm = (f: number) => {
  if (f < 666) return lerp(600, 2400, prog(f, 628, 650, EXPO_OUT));
  return lerp(2400, 600, prog(f, 666, 682, IN_CUBIC));
};

/* ------------------------------------------------------------------ */
/* Debris: the remnant `light = ` from s5, blown left over 600-614     */
/* ------------------------------------------------------------------ */
const CELL = 38.4;
const TEXT_LEFT = 787.2; // s5 screen left of cell 0 after the +154px reframe
const S5_PUSH = 1.035; // s5 push-in, anchored on the dot
const S5_BLUR = 2.5;
const S5_TEXT_OPACITY = 0.72;
const CELLS = "light = ";
const GLYPHS = CELLS.split("")
  .map((ch, i) => ({ ch, i, j: CELLS.length - 1 - i }))
  .filter((g) => g.ch !== " ")
  .map((g) => {
    const r = rng(9001 + g.j * 131);
    return {
      ...g,
      color: g.ch === "=" ? PALETTE.ash : PALETTE.bone,
      dy: (r() * 2 - 1) * 40,
      rot: (r() * 2 - 1) * 12,
    };
  });

let eqBaseline: number | null = null;
/** Baseline that puts the centre of the '=' bars exactly on y = 540 (as s5 does). */
const textBaseline = () => {
  if (eqBaseline !== null) return eqBaseline;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = '400 64px "JetBrains Mono"';
  const m = ctx.measureText("=");
  eqBaseline = 540 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  return eqBaseline;
};

const GLYPH_PAD = 40;
const GLYPH_ASC = 90;

/** Rendered once live and 6x frozen by <Trail>. `liveFrame` is the real local frame. */
const Debris: React.FC<{ liveFrame: number; baseline: number }> = ({ liveFrame, baseline }) => {
  const lf = useCurrentFrame();
  // A trail sample from before the hit would sit on top of the live glyphs and
  // over-brighten them; the glyphs were still then, so it contributes nothing.
  if (lf !== liveFrame && lf <= 0) return null;
  const t = clamp01(lf / 14);
  const e = OUT_CUBIC(t);
  const opacity = S5_TEXT_OPACITY * (1 - e);
  if (opacity <= 0.002) return null;
  return (
    <AbsoluteFill style={{ transform: `scale(${S5_PUSH})`, transformOrigin: `${S5_DOT.x}px ${S5_DOT.y}px` }}>
      {GLYPHS.map((g) => {
        const tx = -(240 + 60 * g.j) * e;
        const ty = g.dy * e;
        const rot = g.rot * e;
        const blur = lerp(S5_BLUR, 10, e);
        return (
          <svg
            key={g.i}
            width={CELL + GLYPH_PAD * 2}
            height={GLYPH_ASC + 40}
            style={{
              position: "absolute",
              left: TEXT_LEFT + CELL * g.i - GLYPH_PAD,
              top: baseline - GLYPH_ASC,
              overflow: "visible",
              transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
              transformOrigin: `${GLYPH_PAD + CELL / 2}px ${GLYPH_ASC - 20}px`,
              filter: `blur(${blur}px)`,
              opacity,
            }}
          >
            <text
              x={GLYPH_PAD}
              y={GLYPH_ASC}
              fill={g.color}
              style={{ fontFamily: MONO, fontWeight: 400, fontSize: 64 }}
            >
              {g.ch}
            </text>
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
export const S6: React.FC = () => {
  const local = useCurrentFrame();
  const f = local + START;
  const ready = useFontsReady();
  if (!ready) return <AbsoluteFill style={{ backgroundColor: PALETTE.ink }} />;

  const T = TITLE_LAYOUT();
  const cam = camera(f);
  const sun = sunState(f, T.P);
  const R = sun.d / 2;
  const hz = horizon(f, T.hairline);
  const bl = bloom(f);

  /* Shockwave ring 600-628 */
  const ringT = clamp01((f - 600) / 28);
  const ringR = lerp(10, 1500, EXPO_OUT(ringT));
  const ringA = 0.9 * (1 - SINE_IN_OUT(ringT));

  /* Rays 628-682 */
  const Rm = raysRm(f);
  // Opacity follows the reveal radius, so the rays fade in as they extend and
  // fade out as they retract (no residual ring at Rm = 600, no 1-frame pop at 682).
  const rayAmt = clamp01((Rm - 600) / 1800);
  const rayRot = 4 * prog(f, 628, 704, SINE_IN_OUT);
  const maskIn = R + 30;
  const maskFull = R + 60;
  const maskOuter = Math.max(Rm, maskFull);

  /* Reflection strips 606-684 */
  const stripsOut = 1 - prog(f, 670, 684, IN_CUBIC);
  const strips: { top: number; h: number; left: number; w: number; a: number }[] = [];
  if (f >= 606 && stripsOut > 0) {
    for (let j = 0; j < 16; j++) {
      const sIn = prog(f, 606 + 1.2 * j, 620 + 1.2 * j, EXPO_OUT);
      const sc = sIn * stripsOut;
      if (sc <= 0) continue;
      const y = 698 + 12 * j + 0.7 * j * j;
      const d = (y - 690) * 1.6;
      if (d >= R) continue;
      const w = 0.9 * 2 * Math.sqrt(R * R - d * d) * sc;
      if (w < 0.5) continue;
      const cx = sun.cx + noise2D(`refl${j}`, f * 0.06, 0) * 18;
      strips.push({ top: Math.round(y), h: Math.round(3 + 0.5 * j), left: cx - w / 2, w, a: 0.55 * (1 - j / 16) });
    }
  }

  /* Ember flash 600-609 */
  const flashA = 0.6 * (1 - OUT_QUAD(clamp01((f - 600) / 9)));

  const hot = hotStop(f);
  // While the stop shrinks, the core colour also cools toward vermilion, so the
  // core dissolves into the flat disc instead of collapsing to a white pinpoint.
  const cool = prog(f, 610, 636, IN_OUT);
  const core = `rgb(255,${Math.round(lerp(244, 61, cool))},${Math.round(lerp(232, 31, cool))})`;
  const discBg =
    hot > 0.05 && cool < 1
      ? `radial-gradient(circle closest-side, ${core} 0%, ${PALETTE.vermilion} ${hot}%, ${PALETTE.vermilion} 100%)`
      : PALETTE.vermilion;

  const bloomSoft = lerp(260, 0, prog(f, 600, 618, IN_OUT));
  const bloomMask = `linear-gradient(to bottom, #000 ${hz.clipY + 400}px, transparent ${hz.clipY + 400 + Math.max(0.01, bloomSoft)}px)`;

  const baseline = textBaseline();

  return (
    <AbsoluteFill>
      {/* Full-frame layers bleed 40px past the frame so the shell's chromatic
          aberration (R/B offset up to 7px at 600) never exposes a coloured edge. */}
      <div style={{ ...BLEED, backgroundColor: PALETTE.ink }} />
      <AbsoluteFill
        style={{
          transform: `translate(${cam.x}px, ${cam.y}px) rotate(${cam.r}deg) scale(${cam.s})`,
          transformOrigin: "960px 600px",
        }}
      >
        {/* RAYS: behind the sun, clipped above the horizon */}
        {rayAmt > 0.002 ? (
          <AbsoluteFill
            style={{
              clipPath: `inset(-200px -200px ${1080 - hz.clipY}px -200px)`,
              opacity: rayAmt,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -200,
                top: -200,
                width: 2320,
                height: 1480,
                background: `repeating-conic-gradient(from ${3.8 + rayRot}deg at ${sun.cx + 200}px ${sun.cy + 200}px, ${BONE(0)} 0deg, ${BONE(0.16)} 1.2deg, ${BONE(0)} 2.4deg, ${BONE(0)} 10deg)`,
                WebkitMaskImage: `radial-gradient(circle at ${sun.cx + 200}px ${sun.cy + 200}px, transparent ${maskIn}px, #000 ${maskFull}px, #000 ${maskOuter}px, transparent ${maskOuter + 240}px)`,
                maskImage: `radial-gradient(circle at ${sun.cx + 200}px ${sun.cy + 200}px, transparent ${maskIn}px, #000 ${maskFull}px, #000 ${maskOuter}px, transparent ${maskOuter + 240}px)`,
              }}
            />
          </AbsoluteFill>
        ) : null}

        {/* EARLY BLOOM (600-617): the box-shadow's exact equivalent (a filled disc
            grown by the spread and blurred by sigma = blur/2) on its own layer, so
            its horizon edge can start soft. A hard clip here would cut a glow
            "shelf" on 600-604, before the horizon line exists. The edge hardens by
            618, when the drawn line covers it and the disc's own box-shadow takes
            over (identical above the horizon, so there is no pop). */}
        {f < 618 ? (
          <div
            style={{
              position: "absolute",
              left: -400,
              top: -400,
              width: 2720,
              height: 1880,
              WebkitMaskImage: bloomMask,
              maskImage: bloomMask,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: sun.cx - R - bl.spread + 400,
                top: sun.cy - R - bl.spread + 400,
                width: sun.d + 2 * bl.spread,
                height: sun.d + 2 * bl.spread,
                borderRadius: "50%",
                backgroundColor: VERM(bl.a),
                filter: `blur(${bl.blur / 2}px)`,
              }}
            />
          </div>
        ) : null}

        {/* SUN: flat disc, hard-clipped at the horizon */}
        <AbsoluteFill style={{ clipPath: `inset(-400px -400px ${1080 - hz.clipY}px -400px)` }}>
          <div
            style={{
              position: "absolute",
              left: sun.cx - R,
              top: sun.cy - R,
              width: sun.d,
              height: sun.d,
              borderRadius: "50%",
              background: discBg,
              boxShadow: f >= 618 ? `0 0 ${bl.blur}px ${bl.spread}px ${VERM(bl.a)}` : undefined,
            }}
          />
        </AbsoluteFill>

        {/* REFLECTION: 16 vermilion strips below the horizon */}
        {strips.map((s, j) => (
          <div
            key={j}
            style={{
              position: "absolute",
              left: s.left,
              top: s.top,
              width: s.w,
              height: s.h,
              backgroundColor: PALETTE.vermilion,
              opacity: s.a,
            }}
          />
        ))}

        {/* HORIZON -> HAIRLINE (in front of the disc) */}
        {hz.x1 - hz.x0 > 0.5 ? (
          <div
            style={{
              position: "absolute",
              left: hz.x0,
              top: hz.top,
              width: hz.x1 - hz.x0,
              height: hz.h,
              backgroundColor: PALETTE.bone,
            }}
          />
        ) : null}

        {/* SHOCKWAVE: soft radial-gradient ring */}
        {ringA > 0.003 ? (
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at ${S5_DOT.x}px ${S5_DOT.y}px, ${BONE(0)} ${Math.max(0, ringR - 28)}px, ${BONE(0.85)} ${Math.max(0, ringR - 2)}px, ${BONE(0)} ${ringR + 4}px)`,
              opacity: ringA,
            }}
          />
        ) : null}

        {/* DEBRIS: `light = ` blown away, Trail motion blur 600-614 only */}
        {local <= 14 ? (
          <Trail layers={6} lagInFrames={0.35} trailOpacity={0.5}>
            <Debris liveFrame={local} baseline={baseline} />
          </Trail>
        ) : null}
      </AbsoluteFill>

      {/* EMBER FLASH 600-609 */}
      {flashA > 0.002 ? (
        <div style={{ ...BLEED, backgroundColor: PALETTE.ember, mixBlendMode: "screen", opacity: flashA }} />
      ) : null}
    </AbsoluteFill>
  );
};

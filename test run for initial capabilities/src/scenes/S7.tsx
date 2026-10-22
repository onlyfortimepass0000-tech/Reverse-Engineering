import React, { useEffect, useState } from "react";
import { AbsoluteFill, Easing, useCurrentFrame, useDelayRender } from "remotion";
import {
  EXPO_OUT,
  IN_OUT,
  PALETTE,
  SINE_IN_OUT,
  TITLE_BASELINE,
  TITLE_DOT_D,
  TITLE_FONT_SIZE,
  TITLE_HAIRLINE_Y,
  TITLE_TRACKING_PX,
  clamp01,
  lerp,
  prog,
} from "../film/film";
import { MONO, SERIF } from "../film/fonts";

/**
 * s7 TITLE (705-839). DOM composition, local frame = global - 705.
 *
 * "First Light." rises glyph by glyph from behind the hairline (one mask whose
 * bottom edge is y = 622), the vermilion full stop that s6 parked at P answers
 * with one spring pulse, the hairline withdraws, the credit types up, a single
 * warm specular band crosses the letters, and the full stop blinks once like the
 * frame-15 cursor. The whole card breathes 1.00 -> 1.03 about (960,540).
 */
const START = 705;

/* ------------------------------------------------------------------ */
/* Typographic constants (measured from the font files, not guessed)   */
/* ------------------------------------------------------------------ */
// Instrument Serif Regular + Italic: hhea = OS/2 typo = win = 990 / -310 per 1000
// upm (USE_TYPO_METRICS set). At 200px: ascent 198px, descent 62px, both integers,
// so Chrome's (rounded) line metrics are exact and the baseline is
// top + halfLeading + ascent with halfLeading = 0 when line-height = 260px.
const SERIF_ASC = 198;
const SERIF_DESC = 62;
const LINE_H = SERIF_ASC + SERIF_DESC; // 260
const PAD_X = 90; // background painting room for italic overhang
const PAD_Y = 40;
const SPAN_TOP = TITLE_BASELINE - SERIF_ASC - PAD_Y; // 314
const SPAN_H = LINE_H + 2 * PAD_Y; // 340 (padding box height)
const MASK_BOTTOM = 622; // the hairline row

// JetBrains Mono: advance exactly 0.6em. Credit at 19px with 0.28em tracking.
const CREDIT = "WRITTEN IN CODE BY AI";
const CREDIT_SIZE = 19;
const CREDIT_ADV = 0.6 * CREDIT_SIZE + 0.28 * CREDIT_SIZE; // 11.4 + 5.32
const CREDIT_W = CREDIT.length * 0.6 * CREDIT_SIZE + (CREDIT.length - 1) * 0.28 * CREDIT_SIZE;
const CREDIT_X0 = 960 - CREDIT_W / 2;
const CREDIT_BASELINE = 676;

const OUT_CUBIC = Easing.out(Easing.cubic);
const OUT_SIN = Easing.out(Easing.sin);

const BONE_RGB = [239, 234, 224];
const HOT_RGB = [255, 244, 232];
const PEAK = (() => {
  const m = 0.85;
  const c = BONE_RGB.map((b, i) => lerp(b, HOT_RGB[i], m).toFixed(1));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
})();

/* ------------------------------------------------------------------ */
/* Fonts gate (local, see sharedModuleIssues). film.ts useFontsReady()   */
/* awaits document.fonts.load(spec), which resolves at once when         */
/* @remotion/fonts has not yet added the FontFace (it fetches, loads and  */
/* only then calls document.fonts.add). In some render tabs that let      */
/* TITLE_LAYOUT() measure the fallback serif and cache it (title ~140px   */
/* wider, P at x~1386). This gate waits until the actual faces are in    */
/* document.fonts with status "loaded" before anything is measured.      */
/* ------------------------------------------------------------------ */
const NEEDED_FACES: [string, string][] = [
  ["Instrument Serif", "normal"],
  ["Instrument Serif", "italic"],
  ["JetBrains Mono", "normal"],
];
const facesLoaded = () =>
  NEEDED_FACES.every(([family, style]) => {
    let ok = false;
    document.fonts.forEach((ff) => {
      if (ff.family.replace(/["']/g, "") === family && ff.style === style && ff.status === "loaded") ok = true;
    });
    return ok;
  });

const useTitleFontsReady = () => {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender("s7: waiting for title font faces"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const t0 = performance.now();
    const poll = () => {
      if (cancelled) return;
      if (facesLoaded() || performance.now() - t0 > 25000) {
        document.fonts.ready.then(() => {
          if (cancelled) return;
          setReady(true);
          continueRender(handle);
        });
        return;
      }
      timer = setTimeout(poll, 20);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
};

/* ------------------------------------------------------------------ */
/* Local title layout. Same formula as film.ts TITLE_LAYOUT (left, W, P, */
/* hairline), but measured only after the gate above and never read     */
/* from the shared cache, which another scene may have filled too early. */
/* Glyph lefts: TITLE_LAYOUT uses width(prefix), which omits the kern    */
/* pair between glyph i-1 and glyph i ('Fi' -12u, 'ig' -14u). The run    */
/* position is width(prefix + ch) - width(ch).                           */
/* ------------------------------------------------------------------ */
let mctx: CanvasRenderingContext2D | null = null;
const measure = (text: string, italic: boolean) => {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  const ctx = mctx!;
  ctx.font = `${italic ? "italic " : ""}400 ${TITLE_FONT_SIZE}px "Instrument Serif"`;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${TITLE_TRACKING_PX}px`;
  return ctx.measureText(text).width;
};

type Glyph = { ch: string; italic: boolean; left: number };
type Layout = {
  left: number;
  W: number;
  P: { x: number; y: number };
  hairline: { x0: number; x1: number; y: number };
  glyphs: Glyph[];
};
let cachedLayout: Layout | null = null;
const titleLayout = (): Layout => {
  if (cachedLayout) return cachedLayout;
  const wF = measure("First ", false);
  const wL = measure("Light", true);
  const W = wF + wL + 8 + TITLE_DOT_D;
  const left = 960 - W / 2;
  const glyphs: Glyph[] = [];
  const words: [string, boolean, number][] = [
    ["First", false, left],
    ["Light", true, left + wF],
  ];
  for (const [word, italic, x0] of words) {
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      glyphs.push({ ch, italic, left: x0 + measure(word.slice(0, i + 1), italic) - measure(ch, italic) });
    }
  }
  const layout: Layout = {
    left,
    W,
    P: { x: left + wF + wL + 8 + TITLE_DOT_D / 2, y: 540 },
    hairline: { x0: left - 24, x1: left + W + 24, y: TITLE_HAIRLINE_Y },
    glyphs,
  };
  // Only cache a layout measured with the real faces.
  if (facesLoaded()) cachedLayout = layout;
  return layout;
};

/* ------------------------------------------------------------------ */
/* Timelines (global frames)                                           */
/* ------------------------------------------------------------------ */
/** Camera breath: 1.00 -> 1.03 about (960,540), Easing.out(sin), 705-839. */
const camScale = (f: number) => 1 + 0.03 * OUT_SIN(clamp01((f - 705) / 134));

/** Glyph i rises +230 -> 0 with blur 8 -> 0 over 22 frames from 707 + 2i. */
const glyphRise = (f: number, i: number) => {
  const t = prog(f, 707 + 2 * i, 729 + 2 * i, EXPO_OUT);
  return { ty: 230 * (1 - t), blur: 8 * (1 - t) };
};

/**
 * Full-stop pulse at 750: the closed-form impulse response of the spring
 * (damping 10, mass 0.5, stiffness 100 -> decay 10/s, damped freq 10 rad/s),
 * normalised so the single lobe peaks at exactly 1. One kick, a ~4% undershoot,
 * settled by ~765.
 */
const PULSE_NORM = Math.exp(-Math.PI / 4) * Math.sin(Math.PI / 4);
const pulse = (f: number) => {
  if (f <= 750) return 0;
  const t = (f - 750) / 30;
  const v = (Math.exp(-10 * t) * Math.sin(10 * t)) / PULSE_NORM;
  return Math.abs(v) < 1e-4 ? 0 : v;
};

/** Bookend blink, mechanical like the s1 cursor: 1 -> 0.12 (819-821), hold, -> 1 (824-826). */
const blink = (f: number) => {
  if (f <= 819 || f >= 826) return 1;
  if (f <= 821) return lerp(1, 0.12, (f - 819) / 2);
  if (f <= 824) return 0.12;
  return lerp(0.12, 1, (f - 824) / 2);
};

/** Specular sweep: band centre X (frame x) from left-200 to left+W+200, 776-806. */
const sweepX = (f: number, left: number, W: number) =>
  lerp(left - 200, left + W + 200, prog(f, 776, 806, SINE_IN_OUT));

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
export const S7: React.FC = () => {
  const local = useCurrentFrame();
  const f = local + START;
  const ready = useTitleFontsReady();
  if (!ready) return <AbsoluteFill style={{ backgroundColor: PALETTE.ink }} />;

  const T = titleLayout();
  const glyphs = T.glyphs;
  const s = camScale(f);

  /* Shared gradient box for the specular sweep: every glyph span shows its own
     slice of one title-wide background, so the band is globally continuous. */
  const BX0 = T.left - 200;
  const BW = T.W + 400;
  const theta = (100 * Math.PI) / 180;
  const Lg = Math.abs(BW * Math.sin(theta)) + Math.abs(SPAN_H * Math.cos(theta));
  const yRef = TITLE_BASELINE - 72 - SPAN_TOP; // mid cap-height, in box coordinates
  const X = sweepX(f, T.left, T.W);
  const p = Lg / 2 + (X - BX0 - BW / 2) * Math.sin(theta) - (yRef - SPAN_H / 2) * Math.cos(theta);
  const bone = PALETTE.bone;
  const gradient = `linear-gradient(100deg, ${bone} 0px, ${bone} ${(p - 70).toFixed(2)}px, ${PEAK} ${p.toFixed(2)}px, ${bone} ${(p + 70).toFixed(2)}px, ${bone} ${Math.max(Lg, p + 71).toFixed(2)}px)`;

  /* Full stop */
  const k = pulse(f);
  const dotD = TITLE_DOT_D * (1 + 0.18 * k);
  const glow = 14 + 12 * k;
  const dotOpacity = blink(f);

  /* Hairline exit 744-764: contracts to its centre while fading */
  const hx = prog(f, 744, 764, IN_OUT);
  const hairW = (T.hairline.x1 - T.hairline.x0) * (1 - hx);
  const hairCx = (T.hairline.x0 + T.hairline.x1) / 2;

  /* Credit 752-765 */
  const creditChars: { ch: string; x: number; t: number }[] = [];
  let vis = 0;
  for (let i = 0; i < CREDIT.length; i++) {
    const ch = CREDIT[i];
    if (ch === " ") continue;
    const st = 752 + 0.4 * vis;
    vis++;
    const t = prog(f, st, st + 6, OUT_CUBIC);
    if (t <= 0) continue;
    creditChars.push({ ch, x: CREDIT_X0 + i * CREDIT_ADV, t });
  }

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ink }}>
      <AbsoluteFill
        style={{
          transform: s === 1 ? undefined : `scale(${s})`,
          transformOrigin: "960px 540px",
          willChange: "auto",
        }}
      >
        {/* TITLE GLYPHS: one mask whose bottom edge is the hairline row */}
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: MASK_BOTTOM, overflow: "hidden" }}>
          {glyphs.map((g, i) => {
            const r = glyphRise(f, i);
            if (r.ty >= 230 - 1e-6) return null; // still fully behind the horizon
            const spanLeft = g.left - PAD_X;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: spanLeft,
                  top: SPAN_TOP,
                  padding: `${PAD_Y}px ${PAD_X}px`,
                  fontFamily: SERIF,
                  fontWeight: 400,
                  fontStyle: g.italic ? "italic" : "normal",
                  fontSize: TITLE_FONT_SIZE,
                  lineHeight: `${LINE_H}px`,
                  whiteSpace: "pre",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                  backgroundImage: gradient,
                  backgroundSize: `${BW}px ${SPAN_H}px`,
                  backgroundPosition: `${BX0 - spanLeft}px 0px`,
                  backgroundRepeat: "no-repeat",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  transform: r.ty > 0.01 ? `translateY(${r.ty}px)` : undefined,
                  filter: r.blur > 0.01 ? `blur(${r.blur}px)` : undefined,
                  willChange: "auto",
                }}
              >
                {g.ch}
              </span>
            );
          })}
        </div>

        {/* HAIRLINE (exactly where s6 left it), exits 744-764 */}
        {hairW > 0.05 && hx < 1 ? (
          <div
            style={{
              position: "absolute",
              left: hairCx - hairW / 2,
              top: T.hairline.y,
              width: hairW,
              height: 1,
              backgroundColor: PALETTE.bone,
              opacity: 1 - hx,
            }}
          />
        ) : null}

        {/* FULL STOP: the sun, parked at P; never moves */}
        <div
          style={{
            position: "absolute",
            left: T.P.x - dotD / 2,
            top: T.P.y - dotD / 2,
            width: dotD,
            height: dotD,
            borderRadius: "50%",
            backgroundColor: PALETTE.vermilion,
            boxShadow: `0 0 ${glow}px 0px rgba(255,61,31,0.5)`,
            opacity: dotOpacity,
          }}
        />

        {/* CREDIT: SVG text so the baseline is exactly y = 676 */}
        {creditChars.length > 0 ? (
          <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {creditChars.map((c, i) => (
              <text
                key={i}
                x={c.x}
                y={CREDIT_BASELINE + 6 * (1 - c.t)}
                fill={PALETTE.ash}
                fillOpacity={c.t}
                fontFamily={MONO}
                fontWeight={300}
                fontSize={CREDIT_SIZE}
              >
                {c.ch}
              </text>
            ))}
          </svg>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

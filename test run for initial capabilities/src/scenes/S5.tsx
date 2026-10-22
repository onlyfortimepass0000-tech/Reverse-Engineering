import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import {
  IN_OUT,
  PALETTE,
  S5_DOT,
  SCENE_RANGES,
  SINE_IN_OUT,
  lerp,
  prog,
  useFontsReady,
} from "../film/film";
import { MONO } from "../film/fonts";
import {
  COUNTER,
  counterOpacity,
  counterText,
  renderSphereFrame,
} from "../film/sphere";

/**
 * s5 HOLD: `light =` (525-599). Local frame = global - 525; every value below
 * is a pure function of the GLOBAL frame `f`.
 *
 * 525-550  COLLAPSE: the shared s4 canvas renderer (sphere.ts), driven by the
 *          global frame, plus the s4 counter fading out (525-535, +6px).
 * 551-599  DOM: the world condensed to one vermilion point. A world group pans
 *          +154px (554-580) carrying the dot and the typed `light = `; a push-in
 *          wrapper scales 1.00 -> 1.035 about the dot (560-599); the text racks
 *          out of focus (584-599) while the dot stays sharp.
 */
const START = SCENE_RANGES.s5[0];
const SETTLE = 551;

/** Matches s4's counter (letter-spacing 0.2em adds 4px after the last glyph). */
const TRAILING_HALF = 2;

/* Code line: one 64px JetBrains Mono cell grid shared with s1 (advance 0.6em). */
const CELL = 38.4;
const CELLS = "light = ";
/** World left of cell 0; after the +154px reframe the screen left is 787.2. */
const WORLD_LEFT = 633.2;
const PAN_X = S5_DOT.x - 960; // 154
const TYPE_START = 556;

let eqBaseline: number | null = null;
/**
 * Baseline that puts the centre of the '=' bars exactly on y = 540 (measured
 * once on the real face; s6 uses the identical formula for its debris).
 */
const textBaseline = () => {
  if (eqBaseline !== null) return eqBaseline;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = '400 64px "JetBrains Mono"';
  const m = ctx.measureText("=");
  eqBaseline = 540 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  return eqBaseline;
};

export const S5: React.FC = () => {
  const f = useCurrentFrame() + START;
  const ready = useFontsReady();
  const ref = useRef<HTMLCanvasElement>(null);
  const collapse = f < SETTLE;

  useLayoutEffect(() => {
    if (!ready || !collapse || !ref.current) return;
    const ctx = ref.current.getContext("2d");
    if (!ctx) return;
    renderSphereFrame(ctx, f);
  }, [f, ready, collapse]);

  if (collapse) {
    const opacity = counterOpacity(f);
    const dy = 6 * prog(f, 525, 535, SINE_IN_OUT);
    return (
      <AbsoluteFill>
        <canvas ref={ref} width={1920} height={1080} style={{ position: "absolute", inset: 0 }} />
        {ready && opacity > 0.002 ? (
          <svg
            width={1920}
            height={1080}
            style={{ position: "absolute", inset: 0, transform: `translateY(${dy}px)` }}
          >
            <text
              x={COUNTER.x + TRAILING_HALF}
              y={COUNTER.baseline}
              textAnchor="middle"
              fill={PALETTE.ash}
              opacity={opacity}
              style={{
                fontFamily: MONO,
                fontWeight: 400,
                fontSize: 20,
                letterSpacing: "0.2em",
                fontVariantNumeric: "tabular-nums",
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {counterText(f)}
            </text>
          </svg>
        ) : null}
      </AbsoluteFill>
    );
  }

  /* ---------------- 551-599: the point, the reframe, the line ---------------- */
  // SETTLE: spring 1.9 -> 1.0 (damping 12, mass 0.6).
  const sp = spring({ frame: f - SETTLE, fps: 30, config: { damping: 12, mass: 0.6 } });
  const dotScale = lerp(1.9, 1, sp);
  // REFRAME: world group X 0 -> +154 (IN_OUT).
  const panX = PAN_X * prog(f, 554, 580, IN_OUT);
  // HELD BREATH: push-in about the dot (SINE_IN_OUT).
  const push = lerp(1, 1.035, prog(f, 560, 599, SINE_IN_OUT));
  // RACK FOCUS off the code, onto the value.
  const rack = prog(f, 584, 599, SINE_IN_OUT);
  const textBlur = 2.5 * rack;
  const textOpacity = 1 - 0.28 * rack;
  // TYPING: one cell every 2 frames, hard-on (mechanical keystrokes).
  const typed = f < TYPE_START ? 0 : Math.min(CELLS.length, Math.floor((f - TYPE_START) / 2) + 1);
  const baseline = ready ? textBaseline() : 561;

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${push})`,
        transformOrigin: `${S5_DOT.x}px ${S5_DOT.y}px`,
        willChange: "auto",
      }}
    >
      <AbsoluteFill style={{ transform: `translateX(${panX}px)`, willChange: "auto" }}>
        {ready && typed > 0 ? (
          <svg
            width={1920}
            height={1080}
            style={{
              position: "absolute",
              inset: 0,
              overflow: "visible",
              opacity: textOpacity,
              filter: textBlur > 0.001 ? `blur(${textBlur}px)` : undefined,
            }}
          >
            {CELLS.slice(0, typed)
              .split("")
              .map((ch, i) =>
                ch === " " ? null : (
                  <text
                    key={i}
                    x={WORLD_LEFT + CELL * i}
                    y={baseline}
                    fill={ch === "=" ? PALETTE.ash : PALETTE.bone}
                    style={{ fontFamily: MONO, fontWeight: 400, fontSize: 64 }}
                  >
                    {ch}
                  </text>
                ),
              )}
          </svg>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: 960 - S5_DOT.d / 2,
            top: S5_DOT.y - S5_DOT.d / 2,
            width: S5_DOT.d,
            height: S5_DOT.d,
            borderRadius: "50%",
            backgroundColor: PALETTE.vermilion,
            boxShadow: "0 0 18px 2px rgba(255,61,31,0.55)",
            transform: `scale(${dotScale})`,
            transformOrigin: "50% 50%",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

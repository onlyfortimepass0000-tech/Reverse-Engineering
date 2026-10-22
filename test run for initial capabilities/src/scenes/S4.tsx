import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { PALETTE, SCENE_RANGES, useFontsReady } from "../film/film";
import { MONO } from "../film/fonts";
import {
  COUNTER,
  counterOpacity,
  counterText,
  renderSphereFrame,
} from "../film/sphere";

const START = SCENE_RANGES.s4[0];

/** Letter-spacing 0.2em at 20px adds 4px after the last glyph; offset half of
 *  it so the visible ink (not the advance box) is centred on x = 960. */
const TRAILING_HALF = 2;

/**
 * s4 MATTER (375-524): fly-through with inherited flare decay, then 4096
 * code particles compile into the spinning Fibonacci sphere. All drawing is
 * renderSphereFrame(global frame) from src/film/sphere.ts (shared with s5).
 */
export const S4: React.FC = () => {
  const local = useCurrentFrame();
  const f = local + START;
  const ready = useFontsReady();
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (!ready || !ref.current) return;
    const ctx = ref.current.getContext("2d");
    if (!ctx) return;
    renderSphereFrame(ctx, f, { inheritFlare: true });
  }, [f, ready]);

  const opacity = counterOpacity(f);

  return (
    <AbsoluteFill>
      <canvas ref={ref} width={1920} height={1080} style={{ position: "absolute", inset: 0 }} />
      {ready && opacity > 0 ? (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
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
};

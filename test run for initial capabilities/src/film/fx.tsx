import { lightLeak } from "@remotion/effects/light-leak";
import { noise2D } from "@remotion/noise";
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Solid,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ease, rng, tween } from "./motion";

/* ------------------------------------------------------------------ */
/* Film grain: pre-baked seeded noise tiles, re-positioned each frame. */
/* ------------------------------------------------------------------ */
const TILE = 256;
const TILE_COUNT = 6;

const makeGrainTiles = (): string[] => {
  const tiles: string[] = [];
  for (let t = 0; t < TILE_COUNT; t++) {
    const c = document.createElement("canvas");
    c.width = TILE;
    c.height = TILE;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(TILE, TILE);
    const r = rng(1009 + t * 7919);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(r() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tiles.push(c.toDataURL("image/png"));
  }
  return tiles;
};

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  const tiles = useMemo(makeGrainTiles, []);
  const r = rng(frame * 2654435761);
  const tile = tiles[frame % TILE_COUNT];
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tile})`,
        backgroundSize: `${TILE}px ${TILE}px`,
        backgroundPosition: `${Math.floor(r() * TILE)}px ${Math.floor(r() * TILE)}px`,
        mixBlendMode: "overlay",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Vignette                                                            */
/* ------------------------------------------------------------------ */
export const Vignette: React.FC<{ strength?: number }> = ({
  strength = 0.55,
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

/* ------------------------------------------------------------------ */
/* Letterbox: 2.39:1 bars. `amount` 0 = no bars, 1 = full scope bars.  */
/* ------------------------------------------------------------------ */
export const LETTERBOX_BAR = Math.round((1080 - 1920 / 2.39) / 2); // 138px

export const Letterbox: React.FC<{ amount: number; color?: string }> = ({
  amount,
  color = "#000",
}) => {
  const h = LETTERBOX_BAR * amount;
  if (h <= 0.01) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, background: color }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, background: color }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Camera rig: push/pan/rotate with optional organic handheld shake    */
/* and rack-focus blur. All values are plain numbers you animate.      */
/* ------------------------------------------------------------------ */
export type CameraProps = {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  perspective?: number;
  /** Handheld shake amplitude in px (0 = locked off). */
  shake?: number;
  shakeSpeed?: number;
  shakeSeed?: string;
  /** Rack-focus blur in px applied to the whole shot. */
  blur?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export const Camera: React.FC<CameraProps> = ({
  x = 0,
  y = 0,
  scale = 1,
  rotate = 0,
  rotateX = 0,
  rotateY = 0,
  perspective = 1600,
  shake = 0,
  shakeSpeed = 0.05,
  shakeSeed = "cam",
  blur = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const sx = shake ? noise2D(shakeSeed + "x", frame * shakeSpeed, 0) * shake : 0;
  const sy = shake ? noise2D(shakeSeed + "y", 0, frame * shakeSpeed) * shake : 0;
  const sr = shake ? noise2D(shakeSeed + "r", frame * shakeSpeed, 5) * shake * 0.02 : 0;
  return (
    <AbsoluteFill style={{ perspective, overflow: "hidden", ...style }}>
      <AbsoluteFill
        style={{
          transform: `translate3d(${x + sx}px, ${y + sy}px, 0) scale(${scale}) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotate(${rotate + sr}deg)`,
          transformStyle: "preserve-3d",
          filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
          willChange: "transform",
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Chromatic aberration (SVG filter). Use on impacts, not constantly.  */
/* ------------------------------------------------------------------ */
let caCounter = 0;
export const ChromaticAberration: React.FC<{
  amount: number;
  children: React.ReactNode;
}> = ({ amount, children }) => {
  const id = useMemo(() => `ca-${++caCounter}`, []);
  const on = amount >= 0.05;
  // Structure is identical whether on or off, so children never remount.
  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        {on ? (
          <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={amount} dy="0" result="r2" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={-amount} dy="0" result="b2" />
            <feBlend in="r2" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b2" mode="screen" />
          </filter>
        ) : null}
      </svg>
      <AbsoluteFill
        style={{
          filter: on ? `url(#${id})` : undefined,
          // The R/B offsets have nothing to pull from beyond the frame edge, which leaves a
          // coloured fringe; a tiny punch-in on impact frames pushes it out of frame.
          transform: on ? `scale(${1 + (2 * amount + 2) / 1920})` : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Light leak overlay (WebGL). progress 0..1 blooms in then retracts.  */
/* ------------------------------------------------------------------ */
export const LightLeak: React.FC<{
  progress: number;
  seed?: number;
  hueShift?: number;
  opacity?: number;
}> = ({ progress, seed = 0, hueShift = 0, opacity = 0.85 }) => {
  const { width, height } = useVideoConfig();
  if (progress <= 0 || progress >= 1) return null;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity, pointerEvents: "none" }}>
      <Solid
        width={width}
        height={height}
        color="#000000"
        effects={[lightLeak({ progress, seed, hueShift })]}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Split text reveal: per-char or per-word masked rise with stagger.   */
/* ------------------------------------------------------------------ */
export const SplitText: React.FC<{
  text: string;
  /** Local frame at which the first unit starts. */
  start: number;
  by?: "char" | "word";
  stagger?: number;
  duration?: number;
  /** Rise distance as fraction of the line (1 = full line height). */
  rise?: number;
  blurIn?: number;
  style?: React.CSSProperties;
  unitStyle?: (i: number, progress: number) => React.CSSProperties;
}> = ({
  text,
  start,
  by = "char",
  stagger = 2,
  duration = 22,
  rise = 1.05,
  blurIn = 0,
  style,
  unitStyle,
}) => {
  const frame = useCurrentFrame();
  const units = by === "char" ? Array.from(text) : text.split(/(\s+)/);
  let visibleIndex = 0;
  return (
    <div style={{ display: "inline-flex", flexWrap: "nowrap", whiteSpace: "pre", ...style }}>
      {units.map((u, i) => {
        if (/^\s+$/.test(u)) return <span key={i}>{u}</span>;
        const idx = visibleIndex++;
        const p = tween(frame, [start + idx * stagger, start + idx * stagger + duration], [0, 1], ease.expoOut);
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", lineHeight: 1.1, paddingBottom: "0.08em" }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * rise * 100}%)`,
                filter: blurIn ? `blur(${(1 - p) * blurIn}px)` : undefined,
                ...unitStyle?.(idx, p),
              }}
            >
              {u}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Ember leak: palette-locked warm light (ember/vermilion only).       */
/* Soft radial blooms drifting on seeded noise; screen-blended.        */
/* ------------------------------------------------------------------ */
export const EmberLeak: React.FC<{
  progress: number;
  opacity: number;
  seed?: string;
  /** Anchor of the main bloom in px (e.g. the sun). */
  anchor?: { x: number; y: number };
}> = ({ progress, opacity, seed = "ember", anchor = { x: 960, y: 640 } }) => {
  if (opacity <= 0.003) return null;
  const t = progress;
  const n = (k: string, s: number) => noise2D(seed + k, t * s, 0);
  const blobs = [
    { x: anchor.x + n("ax", 1.2) * 160, y: anchor.y + n("ay", 1.0) * 90, r: 1100 + 500 * t, c: "255,138,61", a: 0.9 },
    { x: 220 + n("bx", 1.4) * 140, y: 260 + n("by", 1.1) * 120, r: 820, c: "255,61,31", a: 0.55 },
    { x: 1720 + n("cx", 1.3) * 140, y: 820 + n("cy", 1.2) * 120, r: 760, c: "255,138,61", a: 0.5 },
  ];
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity, pointerEvents: "none" }}>
      {blobs.map((b, i) => (
        <AbsoluteFill
          key={i}
          style={{
            background: `radial-gradient(circle ${b.r}px at ${b.x}px ${b.y}px, rgba(${b.c},${b.a}) 0%, rgba(${b.c},${b.a * 0.35}) 35%, rgba(${b.c},0) 100%)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

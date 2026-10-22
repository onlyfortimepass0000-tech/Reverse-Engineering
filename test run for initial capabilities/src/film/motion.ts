import { Easing, interpolate } from "remotion";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_FRAMES = 840;

// Cinematic easing vocabulary. Use these instead of ad-hoc curves so motion feels like one film.
export const ease = {
  expoOut: Easing.bezier(0.16, 1, 0.3, 1),
  expoIn: Easing.bezier(0.7, 0, 0.84, 0),
  expoInOut: Easing.bezier(0.87, 0, 0.13, 1),
  quartOut: Easing.bezier(0.25, 1, 0.5, 1),
  quartInOut: Easing.bezier(0.76, 0, 0.24, 1),
  // Slow, weighty camera drift: barely moves at the ends.
  camera: Easing.bezier(0.45, 0, 0.2, 1),
  // Overshoot for confident "snap" entrances.
  backOut: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: Easing.linear,
};

type EaseFn = (t: number) => number;

/** Clamped interpolate with an easing; the default for every animated value. */
export const tween = (
  frame: number,
  [f0, f1]: [number, number],
  [v0, v1]: [number, number],
  easing: EaseFn = ease.expoOut,
): number =>
  interpolate(frame, [f0, f1], [v0, v1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** Multi-keyframe clamped interpolate. */
export const keys = (
  frame: number,
  input: number[],
  output: number[],
  easing: EaseFn = ease.quartInOut,
): number =>
  interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** Deterministic PRNG (mulberry32). Never use Math.random() in scenes: it flickers between renders. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const sec = (s: number) => Math.round(s * FPS);

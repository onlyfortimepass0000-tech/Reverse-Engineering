import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { EXPO_OUT, IN_OUT, PALETTE, SCENE_RANGES } from "./film";
import "./fonts";
import { ChromaticAberration, EmberLeak, Grain, Letterbox, Vignette } from "./fx";
import { keys, tween } from "./motion";

export type SceneId = keyof typeof SCENE_RANGES;

/* Finishing-layer schedule (global frames), straight from the spec. */
const caAmount = (f: number) => {
  if (f >= 225 && f <= 228) return tween(f, [225, 228], [2, 0], EXPO_OUT);
  if (f >= 375 && f <= 380) return tween(f, [375, 380], [4, 0], EXPO_OUT);
  if (f >= 600 && f <= 607) return tween(f, [600, 607], [7, 0], EXPO_OUT);
  return 0;
};

const vignetteK = (f: number) => {
  if (f < 575) return 0.45;
  if (f < 600) return tween(f, [575, 599], [0.45, 0.72], IN_OUT);
  return tween(f, [600, 680], [0.2, 0.45], IN_OUT);
};

const letterboxAmount = (f: number) => {
  if (f < 600) return 1;
  if (f <= 620) return tween(f, [600, 620], [1, 0], EXPO_OUT);
  if (f < 705) return 0;
  return tween(f, [705, 735], [0, 1], IN_OUT);
};

const Finishing: React.FC = () => {
  const f = useCurrentFrame();
  const leak1 = f >= 600 && f <= 660;
  const leak1Opacity = keys(f, [600, 606, 660], [0, 0.45, 0]);
  const leak2 = f >= 705 && f <= 765;
  const leak2Opacity = keys(f, [705, 720, 750, 765], [0, 0.16, 0.16, 0]);
  return (
    <>
      {leak1 ? (
        <EmberLeak progress={(f - 600) / 60} seed="ignite" opacity={leak1Opacity} anchor={{ x: 960, y: 690 }} />
      ) : null}
      {leak2 ? (
        <AbsoluteFill
          style={{
            // Keep the warm drift to the frame edges, away from the title.
            WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, transparent 40%, black 100%)",
            maskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, transparent 40%, black 100%)",
          }}
        >
          <EmberLeak progress={(f - 705) / 60} seed="title" opacity={leak2Opacity} anchor={{ x: 960, y: 980 }} />
        </AbsoluteFill>
      ) : null}
      <Vignette strength={vignetteK(f)} />
      <Grain opacity={f < 705 ? 0.07 : 0.05} />
      <Letterbox amount={letterboxAmount(f)} />
    </>
  );
};

/** Film shell: finishing layer + whichever scenes are passed in (others stay ink-black). */
export const FilmShell: React.FC<{ scenes: Partial<Record<SceneId, React.FC>> }> = ({ scenes }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ink }}>
      <AbsoluteFill style={{ filter: "contrast(1.05) saturate(1.04)" }}>
        <ChromaticAberration amount={caAmount(f)}>
          {(Object.keys(SCENE_RANGES) as SceneId[]).map((id) => {
            const C = scenes[id];
            if (!C) return null;
            const [a, b] = SCENE_RANGES[id];
            return (
              <Sequence key={id} from={a} durationInFrames={b - a + 1} name={id} layout="none">
                <AbsoluteFill>
                  <C />
                </AbsoluteFill>
              </Sequence>
            );
          })}
        </ChromaticAberration>
      </AbsoluteFill>
      <Finishing />
    </AbsoluteFill>
  );
};

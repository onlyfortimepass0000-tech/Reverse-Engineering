import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "remotion";
import { PALETTE, TITLE_LAYOUT, camZ_floor, drawFloor, floorY_s3, useFontsReady } from "../film/film";
import "../film/fonts";
import { SERIF } from "../film/fonts";
import { assembledCount, renderSphereFrame, thetaDeg } from "../film/sphere";

const Check = () => {
  const f = useCurrentFrame(); // 0: floor@224, 1: sphere@524, 2: sphere@460, 3: title
  const ready = useFontsReady();
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.clearRect(0, 0, 1920, 1080);
    if (f === 0) drawFloor(ctx, { plane: { thDeg: 90, Yo: 380, camZ: camZ_floor(224) } });
    if (f === 1 && ready) renderSphereFrame(ctx, 524);
    if (f === 2 && ready) renderSphereFrame(ctx, 440);
    if (f === 4) drawFloor(ctx, { plane: { thDeg: 90, Yo: floorY_s3(300), camZ: camZ_floor(300) } });
  }, [f, ready]);
  const T = ready ? TITLE_LAYOUT() : null;
  return (
    <AbsoluteFill style={{ background: PALETTE.ink }}>
      <canvas ref={ref} width={1920} height={1080} />
      {f === 3 && T ? (
        <>
          {T.glyphs.map((g, i) => (
            <span key={i} style={{ position: "absolute", left: g.left, top: T.baseline - 200 * 0.92, fontFamily: SERIF, fontStyle: g.italic ? "italic" : "normal", fontSize: 200, lineHeight: 1, color: PALETTE.bone }}>{g.ch}</span>
          ))}
          <div style={{ position: "absolute", left: T.P.x - 12, top: T.P.y - 12, width: 24, height: 24, borderRadius: 12, background: PALETTE.vermilion }} />
          <div style={{ position: "absolute", left: T.hairline.x0, top: T.hairline.y, width: T.hairline.x1 - T.hairline.x0, height: 1, background: PALETTE.bone }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: T.baseline, height: 1, background: "#0f0" }} />
          <div style={{ position: "absolute", left: 20, top: 20, color: "#0f0", fontSize: 22 }}>{`left ${T.left.toFixed(1)} W ${T.W.toFixed(1)} wF ${T.wF.toFixed(1)} wL ${T.wL.toFixed(1)} P ${T.P.x.toFixed(1)} θ524 ${thetaDeg(524).toFixed(2)} count470 ${assembledCount(470)} count440 ${assembledCount(440)}`}</div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
registerRoot(() => <Composition id="Check" component={Check} durationInFrames={5} fps={30} width={1920} height={1080} />);

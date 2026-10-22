import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import { FilmFull } from "./film/FilmFull";
import { TOTAL_FRAMES } from "./film/motion";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Film" component={FilmFull} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
      <MyComposition />
    </>
  );
};

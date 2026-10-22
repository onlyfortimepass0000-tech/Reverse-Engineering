import { Composition, registerRoot } from "remotion";
import { FilmShell } from "../film/Film";
import { TOTAL_FRAMES } from "../film/motion";
import { S1 } from "../scenes/S1";

const Only = () => <FilmShell scenes={{ s1: S1 }} />;

registerRoot(() => (
  <Composition id="Film" component={Only} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
));

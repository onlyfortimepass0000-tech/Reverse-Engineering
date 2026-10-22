import { Composition, registerRoot } from "remotion";
import { FilmShell } from "../film/Film";
import { TOTAL_FRAMES } from "../film/motion";
import { S2 } from "../scenes/S2";

const Only = () => <FilmShell scenes={{ s2: S2 }} />;

registerRoot(() => (
  <Composition id="Film" component={Only} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
));

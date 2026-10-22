import { Composition, registerRoot } from "remotion";
import { FilmShell } from "../film/Film";
import { TOTAL_FRAMES } from "../film/motion";
import { S6 } from "../scenes/S6";

const Only = () => <FilmShell scenes={{ s6: S6 }} />;

registerRoot(() => (
  <Composition id="Film" component={Only} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
));

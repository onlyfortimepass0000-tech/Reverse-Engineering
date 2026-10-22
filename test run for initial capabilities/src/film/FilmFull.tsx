import { S1 } from "../scenes/S1";
import { S2 } from "../scenes/S2";
import { S3 } from "../scenes/S3";
import { S4 } from "../scenes/S4";
import { S5 } from "../scenes/S5";
import { S6 } from "../scenes/S6";
import { S7 } from "../scenes/S7";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { FilmShell } from "./Film";

export const FilmFull: React.FC = () => (
  <>
    <FilmShell scenes={{ s1: S1, s2: S2, s3: S3, s4: S4, s5: S5, s6: S6, s7: S7 }} />
    <Audio src={staticFile("audio/first-light.wav")} />
  </>
);

import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const SERIF = "'Instrument Serif', 'Times New Roman', serif";
export const SANS = "'Inter Tight', 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'JetBrains Mono', 'Courier New', monospace";

export const fontsLoaded: Promise<unknown> = Promise.all([
loadFont({
  family: "Instrument Serif",
  url: staticFile("fonts/InstrumentSerif-Regular.ttf"),
  weight: "400",
  style: "normal",
}),
loadFont({
  family: "Instrument Serif",
  url: staticFile("fonts/InstrumentSerif-Italic.ttf"),
  weight: "400",
  style: "italic",
}),
loadFont({
  family: "Inter Tight",
  url: staticFile("fonts/InterTight.ttf"),
  weight: "100 900",
}),
loadFont({
  family: "JetBrains Mono",
  url: staticFile("fonts/JetBrainsMono.ttf"),
  weight: "100 800",
}),
]);

# Test run for initial capabilities: "First Light"

A 28-second cinematic motion-graphics film written entirely in code with [Remotion](https://www.remotion.dev).
Every frame, plus the soundtrack, is generated procedurally.

- **Final video:** `first-light-v1.mp4` (1920x1080, 30 fps, 28 s, with score)
- **Film source:** `src/film/` (shared camera, projection, effects, and the particle world) and `src/scenes/S1-S7.tsx` (one file per scene)
- **Storyboard / spec:** `src/film/SPEC.json`
- **Soundtrack generator:** `audio-src/score.py` (numpy), output in `public/audio/first-light.wav`
- **Bonus:** `src/Composition.tsx` plus `clients/*.json` hold the data-driven vertical reel template (MVP)

## Re-render

```bash
npm install
npx remotion render src/index.ts Film out/first-light.mp4
```

`remotion.config.ts` points to a cloud-container Chromium path (`/opt/pw-browsers/...`). Delete the `setBrowserExecutable` line when rendering on your own machine.

Remotion is free for individuals and companies of up to 3 people. Bigger companies need a license (see remotion.pro).

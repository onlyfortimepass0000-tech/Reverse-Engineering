# Reverse engineering REMOTION: findings

Source: https://www.remotion.dev and its public GitHub repos (remotion-dev/remotion, remotion-dev/skills, remotion-dev/template-prompt-to-motion-graphics-saas).

## What Remotion is
- An open-source React framework where a video is a React app. `useCurrentFrame()` returns frame N, and every visual is maths on N.
- Rendering: headless Chrome screenshots each frame, a Rust "compositor" decodes and caches video, and FFmpeg stitches the frames into MP4.
- Cloud render (`@remotion/lambda`) splits a video into chunks of about 60 frames, renders them in parallel on many AWS Lambdas, then merges them.
- Newer: `@remotion/web-renderer` renders inside the browser with WebCodecs (no server).

## The "AI" layer (thin, copyable)
In the prompt-to-motion-graphics template, `src/app/api/generate/route.ts`:
1. An LLM checks that the prompt is actually asking for an animation.
2. Skill router: a second LLM call picks from 17 skills (8 markdown guides plus 9 code examples) and injects only those into the system prompt.
3. The LLM streams back one React component (strict system prompt: constants in UPPER_SNAKE_CASE, spring/interpolate, Inter font).
4. The browser compiles it: regexes strip the imports, Babel transpiles it, and `new Function()` runs it.
5. Self-healing: compile errors go back to the LLM automatically, up to N retries.
6. Follow-ups: the LLM returns find/replace edits instead of a full rewrite.
7. AWS Lambda renders the MP4.
- The official MCP server has only one tool, a documentation search. The Agent Skills are about 19k lines of best-practice markdown (`npx skills add remotion-dev/skills`).

## Moat vs copyable
- Moat: the render engine (frame capture, Rust compositor, Lambda chunking) and the skills content.
- Copyable: the AI layer (about 1k lines). Skill router, browser compile, self-correction and edit-based follow-ups are reusable for any "AI writes code" product.
- Security: `new Function()` runs AI-written code with full page access. In a multi-user SaaS it needs an iframe sandbox.

## License
- Free (even for commercial videos) for individuals and companies of 3 or fewer employees.
- Not allowed: selling a derivative of Remotion itself. Selling client videos is fine; a prompt-to-video SaaS built on Remotion is a grey area, so check remotion.pro first.

## Alternatives
- HyperFrames (HeyGen): HTML/GSAP-based, hosted.
- Motion Canvas / Revideo: TypeScript, MIT-licensed.

## Practical lessons from our test run (First Light film)
- In a cloud container, Remotion's own Chrome download is blocked. Use the preinstalled Chromium (`Config.setBrowserExecutable`) and `--gl=angle` for WebGL.
- Chrome 141 has no HTML-in-canvas, so use `CameraMotionBlur`/`Trail` or manual canvas accumulation for motion blur.
- Gate text on fonts: wait for `loadFont()` promises before measuring, or layouts cache a fallback font.
- The WebGL light-leak effect drifted green. Palette-locked radial gradients are safer.
- Keep everything a pure function of the frame (seeded RNG, no Math.random), so renders are deterministic and parallel-safe.
- Render cost on 4 cores: about 0.5 s per 1080p frame. The 28 s film rendered in about 2.3 minutes.

## Fit for us
1. Agency: prompt-built motion reels and data videos for clients (license OK at our size).
2. AI SaaS: reuse the AI-layer pattern (router, self-heal, edits) for any code-generating product.
3. The data-driven reel template in this folder (`src/Composition.tsx` plus `clients/*.json`) means a new client video is a JSON file.

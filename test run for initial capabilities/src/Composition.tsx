import {
  AbsoluteFill,
  Composition,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type ReelProps = {
  brand: string;
  accent: string;
  background: string;
  hook: string[];
  chartTitle: string;
  chart: { label: string; value: number }[];
  cta: string;
};

export const defaultReelProps: ReelProps = {
  brand: "Growth Studio",
  accent: "#7CFFB2",
  background: "#0B0F1A",
  hook: ["Your competitors", "post every day.", "You don't."],
  chartTitle: "Leads per month",
  chart: [
    { label: "Jan", value: 12 },
    { label: "Feb", value: 19 },
    { label: "Mar", value: 31 },
    { label: "Apr", value: 54 },
  ],
  cta: "Book a free audit",
};

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const MyComposition = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      durationInFrames={270}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultReelProps}
    />
  );
};

const Hook: React.FC<{ lines: string[]; accent: string }> = ({ lines, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: 90, gap: 24 }}>
      {lines.map((line, i) => {
        const s = spring({ frame: frame - i * 12, fps, config: { damping: 14 } });
        const isLast = i === lines.length - 1;
        return (
          <div
            key={line}
            style={{
              fontSize: 118,
              fontWeight: 800,
              lineHeight: 1.05,
              color: isLast ? accent : "white",
              opacity: s,
              transform: `translateY(${(1 - s) * 80}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Chart: React.FC<{
  title: string;
  data: ReelProps["chart"];
  accent: string;
}> = ({ title, data, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...data.map((d) => d.value));
  const chartHeight = 900;
  return (
    <AbsoluteFill style={{ padding: 90, justifyContent: "center" }}>
      <div
        style={{
          fontSize: 72,
          fontWeight: 700,
          color: "white",
          marginBottom: 60,
          opacity: interpolate(frame, [0, 10], [0, 1], clamp),
        }}
      >
        {title}
      </div>
      <div
        style={{
          height: chartHeight,
          display: "flex",
          alignItems: "flex-end",
          gap: 40,
        }}
      >
        {data.map((d, i) => {
          const grow = spring({
            frame: frame - 8 - i * 8,
            fps,
            config: { damping: 18 },
          });
          const h = (d.value / max) * (chartHeight - 120) * grow;
          return (
            <div
              key={d.label}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 800, color: "white" }}>
                {Math.round(d.value * grow)}
              </div>
              <div
                style={{
                  width: "100%",
                  height: h,
                  marginTop: 16,
                  borderRadius: 24,
                  background: i === data.length - 1 ? accent : "#2A3350",
                }}
              />
              <div style={{ fontSize: 44, color: "#9AA4C0", marginTop: 20 }}>
                {d.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ brand: string; cta: string; accent: string }> = ({
  brand,
  cta,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const button = spring({ frame: frame - 15, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", gap: 70 }}
    >
      <div
        style={{
          fontSize: 130,
          fontWeight: 900,
          color: "white",
          textAlign: "center",
          transform: `scale(${pop})`,
        }}
      >
        {brand}
      </div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          color: "#0B0F1A",
          background: accent,
          padding: "36px 72px",
          borderRadius: 999,
          opacity: button,
          transform: `translateY(${(1 - button) * 60}px)`,
        }}
      >
        {cta} →
      </div>
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { ...clamp, easing: Easing.in(Easing.quad) },
  );
  return (
    <AbsoluteFill
      style={{ backgroundColor: props.background, fontFamily: FONT }}
    >
      <AbsoluteFill style={{ opacity: fadeOut }}>
        <Sequence durationInFrames={2.5 * fps}>
          <Hook lines={props.hook} accent={props.accent} />
        </Sequence>
        <Sequence from={2.5 * fps} durationInFrames={3.5 * fps}>
          <Chart title={props.chartTitle} data={props.chart} accent={props.accent} />
        </Sequence>
        <Sequence from={6 * fps}>
          <Cta brand={props.brand} cta={props.cta} accent={props.accent} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

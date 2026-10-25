/**
 * A five-slide Instagram carousel (1080×1350, 4:5) made from real screenshots
 * of the app: frames of the recordings in public/rec, saved to public/shots
 * by scripts/instagram.mjs. Cards crop a screenshot, they never retouch it.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import "@fontsource-variable/nunito";
import { Logo } from "./Logo";
import { Background, C, FONT } from "./parts";

export type SlideProps = { n: number };

const PAD = 72;
/** The app's window in the recordings, in CSS pixels. */
const SHOT_W = 1440;
const SHOT_H = 900;

/** Part of a screenshot (fractions of its width and height). */
type Crop = { x: number; y: number; w: number; h: number };
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

function Shot({
  name,
  crop = FULL,
  width,
  label,
  style,
}: {
  name: string;
  crop?: Crop;
  width: number;
  label?: string;
  style?: CSSProperties;
}) {
  const scale = width / (crop.w * SHOT_W);
  const height = crop.h * SHOT_H * scale;
  return (
    <div style={{ display: "grid", gap: 14, width, ...style }}>
      {label ? (
        <span
          style={{
            fontFamily: FONT,
            fontSize: 28,
            fontWeight: 800,
            color: C.ink3,
            letterSpacing: 0.5,
          }}
        >
          {label}
        </span>
      ) : null}
      <div
        style={{
          position: "relative",
          width,
          height,
          overflow: "hidden",
          borderRadius: 22,
          background: "#0b0e13",
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      >
        <Img
          src={staticFile(`shots/${name}.png`)}
          style={{
            position: "absolute",
            left: -crop.x * SHOT_W * scale,
            top: -crop.y * SHOT_H * scale,
            width: SHOT_W * scale,
            height: SHOT_H * scale,
          }}
        />
      </div>
    </div>
  );
}

/** "1 · Script" above a slide's headline. */
function Step({ n, label }: { n?: number; label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        justifySelf: "start",
        padding: "10px 24px 10px 10px",
        borderRadius: 999,
        background: "rgba(28,26,25,0.78)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        fontFamily: FONT,
        fontSize: 30,
        fontWeight: 800,
        color: C.ink,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 46,
          height: 46,
          borderRadius: 23,
          background: C.gradient,
          color: "#212021",
          fontSize: 25,
        }}
      >
        {n ?? "✦"}
      </span>
      {label}
    </div>
  );
}

/** The accent goes on its own line when it is a sentence of its own. */
function Headline({
  lead,
  accent,
  newLine = false,
}: {
  lead: string;
  accent: string;
  newLine?: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 70,
        fontWeight: 850,
        lineHeight: 1.06,
        letterSpacing: -2,
        color: C.ink,
        textWrap: "balance",
      }}
    >
      {lead}{" "}
      <span
        style={{
          color: C.amber,
          // A block of its own, so its lines balance by themselves.
          display: newLine ? "block" : "inline",
          textWrap: "balance",
        }}
      >
        {accent}
      </span>
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 34,
        fontWeight: 650,
        lineHeight: 1.3,
        color: C.ink2,
      }}
    >
      {children}
    </div>
  );
}

/** Logo, name and the slide's place in the carousel, along the top. */
function Top({ n }: { n: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Logo size={52} />
        <span
          style={{
            fontSize: 34,
            fontWeight: 850,
            letterSpacing: -0.5,
            color: C.ink,
          }}
        >
          Frame
          <span
            style={{
              background: C.gradient,
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            bop
          </span>
        </span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 750, color: C.ink3 }}>
        {n} / 5
      </span>
    </div>
  );
}

function Page({ n, children }: { n: number; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ backgroundColor: C.night }}>
      <Background />
      <AbsoluteFill
        style={{
          padding: `60px ${PAD}px ${PAD}px`,
          display: "flex",
          flexDirection: "column",
          gap: 30,
        }}
      >
        <Top n={n} />
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

const PANEL: Crop = { x: 0.774, y: 0.055, w: 0.216, h: 0.635 };
const SCENE: Crop = { x: 0.225, y: 0.095, w: 0.76, h: 0.505 };

function Intro() {
  return (
    <Page n={1}>
      <div style={{ display: "grid", gap: 26, marginTop: 40 }}>
        <Step label="What is Framebop Studio?" />
        <Headline
          lead="Make animated videos with AI"
          accent="that runs on your own computer."
        />
        <Sub>
          Type an idea. Framebop writes the script, makes a picture and a voice
          for every scene, and renders the video, all on your Mac.
        </Sub>
      </div>
      <Shot
        name="05-workspace"
        width={1080 - PAD}
        style={{ position: "absolute", left: PAD, bottom: -70 }}
      />
    </Page>
  );
}

function Script() {
  return (
    <Page n={2}>
      <div style={{ display: "grid", gap: 24, marginTop: 10 }}>
        <Step n={1} label="Script" />
        <Headline
          lead="Start with an idea."
          accent="A local AI drafts the script."
          newLine
        />
        <Sub>Every paragraph becomes a scene.</Sub>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: "auto",
        }}
      >
        <Shot name="01-idea" crop={PANEL} width={418} label="Your idea" />
        <Arrow />
        <Shot
          name="02-script"
          crop={PANEL}
          width={418}
          label="A script, three scenes"
        />
      </div>
    </Page>
  );
}

function Arrow() {
  return (
    <div
      style={{
        alignSelf: "center",
        display: "grid",
        placeItems: "center",
        width: 64,
        height: 64,
        borderRadius: 32,
        background: C.gradient,
        color: "#212021",
        fontFamily: FONT,
        fontSize: 36,
        fontWeight: 900,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}
    >
      →
    </div>
  );
}

function Pictures() {
  return (
    <Page n={3}>
      <div style={{ display: "grid", gap: 24, marginTop: 10 }}>
        <Step n={2} label="Pictures" />
        <Headline
          lead="Each scene gets a picture,"
          accent="made on your Mac."
        />
      </div>
      <div style={{ display: "grid", gap: 34, marginTop: "auto" }}>
        <Shot name="03-picture" crop={SCENE} width={1080 - 2 * PAD} />
        <Shot name="04-picture" crop={SCENE} width={1080 - 2 * PAD} />
      </div>
    </Page>
  );
}

function VoiceAndVideo() {
  return (
    <Page n={4}>
      <div style={{ display: "grid", gap: 24, marginTop: 10 }}>
        <Step n={3} label="Voice and video" />
        <Headline
          lead="A voice reads it aloud."
          accent="Then Framebop renders the video."
          newLine
        />
      </div>
      {/* The scene's voice floats over the finished video in the app's player. */}
      <div style={{ position: "relative", marginTop: "auto", height: 690 }}>
        <Shot
          name="08-video"
          crop={{ x: 0.29, y: 0.27, w: 0.585, h: 0.535 }}
          width={1080 - 2 * PAD}
          style={{ position: "absolute", left: 0, bottom: 0 }}
        />
        <Shot
          name="06-voice"
          crop={{ x: 0.76, y: 0.6, w: 0.228, h: 0.18 }}
          width={560}
          style={{ position: "absolute", left: 0, top: 0 }}
        />
      </div>
    </Page>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 30px 16px 18px",
        borderRadius: 999,
        background: "rgba(38,34,31,0.85)",
        boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.12)",
        fontFamily: FONT,
        fontSize: 38,
        fontWeight: 800,
        color: C.ink,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 40,
          height: 40,
          borderRadius: 20,
          background: C.gradient,
          color: "#212021",
          fontSize: 24,
        }}
      >
        ✓
      </span>
      {children}
    </div>
  );
}

function Closing() {
  return (
    <Page n={5}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 34,
          textAlign: "center",
          fontFamily: FONT,
        }}
      >
        <div style={{ filter: "drop-shadow(0 30px 60px rgba(160,50,0,0.45))" }}>
          <Logo size={220} />
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 850,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: C.ink,
          }}
        >
          Free and open source.
          <br />
          <span style={{ color: C.amber }}>Early alpha.</span>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: 16 }}>
          <Pill>No account</Pill>
          <Pill>No subscription</Pill>
          <Pill>No cloud</Pill>
        </div>
        <div style={{ display: "grid", gap: 8, color: C.ink2 }}>
          <span style={{ fontSize: 34, fontWeight: 750 }}>
            Mac with Apple silicon · Windows and Linux planned
          </span>
          <span style={{ fontSize: 30, fontWeight: 650, color: C.ink3 }}>
            framebop.com · github.com/eaabak/framebop-studio
          </span>
        </div>
        <div
          style={{
            marginTop: 6,
            padding: "18px 40px",
            borderRadius: 999,
            background: C.gradient,
            color: "#212021",
            fontSize: 40,
            fontWeight: 900,
          }}
        >
          Link in bio
        </div>
      </div>
    </Page>
  );
}

export function Slide({ n }: SlideProps) {
  switch (n) {
    case 2:
      return <Script />;
    case 3:
      return <Pictures />;
    case 4:
      return <VoiceAndVideo />;
    case 5:
      return <Closing />;
    default:
      return <Intro />;
  }
}

/**
 * A 1080×1920 story that points to the carousel: the text keeps clear of
 * the profile bar at the top and the reply bar at the bottom, and the first
 * slide stands in for the post.
 */
export function Story() {
  const card = 480;
  return (
    <AbsoluteFill style={{ backgroundColor: C.night }}>
      <Background />
      <AbsoluteFill
        style={{
          padding: `260px ${PAD}px 360px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
          textAlign: "center",
          fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 750, color: C.ink2 }}>
          Been working on something new 🎬
        </div>
        <div style={{ filter: "drop-shadow(0 20px 40px rgba(160,50,0,0.45))" }}>
          <Logo size={100} />
        </div>
        <div
          style={{
            fontSize: 92,
            fontWeight: 850,
            lineHeight: 1.05,
            letterSpacing: -2.5,
            color: C.ink,
          }}
        >
          Meet
          <br />
          <span
            style={{
              background: C.gradient,
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            Framebop Studio.
          </span>
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.25,
            color: C.ink2,
            textWrap: "balance",
          }}
        >
          Free, open source, and powered by local AI.
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 46,
            fontWeight: 850,
            color: C.ink,
          }}
        >
          Check out my first post 👇
        </div>
        <div
          style={{
            position: "relative",
            width: card,
            height: (card * 1350) / 1080,
            flexShrink: 0,
            overflow: "hidden",
            borderRadius: 28,
            transform: "rotate(-2.5deg)",
            boxShadow:
              "0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.14)",
          }}
        >
          <div
            style={{
              position: "absolute",
              width: 1080,
              height: 1350,
              transformOrigin: "0 0",
              transform: `scale(${card / 1080})`,
              textAlign: "left",
            }}
          >
            <Slide n={1} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

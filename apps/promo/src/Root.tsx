import { Composition, Still } from "remotion";
import { Slide, Story, type SlideProps } from "./Instagram";
import { Promo, type PromoProps } from "./Promo";
import { FPS, TOTAL_FRAMES } from "./timeline";

const size = {
  durationInFrames: TOTAL_FRAMES,
  fps: FPS,
  width: 1920,
  height: 1080,
};

/** For Instagram Reels and TikTok. */
const tall = { ...size, width: 1080, height: 1920 };

export function Root() {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        defaultProps={{ music: false } satisfies PromoProps}
        {...size}
      />
      <Composition
        id="PromoMusic"
        component={Promo}
        defaultProps={{ music: true } satisfies PromoProps}
        {...size}
      />
      <Composition
        id="PromoVertical"
        component={Promo}
        defaultProps={{ music: false } satisfies PromoProps}
        {...tall}
      />
      <Composition
        id="PromoVerticalMusic"
        component={Promo}
        defaultProps={{ music: true } satisfies PromoProps}
        {...tall}
      />
      {/* The Instagram carousel: render one slide at a time with { n }. */}
      <Still
        id="Instagram"
        component={Slide}
        defaultProps={{ n: 1 } satisfies SlideProps}
        width={1080}
        height={1350}
      />
      <Still id="InstagramStory" component={Story} width={1080} height={1920} />
    </>
  );
}

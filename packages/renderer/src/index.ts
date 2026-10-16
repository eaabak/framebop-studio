export {
  ROMAN_STREET,
  SPRITE_STREET,
  animationTemplate,
  samplesFromPcm16,
  speechEnvelope,
} from "./animation";
export { approximateCaptions, splitSentences } from "./captions";
export { planIdentity } from "./identity";
export {
  type PlanInput,
  type PlanResult,
  assertPlanConsistent,
  buildRenderPlan,
  framesOf,
  framesToContain,
} from "./plan";

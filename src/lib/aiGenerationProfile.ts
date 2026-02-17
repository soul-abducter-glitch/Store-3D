export type AiGenerationQuality = "draft" | "standard" | "pro";
export type AiGenerationStyle = "realistic" | "stylized" | "anime";
export type AiGenerationAdvanced = "balanced" | "detail" | "speed";

export type AiGenerationProfile = {
  quality: AiGenerationQuality;
  style: AiGenerationStyle;
  advanced: AiGenerationAdvanced;
};

export type AiModeTier = "standard" | "pro";

export const DEFAULT_AI_GENERATION_PROFILE: AiGenerationProfile = {
  quality: "standard",
  style: "stylized",
  advanced: "balanced",
};

const QUALITY_MULTIPLIER: Record<AiGenerationQuality, number> = {
  draft: 0.8,
  standard: 1,
  pro: 1.45,
};

const STYLE_MULTIPLIER: Record<AiGenerationStyle, number> = {
  realistic: 1.1,
  stylized: 1,
  anime: 0.95,
};

const ADVANCED_MULTIPLIER: Record<AiGenerationAdvanced, number> = {
  balanced: 1,
  detail: 1.25,
  speed: 0.78,
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

export const normalizeAiGenerationProfile = (value: unknown): AiGenerationProfile => {
  const qualityRaw = toNonEmptyString((value as { quality?: unknown } | null)?.quality);
  const styleRaw = toNonEmptyString((value as { style?: unknown } | null)?.style);
  const advancedRaw = toNonEmptyString((value as { advanced?: unknown } | null)?.advanced);

  const quality: AiGenerationQuality =
    qualityRaw === "draft" || qualityRaw === "pro" || qualityRaw === "standard"
      ? qualityRaw
      : DEFAULT_AI_GENERATION_PROFILE.quality;
  const style: AiGenerationStyle =
    styleRaw === "realistic" || styleRaw === "anime" || styleRaw === "stylized"
      ? styleRaw
      : DEFAULT_AI_GENERATION_PROFILE.style;
  const advanced: AiGenerationAdvanced =
    advancedRaw === "detail" || advancedRaw === "speed" || advancedRaw === "balanced"
      ? advancedRaw
      : DEFAULT_AI_GENERATION_PROFILE.advanced;

  return { quality, style, advanced };
};

export const resolveAiModeFromGenerationProfile = (
  profile: AiGenerationProfile
): AiModeTier => {
  return profile.quality === "pro" ? "pro" : "standard";
};

export const resolveGenerationTokenCost = (
  baseTokenCost: number,
  profile: AiGenerationProfile
) => {
  const base = Number.isFinite(baseTokenCost) ? Math.max(1, Math.trunc(baseTokenCost)) : 1;
  return Math.max(
    1,
    Math.round(base * QUALITY_MULTIPLIER[profile.quality] * STYLE_MULTIPLIER[profile.style] * ADVANCED_MULTIPLIER[profile.advanced])
  );
};

export const resolveGenerationEtaMinutes = (
  baseEtaMinutes: number,
  profile: AiGenerationProfile
) => {
  const base = Number.isFinite(baseEtaMinutes) ? Math.max(1, Math.round(baseEtaMinutes)) : 1;
  const qualityFactor = QUALITY_MULTIPLIER[profile.quality];
  const speedFactor = profile.advanced === "speed" ? 0.7 : 1.15;
  return Math.max(1, Math.round(base * qualityFactor * speedFactor));
};

export const buildProviderPromptWithGenerationProfile = (
  basePrompt: string,
  profile: AiGenerationProfile
) => {
  const styleHint =
    profile.style === "realistic"
      ? "photorealistic style"
      : profile.style === "anime"
        ? "anime style"
        : "stylized art toy style";
  const qualityHint =
    profile.quality === "pro"
      ? "high fidelity mesh and clean topology"
      : profile.quality === "draft"
        ? "fast draft mesh, low complexity"
        : "balanced mesh quality";
  const advancedHint =
    profile.advanced === "detail"
      ? "prioritize details over speed"
      : profile.advanced === "speed"
        ? "prioritize speed over details"
        : "balanced detail and speed";

  const suffix = `Requirements: ${styleHint}; ${qualityHint}; ${advancedHint}.`;
  const normalizedBase = typeof basePrompt === "string" ? basePrompt.trim() : "";
  if (!normalizedBase) {
    return `Create a printable 3D model. ${suffix}`.slice(0, 800);
  }
  return `${normalizedBase}\n${suffix}`.slice(0, 800);
};

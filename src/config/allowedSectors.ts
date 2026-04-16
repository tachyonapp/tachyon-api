// Handled separately as a boolean toggle, not a sector filter
export const EARNINGS_AVOIDER_TOGGLE = "EARNINGS_AVOIDER";

export const ALLOWED_BYOK_PROVIDERS = ["anthropic", "openai"] as const;
export type ByokProvider = (typeof ALLOWED_BYOK_PROVIDERS)[number];

export const ALLOWED_BYOK_MODELS: Record<ByokProvider, string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

export const BYOK_PROVIDER_VALIDATION_ENDPOINTS: Record<ByokProvider, string> = {
  anthropic: "https://api.anthropic.com/v1/models",
  openai: "https://api.openai.com/v1/models",
};

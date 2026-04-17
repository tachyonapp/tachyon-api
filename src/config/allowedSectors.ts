import {
  ALLOWED_BYOK_PROVIDERS,
  ALLOWED_BYOK_MODELS,
  type ByokProvider,
} from "./brainProviders";

export { ALLOWED_BYOK_PROVIDERS, ALLOWED_BYOK_MODELS, type ByokProvider };

// Handled separately as a boolean toggle, not a sector filter
export const EARNINGS_AVOIDER_TOGGLE = "EARNINGS_AVOIDER";

// Server-side only — never sent to clients
export const BYOK_PROVIDER_VALIDATION_ENDPOINTS: Record<ByokProvider, string> =
  {
    anthropic: "https://api.anthropic.com/v1/models",
    openai: "https://api.openai.com/v1/models",
  };

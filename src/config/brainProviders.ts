export const TACHYON_DEFAULT_BRAIN = {
  brainType: "TACHYON_HOSTED" as const,
  modelId: "claude-haiku-4-5-20251001",
  provider: "anthropic",
  displayName: "Tachyon Default",
  description: "Powered by Claude Haiku. Free, built-in, usage-capped.",
} as const;

export const BYOK_PROVIDER_CATALOG = [
  {
    provider: "anthropic" as const,
    displayName: "Anthropic",
    models: [
      { modelId: "claude-opus-4-7",          displayName: "Claude Opus 4.7"   },
      { modelId: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4.6" },
      { modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5"  },
    ],
  },
  {
    provider: "openai" as const,
    displayName: "OpenAI",
    models: [
      { modelId: "gpt-4o",      displayName: "GPT-4o"      },
      { modelId: "gpt-4o-mini", displayName: "GPT-4o mini" },
    ],
  },
] as const;

export type ByokProvider = (typeof BYOK_PROVIDER_CATALOG)[number]["provider"];

export const ALLOWED_BYOK_PROVIDERS = BYOK_PROVIDER_CATALOG.map(
  (p) => p.provider,
);

export const ALLOWED_BYOK_MODELS = Object.fromEntries(
  BYOK_PROVIDER_CATALOG.map((p) => [p.provider, p.models.map((m) => m.modelId)]),
) as Record<ByokProvider, string[]>;

// Maps short variant labels to canonical model IDs.
// IMPORTANT: tachyon-workers/src/lib/brain-router.ts contains an identical local copy.
// When updating model IDs here, update the workers copy too (see Task 7 comment).
// Follow-on tech debt: move these to @tachyonapp/tachyon-queue-types/config.
export const ANTHROPIC_VARIANT_MODEL_IDS: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-7",
  // haiku is reserved for TACHYON_HOSTED — not available as BYOK
};

export const OPENAI_VARIANT_MODEL_IDS: Record<string, string> = {
  "gpt-4o":      "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
};

export const GROQ_VARIANT_MODEL_IDS: Record<string, string> = {
  "llama-4-scout":    "llama-4-scout-17b-16e-instruct",
  "llama-4-maverick": "llama-4-maverick-17b-128e-instruct",
  "llama-3.3-70b":    "llama-3.3-70b-versatile",
};

export const GEMINI_VARIANT_MODEL_IDS: Record<string, string> = {
  "gemini-2.0-flash": "gemini-2.0-flash",
  "gemini-2.5-flash": "gemini-2.5-flash-preview-05-20",
};

// Groq and Gemini use OpenAI-compatible endpoints. No new npm packages required.
// The existing `openai` SDK is used with baseURL override per provider.
export const BYOK_PROVIDER_BASE_URLS: Partial<Record<string, string>> = {
  groq:   "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
};

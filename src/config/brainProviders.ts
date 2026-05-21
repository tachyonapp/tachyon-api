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

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed on the server.");
}

export type GemmaProviderConfig = {
  isConfigured: boolean;
  primaryModel: string;
  fallbackModel: string;
  model: string;
  endpointUrl: string;
  hasApiKey: boolean;
  missingKeys: string[];
  timeoutMs: number;
  totalBudgetMs: number;
};

export const PRIMARY_GEMMA_MODEL = "gemma-4-26b-a4b-it";
export const FALLBACK_GEMMA_MODEL = "gemma-4-31b-it";
export const DEFAULT_GEMMA_MODEL = PRIMARY_GEMMA_MODEL;

export const ALTERNATIVE_GEMMA_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  "gemma-4-4b-it",
] as const;

export function getGemmaConfig(): GemmaProviderConfig {
  const apiKey =
    process.env.GEMMA_API_KEY?.trim() ||
    process.env.GOOGLE_GENAI_API_KEY?.trim() ||
    "";

  // Use gemma-4-26b-a4b-it as primary model for fast, reliable generation
  const primaryModel =
    process.env.GEMMA_PRIMARY_MODEL?.trim() ||
    PRIMARY_GEMMA_MODEL;

  const fallbackModel =
    process.env.GEMMA_FALLBACK_MODEL?.trim() ||
    FALLBACK_GEMMA_MODEL;

  const model = primaryModel;

  // Custom endpoint for self-hosted / proxy deployments, or Google Generative Language endpoint
  const endpointUrl =
    process.env.GEMMA_ENDPOINT_URL?.trim() ||
    `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent`;

  const missingKeys: string[] = [];
  if (!apiKey) {
    missingKeys.push("GEMMA_API_KEY");
  }

  const parsedTimeout = Number(process.env.GEMMA_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout >= 5000 && parsedTimeout <= 60000
      ? parsedTimeout
      : 50000;

  const totalBudgetMs = 58000; // 58 seconds total budget (under 60s maxDuration)

  return {
    isConfigured: Boolean(apiKey),
    primaryModel,
    fallbackModel,
    model,
    endpointUrl,
    hasApiKey: Boolean(apiKey),
    missingKeys,
    timeoutMs,
    totalBudgetMs,
  };
}

export function getGemmaApiKey(): string | null {
  return (
    process.env.GEMMA_API_KEY?.trim() ||
    process.env.GOOGLE_GENAI_API_KEY?.trim() ||
    null
  );
}

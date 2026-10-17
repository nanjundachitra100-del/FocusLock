if (typeof window !== "undefined") {
  throw new Error("This module can only be executed on the server.");
}
import { getGemmaApiKey, getGemmaConfig } from "./gemma-config";
import {
  type ServerQuizQuestion,
  validateGeneratedQuiz,
} from "./quiz-schema";

export interface GenerateQuizOptions {
  notes: string;
  topic?: string;
  questionCount?: number;
}

export type ErrorCode =
  | "MISSING_KEY"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "PARSE_ERROR"
  | "INVALID_INPUT";

export type GenerateQuizResult =
  | { success: true; questions: ServerQuizQuestion[]; modelUsed: string }
  | {
      success: false;
      error: string;
      code: ErrorCode;
    };

/**
 * Builds the instruction prompt for Gemma 4.
 */
function buildGemmaPrompt(
  notes: string,
  topic?: string,
  count: number = 5,
  isCorrectiveRetry: boolean = false,
): string {
  const topicLabel = topic?.trim() ? `Topic: ${topic.trim()}\n` : "";
  const correction = isCorrectiveRetry
    ? " Correct the previous format/validation issue."
    : "";

  return `Create exactly ${count} concise multiple-choice questions grounded only in these notes.
${topicLabel}Each question needs a question, 4 distinct options, correctAnswer matching one option exactly, and a brief explanation.
Return only a JSON array with no markdown or commentary.${correction}
Notes:
${notes}`;
}

/**
 * Calls the Gemma 4 API with strict limits:
 * - At most 1 single retry on transient error or invalid output
 * - Bounded timeout per attempt and total generation budget
 * - Output-token limit scales with the requested question count
 */
export async function generateQuizWithGemma(
  options: GenerateQuizOptions,
): Promise<GenerateQuizResult> {
  const { notes, topic, questionCount = 5 } = options;

  if (!notes || notes.trim().length < 20) {
    return {
      success: false,
      error: "Study notes are too short. Please provide at least 20 characters of study material.",
      code: "INVALID_INPUT",
    };
  }
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 10) {
    return {
      success: false,
      error: "Question count must be an integer between 1 and 10.",
      code: "INVALID_INPUT",
    };
  }

  const config = getGemmaConfig();
  const apiKey = getGemmaApiKey();

  if (!config.hasApiKey || !apiKey) {
    return {
      success: false,
      error: "Gemma 4 provider is not configured. Set GEMMA_API_KEY (or GOOGLE_GENAI_API_KEY) in the server environment.",
      code: "MISSING_KEY",
    };
  }

  const totalBudgetMs = config.totalBudgetMs || 50000;
  const startTime = Date.now();

  let currentModel = config.primaryModel;
  let lastError = "";
  let lastCode: ErrorCode = "PROVIDER_ERROR";

  // Maximum of 2 attempts total within total time budget
  for (let attempt = 1; attempt <= 2; attempt++) {
    const elapsedMs = Date.now() - startTime;
    const remainingBudgetMs = totalBudgetMs - elapsedMs;

    // If remaining budget is less than 10 seconds, do not launch a doomed attempt
    if (remainingBudgetMs < 10000) {
      lastError = "Quiz generation timed out before completing. The AI service is experiencing high latency; please try again in a moment.";
      lastCode = "TIMEOUT";
      break;
    }

    const isRetry = attempt > 1;
    const perAttemptTimeoutMs = Math.min(
      remainingBudgetMs - 2000,
      config.timeoutMs || 50000,
    );

    const prompt = buildGemmaPrompt(notes, topic, questionCount, isRetry);
    const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: isRetry ? 0.1 : 0.2,
            topP: 0.9,
            maxOutputTokens: Math.min(3072, 256 + questionCount * 320),
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(perAttemptTimeoutMs),
      });

      // 429 Rate Limit
      if (response.status === 429) {
        lastError = "Gemma 4 rate limit reached. Please wait a moment before generating another quiz.";
        lastCode = "RATE_LIMITED";
        break;
      }

      // 503 Capacity / 500 Server Error
      if (response.status === 503 || response.status === 500 || response.status === 502) {
        const errorJson = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        lastError =
          errorJson.error?.message ||
          `Gemma model ${currentModel} returned status ${response.status}.`;
        lastCode = "PROVIDER_ERROR";

        if (!isRetry && (totalBudgetMs - (Date.now() - startTime)) >= 20000) {
          // Switch to fallback model if primary capacity was saturated
          if (currentModel === config.primaryModel && config.fallbackModel !== config.primaryModel) {
            currentModel = config.fallbackModel;
          }
          continue;
        }
        break;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          success: false,
          error: `Gemma provider returned status ${response.status}: ${errorText.substring(0, 200)}`,
          code: "PROVIDER_ERROR",
        };
      }

      const responseData = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
          finishReason?: string;
        }>;
      };

      const candidate = responseData.candidates?.[0];
      const rawText =
        candidate?.content?.parts
          ?.map((part) => part.text || "")
          .filter(Boolean)
          .join("") || "";

      if (!rawText.trim()) {
        lastError = "Gemma returned an empty response. Please verify your study notes content.";
        lastCode = "PARSE_ERROR";
        if (!isRetry && (totalBudgetMs - (Date.now() - startTime)) >= 15000) {
          continue;
        }
        break;
      }

      // Validate parsed JSON strictly
      const validation = validateGeneratedQuiz(rawText, questionCount);
      if (!validation.success) {
        lastError = `Gemma output failed validation: ${validation.error}`;
        lastCode = "PARSE_ERROR";

        if (!isRetry && (totalBudgetMs - (Date.now() - startTime)) >= 15000) {
          // Corrective retry on same fast model
          continue;
        }
        break;
      }

      return {
        success: true,
        questions: validation.questions,
        modelUsed: currentModel + (currentModel !== config.primaryModel ? " (fallback)" : ""),
      };
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");

      if (isTimeout) {
        lastError = `Quiz generation timed out. The AI model is currently under high demand; please try again in a moment.`;
        lastCode = "TIMEOUT";

        if (!isRetry && (totalBudgetMs - (Date.now() - startTime)) >= 22000) {
          // If primary timed out, try fallback model once if budget permits
          if (currentModel === config.primaryModel && config.fallbackModel !== config.primaryModel) {
            currentModel = config.fallbackModel;
            continue;
          }
        }
        break;
      }

      lastError = `Network error reaching Gemma provider: ${error instanceof Error ? error.message : String(error)}`;
      lastCode = "PROVIDER_ERROR";
      if (!isRetry && (totalBudgetMs - (Date.now() - startTime)) >= 15000) {
        continue;
      }
      break;
    }
  }

  return {
    success: false,
    error: lastError || "Failed to generate quiz from Gemma 4.",
    code: lastCode,
  };
}

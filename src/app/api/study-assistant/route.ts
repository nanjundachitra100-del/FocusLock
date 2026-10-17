import { NextResponse } from "next/server";
import { getGemmaConfig, getGemmaApiKey } from "@/lib/ai/gemma-config";

// Max conversation turns sent to the model (keeps prompt within token budget)
const MAX_HISTORY_TURNS = 10;
// Max characters per individual message
const MAX_MESSAGE_CHARS = 4000;
// Timeout per request to Gemma
const REQUEST_TIMEOUT_MS = 30000;

type IncomingMessage = {
  role?: unknown;
  content?: unknown;
};

type GemmaContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

const SYSTEM_INSTRUCTION = `You are a helpful study assistant integrated into FocusLock, a focused-learning app.
Your job is to answer the student's question directly and clearly.

STRICT OUTPUT RULES — follow these exactly:
- Output ONLY your final answer to the student. Nothing else.
- Do NOT include any reasoning, thinking steps, drafts, self-critique, refinement notes, or internal instructions.
- Do NOT use labels like "Draft:", "Answer:", "Refined answer:", "Thinking:", or similar.
- Do NOT explain your process. Just answer.
- Keep answers concise, accurate, and educational.
- Do not generate quizzes or assessment questions unless the student explicitly asks for them.`;

export async function POST(request: Request) {
  // Parse and validate request body
  let body: { messages?: IncomingMessage[] };
  try {
    body = (await request.json()) as { messages?: IncomingMessage[] };
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body was not valid JSON." },
      { status: 400 },
    );
  }

  // Validate messages array
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const validMessages = rawMessages
    .filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0,
    )
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: String(item.content).trim().slice(0, MAX_MESSAGE_CHARS),
    }));

  if (validMessages.length === 0 || validMessages[validMessages.length - 1]?.role !== "user") {
    return NextResponse.json(
      { error: "invalid_messages", message: "Send at least one user message." },
      { status: 400 },
    );
  }

  // Check Gemma configuration — never expose the key to the browser
  const config = getGemmaConfig();
  const apiKey = getGemmaApiKey();

  if (!config.hasApiKey || !apiKey) {
    return NextResponse.json(
      {
        error: "unavailable",
        message:
          "The Gemma AI is not configured. Set GEMMA_API_KEY or GOOGLE_GENAI_API_KEY in your server environment.",
      },
      { status: 503 },
    );
  }

  // Trim history to MAX_HISTORY_TURNS most recent messages (always keep last user msg)
  const trimmed = validMessages.slice(-MAX_HISTORY_TURNS);

  // Map to Gemma contents format: "assistant" -> "model"
  const contents: GemmaContent[] = trimmed.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.primaryModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const gemmaResponse = await fetch(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 1024,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Rate limited
    if (gemmaResponse.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", message: "The AI service is busy. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    // Provider errors
    if (gemmaResponse.status === 503 || gemmaResponse.status === 502 || gemmaResponse.status === 500) {
      return NextResponse.json(
        { error: "provider_error", message: "The AI service is temporarily unavailable. Please try again." },
        { status: 502 },
      );
    }

    if (!gemmaResponse.ok) {
      const errText = await gemmaResponse.text().catch(() => "");
      return NextResponse.json(
        {
          error: "provider_error",
          message: `AI provider returned status ${gemmaResponse.status}: ${errText.slice(0, 200)}`,
        },
        { status: 502 },
      );
    }

    const data = (await gemmaResponse.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    // Some Gemma variants return a thought part followed by the real answer.
    // Pick the first part that is NOT marked as a thought, falling back to the first part.
    const answerPart = parts.find((p) => !(p as Record<string, unknown>).thought) ?? parts[0];
    const replyText = answerPart?.text?.trim();

    if (!replyText) {
      return NextResponse.json(
        { error: "empty_response", message: "The AI returned an empty answer. Please try rephrasing your question." },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply: replyText });
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

    if (isTimeout) {
      return NextResponse.json(
        { error: "timeout", message: "The AI took too long to respond. Please try again." },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "unreachable", message: "Could not reach the AI service. Check your connection and try again." },
      { status: 503 },
    );
  }
}

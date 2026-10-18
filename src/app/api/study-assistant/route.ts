import { NextResponse } from "next/server";
import { getGemmaConfig, getGemmaApiKey } from "@/lib/ai/gemma-config";
import { parseStructuredResponse } from "@/lib/ai/structured-response";

const MAX_HISTORY_TURNS = 10;
const MAX_MESSAGE_CHARS = 4000;
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

RESPONSE FORMAT:
Always respond with a single valid JSON object. Do not include any text outside the JSON.

Schema:
{
  "answer": "<your full conversational answer as plain text>",
  "language": "<programming language id, e.g. c, cpp, python, javascript — omit if not applicable>",
  "code": "<relevant code snippet as a string — omit if not applicable>",
  "highlights": [
    { "startLine": 1, "endLine": 3, "reason": "Why these lines matter" }
  ],
  "canvasAction": {
    "type": "<one of: linked_list | doubly_linked_list | array | stack | queue | binary_tree | recursion_tree | sorting | search | pointers>",
    "title": "<short diagram title>",
    "steps": [
      {
        "description": "<what is happening in this step>",
        "nodes": [ { "id": "n1", "value": 10, "next": "n2" } ],
        "edges": [ { "from": "n1", "to": "n2" } ],
        "activeNodeIds": ["n1"]
      }
    ]
  }
}

RULES:
- "answer" is always required. All other fields are optional.
- Omit "code", "highlights", "language", and "canvasAction" when the question does not involve programming or data structures.
- For simple conversational questions (definitions, study tips, etc.) just provide "answer".
- Keep "answer" concise, accurate, and educational.
- Do NOT include reasoning, drafts, self-critique, or thinking steps anywhere.
- "canvasAction" steps: max 8 steps. Max 16 nodes per step. Keep node values simple.
- Any "addressLabel" in nodes must be clearly illustrative (e.g. "0x1a2b") — not real memory addresses.
- Do not wrap the JSON in markdown code fences.`;

export async function POST(request: Request) {
  let body: { messages?: IncomingMessage[] };
  try {
    body = (await request.json()) as { messages?: IncomingMessage[] };
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body was not valid JSON." },
      { status: 400 },
    );
  }

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

  const trimmed = validMessages.slice(-MAX_HISTORY_TURNS);

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
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (gemmaResponse.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", message: "The AI service is busy. Please wait a moment and try again." },
        { status: 429 },
      );
    }
    if (gemmaResponse.status === 503 || gemmaResponse.status === 502 || gemmaResponse.status === 500) {
      return NextResponse.json(
        { error: "provider_error", message: "The AI service is temporarily unavailable. Please try again." },
        { status: 502 },
      );
    }
    if (!gemmaResponse.ok) {
      const errText = await gemmaResponse.text().catch(() => "");
      return NextResponse.json(
        { error: "provider_error", message: `AI provider returned status ${gemmaResponse.status}: ${errText.slice(0, 200)}` },
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
    const answerPart = parts.find((p) => !(p as Record<string, unknown>).thought) ?? parts[0];
    const rawText = answerPart?.text?.trim() ?? "";

    if (!rawText) {
      return NextResponse.json(
        { error: "empty_response", message: "The AI returned an empty answer. Please try rephrasing your question." },
        { status: 502 },
      );
    }

    // Attempt structured parse; fall back to plain reply
    const structured = parseStructuredResponse(rawText);
    if (structured) {
      return NextResponse.json({
        reply: structured.answer,
        language: structured.language ?? null,
        code: structured.code ?? null,
        highlights: structured.highlights ?? [],
        canvasAction: structured.canvasAction ?? null,
      });
    }

    // Plain text fallback — model didn't return JSON
    return NextResponse.json({ reply: rawText, language: null, code: null, highlights: [], canvasAction: null });
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

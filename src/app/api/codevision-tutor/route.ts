import { NextResponse } from "next/server";
import { getGemmaConfig, getGemmaApiKey } from "@/lib/ai/gemma-config";

const REQUEST_TIMEOUT_MS = 30000;

const SYSTEM_INSTRUCTION = `You are an expert C programming tutor integrated into FocusLock CodeVision.
A student is stepping through a C program using a deterministic execution visualizer.
You receive the current execution state and must explain it clearly for a beginner.

STRICT OUTPUT RULES:
- Output ONLY your final answer. No reasoning, drafts, or internal notes.
- Be concise, accurate, and encouraging. Use plain language.
- When explaining pointers, memory, or the stack/heap, give concrete analogies.
- Do NOT invent variable values or memory addresses not provided to you.
- Do NOT pretend to execute code. The execution state is pre-computed.`;

type TutorRequest = {
  action: "explain_step" | "explain_simpler" | "give_hint" | "custom";
  program: string;
  language: string;
  activeLine: number;
  stepIndex: number;
  totalSteps: number;
  explanation: string;
  variables: Array<{ name: string; type: string; value: string; changed: boolean }>;
  stack: Array<{ fn: string; locals: Array<{ name: string; value: string }> }>;
  heap: Array<{ address: string; label: string; isNew: boolean }>;
  pointers: Array<{ from: string; to: string | null }>;
  linkedList: Array<{ data: string; isHead: boolean; isActive: boolean }>;
  question?: string;
};

function buildPrompt(req: TutorRequest): string {
  const varsText = req.variables.length
    ? req.variables.map((v) => `  ${v.changed ? "★ " : "  "}${v.name} (${v.type}) = ${v.value}`).join("\n")
    : "  (none)";

  const stackText = req.stack
    .map((f) => `  ${f.fn}(): ${f.locals.map((l) => `${l.name}=${l.value}`).join(", ")}`)
    .join("\n") || "  (empty)";

  const heapText = req.heap.length
    ? req.heap.map((n) => `  ${n.isNew ? "[NEW] " : ""}${n.label} @ ${n.address}`).join("\n")
    : "  (no heap allocations)";

  const ptrText = req.pointers.length
    ? req.pointers.map((p) => `  ${p.from} → ${p.to ?? "NULL"}`).join("\n")
    : "  (no pointer relationships)";

  const llText = req.linkedList.length
    ? req.linkedList.map((n) => `${n.isHead ? "[HEAD]" : ""}${n.isActive ? "[ACTIVE]" : ""}${n.data}`).join(" → ") + " → NULL"
    : "  (no linked list)";

  const actionPart = (() => {
    switch (req.action) {
      case "explain_step": return "Explain what is happening at this execution step in simple terms.";
      case "explain_simpler": return "Explain this more simply, as if talking to someone with no programming experience.";
      case "give_hint": return "Give a helpful hint about what is happening, without giving the complete answer.";
      case "custom": return req.question ?? "Explain this step.";
    }
  })();

  return `Program: "${req.program}" (${req.language})
Step: ${req.stepIndex + 1} of ${req.totalSteps} — Line ${req.activeLine}
Pre-computed explanation: "${req.explanation}"

Current variables:
${varsText}

Call stack:
${stackText}

Heap:
${heapText}

Pointer relationships:
${ptrText}

Linked list state: ${llText}

Student request: ${actionPart}

Provide a clear, beginner-friendly explanation of this execution step.`;
}

export async function POST(request: Request) {
  let body: TutorRequest;
  try {
    body = (await request.json()) as TutorRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Invalid request body." }, { status: 400 });
  }

  if (!body.program || typeof body.activeLine !== "number") {
    return NextResponse.json({ error: "invalid_request", message: "Missing required fields." }, { status: 400 });
  }

  const config = getGemmaConfig();
  const apiKey = getGemmaApiKey();

  if (!config.hasApiKey || !apiKey) {
    return NextResponse.json(
      { error: "unavailable", message: "Gemma AI is not configured. Set GEMMA_API_KEY or GOOGLE_GENAI_API_KEY in your server environment." },
      { status: 503 },
    );
  }

  const prompt = buildPrompt(body);
  const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.primaryModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, topP: 0.9, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 429) return NextResponse.json({ error: "rate_limited", message: "Gemma is busy. Please wait a moment." }, { status: 429 });
    if (res.status >= 500) return NextResponse.json({ error: "provider_error", message: "Gemma service unavailable." }, { status: 502 });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: "provider_error", message: `Gemma returned ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const answer = (parts.find((p) => !(p as Record<string, unknown>).thought) ?? parts[0])?.text?.trim() ?? "";

    if (!answer) return NextResponse.json({ error: "empty_response", message: "Gemma returned an empty response." }, { status: 502 });

    return NextResponse.json({ reply: answer, model: config.primaryModel });
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (isTimeout) return NextResponse.json({ error: "timeout", message: "Gemma took too long. Try again." }, { status: 504 });
    return NextResponse.json({ error: "unreachable", message: "Could not reach Gemma." }, { status: 503 });
  }
}

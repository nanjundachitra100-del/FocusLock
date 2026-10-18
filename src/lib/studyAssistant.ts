import type { CodeHighlight, CanvasAction } from "@/lib/ai/structured-response";

export type StudyRole = "user" | "assistant";

export type StudyMessage = {
  role: StudyRole;
  content: string;
};

export type StudyAssistantResult = {
  reply: string;
  language: string | null;
  code: string | null;
  highlights: CodeHighlight[];
  canvasAction: CanvasAction | null;
};

export class StudyAssistantUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyAssistantUnavailableError";
  }
}

export async function sendStudyMessage(messages: StudyMessage[]): Promise<StudyAssistantResult> {
  const response = await fetch("/api/study-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  const data: unknown = await response.json().catch(() => null);
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const errMessage =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "The study assistant backend is unavailable.";

  if (!response.ok) {
    throw new StudyAssistantUnavailableError(errMessage);
  }

  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  if (!reply) {
    throw new StudyAssistantUnavailableError("The study assistant returned an empty answer.");
  }

  return {
    reply,
    language: typeof payload.language === "string" ? payload.language : null,
    code: typeof payload.code === "string" ? payload.code : null,
    highlights: Array.isArray(payload.highlights) ? (payload.highlights as CodeHighlight[]) : [],
    canvasAction: payload.canvasAction && typeof payload.canvasAction === "object"
      ? (payload.canvasAction as CanvasAction)
      : null,
  };
}

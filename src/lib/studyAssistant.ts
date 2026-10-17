export type StudyRole = "user" | "assistant";

export type StudyMessage = {
  role: StudyRole;
  content: string;
};

export class StudyAssistantUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyAssistantUnavailableError";
  }
}

export async function sendStudyMessage(messages: StudyMessage[]): Promise<string> {
  const response = await fetch("/api/study-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  const data: unknown = await response.json().catch(() => null);
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "The study assistant backend is unavailable.";

  if (!response.ok) {
    throw new StudyAssistantUnavailableError(message);
  }

  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  if (!reply) {
    throw new StudyAssistantUnavailableError("The study assistant returned an empty answer.");
  }

  return reply;
}

import { createClient } from "./client";
import type { Database } from "./database.types";

export type FocusSessionRow = Database["public"]["Tables"]["focus_sessions"]["Row"];

export async function createFocusSession(userId: string): Promise<{ id: string; started_at: string }> {
  if (!userId) {
    throw new Error("Cannot start a session: authenticated user ID is required.");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("focus_sessions")
    .insert({
      user_id: userId,
      status: "in_progress",
    })
    .select("id, started_at")
    .single();

  if (error) {
    throw new Error(`Failed to start focus session: ${error.message}`);
  }

  return { id: data.id, started_at: data.started_at };
}

export async function completeFocusSession(
  sessionId: string,
  durationSeconds: number,
): Promise<void> {
  if (!sessionId) {
    throw new Error("Cannot complete session: session ID is missing.");
  }

  const supabase = createClient();
  const safeSeconds = Math.max(0, Math.round(durationSeconds));
  const endedAt = new Date().toISOString();

  const { error } = await supabase
    .from("focus_sessions")
    .update({
      status: "completed",
      ended_at: endedAt,
      duration_seconds: safeSeconds,
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to complete focus session: ${error.message}`);
  }
}

export async function abandonFocusSession(
  sessionId: string,
  durationSeconds: number,
): Promise<void> {
  if (!sessionId) return;

  const supabase = createClient();
  const safeSeconds = Math.max(0, Math.round(durationSeconds));
  const endedAt = new Date().toISOString();

  const { error } = await supabase
    .from("focus_sessions")
    .update({
      status: "abandoned",
      ended_at: endedAt,
      duration_seconds: safeSeconds,
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to record abandoned session: ${error.message}`);
  }
}

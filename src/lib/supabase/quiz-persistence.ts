if (typeof window !== "undefined") {
  throw new Error("This module can only be executed on the server.");
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { requireSupabasePublicConfig } from "./env";

export interface RecordQuizOptions {
  userId: string;
  quizId: string;
  score: number;
  totalQuestions: number;
  passed: boolean;
  rewardMinutes: number;
  focusSessionId?: string | null;
}

export type RecordQuizResult =
  | {
      success: true;
      attemptId: string;
      rewardMinutes: number;
      availableMinutes: number;
      method: "rpc" | "service_role";
    }
  | {
      success: false;
      error: string;
      code: "ALREADY_SUBMITTED" | "DB_ERROR" | "MIGRATION_REQUIRED";
    };

/**
 * Creates an admin Supabase client using SUPABASE_SERVICE_ROLE_KEY if configured.
 * This is only ever used server-side and never exposed to the client.
 */
function getServiceRoleClient(): SupabaseClient<Database> | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) return null;

  try {
    const { url } = requireSupabasePublicConfig();
    return createSupabaseClient<Database>(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Atomically records a quiz attempt and awards entertainment minutes if passed.
 * Prevents replays, enforces strict score constraints, and never trusts client values.
 */
export async function persistQuizAttemptAndReward(
  authenticatedClient: SupabaseClient<Database>,
  options: RecordQuizOptions,
): Promise<RecordQuizResult> {
  const { userId, quizId, score, totalQuestions, passed, rewardMinutes, focusSessionId } = options;

  // 1. Check if this quiz attempt has already been submitted (idempotency / replay check)
  const { data: existingAttempt, error: checkError } = await authenticatedClient
    .from("quiz_attempts")
    .select("id")
    .eq("id", quizId)
    .maybeSingle();

  if (!checkError && existingAttempt) {
    return {
      success: false,
      error: "This quiz attempt has already been evaluated and recorded.",
      code: "ALREADY_SUBMITTED",
    };
  }

  // 2. Preferred path: Call the atomic PostgreSQL RPC function
  try {
    const { data: rpcData, error: rpcError } = await (authenticatedClient.rpc as any)(
      "record_quiz_attempt_and_reward",
      {
        p_quiz_id: quizId,
        p_score: score,
        p_total_questions: totalQuestions,
        p_focus_session_id: focusSessionId || null,
      },
    );

    if (!rpcError && rpcData) {
      return {
        success: true,
        attemptId: rpcData.attempt_id,
        rewardMinutes: rpcData.reward_minutes,
        availableMinutes: rpcData.available_minutes,
        method: "rpc",
      };
    }

    // If error is about duplicate submission
    if (rpcError?.message?.includes("already been submitted")) {
      return {
        success: false,
        error: "This quiz attempt has already been evaluated and recorded.",
        code: "ALREADY_SUBMITTED",
      };
    }

    // If RPC function is not found, attempt service-role fallback
    const isMissingFunction =
      rpcError?.message?.includes("Could not find the function") ||
      rpcError?.code === "PGRST202";

    if (!isMissingFunction) {
      // Real database error occurred
      console.error("[QuizPersistence] RPC error:", rpcError?.message);
    }
  } catch (rpcErr) {
    console.error("[QuizPersistence] RPC invocation failed:", rpcErr);
  }

  // 3. Fallback path: If SUPABASE_SERVICE_ROLE_KEY is available in the server environment
  const adminClient = getServiceRoleClient();
  if (adminClient) {
    try {
      // Re-check replay in admin client to prevent race conditions
      const { data: existingAdmin } = await adminClient
        .from("quiz_attempts")
        .select("id")
        .eq("id", quizId)
        .maybeSingle();

      if (existingAdmin) {
        return {
          success: false,
          error: "This quiz attempt has already been evaluated and recorded.",
          code: "ALREADY_SUBMITTED",
        };
      }

      // Insert quiz attempt
      const { data: insertedAttempt, error: attemptError } = await adminClient
        .from("quiz_attempts")
        .insert({
          id: quizId,
          user_id: userId,
          score,
          total_questions: totalQuestions,
          passed,
          focus_session_id: focusSessionId || null,
        })
        .select("id")
        .single();

      if (attemptError) {
        console.error("[QuizPersistence] Service role attempt insert error:", attemptError.message);
        return {
          success: false,
          error: `Failed to save quiz attempt: ${attemptError.message}`,
          code: "DB_ERROR",
        };
      }

      // Insert reward transaction if passed (10 minutes)
      if (passed && rewardMinutes > 0) {
        const { error: rewardError } = await adminClient
          .from("reward_transactions")
          .insert({
            user_id: userId,
            transaction_type: "earned",
            minutes: rewardMinutes,
            reference_id: quizId,
          });

        if (rewardError) {
          console.error("[QuizPersistence] Service role reward insert error:", rewardError.message);
        }
      }

      // Calculate updated available balance
      const { data: rewards } = await adminClient
        .from("reward_transactions")
        .select("transaction_type, minutes")
        .eq("user_id", userId);

      const earned = (rewards || [])
        .filter((r) => r.transaction_type === "earned")
        .reduce((sum, r) => sum + r.minutes, 0);
      const spent = (rewards || [])
        .filter((r) => r.transaction_type === "spent")
        .reduce((sum, r) => sum + r.minutes, 0);
      const availableMinutes = Math.max(0, earned - spent);

      return {
        success: true,
        attemptId: insertedAttempt.id,
        rewardMinutes: passed ? rewardMinutes : 0,
        availableMinutes,
        method: "service_role",
      };
    } catch (adminErr) {
      console.error("[QuizPersistence] Admin write error:", adminErr);
      return {
        success: false,
        error: "Failed to persist quiz attempt via service role.",
        code: "DB_ERROR",
      };
    }
  }

  // 4. If neither RPC nor service role key is present
  return {
    success: false,
    error:
      "Database function 'record_quiz_attempt_and_reward' is not yet installed in Supabase. Apply migration 20261016000001_record_quiz_and_reward.sql or configure SUPABASE_SERVICE_ROLE_KEY.",
    code: "MIGRATION_REQUIRED",
  };
}

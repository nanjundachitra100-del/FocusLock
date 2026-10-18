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
  focusSessionId?: string | null;
}

export type RecordQuizResult =
  | {
      success: true;
      attemptId: string;
      rewardMinutes: number;
      availableMinutes: number;
      method: "rpc";
    }
  | {
      success: false;
      error: string;
      code: "ALREADY_SUBMITTED" | "DB_ERROR" | "MIGRATION_REQUIRED";
    };

/**
 * Atomically records a quiz attempt and awards entertainment minutes if passed.
 * Prevents replays, enforces strict score constraints, and never trusts client values.
 */
function createServiceRoleClient(): SupabaseClient<Database> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for atomic quiz reward persistence.");
  }

  const { url } = requireSupabasePublicConfig();
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function persistQuizAttemptAndReward(
  options: RecordQuizOptions,
): Promise<RecordQuizResult> {
  const { userId, quizId, score, totalQuestions, focusSessionId } = options;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quizId) ||
    !Number.isInteger(totalQuestions) ||
    totalQuestions <= 0 ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > totalQuestions
  ) {
    return {
      success: false,
      error: "Invalid server-calculated quiz result.",
      code: "DB_ERROR",
    };
  }

  let serviceClient: SupabaseClient<Database>;
  try {
    serviceClient = createServiceRoleClient();
  } catch (error) {
    console.error(
      "[QuizPersistence] Server-side reward persistence is not configured.",
      error instanceof Error ? error.message : "Unknown configuration error.",
    );
    return {
      success: false,
      error: "Server-side atomic quiz reward persistence is not configured.",
      code: "DB_ERROR",
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await serviceClient.rpc(
      "record_quiz_attempt_and_reward",
      {
        p_user_id: userId,
        p_quiz_id: quizId,
        p_score: score,
        p_total_questions: totalQuestions,
        p_focus_session_id: focusSessionId || null,
      },
    );

    if (!rpcError && rpcData) {
      const expectedPassed = score / totalQuestions >= 0.8;
      const expectedRewardMinutes = expectedPassed ? 10 : 0;
      if (
        rpcData.attempt_id !== quizId ||
        rpcData.score !== score ||
        rpcData.total_questions !== totalQuestions ||
        rpcData.passed !== expectedPassed ||
        rpcData.reward_minutes !== expectedRewardMinutes ||
        !Number.isInteger(rpcData.available_minutes) ||
        rpcData.available_minutes < 0
      ) {
        console.error("[QuizPersistence] Atomic quiz RPC returned an invalid result.");
        return {
          success: false,
          error: "The quiz attempt and reward could not be confirmed.",
          code: "DB_ERROR",
        };
      }

      return {
        success: true,
        attemptId: rpcData.attempt_id,
        rewardMinutes: rpcData.reward_minutes,
        availableMinutes: rpcData.available_minutes,
        method: "rpc",
      };
    }

    if (rpcError?.message?.includes("already been submitted")) {
      return {
        success: false,
        error: "This quiz attempt has already been evaluated and recorded.",
        code: "ALREADY_SUBMITTED",
      };
    }

    const isMissingFunction =
      rpcError?.message?.includes("Could not find the function") ||
      rpcError?.code === "PGRST202" ||
      rpcError?.code === "42883";
    if (isMissingFunction) {
      return {
        success: false,
        error:
          "Secure database function 'record_quiz_attempt_and_reward' is not installed. Apply the latest quiz reward RPC security migration.",
        code: "MIGRATION_REQUIRED",
      };
    }
    if (rpcError?.code === "23505") {
      return {
        success: false,
        error: "This quiz attempt has already been evaluated and recorded.",
        code: "ALREADY_SUBMITTED",
      };
    }
    if (rpcError) {
      console.error("[QuizPersistence] Atomic RPC error:", rpcError.message);
    }
  } catch (rpcErr) {
    console.error("[QuizPersistence] Atomic RPC invocation failed:", rpcErr);
  }

  return {
    success: false,
    error: "Failed to persist the quiz attempt and reward atomically. Please try again.",
    code: "DB_ERROR",
  };
}

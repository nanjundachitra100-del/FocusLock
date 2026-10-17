import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { persistQuizAttemptAndReward } from "../src/lib/supabase/quiz-persistence";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));
vi.mock("../src/lib/supabase/env", () => ({
  requireSupabasePublicConfig: () => ({
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
  }),
}));

const quizId = "a674f09d-8ea9-41f2-8bca-f40ed3bd4621";
const options = {
  userId: "95a63800-99f1-4bd2-a6fa-4ee1c9c0b765",
  quizId,
  score: 4,
  totalQuestions: 5,
  focusSessionId: null,
};

function makeClient(
  rpcResult: { data: unknown; error: { code?: string; message: string } | null },
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const client = { from, rpc } as unknown as SupabaseClient<Database>;
  mocks.createClient.mockReturnValue(client);
  return { client, from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("quiz reward persistence", () => {
  it("uses the server-configured service-role client and supplies the authenticated user ID", async () => {
    const { client, rpc } = makeClient({
      data: {
        attempt_id: quizId,
        passed: true,
        score: 4,
        total_questions: 5,
        reward_minutes: 10,
        available_minutes: 10,
      },
      error: null,
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: true,
      method: "rpc",
    });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "server-only-test-key",
      expect.objectContaining({
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    );
    expect(rpc).toHaveBeenCalledWith("record_quiz_attempt_and_reward", {
      p_user_id: options.userId,
      p_quiz_id: quizId,
      p_score: 4,
      p_total_questions: 5,
      p_focus_session_id: null,
    });
    expect(client).toBe(mocks.createClient.mock.results[0].value);
  });

  it("reports success only when the atomic RPC confirms the attempt and reward", async () => {
    const { rpc } = makeClient({
      data: {
        attempt_id: quizId,
        passed: true,
        score: 4,
        total_questions: 5,
        reward_minutes: 10,
        available_minutes: 10,
      },
      error: null,
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toEqual({
      success: true,
      attemptId: quizId,
      rewardMinutes: 10,
      availableMinutes: 10,
      method: "rpc",
    });
    expect(rpc).toHaveBeenCalledWith("record_quiz_attempt_and_reward", {
      p_user_id: options.userId,
      p_quiz_id: quizId,
      p_score: 4,
      p_total_questions: 5,
      p_focus_session_id: null,
    });
  });

  it("fails explicitly when the atomic RPC fails without querying or writing tables directly", async () => {
    const { from, rpc } = makeClient({
      data: null,
      error: { code: "XX000", message: "Database unavailable." },
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: false,
      code: "DB_ERROR",
      error: "Failed to persist the quiz attempt and reward atomically. Please try again.",
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a missing atomic RPC as a migration requirement without falling back", async () => {
    const { from } = makeClient({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function." },
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: false,
      code: "MIGRATION_REQUIRED",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an RPC result that does not confirm the fixed reward policy", async () => {
    makeClient({
      data: {
        attempt_id: quizId,
        passed: true,
        score: 4,
        total_questions: 5,
        reward_minutes: 0,
        available_minutes: 0,
      },
      error: null,
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: false,
      code: "DB_ERROR",
    });
  });

  it("maps duplicate-attempt rejection from the atomic RPC to a conflict", async () => {
    const { rpc, from } = makeClient({
      data: null,
      error: { code: "P0001", message: "Quiz attempt has already been submitted and recorded." },
    });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: false,
      code: "ALREADY_SUBMITTED",
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("revokes the old client-callable RPC signature and grants only the revised function to service_role", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20261017000002_secure_quiz_reward_rpc.sql", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(migration).toContain(
      "drop function if exists public.record_quiz_attempt_and_reward(uuid, integer, integer, uuid);",
    );
    expect(migration).toContain(
      "grant execute on function public.record_quiz_attempt_and_reward(uuid, uuid, integer, integer, uuid)\n  to service_role;",
    );
    expect(migration).toContain("from public, anon, authenticated;");
  });

  it("does not invoke persistence without server-only service-role configuration", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { rpc } = makeClient({ data: null, error: null });

    await expect(persistQuizAttemptAndReward(options)).resolves.toMatchObject({
      success: false,
      code: "DB_ERROR",
      error: "Server-side atomic quiz reward persistence is not configured.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

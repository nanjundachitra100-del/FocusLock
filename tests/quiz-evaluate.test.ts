import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  unsealQuiz: vi.fn(),
  persistQuizAttemptAndReward: vi.fn(),
  client: { auth: { getUser: vi.fn() } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/ai/quiz-store", () => ({
  unsealQuiz: mocks.unsealQuiz,
}));
vi.mock("@/lib/supabase/quiz-persistence", () => ({
  persistQuizAttemptAndReward: mocks.persistQuizAttemptAndReward,
}));

import { POST as evaluateQuiz } from "@/app/api/quiz/evaluate/route";

const user = { id: "95a63800-99f1-4bd2-a6fa-4ee1c9c0b765", email: "learner@example.com" };
const quizId = "a674f09d-8ea9-41f2-8bca-f40ed3bd4621";
const answerKey = Array.from({ length: 5 }, (_, id) => ({
  id,
  correctAnswer: "Option A",
  explanation: "Verified server answer.",
}));

function request(body: unknown) {
  return new NextRequest("http://localhost/api/quiz/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("quiz reward evaluation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.auth.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.createClient.mockResolvedValue(mocks.client);
    mocks.unsealQuiz.mockReturnValue({
      valid: true,
      data: { quizId, topic: "Science", answerKey },
    });
    mocks.persistQuizAttemptAndReward.mockResolvedValue({
      success: true,
      attemptId: quizId,
      rewardMinutes: 10,
      availableMinutes: 10,
      method: "rpc",
    });
  });

  it("evaluates answers and uses the server's fixed 80-percent, 10-minute reward policy", async () => {
    const response = await evaluateQuiz(request({
      quizToken: "sealed-quiz-token",
      answers: { 0: "Option A", 1: "Option A", 2: "Option A", 3: "Option A", 4: "Option B" },
      score: 0,
      passed: false,
      rewardMinutes: 9999,
      userId: "f1c5dc66-bde0-4c9f-88f8-515917fe12a3",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      score: 4,
      totalQuestions: 5,
      percentage: 80,
      passed: true,
      rewardMinutes: 10,
      rewardEarned: true,
      persisted: true,
      availableMinutes: 10,
    });
    expect(mocks.persistQuizAttemptAndReward).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        quizId,
        score: 4,
        totalQuestions: 5,
        focusSessionId: null,
      }),
    );
  });

  it("returns a conflict for a replayed quiz attempt", async () => {
    mocks.persistQuizAttemptAndReward.mockResolvedValue({
      success: false,
      error: "Duplicate quiz attempt.",
      code: "ALREADY_SUBMITTED",
    });

    const response = await evaluateQuiz(request({
      quizToken: "sealed-quiz-token",
      answers: Object.fromEntries(answerKey.map(({ id }) => [id, "Option A"])),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ALREADY_SUBMITTED" });
  });

  it("returns a service error without evaluation or reward data when persistence fails", async () => {
    mocks.persistQuizAttemptAndReward.mockResolvedValue({
      success: false,
      error: "Atomic reward persistence failed.",
      code: "DB_ERROR",
    });

    const response = await evaluateQuiz(request({
      quizToken: "sealed-quiz-token",
      answers: { 0: "Option A", 1: "Option A", 2: "Option A", 3: "Option A", 4: "Option B" },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Atomic reward persistence failed.",
      code: "DB_ERROR",
    });
  });

  it("returns a clear migration-required response when the secure RPC is missing", async () => {
    mocks.persistQuizAttemptAndReward.mockResolvedValue({
      success: false,
      error: "Secure database function is not installed.",
      code: "MIGRATION_REQUIRED",
    });

    const response = await evaluateQuiz(request({
      quizToken: "sealed-quiz-token",
      answers: { 0: "Option A", 1: "Option A", 2: "Option A", 3: "Option A", 4: "Option B" },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Secure database function is not installed.",
      code: "MIGRATION_REQUIRED",
    });
  });

  it("does not evaluate or persist attempts for unauthenticated or invalid quiz tokens", async () => {
    mocks.client.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Unauthorized" },
    });
    const unauthorizedResponse = await evaluateQuiz(request({
      quizToken: "sealed-quiz-token",
      answers: {},
    }));
    expect(unauthorizedResponse.status).toBe(401);
    expect(mocks.persistQuizAttemptAndReward).not.toHaveBeenCalled();

    mocks.unsealQuiz.mockReturnValueOnce({ valid: false, reason: "Invalid token." });
    const invalidTokenResponse = await evaluateQuiz(request({
      quizToken: "invalid-token",
      answers: {},
    }));
    expect(invalidTokenResponse.status).toBe(400);
    expect(mocks.persistQuizAttemptAndReward).not.toHaveBeenCalled();
  });
});

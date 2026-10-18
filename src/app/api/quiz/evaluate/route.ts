import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unsealQuiz } from "@/lib/ai/quiz-store";
import { persistQuizAttemptAndReward } from "@/lib/supabase/quiz-persistence";
import type { EvaluatedQuestion, QuizEvaluationResult } from "@/lib/ai/quiz-schema";

export const maxDuration = 30;

export type EvaluateQuestionResult = EvaluatedQuestion;
export type EvaluateQuizResponse = QuizEvaluationResult;

export async function POST(request: NextRequest) {
  // 1. Authenticate user strictly on server
  let authUser: { id: string; email?: string } | null = null;
  let supabase: Awaited<ReturnType<typeof createClient>>;

  try {
    supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Unauthorized. You must be logged in to submit a quiz." },
        { status: 401 },
      );
    }
    authUser = authData.user;
  } catch {
    return NextResponse.json(
      { error: "Authentication service unavailable. Please try again." },
      { status: 401 },
    );
  }

  // 2. Parse request body
  let body: {
    quizToken?: unknown;
    answers?: unknown;
    focusSessionId?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload. Expected JSON body." },
      { status: 400 },
    );
  }

  const { quizToken, answers, focusSessionId } = body;

  if (typeof quizToken !== "string" || !quizToken.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid 'quizToken'." },
      { status: 400 },
    );
  }

  // 3. Unseal and decrypt the token on the server
  const unsealResult = unsealQuiz(quizToken.trim(), authUser.id);
  if (!unsealResult.valid) {
    return NextResponse.json(
      { error: `Token validation failed: ${unsealResult.reason}` },
      { status: 400 },
    );
  }

  const { quizId, topic, answerKey } = unsealResult.data;

  if (!Array.isArray(answerKey) || answerKey.length === 0) {
    return NextResponse.json(
      { error: "Corrupted quiz token: no questions found." },
      { status: 400 },
    );
  }

  // 4. Normalize user answers dictionary
  // Supports { "0": "Option A" } or [ { id: 0, answer: "Option A" } ]
  const normalizedAnswers: Record<number, string> = {};

  if (answers && typeof answers === "object") {
    if (Array.isArray(answers)) {
      for (const item of answers) {
        if (item && typeof item === "object" && typeof item.id === "number" && typeof item.answer === "string") {
          normalizedAnswers[item.id] = item.answer.trim();
        }
      }
    } else {
      for (const [key, val] of Object.entries(answers as Record<string, unknown>)) {
        const numKey = Number(key);
        if (Number.isInteger(numKey) && typeof val === "string") {
          normalizedAnswers[numKey] = val.trim();
        }
      }
    }
  }

  // 5. Evaluate answers server-side
  let score = 0;
  const questionResults: EvaluateQuestionResult[] = [];

  for (const item of answerKey) {
    const userSelected = normalizedAnswers[item.id] || null;
    const isCorrect = Boolean(
      userSelected &&
      userSelected.toLowerCase() === item.correctAnswer.trim().toLowerCase(),
    );

    if (isCorrect) {
      score++;
    }

    questionResults.push({
      id: item.id,
      selectedAnswer: userSelected,
      correctAnswer: item.correctAnswer,
      isCorrect,
      explanation: item.explanation,
    });
  }

  const totalQuestions = answerKey.length;
  const percentage = Math.round((score / totalQuestions) * 100);
  const passed = percentage >= 80;
  const rewardMinutes = passed ? 10 : 0;

  // 6. Persist quiz attempt and reward transaction atomically to Supabase
  const safeFocusSessionId =
    typeof focusSessionId === "string" && focusSessionId.trim()
      ? focusSessionId.trim()
      : null;

  const persistResult = await persistQuizAttemptAndReward({
    userId: authUser.id,
    quizId,
    score,
    totalQuestions,
    focusSessionId: safeFocusSessionId,
  });

  if (!persistResult.success && persistResult.code === "ALREADY_SUBMITTED") {
    return NextResponse.json(
      { error: "This quiz attempt has already been submitted and rewarded.", code: "ALREADY_SUBMITTED" },
      { status: 409 },
    );
  }

  if (!persistResult.success) {
    return NextResponse.json(
      { error: persistResult.error, code: persistResult.code },
      { status: 503 },
    );
  }

  const responsePayload: EvaluateQuizResponse = {
    quizId,
    topic,
    score,
    totalQuestions,
    percentage,
    passed,
    rewardMinutes: persistResult.rewardMinutes,
    rewardEarned: persistResult.rewardMinutes > 0,
    questions: questionResults,
    persisted: true,
    availableMinutes: persistResult.availableMinutes,
  };

  return NextResponse.json(responsePayload, { status: 200 });
}

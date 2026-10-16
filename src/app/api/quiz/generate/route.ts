import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { generateQuizWithGemma } from "@/lib/ai/gemma-service";
import { sanitizeQuestionsForClient } from "@/lib/ai/quiz-schema";
import { sealQuiz } from "@/lib/ai/quiz-store";
import { getGemmaConfig } from "@/lib/ai/gemma-config";

// Allow up to 60 seconds execution duration for high-parameter model inference
export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const MAX_NOTES_LENGTH = 50000; // 50,000 chars
const MIN_NOTES_LENGTH = 20;

// Simple in-process cooldown tracker per user (prevents spam / flooding)
const userRequestTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 6;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = userRequestTimestamps.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  validTimestamps.push(now);
  userRequestTimestamps.set(userId, validTimestamps);
  return true;
}

export async function POST(request: NextRequest) {
  // 1. Authenticate user strictly on the server
  let authUser: { id: string; email?: string } | null = null;
  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Unauthorized. You must be logged in to generate quizzes." },
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

  // 2. Check rate limit
  if (!checkRateLimit(authUser.id)) {
    return NextResponse.json(
      { error: "Too many quiz requests. Please wait a minute before generating another quiz." },
      { status: 429 },
    );
  }

  // 3. Parse input (multipart form or JSON)
  let notesText = "";
  let topic = "";
  const contentType = request.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const rawTopic = formData.get("topic");
      if (typeof rawTopic === "string") {
        topic = rawTopic.trim().slice(0, 100);
      }

      const notesField = formData.get("notes");
      if (typeof notesField === "string" && notesField.trim()) {
        notesText = notesField.trim();
      }

      const fileField = formData.get("file");
      if (fileField && fileField instanceof File && fileField.size > 0) {
        // Validate file size
        if (fileField.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json(
            { error: `File exceeds maximum allowed size of 512 KB.` },
            { status: 400 },
          );
        }

        // Validate file extension
        const fileName = fileField.name.toLowerCase();
        if (!fileName.endsWith(".txt") && !fileName.endsWith(".md")) {
          return NextResponse.json(
            { error: "Only plain text (.txt) and markdown (.md) note files are supported." },
            { status: 400 },
          );
        }

        const fileContent = await fileField.text();
        if (fileContent.trim()) {
          notesText = notesText ? `${notesText}\n\n${fileContent.trim()}` : fileContent.trim();
        }

        // If no topic specified, infer from file name
        if (!topic) {
          topic = fileField.name.replace(/\.(txt|md)$/i, "").slice(0, 80);
        }
      }
    } else {
      const body = await request.json();
      if (typeof body.notes === "string") {
        notesText = body.notes.trim();
      }
      if (typeof body.topic === "string") {
        topic = body.topic.trim().slice(0, 100);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse request payload: ${err instanceof Error ? err.message : "invalid request"}` },
      { status: 400 },
    );
  }

  // 4. Validate notes length
  if (!notesText || notesText.length < MIN_NOTES_LENGTH) {
    return NextResponse.json(
      {
        error: `Please provide study notes with at least ${MIN_NOTES_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  if (notesText.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      {
        error: `Study notes exceed the maximum limit of ${MAX_NOTES_LENGTH.toLocaleString()} characters.`,
      },
      { status: 400 },
    );
  }

  // Default topic if none provided
  const finalTopic = topic || "Study Notes Assessment";

  // 5. Check AI configuration
  const aiConfig = getGemmaConfig();
  if (!aiConfig.isConfigured) {
    return NextResponse.json(
      {
        error: "Gemma 4 provider is not configured. Set GEMMA_API_KEY in the server environment.",
        code: "MISSING_KEY",
        missingKeys: aiConfig.missingKeys,
      },
      { status: 503 },
    );
  }

  // 6. Generate quiz via Gemma 4 service
  // Note: Never log raw study notes!
  console.log(`[QuizGenerate] Generating quiz for user=${authUser.id.slice(0, 8)}... topic="${finalTopic}" notesLength=${notesText.length}`);

  const aiResult = await generateQuizWithGemma({
    notes: notesText,
    topic: finalTopic,
    questionCount: 5,
  });

  if (!aiResult.success) {
    console.error(`[QuizGenerate] Failed generating quiz for user=${authUser.id.slice(0, 8)}... code=${aiResult.code}`);
    const statusCode =
      aiResult.code === "RATE_LIMITED"
        ? 429
        : aiResult.code === "MISSING_KEY"
          ? 503
          : aiResult.code === "TIMEOUT"
            ? 504
            : 502;
    return NextResponse.json(
      { error: aiResult.error, code: aiResult.code },
      { status: statusCode },
    );
  }

  // 7. Tamper-resistant seal on server (encrypt answers and metadata)
  const quizId = randomUUID();
  const { quizToken, expiresAt } = sealQuiz(
    quizId,
    authUser.id,
    finalTopic,
    aiResult.questions,
  );

  // 8. Sanitize questions (strip answers and explanations for client safety)
  const clientQuestions = sanitizeQuestionsForClient(aiResult.questions);

  return NextResponse.json({
    quizId,
    topic: finalTopic,
    totalQuestions: clientQuestions.length,
    questions: clientQuestions,
    quizToken,
    expiresAt,
    modelUsed: aiResult.modelUsed,
  });
}

export interface ServerQuizQuestion {
  id: number;
  question: string;
  options: [string, string, string, string];
  correctAnswer: string;
  explanation: string;
}

export interface ClientQuizQuestion {
  id: number;
  question: string;
  options: [string, string, string, string];
}

export interface QuizPayload {
  quizId: string;
  topic: string;
  totalQuestions: number;
  questions: ClientQuizQuestion[];
  quizToken: string;
  expiresAt: string;
}

export type ValidationResult =
  | { success: true; questions: ServerQuizQuestion[] }
  | { success: false; error: string };

function isQuizCandidate(val: unknown): boolean {
  if (Array.isArray(val)) {
    return val.length > 0 && val.some((item) => item && typeof item === "object" && "question" in item);
  }
  if (val && typeof val === "object" && "questions" in val) {
    const q = (val as { questions: unknown }).questions;
    return Array.isArray(q) && q.some((item) => item && typeof item === "object" && "question" in item);
  }
  return false;
}

/**
 * Safely parses JSON from model output handling:
 * 1. Direct raw JSON
 * 2. Markdown code fences (```json ... ```)
 * 3. Preceding or following commentary/thinking text without breaking on stray brackets
 */
export function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();

  // 1. Direct parse attempt
  try {
    const direct = JSON.parse(trimmed);
    if (isQuizCandidate(direct)) {
      return direct;
    }
  } catch {}

  // 2. Search all markdown code fences
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    const blockContent = fenceMatch[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (isQuizCandidate(parsed)) {
        return parsed;
      }
    } catch {}
  }

  // 3. Balanced bracket/brace scanner
  // Scans for candidate array '[' or object '{' blocks, tracking depth while
  // respecting quotes and escape sequences.
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char !== "[" && char !== "{") continue;

    const isArray = char === "[";
    const closingChar = isArray ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let j = i; j < trimmed.length; j++) {
      const c = trimmed[j];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (c === "\\") {
        escapeNext = true;
        continue;
      }

      if (c === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (c === char) {
          depth++;
        } else if (c === closingChar) {
          depth--;
          if (depth === 0) {
            const candidate = trimmed.substring(i, j + 1);
            try {
              const parsed = JSON.parse(candidate);
              if (isQuizCandidate(parsed)) {
                return parsed;
              }
            } catch {}
            break;
          }
        }
      }
    }
  }

  throw new Error("Unable to locate a valid JSON questions array in the model response.");
}

/**
 * Validates that the generated data strictly matches the 5-question multiple choice schema.
 */
export function validateGeneratedQuiz(rawInput: string): ValidationResult {
  let parsed: unknown;

  try {
    parsed = extractJsonFromText(rawInput);
  } catch (err) {
    return {
      success: false,
      error: `Model response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Handle both [ {...}, {...} ] and { questions: [ {...}, {...} ] }
  let questionList: unknown[];
  if (Array.isArray(parsed)) {
    questionList = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    "questions" in parsed &&
    Array.isArray((parsed as { questions: unknown[] }).questions)
  ) {
    questionList = (parsed as { questions: unknown[] }).questions;
  } else {
    return {
      success: false,
      error: "JSON root must be an array of questions or an object with a 'questions' array.",
    };
  }

  if (questionList.length !== 5) {
    return {
      success: false,
      error: `Quiz must have exactly 5 questions; found ${questionList.length}.`,
    };
  }

  const validatedQuestions: ServerQuizQuestion[] = [];

  for (let i = 0; i < questionList.length; i++) {
    const item = questionList[i];
    if (typeof item !== "object" || item === null) {
      return { success: false, error: `Question item at index ${i} is not a valid object.` };
    }

    const record = item as Record<string, unknown>;

    // Validate question text
    const questionText = typeof record.question === "string" ? record.question.trim() : "";
    if (questionText.length < 5) {
      return {
        success: false,
        error: `Question at index ${i} has an empty or overly short question text.`,
      };
    }

    // Validate options
    if (!Array.isArray(record.options)) {
      return {
        success: false,
        error: `Question at index ${i} does not provide an options array.`,
      };
    }

    const cleanOptions = record.options
      .map((opt) => (typeof opt === "string" ? opt.trim() : ""))
      .filter((opt) => opt.length > 0);

    if (cleanOptions.length !== 4) {
      return {
        success: false,
        error: `Question at index ${i} must have exactly 4 non-empty options; found ${cleanOptions.length}.`,
      };
    }

    // Validate correct answer
    const correctAnswer =
      typeof record.correctAnswer === "string" ? record.correctAnswer.trim() : "";
    if (!correctAnswer) {
      return {
        success: false,
        error: `Question at index ${i} is missing a correctAnswer.`,
      };
    }

    // Ensure correctAnswer is strictly one of the 4 options
    const optionMatch = cleanOptions.find(
      (opt) => opt.toLowerCase() === correctAnswer.toLowerCase(),
    );

    if (!optionMatch) {
      return {
        success: false,
        error: `Question at index ${i} has correctAnswer "${correctAnswer}" which does not match any of the provided choices.`,
      };
    }

    // Explanation
    const explanation =
      typeof record.explanation === "string" && record.explanation.trim()
        ? record.explanation.trim()
        : `Option "${optionMatch}" is the correct answer based on the study notes.`;

    validatedQuestions.push({
      id: i,
      question: questionText,
      options: [cleanOptions[0], cleanOptions[1], cleanOptions[2], cleanOptions[3]],
      correctAnswer: optionMatch,
      explanation,
    });
  }

  return {
    success: true,
    questions: validatedQuestions,
  };
}

/**
 * Strips correct answers and explanations before sending to the client browser.
 */
export function sanitizeQuestionsForClient(
  serverQuestions: ServerQuizQuestion[],
): ClientQuizQuestion[] {
  return serverQuestions.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
  }));
}

export interface EvaluatedQuestion {
  id: number;
  selectedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
}

export interface QuizEvaluationResult {
  quizId: string;
  topic: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  rewardMinutes: number;
  rewardEarned: boolean;
  questions: EvaluatedQuestion[];
  persisted: boolean;
  persistenceError?: string;
  availableMinutes?: number;
}


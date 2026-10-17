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

function isQuizCandidate(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (item) => item !== null && typeof item === "object" && "question" in item,
    );
  }
  return (
    value !== null &&
    typeof value === "object" &&
    "questions" in value &&
    Array.isArray(value.questions)
  );
}

function findJsonEnd(text: string, start: number): number | null {
  const closingFor: Record<string, string> = { "{": "}", "[": "]" };
  const expectedClosings: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      expectedClosings.push(closingFor[character]);
    } else if (character === "}" || character === "]") {
      if (expectedClosings.pop() !== character) {
        return null;
      }
      if (expectedClosings.length === 0) {
        return index;
      }
    }
  }

  return null;
}

/**
 * Extracts a balanced JSON object or array from direct, fenced, or prose-wrapped output.
 */
export function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  let firstJson: unknown;
  let foundJson = false;

  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== "[" && trimmed[start] !== "{") continue;
    const end = findJsonEnd(trimmed, start);
    if (end === null) continue;

    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
      if (isQuizCandidate(parsed)) {
        return parsed;
      }
      if (!foundJson) {
        firstJson = parsed;
        foundJson = true;
      }
    } catch {
      // The surrounding model text can contain unmatched or non-JSON brackets.
    }
  }

  if (foundJson) return firstJson;
  throw new Error("Unable to locate a valid JSON questions array in the model response.");
}

/**
 * Validates that the generated data matches the requested multiple-choice quiz schema.
 */
export function validateGeneratedQuiz(
  rawInput: string,
  expectedQuestionCount = 5,
): ValidationResult {
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

  if (questionList.length !== expectedQuestionCount) {
    return {
      success: false,
      error: `Quiz must have exactly ${expectedQuestionCount} questions; found ${questionList.length}.`,
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

    const cleanOptions = record.options.map((opt) =>
      typeof opt === "string" ? opt.trim() : "",
    );

    if (cleanOptions.length !== 4 || cleanOptions.some((option) => !option)) {
      return {
        success: false,
        error: `Question at index ${i} must have exactly 4 non-empty options.`,
      };
    }
    if (new Set(cleanOptions.map((option) => option.toLowerCase())).size !== 4) {
      return {
        success: false,
        error: `Question at index ${i} must have 4 distinct options.`,
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
      typeof record.explanation === "string" ? record.explanation.trim() : "";
    if (!explanation) {
      return {
        success: false,
        error: `Question at index ${i} is missing an explanation.`,
      };
    }

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

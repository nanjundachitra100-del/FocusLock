if (typeof window !== "undefined") {
  throw new Error("This module can only be executed on the server.");
}
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { ServerQuizQuestion } from "./quiz-schema";

export interface SealedQuizData {
  quizId: string;
  userId: string;
  topic: string;
  createdAt: number;
  expiresAt: number;
  answerKey: Array<{
    id: number;
    correctAnswer: string;
    explanation: string;
  }>;
}

const ALGORITHM = "aes-256-gcm";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Generate a deterministic 32-byte key from available server secret or persistent runtime key
let cachedRuntimeKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedRuntimeKey) return cachedRuntimeKey;

  const rawSecret =
    process.env.QUIZ_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    "focuslock-default-fallback-key-for-dev";

  cachedRuntimeKey = createHash("sha256").update(rawSecret).digest();
  return cachedRuntimeKey;
}

/**
 * Seals the quiz answer key and session metadata into an encrypted,
 * tamper-resistant token using AES-256-GCM.
 * The client cannot read the answers or forge the payload.
 */
export function sealQuiz(
  quizId: string,
  userId: string,
  topic: string,
  serverQuestions: ServerQuizQuestion[],
): { quizToken: string; expiresAt: string } {
  const now = Date.now();
  const expiresAtMs = now + TOKEN_TTL_MS;

  const payload: SealedQuizData = {
    quizId,
    userId,
    topic,
    createdAt: now,
    expiresAt: expiresAtMs,
    answerKey: serverQuestions.map((q) => ({
      id: q.id,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    })),
  };

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const jsonString = JSON.stringify(payload);
  let encrypted = cipher.update(jsonString, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv.authTag.ciphertext
  const quizToken = `${iv.toString("hex")}.${authTag.toString("hex")}.${encrypted}`;

  return {
    quizToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Decrypts and verifies a sealed quiz token for a specific authenticated user.
 */
export function unsealQuiz(
  quizToken: string,
  authenticatedUserId: string,
): { valid: true; data: SealedQuizData } | { valid: false; reason: string } {
  try {
    const parts = quizToken.split(".");
    if (parts.length !== 3) {
      return { valid: false, reason: "Malformed quiz token structure." };
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    if (iv.length !== 12 || authTag.length !== 16) {
      return { valid: false, reason: "Invalid cryptographic parameters in quiz token." };
    }

    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const data = JSON.parse(decrypted) as SealedQuizData;

    // Check expiration
    if (Date.now() > data.expiresAt) {
      return { valid: false, reason: "Quiz session has expired." };
    }

    // Verify user binding
    if (data.userId !== authenticatedUserId) {
      return { valid: false, reason: "Quiz session is not associated with this account." };
    }

    return { valid: true, data };
  } catch (err) {
    return {
      valid: false,
      reason: `Cryptographic verification failed: ${err instanceof Error ? err.message : "tampered token"}`,
    };
  }
}

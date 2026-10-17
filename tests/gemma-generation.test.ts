import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractJsonFromText,
  validateGeneratedQuiz,
} from "../src/lib/ai/quiz-schema";
import { generateQuizWithGemma } from "../src/lib/ai/gemma-service";

const question = (index: number) => ({
  question: `Question ${index}: What is the answer?`,
  options: ["Answer A", "Answer B", "Answer C", "Answer D"],
  correctAnswer: "Answer A",
  explanation: `The notes establish answer ${index}.`,
});

const questions = (count: number) =>
  Array.from({ length: count }, (_, index) => question(index + 1));

function providerResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("Gemma quiz JSON parsing and generation", () => {
  beforeEach(() => {
    vi.stubEnv("GEMMA_API_KEY", "test-gemma-key");
    vi.stubEnv("GEMMA_TIMEOUT_MS", "5000");
    vi.stubEnv("GEMMA_PRIMARY_MODEL", "gemma-test");
    vi.stubEnv("GEMMA_FALLBACK_MODEL", "gemma-test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses a direct questions array", () => {
    expect(extractJsonFromText(JSON.stringify(questions(5)))).toEqual(questions(5));
    expect(validateGeneratedQuiz(JSON.stringify(questions(5))).success).toBe(true);
  });

  it("parses JSON enclosed in a Markdown fence", () => {
    const output = `\`\`\`json\n${JSON.stringify({ questions: questions(5) })}\n\`\`\``;
    const result = validateGeneratedQuiz(output);
    expect(result.success).toBe(true);
  });

  it("finds the questions object between explanatory text", () => {
    const output = `Here is your quiz:\n${JSON.stringify({ questions: questions(5) })}\nEnd of response.`;
    expect(validateGeneratedQuiz(output).success).toBe(true);
  });

  it("handles nested arrays and escaped quotes inside JSON strings", () => {
    const nested = questions(5);
    nested[0].explanation = 'The note says "use [left, right]" and then continue.';
    const output = `Result:\n${JSON.stringify({ questions: nested, metadata: { tags: ["a", "b"] } })}`;
    const result = validateGeneratedQuiz(output);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.questions[0].explanation).toBe(nested[0].explanation);
    }
  });

  it("reports a useful error when no questions array is present", () => {
    const result = validateGeneratedQuiz('{"status":"ok"}');
    expect(result).toEqual({
      success: false,
      error: "JSON root must be an array of questions or an object with a 'questions' array.",
    });
  });

  it("rejects invalid required question fields", () => {
    const invalid = questions(5);
    invalid[2].options = ["Same", "Same", "Other", "Last"];
    const result = validateGeneratedQuiz(JSON.stringify(invalid));
    expect(result).toEqual({
      success: false,
      error: "Question at index 2 must have 4 distinct options.",
    });
  });

  it("requests JSON output and only the requested number of questions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(JSON.stringify(questions(3))));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
      topic: "Test Topic",
      questionCount: 3,
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.contents[0].parts[0].text).toContain("exactly 3");
    expect(request.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 1216,
    });
  });

  it("combines multiple model text parts before validation", async () => {
    const json = JSON.stringify({ questions: questions(5) });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: json.slice(0, 40) }, { text: json.slice(40) }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-range requested question counts without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
      questionCount: 11,
    });

    expect(result).toMatchObject({ success: false, code: "INVALID_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries malformed model output once, then returns a parse error", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      providerResponse("No valid question JSON was generated."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
    });

    expect(result).toMatchObject({ success: false, code: "PARSE_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a valid second response after one corrective retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("not JSON"))
      .mockResolvedValueOnce(providerResponse(JSON.stringify(questions(5))));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(retry.contents[0].parts[0].text).toContain("Correct the previous");
  });

  it("bounds timeout recovery to two provider requests", async () => {
    vi.stubEnv("GEMMA_FALLBACK_MODEL", "gemma-test-fallback");
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Request timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateQuizWithGemma({
      notes: "These are sufficiently long study notes about the requested topic.",
    });

    expect(result).toMatchObject({ success: false, code: "TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

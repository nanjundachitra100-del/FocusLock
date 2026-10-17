import test from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_QUESTIONS, scoreQuiz } from "../src/lib/quiz.js";

test("sample quiz is explicitly a usable set of scored questions", () => {
  assert.equal(SAMPLE_QUESTIONS.length, 5);
  const allCorrect = SAMPLE_QUESTIONS.map((question) => question.answer);
  assert.deepEqual(scoreQuiz(SAMPLE_QUESTIONS, allCorrect), {
    correct: 5,
    total: 5,
    percentage: 100,
  });
});

test("unanswered and incorrect answers are counted as incorrect", () => {
  assert.deepEqual(scoreQuiz(SAMPLE_QUESTIONS, [0, undefined, 2, 3, 0]), {
    correct: 1,
    total: 5,
    percentage: 20,
  });
});

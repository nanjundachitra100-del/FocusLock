import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTimer,
  makeTimer,
  pauseTimer,
  remainingSeconds,
  startTimer,
} from "../src/lib/timer.js";

test("formats countdown values as minutes and seconds", () => {
  assert.equal(formatTimer(0), "00:00");
  assert.equal(formatTimer(65), "01:05");
  assert.equal(formatTimer(3600), "60:00");
});

test("running timer uses its end time instead of counting interval ticks", () => {
  const running = startTimer(makeTimer("focus", 90), 1_000);
  assert.equal(remainingSeconds(running, 31_000), 60);
  assert.equal(remainingSeconds(running, 92_000), 0);
});

test("pausing preserves the remaining time and clears the deadline", () => {
  const running = startTimer(makeTimer("focus", 90), 1_000);
  const paused = pauseTimer(running, 31_000);
  assert.equal(paused.status, "paused");
  assert.equal(paused.remainingSeconds, 60);
  assert.equal(paused.endsAt, null);
  assert.equal(remainingSeconds(paused, 90_000), 60);
});

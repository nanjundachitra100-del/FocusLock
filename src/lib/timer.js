export const TIMER_STORAGE_KEY = "focuslock.timer.v1";

export function makeTimer(mode = "focus", durationSeconds = 25 * 60) {
  return {
    mode,
    status: "idle",
    durationSeconds,
    remainingSeconds: durationSeconds,
    endsAt: null,
  };
}

export function remainingSeconds(timer, now = Date.now()) {
  if (timer.status !== "running" || !Number.isFinite(timer.endsAt)) {
    return Math.max(0, Math.ceil(timer.remainingSeconds || 0));
  }
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function startTimer(timer, now = Date.now()) {
  const seconds = remainingSeconds(timer, now);
  return {
    ...timer,
    status: "running",
    remainingSeconds: seconds,
    endsAt: now + seconds * 1000,
  };
}

export function pauseTimer(timer, now = Date.now()) {
  return {
    ...timer,
    status: "paused",
    remainingSeconds: remainingSeconds(timer, now),
    endsAt: null,
  };
}

export function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function readTimer() {
  if (typeof window === "undefined") return makeTimer();
  try {
    const saved = JSON.parse(window.localStorage.getItem(TIMER_STORAGE_KEY));
    if (
      saved &&
      ["focus", "break"].includes(saved.mode) &&
      ["idle", "running", "paused"].includes(saved.status) &&
      Number.isFinite(saved.remainingSeconds)
    ) {
      return saved;
    }
  } catch {
    // Invalid local data is ignored and replaced with a fresh timer.
  }
  return makeTimer();
}

export function saveTimer(timer) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
  }
}

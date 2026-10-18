export const DEFAULT_SESSION_DURATION = 5;
export const SUPPORTED_SESSION_DURATIONS = [5, 10, 15, 30, 60];
export const PREFERRED_SESSION_DURATION_KEY = "focusLockPreferredSessionDuration";

export function isSupportedSessionDuration(value) {
  return Number.isInteger(value) && SUPPORTED_SESSION_DURATIONS.includes(value);
}

export function durationIsAffordable(duration, availableMinutes) {
  return isSupportedSessionDuration(duration) &&
    Number.isFinite(availableMinutes) &&
    availableMinutes >= duration;
}

export async function loadPreferredSessionDuration(storage) {
  try {
    const value = (await storage.get(PREFERRED_SESSION_DURATION_KEY))?.[PREFERRED_SESSION_DURATION_KEY];
    return isSupportedSessionDuration(value) ? value : DEFAULT_SESSION_DURATION;
  } catch {
    return DEFAULT_SESSION_DURATION;
  }
}

export async function savePreferredSessionDuration(storage, value) {
  if (!isSupportedSessionDuration(value)) return false;
  try {
    await storage.set({ [PREFERRED_SESSION_DURATION_KEY]: value });
    return true;
  } catch {
    return false;
  }
}

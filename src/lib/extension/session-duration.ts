export const SUPPORTED_SESSION_DURATIONS = [5, 10, 15, 30, 60] as const;
export type SupportedSessionDuration = typeof SUPPORTED_SESSION_DURATIONS[number];

export function isSupportedSessionDuration(value: unknown): value is SupportedSessionDuration {
  return typeof value === "number" &&
    SUPPORTED_SESSION_DURATIONS.includes(value as SupportedSessionDuration);
}

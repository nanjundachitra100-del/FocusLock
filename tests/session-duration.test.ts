import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SESSION_DURATION,
  PREFERRED_SESSION_DURATION_KEY,
  SUPPORTED_SESSION_DURATIONS,
  durationIsAffordable,
  isSupportedSessionDuration,
  loadPreferredSessionDuration,
  savePreferredSessionDuration,
} from "../chrome-extension/session-duration.js";
import { SUPPORTED_SESSION_DURATIONS as SERVER_DURATIONS, isSupportedSessionDuration as serverDurationIsSupported } from "@/lib/extension/session-duration";

describe("temporary unlock duration policy", () => {
  it("supports exactly the five selectable duration values on client and server", () => {
    expect(SUPPORTED_SESSION_DURATIONS).toEqual([5, 10, 15, 30, 60]);
    expect(SERVER_DURATIONS).toEqual(SUPPORTED_SESSION_DURATIONS);
    for (const duration of SUPPORTED_SESSION_DURATIONS) {
      expect(isSupportedSessionDuration(duration)).toBe(true);
      expect(serverDurationIsSupported(duration)).toBe(true);
    }
    for (const duration of [0, 1, 3, 7, 90, 180, 5.5, "5", null]) {
      expect(isSupportedSessionDuration(duration)).toBe(false);
      expect(serverDurationIsSupported(duration)).toBe(false);
    }
  });

  it("rejects durations above available earned time and permits exact matches", () => {
    expect(durationIsAffordable(5, 3)).toBe(false);
    expect(durationIsAffordable(5, 10)).toBe(true);
    expect(durationIsAffordable(15, 10)).toBe(false);
    expect(durationIsAffordable(30, 30)).toBe(true);
    expect(durationIsAffordable(7, 30)).toBe(false);
  });

  it("persists the preferred duration between popup openings and defaults to five minutes", async () => {
    const values = new Map<string, unknown>();
    const storage = {
      get: async (key: string) => ({ [key]: values.get(key) }),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) values.set(key, value);
      },
    };

    expect(await loadPreferredSessionDuration(storage)).toBe(DEFAULT_SESSION_DURATION);
    expect(await savePreferredSessionDuration(storage, 30)).toBe(true);
    expect(values.get(PREFERRED_SESSION_DURATION_KEY)).toBe(30);
    expect(await loadPreferredSessionDuration(storage)).toBe(30);
    expect(await savePreferredSessionDuration(storage, 7)).toBe(false);
  });

  it("keeps the database RPC as the atomic earned-time and concurrency authority", () => {
    const sql = readFileSync(
      "supabase/migrations/20261018000002_restrict_unlock_durations.sql",
      "utf8",
    );
    const lockPosition = sql.indexOf("for update");
    const balancePosition = sql.indexOf("select coalesce(sum(minutes), 0) into v_earned_minutes");
    const sessionInsertPosition = sql.indexOf("insert into public.entertainment_sessions");
    const spendInsertPosition = sql.indexOf("insert into public.reward_transactions");

    expect(sql).toContain("p_minutes not in (5, 10, 15, 30, 60)");
    expect(lockPosition).toBeGreaterThan(-1);
    expect(lockPosition).toBeLessThan(balancePosition);
    expect(balancePosition).toBeLessThan(sessionInsertPosition);
    expect(sessionInsertPosition).toBeLessThan(spendInsertPosition);
    expect(sql).toContain("if v_available_minutes < p_minutes then");
    expect(sql).toContain("v_expires_at := v_started_at + (p_minutes || ' minutes')::interval");
  });
});

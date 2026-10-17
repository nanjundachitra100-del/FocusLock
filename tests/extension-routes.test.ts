import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import {
  endEntertainmentSession,
  getEntertainmentStatus,
  saveUserBlockedSites,
  startEntertainmentSession,
} from "@/lib/supabase/entertainment-persistence";
import { POST as saveBlockedSites } from "@/app/api/extension/blocked-sites/route";
import { POST as startSession } from "@/app/api/extension/session/start/route";
import { POST as endSession } from "@/app/api/extension/session/end/route";
import { GET as getExtensionStatus } from "@/app/api/extension/status/route";
import { proxy } from "@/proxy";

vi.mock("@/lib/extension/auth", () => ({
  authenticateExtensionRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/entertainment-persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/entertainment-persistence")>();
  return {
    ...actual,
    getEntertainmentStatus: vi.fn(),
    saveUserBlockedSites: vi.fn(),
    startEntertainmentSession: vi.fn(),
    endEntertainmentSession: vi.fn(),
  };
});

const userId = "95a63800-99f1-4bd2-a6fa-4ee1c9c0b765";
const authContext = { user: { id: userId, email: null }, client: {} as never };

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(url: string, body: string, headers: HeadersInit = { "content-type": "application/json" }) {
  return new NextRequest(url, { method: "POST", headers, body });
}

describe("extension route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateExtensionRequest).mockResolvedValue(authContext);
  });

  it("rejects more than 50 blocked sites before writing", async () => {
    const response = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      JSON.stringify({ sites: Array.from({ length: 51 }, (_, index) => `site${index}.example`) }),
    ));

    expect(response.status).toBe(400);
    expect(saveUserBlockedSites).not.toHaveBeenCalled();
  });

  it("rejects an invalid domain and malformed JSON before writing", async () => {
    const invalidDomainResponse = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      JSON.stringify({ sites: ["example.com", "not a domain"] }),
    ));
    const malformedBodyResponse = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      "{",
    ));

    expect(invalidDomainResponse.status).toBe(400);
    expect(malformedBodyResponse.status).toBe(400);
    expect(saveUserBlockedSites).not.toHaveBeenCalled();
  });

  it("rejects oversized blocked-sites request bodies", async () => {
    const response = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      "x".repeat(16 * 1024 + 1),
    ));

    expect(response.status).toBe(413);
    expect(saveUserBlockedSites).not.toHaveBeenCalled();
  });

  it("rejects invalid session UUIDs before calling persistence", async () => {
    const startResponse = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 15, sessionId: "not-a-uuid" }),
    ));
    const endResponse = await endSession(post(
      "http://localhost/api/extension/session/end",
      JSON.stringify({ sessionId: "not-a-uuid" }),
    ));

    expect(startResponse.status).toBe(400);
    expect(endResponse.status).toBe(400);
    expect(await startResponse.json()).toHaveProperty("error");
    expect(await endResponse.json()).toHaveProperty("error");
    expect(startEntertainmentSession).not.toHaveBeenCalled();
    expect(endEntertainmentSession).not.toHaveBeenCalled();
  });

  it("rejects non-numeric and over-policy unlock durations before persistence", async () => {
    const stringDuration = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: "15" }),
    ));
    const overLimit = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 181 }),
    ));
    const fractional = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 1.5 }),
    ));

    expect(stringDuration.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(fractional.status).toBe(400);
    expect(startEntertainmentSession).not.toHaveBeenCalled();
  });

  it("allows the optional start session ID to be omitted or null", async () => {
    vi.mocked(startEntertainmentSession).mockResolvedValue({
      success: true,
      session: {
        id: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
        minutes: 15,
        startedAt: "2026-10-16T00:00:00.000Z",
        expiresAt: "2026-10-16T00:15:00.000Z",
        status: "active",
      },
      availableMinutes: 5,
      method: "rpc",
    });

    const response = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 15, sessionId: null }),
    ));

    expect(response.status).toBe(200);
    expect(startEntertainmentSession).toHaveBeenCalledWith(
      authContext.client,
      { minutes: 15, sessionId: undefined },
    );
  });

  it("maps insufficient balance and duplicate active sessions to client errors", async () => {
    vi.mocked(startEntertainmentSession)
      .mockResolvedValueOnce({
        success: false,
        error: "Insufficient reward balance.",
        code: "INSUFFICIENT_BALANCE",
      })
      .mockResolvedValueOnce({
        success: false,
        error: "An active entertainment session is already in progress.",
        code: "ACTIVE_SESSION_EXISTS",
      });

    const firstResponse = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 15 }),
    ));
    const secondResponse = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 15 }),
    ));

    expect(firstResponse.status).toBe(400);
    expect(secondResponse.status).toBe(409);
  });

  it("returns safe server errors when session RPC calls fail", async () => {
    vi.mocked(startEntertainmentSession).mockResolvedValue({
      success: false,
      error: "Unable to confirm entertainment session start.",
      code: "DB_ERROR",
    });
    vi.mocked(endEntertainmentSession).mockResolvedValue({
      success: false,
      error: "Unable to confirm entertainment session end.",
      code: "DB_ERROR",
    });

    const startResponse = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 15 }),
    ));
    const endResponse = await endSession(post(
      "http://localhost/api/extension/session/end",
      JSON.stringify({ sessionId: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621" }),
    ));

    expect(startResponse.status).toBe(500);
    expect(endResponse.status).toBe(500);
    expect(await startResponse.json()).toMatchObject({ code: "DB_ERROR" });
    expect(await endResponse.json()).toMatchObject({ code: "DB_ERROR" });
  });

  it("returns an active session from status so a client can recover after a lost start response", async () => {
    vi.mocked(getEntertainmentStatus).mockResolvedValue({
      earnedMinutes: 30,
      spentMinutes: 10,
      availableMinutes: 20,
      activeSession: {
        id: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
        minutes: 10,
        startedAt: "2026-10-16T00:00:00.000Z",
        expiresAt: "2026-10-16T00:10:00.000Z",
        remainingSeconds: 600,
      },
      blockedSites: [],
    });

    const response = await getExtensionStatus(new NextRequest("http://localhost/api/extension/status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activeSession.id).toBe("a674f09d-8ea9-41f2-8bca-f40ed3bd4621");
    expect(startEntertainmentSession).not.toHaveBeenCalled();
  });

  it("returns an explicit server error if status cannot determine the active session", async () => {
    vi.mocked(getEntertainmentStatus).mockRejectedValue(new Error("Failed to load entertainment session."));

    const response = await getExtensionStatus(new NextRequest("http://localhost/api/extension/status"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load entertainment session." });
  });

  it("returns JSON 500 for API configuration errors and preserves page redirects", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const apiResponse = await proxy(new NextRequest("http://localhost/api/extension/session/start"));
    const pageResponse = await proxy(new NextRequest("http://localhost/dashboard"));

    expect(apiResponse.status).toBe(500);
    expect(apiResponse.headers.get("content-type")).toContain("application/json");
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toContain("/login?error=configuration");
    vi.unstubAllEnvs();
  });
});

describe("blocked-site persistence helper", () => {
  it("validates every domain before making one authenticated-client batch upsert", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn(() => ({ upsert })),
    } as never;

    const invalidResult = await persistence.saveUserBlockedSites(client, userId, [
      { domain: "example.com", enabled: true },
      { domain: "bad domain", enabled: true },
    ]);
    expect(invalidResult.success).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    const longLabelResult = await persistence.saveUserBlockedSites(client, userId, [
      { domain: `${"a".repeat(64)}.example`, enabled: true },
    ]);
    expect(longLabelResult.success).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    const oversizedResult = await persistence.saveUserBlockedSites(
      client,
      userId,
      Array.from({ length: 51 }, (_, index) => ({ domain: `site${index}.example`, enabled: true })),
    );
    expect(oversizedResult.success).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    const validResult = await persistence.saveUserBlockedSites(client, userId, [
      { domain: "www.Example.com", enabled: true },
      { domain: "other.example", enabled: false },
    ]);

    expect(validResult.success).toBe(true);
    expect(persistence.normalizeDomain("www.Example.com")).toBe("example.com");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ user_id: userId, domain: "example.com", enabled: true }),
        expect.objectContaining({ user_id: userId, domain: "other.example", enabled: false }),
      ],
      { onConflict: "user_id,domain" },
    );
  });

  it("maps a generic RPC not-found error without querying sessions directly", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Entertainment session not found." },
    });
    const from = vi.fn();
    const client = {
      rpc,
      from,
    } as never;

    const result = await persistence.endEntertainmentSession(client, {
      sessionId: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
    });

    expect(result).toMatchObject({
      success: false,
      code: "NOT_FOUND",
      error: "Entertainment session not found.",
    });
    expect(rpc).toHaveBeenCalledWith("end_entertainment_session", {
      p_session_id: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not retry a start through direct writes when the RPC response is uncertain", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn().mockRejectedValue(new Error("Connection interrupted."));
    const from = vi.fn();
    const client = { rpc, from } as never;

    const result = await persistence.startEntertainmentSession(client, {
      minutes: 10,
    });

    expect(result).toMatchObject({
      success: false,
      code: "DB_ERROR",
      error: "Unable to confirm entertainment session start.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the missing-profile failure without attempting fallback writes", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Profile not found for authenticated user." },
    });
    const from = vi.fn();
    const client = { rpc, from } as never;

    const result = await persistence.startEntertainmentSession(client, { minutes: 10 });

    expect(result).toMatchObject({
      success: false,
      code: "DB_ERROR",
      error: "Profile not found for authenticated user.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not fall back to direct writes when ending an RPC session fails", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn().mockRejectedValue(new Error("Connection interrupted."));
    const from = vi.fn();
    const client = { rpc, from } as never;

    const result = await persistence.endEntertainmentSession(client, {
      sessionId: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
    });

    expect(result).toMatchObject({
      success: false,
      code: "DB_ERROR",
      error: "Unable to confirm entertainment session end.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("fails status reads rather than fabricating an empty active session when a query errors", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const makeQuery = (result: unknown) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    };
    const client = {
      from: vi.fn((table: string) => table === "reward_transactions"
        ? makeQuery({ data: [], error: null })
        : makeQuery({ data: null, error: { message: "database unavailable" } })),
    } as never;

    await expect(persistence.getEntertainmentStatus(client, userId)).rejects.toThrow(
      "Failed to load entertainment session.",
    );
  });
});

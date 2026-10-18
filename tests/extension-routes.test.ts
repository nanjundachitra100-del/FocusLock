import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import {
  endEntertainmentSession,
  getEntertainmentStatus,
  saveUserBlockedSites,
  startEntertainmentSession,
} from "@/lib/supabase/entertainment-persistence";
import { GET as getBlockedSites, POST as saveBlockedSites } from "@/app/api/extension/blocked-sites/route";
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

  it("loads the authenticated user's blocked sites without a client-supplied user id", async () => {
    vi.mocked(getEntertainmentStatus).mockResolvedValue({
      earnedMinutes: 20,
      spentMinutes: 5,
      availableMinutes: 15,
      activeSession: null,
      blockedSites: [
        { domain: "youtube.com", enabled: true },
        { domain: "reddit.com", enabled: false },
      ],
    });

    const response = await getBlockedSites(new NextRequest("http://localhost/api/extension/blocked-sites"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sites: [
        { domain: "youtube.com", enabled: true },
        { domain: "reddit.com", enabled: false },
      ],
    });
    expect(getEntertainmentStatus).toHaveBeenCalledWith(authContext.client, userId);
  });

  it("rejects an empty blocked-sites list before writing", async () => {
    const response = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      JSON.stringify({ sites: [] }),
    ));

    expect(response.status).toBe(400);
    expect(saveUserBlockedSites).not.toHaveBeenCalled();
  });

  it("deduplicates domains and saves without a client-supplied user id", async () => {
    vi.mocked(saveUserBlockedSites).mockResolvedValue({
      success: true,
      sites: [
        { domain: "youtube.com", enabled: true },
        { domain: "reddit.com", enabled: true },
      ],
    });

    const response = await saveBlockedSites(post(
      "http://localhost/api/extension/blocked-sites",
      JSON.stringify({
        sites: [
          "https://www.YouTube.com/watch",
          "youtube.com",
          { domain: "reddit.com", enabled: true },
        ],
      }),
    ));

    expect(response.status).toBe(200);
    expect(saveUserBlockedSites).toHaveBeenCalledTimes(1);
    expect(saveUserBlockedSites).toHaveBeenCalledWith(authContext.client, [
      { domain: "youtube.com", enabled: true },
      { domain: "reddit.com", enabled: true },
    ]);
    expect(saveUserBlockedSites.mock.calls[0]).toHaveLength(2);
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

  it("rejects tampered or unsupported unlock durations before persistence", async () => {
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
    const unsupported = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: 7 }),
    ));

    expect(stringDuration.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(fractional.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(startEntertainmentSession).not.toHaveBeenCalled();
  });

  it.each([5, 10, 15, 30, 60])("accepts the supported %i-minute duration for trusted balance validation", async (minutes) => {
    vi.mocked(startEntertainmentSession).mockResolvedValue({
      success: true,
      session: {
        id: "a674f09d-8ea9-41f2-8bca-f40ed3bd4621",
        minutes,
        startedAt: "2026-10-16T00:00:00.000Z",
        expiresAt: new Date(Date.parse("2026-10-16T00:00:00.000Z") + minutes * 60_000).toISOString(),
        status: "active",
      },
      availableMinutes: 0,
      method: "rpc",
    });
    const response = await startSession(post(
      "http://localhost/api/extension/session/start",
      JSON.stringify({ requestedMinutes: minutes }),
    ));
    expect(response.status).toBe(200);
    expect(startEntertainmentSession).toHaveBeenCalledWith(authContext.client, { minutes, sessionId: undefined });
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
  const otherUserId = "d3b07384-d9a0-4f1f-8b0d-1c9f6a2e4b77";

  type BlockedSite = { domain: string; enabled: boolean };

  function createIsolatedReplaceClient(ownerId: string, store: Map<string, BlockedSite[]>) {
    const from = vi.fn();
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe("replace_user_blocked_sites");
      expect(args).not.toHaveProperty("user_id");
      expect(args).not.toHaveProperty("p_user_id");

      const submitted = args.p_sites as BlockedSite[];
      store.set(ownerId, submitted.map((site) => ({ ...site })));
      const sites = [...(store.get(ownerId) ?? [])].sort((a, b) => a.domain.localeCompare(b.domain));
      return { data: { sites }, error: null };
    });

    return { rpc, from };
  }

  it("rejects malformed, empty, oversized, and invalid domains before calling the replace RPC", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn();
    const from = vi.fn();
    const client = { rpc, from } as never;

    const invalidResult = await persistence.saveUserBlockedSites(client, [
      { domain: "example.com", enabled: true },
      { domain: "bad domain", enabled: true },
    ]);
    expect(invalidResult).toMatchObject({ success: false, code: "VALIDATION" });

    const malformedResult = await persistence.saveUserBlockedSites(client, [
      { domain: "example.com", enabled: "yes" as never },
    ]);
    expect(malformedResult).toMatchObject({ success: false, code: "VALIDATION" });

    const longLabelResult = await persistence.saveUserBlockedSites(client, [
      { domain: `${"a".repeat(64)}.example`, enabled: true },
    ]);
    expect(longLabelResult).toMatchObject({ success: false, code: "VALIDATION" });

    const emptyResult = await persistence.saveUserBlockedSites(client, []);
    expect(emptyResult).toMatchObject({
      success: false,
      code: "VALIDATION",
      error: "Blocked sites must contain between 1 and 50 entries.",
    });

    const oversizedResult = await persistence.saveUserBlockedSites(
      client,
      Array.from({ length: 51 }, (_, index) => ({ domain: `site${index}.example`, enabled: true })),
    );
    expect(oversizedResult).toMatchObject({ success: false, code: "VALIDATION" });

    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("replaces the authenticated user's list through RPC and drops deselected domains", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const store = new Map<string, BlockedSite[]>([
      [userId, [
        { domain: "youtube.com", enabled: true },
        { domain: "reddit.com", enabled: true },
        { domain: "tiktok.com", enabled: true },
      ]],
    ]);
    const client = createIsolatedReplaceClient(userId, store);

    const result = await persistence.saveUserBlockedSites(client as never, [
      { domain: "www.YouTube.com", enabled: true },
      { domain: "instagram.com", enabled: false },
    ]);

    expect(result.success).toBe(true);
    expect(result.sites).toEqual([
      { domain: "instagram.com", enabled: false },
      { domain: "youtube.com", enabled: true },
    ]);
    expect(store.get(userId)).toEqual([
      { domain: "youtube.com", enabled: true },
      { domain: "instagram.com", enabled: false },
    ]);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("replace_user_blocked_sites", {
      p_sites: [
        { domain: "youtube.com", enabled: true },
        { domain: "instagram.com", enabled: false },
      ],
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("collapses duplicate domains before replace and never writes through table upserts", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const store = new Map<string, BlockedSite[]>();
    const client = createIsolatedReplaceClient(userId, store);

    const result = await persistence.saveUserBlockedSites(client as never, [
      { domain: "https://www.Example.com/path", enabled: true },
      { domain: "example.com", enabled: false },
      { domain: "other.example", enabled: true },
    ]);

    expect(result.success).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("replace_user_blocked_sites", {
      p_sites: [
        { domain: "example.com", enabled: true },
        { domain: "other.example", enabled: true },
      ],
    });
    expect(persistence.normalizeDomain("www.Example.com")).toBe("example.com");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does not let one user's replace mutate another user's stored sites", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const store = new Map<string, BlockedSite[]>([
      [userId, [{ domain: "youtube.com", enabled: true }]],
      [otherUserId, [{ domain: "netflix.com", enabled: true }]],
    ]);
    const userClient = createIsolatedReplaceClient(userId, store);
    const otherClient = createIsolatedReplaceClient(otherUserId, store);

    const userResult = await persistence.saveUserBlockedSites(userClient as never, [
      { domain: "reddit.com", enabled: true },
    ]);
    const otherResult = await persistence.saveUserBlockedSites(otherClient as never, [
      { domain: "twitch.tv", enabled: true },
    ]);

    expect(userResult.success).toBe(true);
    expect(otherResult.success).toBe(true);
    expect(store.get(userId)).toEqual([{ domain: "reddit.com", enabled: true }]);
    expect(store.get(otherUserId)).toEqual([{ domain: "twitch.tv", enabled: true }]);
    expect(userClient.rpc.mock.calls[0][1]).not.toHaveProperty("user_id");
    expect(otherClient.rpc.mock.calls[0][1]).not.toHaveProperty("p_user_id");
  });

  it.each([
    ["PGRST202", "Could not find the function in the schema cache", "schema_cache_lookup"],
    ["42883", "An undefined function was encountered", "postgres_undefined_function"],
  ])("logs safe diagnostics and maps replace RPC resolution error %s", async (code, message, messageKind) => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message },
    });
    const from = vi.fn();
    const client = { rpc, from } as never;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await persistence.saveUserBlockedSites(client, [
        { domain: "example.com", enabled: true },
      ]);

      expect(result).toMatchObject({
        success: false,
        code: "MIGRATION_REQUIRED",
      });
      expect(from).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`code=${code}`));
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`messageKind=${messageKind}`));
      expect(log.mock.calls.flat().join(" ")).not.toContain(message);
      expect(log.mock.calls.flat().join(" ")).not.toContain("example.com");
    } finally {
      log.mockRestore();
    }
  });

  it("replace_user_blocked_sites SQL derives ownership from auth.uid and scopes writes to that user", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261018000001_fix_replace_user_blocked_sites_unnest.sql"),
      "utf8",
    );

    expect(sql).toMatch(/v_user_id := auth\.uid\(\)/);
    expect(sql).not.toMatch(/p_user_id/);
    expect(sql).toMatch(/delete from public\.user_blocked_sites\s+where user_id = v_user_id/i);
    expect(sql).toMatch(/insert into public\.user_blocked_sites/);
    expect(sql).toMatch(/from pg_catalog\.generate_subscripts\(v_domains, 1\)/i);
    expect(sql).not.toMatch(/pg_catalog\.unnest\(v_domains,\s*v_enableds\)/i);
    expect(sql).toMatch(/from public\.user_blocked_sites as site\s+where site\.user_id = v_user_id/);
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

describe("trusted reward-session persistence", () => {
  it("rejects unsupported durations before invoking the spend RPC", async () => {
    const persistence = await vi.importActual<typeof import("@/lib/supabase/entertainment-persistence")>(
      "@/lib/supabase/entertainment-persistence",
    );
    const rpc = vi.fn();
    const client = { rpc } as never;

    const result = await persistence.startEntertainmentSession(client, { minutes: 7 });

    expect(result).toMatchObject({ success: false, code: "INVALID_DURATION" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

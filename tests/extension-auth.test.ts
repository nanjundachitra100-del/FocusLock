import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  bearerGetUser: vi.fn(),
  cookieGetUser: vi.fn(),
  createCookieClient: vi.fn(),
  bearerClient: { auth: { getUser: vi.fn() } },
  cookieClient: { auth: { getUser: vi.fn() } },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mocks.bearerClient),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createCookieClient,
}));

import { authenticateExtensionRequest } from "@/lib/extension/auth";

const user = { id: "95a63800-99f1-4bd2-a6fa-4ee1c9c0b765", email: "user@example.com" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extension authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    mocks.bearerClient.auth.getUser.mockImplementation(mocks.bearerGetUser);
    mocks.cookieClient.auth.getUser.mockImplementation(mocks.cookieGetUser);
    mocks.createCookieClient.mockResolvedValue(mocks.cookieClient);
  });

  it("rejects an invalid bearer token without falling back to valid ambient cookies", async () => {
    mocks.bearerGetUser.mockResolvedValue({ data: { user: null }, error: { message: "Invalid token" } });
    mocks.cookieGetUser.mockResolvedValue({ data: { user }, error: null });
    const request = new NextRequest("http://localhost/api/extension/blocked-sites", {
      headers: {
        Authorization: "Bearer invalid-token",
        Cookie: "supabase-auth=valid-cookie",
      },
    });

    const context = await authenticateExtensionRequest(request);

    expect(context).toBeNull();
    expect(mocks.bearerGetUser).toHaveBeenCalledWith("invalid-token");
    expect(mocks.createCookieClient).not.toHaveBeenCalled();
  });

  it("uses cookie authentication only when Authorization is absent", async () => {
    mocks.cookieGetUser.mockResolvedValue({ data: { user }, error: null });
    const request = new NextRequest("http://localhost/api/extension/blocked-sites", {
      headers: { Cookie: "supabase-auth=valid-cookie" },
    });

    const context = await authenticateExtensionRequest(request);

    expect(context?.user).toEqual({ id: user.id, email: user.email });
    expect(mocks.createCookieClient).toHaveBeenCalledOnce();
    expect(mocks.cookieGetUser).toHaveBeenCalledWith();
    expect(mocks.bearerGetUser).not.toHaveBeenCalled();
  });

  it("rejects malformed Authorization headers without cookie fallback", async () => {
    const request = new NextRequest("http://localhost/api/extension/blocked-sites", {
      headers: {
        Authorization: "Basic invalid-token",
        Cookie: "supabase-auth=valid-cookie",
      },
    });

    expect(await authenticateExtensionRequest(request)).toBeNull();
    expect(mocks.createCookieClient).not.toHaveBeenCalled();
  });
});

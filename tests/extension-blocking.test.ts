import { describe, expect, it, vi } from "vitest";
import {
  ALLOW_RULE_ID_START,
  BLOCK_RULE_ID_START,
  DEFAULT_BLOCKED_DOMAINS,
  SESSION_REVOKE_MARGIN_MS,
  buildBlockingRules,
  getHostPermissionOrigins,
  getBlockedTabQueryPatterns,
  getPermissionScopedSites,
  isConfirmedSessionStart,
  isReconciliationCurrent,
  isSessionAuthorized,
  matchesBlockedSite,
  normalizeHostname,
  reconcileDynamicRules,
  removeAllowRules,
  revokeAccessBeforeRevalidation,
  validateExcludedHosts,
  validateBlockedSites,
} from "../chrome-extension/blocking.js";

const now = 1_800_000_000_000;
const validSites = [
  { domain: "youtube.com", enabled: true },
  { domain: "instagram.com", enabled: true },
  { domain: "reddit.com", enabled: false },
];

function activeSession(expiresAt = new Date(now + 120_000).toISOString()) {
  return {
    id: "6b29fef0-0639-4a53-aa93-b35d4de1784c",
    minutes: 10,
    startedAt: new Date(now - 480_000).toISOString(),
    expiresAt,
  };
}

describe("extension blocked-site matching", () => {
  it("builds and installs YouTube allow rules only for a confirmed authorized session", async () => {
    let dynamicRules: any[] = [];
    let sessionRules: any[] = [];
    const dnr = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }: any) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }: any) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }),
    };
    const session = activeSession();
    const startResult = { state: "SESSION_STARTED", session: { id: session.id } };
    const status = { state: "AUTHENTICATED", status: { activeSession: session } };
    expect(isConfirmedSessionStart(startResult, status, now)).toBe(true);
    const plan = buildBlockingRules({ sites: validSites, session, now });
    await reconcileDynamicRules(dnr, plan!);

    expect(dynamicRules).toContainEqual(expect.objectContaining({
      condition: expect.objectContaining({ urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] }),
      priority: 1,
      action: expect.objectContaining({ type: "redirect" }),
    }));
    expect(sessionRules).toContainEqual(expect.objectContaining({
      condition: expect.objectContaining({ urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] }),
      priority: 2,
      action: { type: "allow" },
    }));
  });

  it("does not confirm start failures, mismatched sessions, or expired sessions", () => {
    const session = activeSession();
    const status = { state: "AUTHENTICATED", status: { activeSession: session } };
    expect(isConfirmedSessionStart({ state: "INSUFFICIENT_BALANCE" }, status, now)).toBe(false);
    expect(isConfirmedSessionStart({ state: "SESSION_STARTED", session: { id: "other" } }, status, now)).toBe(false);
    expect(isConfirmedSessionStart(
      { state: "SESSION_STARTED", session: { id: session.id } },
      { ...status, status: { activeSession: activeSession(new Date(now).toISOString()) } },
      now,
    )).toBe(false);
  });

  it("targets both root and subdomain tabs when expiry forces open tabs back to the block page", () => {
    expect(getBlockedTabQueryPatterns(["youtube.com", "youtube.com", "bad host"])).toEqual([
      "*://youtube.com/*",
      "*://*.youtube.com/*",
    ]);
  });

  it("discards an authorization result captured before expiry invalidated access", () => {
    expect(isReconciliationCurrent(7, 7)).toBe(true);
    expect(isReconciliationCurrent(7, 8)).toBe(false);
    expect(isReconciliationCurrent(7.5, 7.5)).toBe(false);
  });

  it("normalizes domain names and supported HTTP(S) URL hostnames", () => {
    expect(normalizeHostname("  WWW.YouTube.COM  ")).toBe("youtube.com");
    expect(normalizeHostname("https://www.youtube.com/")).toBe("youtube.com");
    expect(normalizeHostname("https://sub.example.org")).toBe("sub.example.org");
  });

  it("rejects malformed hosts and unsupported URL schemes", () => {
    for (const value of [
      "",
      "not a domain",
      "youtube.com.example.org/path",
      "-bad.example",
      "bad-.example",
      "bad..example",
      "youtube.com:8080",
      "ftp://youtube.com",
      "javascript:alert(1)",
      "https://user:pass@youtube.com/",
      "https://youtube.com/path",
      "*.youtube.com",
    ]) {
      expect(normalizeHostname(value), value).toBeNull();
    }
  });

  it("matches exact domains and their subdomains only at hostname boundaries", () => {
    expect(matchesBlockedSite("https://youtube.com/watch?v=1", validSites)).toBe(true);
    expect(matchesBlockedSite("http://music.youtube.com/", validSites)).toBe(true);
    expect(matchesBlockedSite("https://youtube.com.example.org/", validSites)).toBe(false);
    expect(matchesBlockedSite("https://notyoutube.com/", validSites)).toBe(false);
  });

  it("honors the configured subdomain policy", () => {
    expect(matchesBlockedSite("https://music.youtube.com/", validSites, {
      includeSubdomains: false,
    })).toBe(false);
    expect(matchesBlockedSite("https://youtube.com/", validSites, {
      includeSubdomains: false,
    })).toBe(true);
  });

  it("ignores disabled entries", () => {
    expect(matchesBlockedSite("https://reddit.com/", validSites)).toBe(false);
  });

  it("never matches configured FocusLock or Supabase hosts and rejects non-web schemes", () => {
    expect(matchesBlockedSite("https://dashboard.example.com/login", validSites, {
      excludedHosts: ["example.com"],
    })).toBe(false);
    expect(matchesBlockedSite("https://youtube.com/", validSites, {
      excludedHosts: ["youtube.com"],
    })).toBe(false);
    expect(matchesBlockedSite("chrome://settings/", validSites)).toBe(false);
    expect(matchesBlockedSite("file:///youtube.com", validSites)).toBe(false);
  });

  it("rejects malformed blocked-site configuration instead of matching partial entries", () => {
    expect(validateBlockedSites([
      { domain: "youtube.com", enabled: true },
      { domain: "invalid host", enabled: true },
    ])).toBeNull();
    expect(matchesBlockedSite("https://youtube.com/", [
      { domain: "youtube.com", enabled: true },
      { domain: "invalid host", enabled: true },
    ])).toBe(false);
    expect(validateBlockedSites([])).toBeNull();
    expect(validateBlockedSites(Array.from({ length: 51 }, (_, index) => ({
      domain: `site${index}.example`,
      enabled: true,
    })))).toBeNull();
  });

  it("deduplicates canonical domains after validation", () => {
    expect(validateBlockedSites([
      { domain: "www.youtube.com", enabled: true },
      { domain: "youtube.com", enabled: true },
    ])).toEqual([{ domain: "youtube.com", enabled: true }]);
    expect(validateBlockedSites([
      { domain: "youtube.com", enabled: true },
      { domain: "www.youtube.com", enabled: false },
    ])).toBeNull();
  });

  it("requests only enabled entertainment hosts and excludes the FocusLock application hosts", () => {
    expect(getHostPermissionOrigins(validSites, ["focuslock.example"])).toEqual([
      "*://*.instagram.com/*",
      "*://*.youtube.com/*",
    ]);
  });

  it("accepts configured localhost hosts for exclusions without allowing them as blocked sites", () => {
    const excludedHosts = ["localhost", "127.0.0.1", "project.supabase.co"];

    expect(validateExcludedHosts(excludedHosts)).toEqual(excludedHosts);
    expect(getHostPermissionOrigins(validSites, excludedHosts)).toEqual([
      "*://*.instagram.com/*",
      "*://*.youtube.com/*",
    ]);
    expect(validateBlockedSites([
      { domain: "localhost", enabled: true },
    ])).toBeNull();
  });
});

describe("extension dynamic blocking rules", () => {
  it("treats active, expired, malformed, and unknown sessions conservatively", () => {
    expect(isSessionAuthorized(activeSession(), now)).toBe(true);
    expect(isSessionAuthorized(activeSession(new Date(now).toISOString()), now)).toBe(false);
    expect(isSessionAuthorized(activeSession(new Date(now + 30_000).toISOString()), now)).toBe(false);
    expect(isSessionAuthorized(undefined, now)).toBe(false);
    expect(isSessionAuthorized({ id: "x", minutes: 10, expiresAt: "bad-date" }, now)).toBe(false);
  });

  it("generates exact boundary-safe main-frame redirect and active-session allow rules", () => {
    const plan = buildBlockingRules({
      sites: validSites,
      session: activeSession(),
      now,
      excludedHosts: ["focuslock.example", "project.supabase.co"],
    });

    expect(plan).not.toBeNull();
    expect(plan?.domains).toEqual(["instagram.com", "youtube.com"]);
    expect(plan?.blockRules).toHaveLength(2);
    expect(plan?.allowRules).toHaveLength(2);
    expect(plan?.blockRules[0]).toMatchObject({
      id: BLOCK_RULE_ID_START,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" },
      },
      condition: {
        urlFilter: "||instagram.com^",
        resourceTypes: ["main_frame"],
        excludedRequestDomains: ["focuslock.example", "project.supabase.co"],
      },
    });
    expect(plan?.allowRules[0]).toMatchObject({
      id: ALLOW_RULE_ID_START,
      priority: 2,
      action: { type: "allow" },
    });
  });

  it("generates block-only rules for expired, unknown, or near-expiry sessions", () => {
    const expired = buildBlockingRules({
      sites: validSites,
      session: activeSession(new Date(now).toISOString()),
      now,
    });
    const unknown = buildBlockingRules({ sites: validSites, session: null, now });
    const nearExpiry = buildBlockingRules({
      sites: validSites,
      session: activeSession(new Date(now + SESSION_REVOKE_MARGIN_MS).toISOString()),
      now,
    });

    expect(expired?.blockRules.length).toBe(2);
    expect(expired?.allowRules).toEqual([]);
    expect(unknown?.allowRules).toEqual([]);
    expect(nearExpiry?.allowRules).toEqual([]);
  });

  it("excludes FocusLock domains and rejects malformed configuration", () => {
    const excluded = buildBlockingRules({
      sites: [
        { domain: "youtube.com", enabled: true },
        { domain: "focuslock.example", enabled: true },
        { domain: "dashboard.focuslock.example", enabled: true },
      ],
      excludedHosts: ["focuslock.example"],
      now,
    });
    expect(excluded?.domains).toEqual(["youtube.com"]);
    expect(buildBlockingRules({
      sites: [{ domain: "bad domain", enabled: true }],
      now,
    })).toBeNull();
    expect(buildBlockingRules({
      sites: validSites,
      blockedPagePath: "https://example.com/",
      now,
    })).toBeNull();
  });

  it("builds an empty fail-closed plan when no configured host permissions are granted", () => {
    const plan = buildBlockingRules({
      sites: [],
      excludedHosts: ["localhost", "project.supabase.co"],
    });

    expect(plan).toEqual({
      blockRules: [],
      allowRules: [],
      domains: [],
      authorizedUntil: null,
    });
    expect(validateBlockedSites([])).toBeNull();
  });

  it("builds rules with the configured localhost backend excluded", () => {
    const plan = buildBlockingRules({
      sites: validSites,
      excludedHosts: ["localhost", "project.supabase.co"],
      now,
    });

    expect(plan).not.toBeNull();
    expect(plan?.blockRules[0].condition.excludedRequestDomains).toEqual([
      "localhost",
      "project.supabase.co",
    ]);
  });

  it("reconciles pre-save with no optional host permissions and existing DNR rules", async () => {
    const excludedHosts = ["localhost", "project.supabase.co"];
    const failClosedSites = DEFAULT_BLOCKED_DOMAINS.map((domain) => ({
      domain,
      enabled: true,
    }));
    const permissionState = await getPermissionScopedSites(
      failClosedSites,
      excludedHosts,
      async () => false,
    );
    expect(permissionState).toEqual({
      sites: [],
      missingOrigins: getHostPermissionOrigins(failClosedSites, excludedHosts),
    });

    let dynamicRules = [
      { id: BLOCK_RULE_ID_START, condition: { urlFilter: "||youtube.com^" } },
      { id: 99, condition: { urlFilter: "||unrelated.example^" } },
    ];
    let sessionRules = [
      { id: ALLOW_RULE_ID_START, condition: { urlFilter: "||youtube.com^" } },
      { id: 98, condition: { urlFilter: "||unrelated-session.example^" } },
    ];
    const dnr = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
        dynamicRules.push(...addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
        sessionRules.push(...addRules);
      }),
    };
    const plan = buildBlockingRules({
      sites: permissionState!.sites,
      excludedHosts,
    });
    expect(plan).toEqual({
      blockRules: [],
      allowRules: [],
      domains: [],
      authorizedUntil: null,
    });

    await reconcileDynamicRules(dnr, plan!, { failClosed: true });

    expect(dynamicRules).toEqual([
      { id: 99, condition: { urlFilter: "||unrelated.example^" } },
    ]);
    expect(sessionRules).toEqual([
      { id: 98, condition: { urlFilter: "||unrelated-session.example^" } },
    ]);
  });

  it("replaces owned rules without leaving duplicates or touching unrelated rules", async () => {
    let dynamicRules = [
      { id: BLOCK_RULE_ID_START, condition: { urlFilter: "old.example" } },
      { id: 99, condition: { urlFilter: "unrelated.example" } },
    ];
    let sessionRules = [
      { id: ALLOW_RULE_ID_START, condition: { urlFilter: "old.example" } },
      { id: 98, condition: { urlFilter: "unrelated-session.example" } },
    ];
    const api = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
        dynamicRules.push(...addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
        sessionRules.push(...addRules);
      }),
    };
    const plan = buildBlockingRules({ sites: validSites, session: activeSession(), now });
    expect(plan).not.toBeNull();

    await reconcileDynamicRules(api, plan!);
    await reconcileDynamicRules(api, plan!);

    expect(dynamicRules.filter((rule) => rule.id === 99)).toHaveLength(1);
    expect(dynamicRules.filter((rule) => rule.id >= BLOCK_RULE_ID_START && rule.id < ALLOW_RULE_ID_START))
      .toHaveLength(2);
    expect(sessionRules.filter((rule) => rule.id === 98)).toHaveLength(1);
    expect(sessionRules.filter((rule) => rule.id >= ALLOW_RULE_ID_START)).toHaveLength(2);
    expect(new Set(dynamicRules.map((rule) => rule.id)).size).toBe(dynamicRules.length);
    expect(new Set(sessionRules.map((rule) => rule.id)).size).toBe(sessionRules.length);
  });

  it("removes an obsolete higher-priority website redirect outside current rule ID ranges", async () => {
    let dynamicRules = [{
      id: 77,
      priority: 3,
      action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
      condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] },
    }];
    let sessionRules = [{
      id: 78,
      priority: 3,
      action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
      condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] },
    }];
    const dnr = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
        dynamicRules.push(...addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
        sessionRules.push(...addRules);
      }),
    };
    const plan = buildBlockingRules({ sites: validSites, session: activeSession(), now });

    await reconcileDynamicRules(dnr, plan!);

    expect(dynamicRules.some((rule) => rule.id === 77)).toBe(false);
    expect(sessionRules.some((rule) => rule.id === 78)).toBe(false);
    expect(dynamicRules).toEqual(expect.arrayContaining(plan!.blockRules));
    expect(sessionRules).toEqual(expect.arrayContaining(plan!.allowRules));
    expect(sessionRules.find((rule) => rule.condition.urlFilter === "||youtube.com^"))
      .toMatchObject({ priority: 2, action: { type: "allow" } });
  });

  it("removes allow rules on a fail-closed reconciliation", async () => {
    let dynamicRules = [];
    let sessionRules = [{ id: ALLOW_RULE_ID_START, condition: { urlFilter: "old.example" } }];
    const api = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
        dynamicRules.push(...addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
        sessionRules.push(...addRules);
      }),
    };
    const plan = buildBlockingRules({ sites: validSites, session: activeSession(), now });

    await reconcileDynamicRules(api, plan!, { failClosed: true });

    expect(sessionRules.some((rule) => rule.id >= ALLOW_RULE_ID_START)).toBe(false);
    expect(dynamicRules.some((rule) => rule.id >= ALLOW_RULE_ID_START)).toBe(false);
    expect(dynamicRules).toHaveLength(2);
  });

  it("reapplies blocking and drops session access during worker-start fail-closed bootstrap", async () => {
    let dynamicRules: any[] = [];
    let sessionRules: any[] = [{
      id: ALLOW_RULE_ID_START,
      priority: 2,
      action: { type: "allow" },
      condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] },
    }];
    const dnr = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }: any) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }: any) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }),
    };
    const plan = buildBlockingRules({ sites: validSites, session: null, now });

    await reconcileDynamicRules(dnr, plan!, { failClosed: true });

    expect(sessionRules.some((rule) => rule.action.type === "allow")).toBe(false);
    expect(dynamicRules).toContainEqual(expect.objectContaining({
      condition: expect.objectContaining({ urlFilter: "||youtube.com^" }),
      action: expect.objectContaining({ type: "redirect" }),
    }));
  });

  it("removes stale website allow rules even when they use IDs outside the current range", async () => {
    let dynamicRules = [{
      id: 77,
      priority: 3,
      action: { type: "allow" },
      condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] },
    }];
    let sessionRules = [{
      id: 78,
      priority: 3,
      action: { type: "allow" },
      condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] },
    }];
    const dnr = {
      getDynamicRules: vi.fn(async () => dynamicRules),
      getSessionRules: vi.fn(async () => sessionRules),
      updateDynamicRules: vi.fn(async ({ removeRuleIds }) => {
        dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
      }),
      updateSessionRules: vi.fn(async ({ removeRuleIds }) => {
        sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
      }),
    };

    await removeAllowRules(dnr);

    expect(dynamicRules).toEqual([]);
    expect(sessionRules).toEqual([]);
  });

  it.each(["expired", "ended"])(
    "removes temporary access before revalidating an %s session",
    async () => {
      let dynamicRules = [
        { id: ALLOW_RULE_ID_START, condition: { urlFilter: "||youtube.com^" } },
      ];
      let sessionRules = [
        { id: ALLOW_RULE_ID_START, condition: { urlFilter: "||youtube.com^" } },
      ];
      const dnr = {
        getDynamicRules: vi.fn(async () => dynamicRules),
        getSessionRules: vi.fn(async () => sessionRules),
        updateDynamicRules: vi.fn(async ({ removeRuleIds, addRules }) => {
          dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
          dynamicRules.push(...addRules);
        }),
        updateSessionRules: vi.fn(async ({ removeRuleIds, addRules }) => {
          sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
          sessionRules.push(...addRules);
        }),
      };
      const revalidate = vi.fn(async () => {
        expect(sessionRules.some((rule) => rule.id >= ALLOW_RULE_ID_START)).toBe(false);
        const blockedPlan = buildBlockingRules({ sites: validSites, session: null, now });
        await reconcileDynamicRules(dnr, blockedPlan!);
      });

      await revokeAccessBeforeRevalidation(dnr, revalidate);

      expect(revalidate).toHaveBeenCalledOnce();
      expect(sessionRules.some((rule) => rule.id >= ALLOW_RULE_ID_START)).toBe(false);
      expect(dynamicRules.some((rule) => rule.id >= ALLOW_RULE_ID_START)).toBe(false);
      expect(dynamicRules).toHaveLength(2);
    },
  );

  it("retries temporary access cleanup when expiry revalidation fails", async () => {
    const updateSessionRules = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const dnr = {
      getDynamicRules: vi.fn(async () => []),
      getSessionRules: vi.fn(async () => [{ id: ALLOW_RULE_ID_START }]),
      updateDynamicRules: vi.fn(async () => undefined),
      updateSessionRules,
    };

    await expect(revokeAccessBeforeRevalidation(
      dnr,
      async () => { throw new Error("status unavailable"); },
    )).rejects.toThrow("status unavailable");

    expect(updateSessionRules).toHaveBeenCalledTimes(2);
    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: expect.arrayContaining([ALLOW_RULE_ID_START]),
      addRules: [],
    });
  });
});

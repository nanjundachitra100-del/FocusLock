import { describe, expect, it, vi } from "vitest";
import { loadBlockedSites, saveBlockedSites } from "@/lib/blocked-sites/api";
import { BLOCKED_SITE_CATALOG, DEFAULT_BLOCKED_DOMAINS } from "@/lib/blocked-sites/catalog";
import {
  EMPTY_SELECTION_ERROR,
  addCustomWebsite,
  buildSavePayload,
  hostPermissionGuidance,
  loadBlockedWebsiteSelections,
  persistBlockedWebsiteSelection,
  removeCustomWebsite,
  normalizeCustomWebsiteInput,
  toggleCustomWebsite,
  toggleDomain,
  validateSelection,
} from "@/lib/blocked-sites/settings";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("blocked websites settings catalog", () => {
  it("exposes the supported default sites including YouTube, Instagram, Reddit, X, and Netflix", () => {
    const names = BLOCKED_SITE_CATALOG.map((site) => site.name);
    const domains = BLOCKED_SITE_CATALOG.map((site) => site.domain);

    expect(names).toEqual(expect.arrayContaining([
      "YouTube",
      "Instagram",
      "Reddit",
      "Facebook",
      "X",
      "Netflix",
    ]));
    expect(domains).toEqual(expect.arrayContaining([
      "youtube.com",
      "instagram.com",
      "reddit.com",
      "facebook.com",
      "x.com",
      "netflix.com",
    ]));
    expect(DEFAULT_BLOCKED_DOMAINS).not.toContain("facebook.com");
  });
});

describe("blocked websites settings selection", () => {
  it("normalizes domain and HTTP(S) URL inputs while rejecting unsafe or local hosts", () => {
    expect(normalizeCustomWebsiteInput("  snapchat.com ")).toEqual({ success: true, domain: "snapchat.com" });
    expect(normalizeCustomWebsiteInput("https://www.pinterest.com/pins/?q=art")).toEqual({ success: true, domain: "pinterest.com" });
    for (const input of ["ftp://example.com", "javascript:alert(1)", "localhost", "foo.localhost", "127.0.0.1", "https://user:pass@example.com"]) {
      expect(normalizeCustomWebsiteInput(input).success, input).toBe(false);
    }
  });

  it("adds, re-enables, toggles, and removes custom websites", () => {
    const added = addCustomWebsite("https://www.snapchat.com/chat", [], []);
    expect(added).toMatchObject({ success: true, domain: "snapchat.com", kind: "custom" });
    if (!added.success) throw new Error("Expected custom website to be added");

    expect(toggleCustomWebsite(added.extraSites, "snapchat.com")).toEqual([
      { domain: "snapchat.com", enabled: false },
    ]);
    expect(addCustomWebsite("snapchat.com", [], [{ domain: "snapchat.com", enabled: false }]))
      .toMatchObject({ success: true, extraSites: [{ domain: "snapchat.com", enabled: true }] });
    expect(removeCustomWebsite(added.extraSites, "snapchat.com")).toEqual([]);
  });

  it("persists a custom-only selection and its deselection", async () => {
    const save = vi.fn(async (sites) => ({ success: true as const, sites }));
    await expect(persistBlockedWebsiteSelection({
      selectedDomains: [],
      extraSites: [{ domain: "snapchat.com", enabled: true }],
      save,
    })).resolves.toMatchObject({ success: true, sites: [{ domain: "snapchat.com", enabled: true }] });
    await expect(persistBlockedWebsiteSelection({
      selectedDomains: ["youtube.com"],
      extraSites: [{ domain: "snapchat.com", enabled: false }],
      save,
    })).resolves.toMatchObject({ success: true, sites: [
      { domain: "youtube.com", enabled: true },
      { domain: "snapchat.com", enabled: false },
    ] });
  });

  it("synchronizes a saved custom website back from the persisted settings response", async () => {
    const sites = [{ domain: "snapchat.com", enabled: true }];
    const save = vi.fn(async (selection) => ({ success: true as const, sites: selection }));
    const saved = await persistBlockedWebsiteSelection({
      selectedDomains: [],
      extraSites: sites,
      save,
    });
    const reloaded = await loadBlockedWebsiteSelections({
      load: async () => saved.success
        ? { success: true as const, sites: saved.sites }
        : saved,
    });

    expect(save).toHaveBeenCalledWith(sites);
    expect(reloaded).toMatchObject({ success: true, selected: [], extraSites: sites });
  });

  it("loads existing catalog selections and keeps extra saved sites", async () => {
    const result = await loadBlockedWebsiteSelections({
      load: async () => ({
        success: true,
        sites: [
          { domain: "youtube.com", enabled: true },
          { domain: "instagram.com", enabled: false },
          { domain: "reddit.com", enabled: true },
          { domain: "facebook.com", enabled: true },
          { domain: "custom.example", enabled: true },
        ],
      }),
    });

    expect(result).toEqual({
      success: true,
      selected: ["youtube.com", "reddit.com", "facebook.com"],
      extraSites: [{ domain: "custom.example", enabled: true }],
      sites: [
        { domain: "youtube.com", enabled: true },
        { domain: "instagram.com", enabled: false },
        { domain: "reddit.com", enabled: true },
        { domain: "facebook.com", enabled: true },
        { domain: "custom.example", enabled: true },
      ],
    });
  });

  it("loads saved selections through GET /api/extension/blocked-sites", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, {
      sites: [
        { domain: "netflix.com", enabled: true },
        { domain: "x.com", enabled: true },
      ],
    }));

    const loaded = await loadBlockedSites(fetcher);
    const result = await loadBlockedWebsiteSelections({
      load: async () => loaded,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/extension/blocked-sites", expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
    }));
    expect(result).toMatchObject({
      success: true,
      selected: ["x.com", "netflix.com"],
    });
  });

  it("selects and deselects websites without mutating the previous list", () => {
    const original = ["youtube.com"];
    const selected = toggleDomain(original, "reddit.com");
    const deselected = toggleDomain(selected, "youtube.com");

    expect(original).toEqual(["youtube.com"]);
    expect(selected).toEqual(["youtube.com", "reddit.com"]);
    expect(deselected).toEqual(["reddit.com"]);
  });

  it("saves the exact selected list through POST /api/extension/blocked-sites", async () => {
    const selected = ["youtube.com", "facebook.com", "netflix.com"];
    const extraSites = [{ domain: "custom.example", enabled: true }];
    const payload = buildSavePayload(selected, extraSites);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true,
      sites: payload,
    }));

    const result = await persistBlockedWebsiteSelection({
      selectedDomains: selected,
      extraSites,
      save: (sites) => saveBlockedSites(sites, fetcher),
    });

    expect(payload).toEqual([
      { domain: "youtube.com", enabled: true },
      { domain: "facebook.com", enabled: true },
      { domain: "netflix.com", enabled: true },
      { domain: "custom.example", enabled: true },
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/extension/blocked-sites", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ sites: payload }),
    }));
    expect(result).toEqual({ success: true, sites: payload });
  });

  it("rejects an empty selection before calling the save API", async () => {
    const save = vi.fn();
    const refreshExtension = vi.fn();

    expect(validateSelection([])).toEqual({
      valid: false,
      error: EMPTY_SELECTION_ERROR,
    });

    const result = await persistBlockedWebsiteSelection({
      selectedDomains: [],
      save,
      refreshExtension,
    });

    expect(result).toEqual({
      success: false,
      error: EMPTY_SELECTION_ERROR,
      reason: "empty",
    });
    expect(save).not.toHaveBeenCalled();
    expect(refreshExtension).not.toHaveBeenCalled();
  });

  it("does not report success or refresh extension status after an API failure, then retries", async () => {
    const payload = buildSavePayload(["instagram.com", "x.com"]);
    const save = vi.fn()
      .mockResolvedValueOnce({ success: false, error: "Failed to save blocked websites." })
      .mockResolvedValueOnce({ success: true, sites: payload });
    const refreshExtension = vi.fn();

    const failed = await persistBlockedWebsiteSelection({
      selectedDomains: ["instagram.com", "x.com"],
      save,
      refreshExtension,
    });

    expect(failed).toEqual({
      success: false,
      error: "Failed to save blocked websites.",
      reason: "api",
    });
    expect(refreshExtension).not.toHaveBeenCalled();

    const retried = await persistBlockedWebsiteSelection({
      selectedDomains: ["instagram.com", "x.com"],
      save,
      refreshExtension,
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, payload);
    expect(save).toHaveBeenNthCalledWith(2, payload);
    expect(retried).toEqual({ success: true, sites: payload });
    expect(refreshExtension).toHaveBeenCalledTimes(1);
  });

  it("refreshes extension status only after a successful save", async () => {
    const refreshExtension = vi.fn();
    const sites = [{ domain: "reddit.com", enabled: true }];

    await persistBlockedWebsiteSelection({
      selectedDomains: ["reddit.com"],
      save: async () => ({ success: true, sites }),
      refreshExtension,
    });

    expect(refreshExtension).toHaveBeenCalledTimes(1);
  });

  it("surfaces load and save API failures without treating them as success", async () => {
    const loadFailure = await loadBlockedWebsiteSelections({
      load: async () => ({ success: false, error: "You must be logged in to load blocked websites." }),
    });
    const saveFetcher = vi.fn().mockResolvedValue(jsonResponse(500, {
      error: "Failed to save blocked websites.",
    }));
    const saveFailure = await persistBlockedWebsiteSelection({
      selectedDomains: ["youtube.com"],
      save: (sites) => saveBlockedSites(sites, saveFetcher),
      refreshExtension: vi.fn(),
    });

    expect(loadFailure).toEqual({
      success: false,
      error: "You must be logged in to load blocked websites.",
    });
    expect(saveFailure.success).toBe(false);
    expect(saveFailure).toMatchObject({ reason: "api" });
  });

  it("explains that the dashboard cannot grant Chrome host permissions", () => {
    for (const state of ["authenticated", "auth_required", "unavailable", "checking", "not_detected"] as const) {
      expect(hostPermissionGuidance(state)).toContain(
        "This dashboard cannot grant those Chrome host permissions itself.",
      );
    }
  });
});

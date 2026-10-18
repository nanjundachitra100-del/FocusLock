import {
  parseBlockedSitesResponse,
  type BlockedSiteRecord,
} from "./settings";

type FetchLike = typeof fetch;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export async function loadBlockedSites(
  fetcher: FetchLike = fetch,
): Promise<{ success: true; sites: BlockedSiteRecord[] } | { success: false; error: string }> {
  try {
    const response = await fetcher("/api/extension/blocked-sites", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);

    if (response.status === 401) {
      return { success: false, error: "You must be logged in to load blocked websites." };
    }
    if (!response.ok) {
      return {
        success: false,
        error: errorFromBody(body, "Failed to load blocked websites."),
      };
    }

    return parseBlockedSitesResponse(body);
  } catch {
    return { success: false, error: "Failed to load blocked websites." };
  }
}

export async function saveBlockedSites(
  sites: BlockedSiteRecord[],
  fetcher: FetchLike = fetch,
): Promise<{ success: true; sites: BlockedSiteRecord[] } | { success: false; error: string }> {
  try {
    const response = await fetcher("/api/extension/blocked-sites", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sites }),
    });
    const body = await readJson(response);

    if (response.status === 401) {
      return { success: false, error: "You must be logged in to save blocked websites." };
    }
    if (!response.ok) {
      return {
        success: false,
        error: errorFromBody(body, "Failed to save blocked websites."),
      };
    }

    const parsed = parseBlockedSitesResponse(body);
    if (!parsed.success) {
      return { success: false, error: "Failed to save blocked websites." };
    }
    return parsed;
  } catch {
    return { success: false, error: "Failed to save blocked websites." };
  }
}

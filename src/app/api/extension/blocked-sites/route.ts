import { NextResponse, type NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import {
  getEntertainmentStatus,
  saveUserBlockedSites,
  normalizeDomain,
  MAX_BLOCKED_SITES,
} from "@/lib/supabase/entertainment-persistence";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16 * 1024;

type BlockedSiteInput = { domain: string; enabled: boolean };

async function readBoundedJson(request: NextRequest): Promise<
  { success: true; body: unknown } | { success: false; status: 400 | 413; error: string }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { success: false, status: 400, error: "Invalid Content-Length header." };
    }
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      return { success: false, status: 413, error: "Request body is too large." };
    }
  }

  if (!request.body) {
    return { success: false, status: 400, error: "Invalid JSON payload." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { success: false, status: 413, error: "Request body is too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { success: false, status: 400, error: "Invalid JSON payload." };
  }

  try {
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { success: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { success: false, status: 400, error: "Invalid JSON payload." };
  }
}

function parseBlockedSites(body: unknown):
  | { success: true; sites: BlockedSiteInput[] }
  | { success: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { success: false, error: "Request body must be a JSON object." };
  }

  const object = body as Record<string, unknown>;
  let inputs: unknown[];
  if (Object.prototype.hasOwnProperty.call(object, "sites")) {
    if (!Array.isArray(object.sites)) {
      return { success: false, error: "'sites' must be an array." };
    }
    if (object.sites.length > MAX_BLOCKED_SITES) {
      return { success: false, error: `No more than ${MAX_BLOCKED_SITES} blocked sites may be submitted.` };
    }
    inputs = object.sites;
  } else if (Object.prototype.hasOwnProperty.call(object, "domain")) {
    inputs = [{ domain: object.domain, enabled: object.enabled }];
  } else {
    return { success: false, error: "Provide a 'sites' array or a 'domain'." };
  }

  if (inputs.length === 0) {
    return { success: false, error: "At least one website domain must be provided." };
  }

  const sites: BlockedSiteInput[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const isString = typeof input === "string";
    if (!isString && (!input || typeof input !== "object" || Array.isArray(input))) {
      return { success: false, error: "Each site must be a domain string or an object with a domain." };
    }

    const site = isString ? { domain: input, enabled: true } : input as Record<string, unknown>;
    if (typeof site.domain !== "string" || (site.enabled !== undefined && typeof site.enabled !== "boolean")) {
      return { success: false, error: "Each site must include a valid domain and optional boolean 'enabled' value." };
    }

    const domain = normalizeDomain(site.domain);
    if (!domain) {
      return { success: false, error: "One or more website domains are invalid." };
    }
    if (!seen.has(domain)) {
      seen.add(domain);
      sites.push({ domain, enabled: site.enabled !== false });
    }
  }

  return { success: true, sites };
}

export async function GET(request: NextRequest) {
  const authContext = await authenticateExtensionRequest(request);
  if (!authContext) {
    return NextResponse.json(
      { error: "Unauthorized. Please log in to FocusLock." },
      { status: 401 },
    );
  }

  try {
    const status = await getEntertainmentStatus(authContext.client, authContext.user.id);
    return NextResponse.json({
      sites: status.blockedSites,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load blocked sites." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authContext = await authenticateExtensionRequest(request);
  if (!authContext) {
    return NextResponse.json(
      { error: "Unauthorized. Please log in to FocusLock." },
      { status: 401 },
    );
  }

  const parsedRequest = await readBoundedJson(request);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error },
      { status: parsedRequest.status },
    );
  }

  const parsedSites = parseBlockedSites(parsedRequest.body);
  if (!parsedSites.success) {
    return NextResponse.json(
      { error: parsedSites.error },
      { status: 400 },
    );
  }

  const result = await saveUserBlockedSites(authContext.client, parsedSites.sites);

  if (!result.success) {
    const status = result.code === "VALIDATION" ? 400 : 500;
    return NextResponse.json(
      { error: result.error || "Failed to save blocked websites." },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    sites: result.sites,
  });
}

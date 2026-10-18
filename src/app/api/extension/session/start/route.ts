import { NextResponse, type NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import { startEntertainmentSession } from "@/lib/supabase/entertainment-persistence";
import { isSupportedSessionDuration } from "@/lib/extension/session-duration";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authContext = await authenticateExtensionRequest(request);
  if (!authContext) {
    return NextResponse.json(
      { error: "Unauthorized. Please log in to FocusLock." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const { requestedMinutes, sessionId } = body as { requestedMinutes?: unknown; sessionId?: unknown };

  if (
    !isSupportedSessionDuration(requestedMinutes)
  ) {
    return NextResponse.json(
      { error: "Invalid 'requestedMinutes'. Choose 5, 10, 15, 30, or 60 minutes.", code: "INVALID_DURATION" },
      { status: 400 },
    );
  }
  const minutes = requestedMinutes;

  let cleanSessionId: string | undefined;
  if (sessionId !== undefined && sessionId !== null) {
    if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId.trim())) {
      return NextResponse.json({ error: "Invalid 'sessionId'. Must be a UUID." }, { status: 400 });
    }
    cleanSessionId = sessionId.trim();
  }

  const result = await startEntertainmentSession(authContext.client, {
    minutes,
    sessionId: cleanSessionId,
  });

  if (!result.success) {
    let statusCode = 400;
    if (result.code === "ACTIVE_SESSION_EXISTS" || result.code === "DUPLICATE_SESSION") {
      statusCode = 409;
    } else if (result.code === "INVALID_DURATION") {
      statusCode = 400;
    } else if (result.code === "DB_ERROR" || result.code === "MIGRATION_REQUIRED") {
      statusCode = 500;
    }

    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: statusCode },
    );
  }

  return NextResponse.json({
    success: true,
    session: result.session,
    availableMinutes: result.availableMinutes,
  });
}

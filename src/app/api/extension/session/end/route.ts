import { NextResponse, type NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import { endEntertainmentSession } from "@/lib/supabase/entertainment-persistence";

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

  const { sessionId } = body as { sessionId?: unknown };
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId.trim())) {
    return NextResponse.json(
      { error: "Invalid 'sessionId'. Must be a UUID." },
      { status: 400 },
    );
  }

  const result = await endEntertainmentSession(authContext.client, {
    sessionId: sessionId.trim(),
  });

  if (!result.success) {
    let statusCode = 400;
    if (result.code === "NOT_FOUND") {
      statusCode = 404;
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
  });
}

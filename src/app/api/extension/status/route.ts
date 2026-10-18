import { NextResponse, type NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import { getEntertainmentStatus } from "@/lib/supabase/entertainment-persistence";

export const dynamic = "force-dynamic";

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
      authenticated: true,
      user: {
        id: authContext.user.id,
        email: authContext.user.email,
      },
      wallet: {
        availableMinutes: status.availableMinutes,
        earnedMinutes: status.earnedMinutes,
        spentMinutes: status.spentMinutes,
      },
      activeSession: status.activeSession,
      blockedSites: status.blockedSites,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch extension status." },
      { status: 500 },
    );
  }
}

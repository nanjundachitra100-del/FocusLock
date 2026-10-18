import { NextResponse } from "next/server";
import { getAuraSyncFeed } from "@/lib/aurasync/feed-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleCronRefresh(request);
}

export async function POST(request: Request) {
  return handleCronRefresh(request);
}

async function handleCronRefresh(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Force background revalidation across all configured sources
    const feed = await getAuraSyncFeed(true);

    return NextResponse.json({
      success: true,
      message: "AuraSync background feed collection completed successfully.",
      totalCount: feed.totalCount,
      lastUpdated: feed.lastUpdated,
      sources: feed.sources,
    });
  } catch (error) {
    console.error("[AuraSync] Cron refresh error:", error);
    return NextResponse.json(
      {
        error: "internal_error",
        message: "Failed to run AuraSync scheduled collection.",
      },
      { status: 500 }
    );
  }
}

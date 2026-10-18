import { NextResponse } from "next/server";
import { getAuraSyncFeed } from "@/lib/aurasync/feed-service";
import type { AuraSyncCategory } from "@/lib/aurasync/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";
    const categoryParam = searchParams.get("category");
    const searchQuery = searchParams.get("q") || undefined;

    const preferredCategories: AuraSyncCategory[] = [];
    if (categoryParam && categoryParam !== "All") {
      preferredCategories.push(categoryParam as AuraSyncCategory);
    }

    const feed = await getAuraSyncFeed(forceRefresh, preferredCategories, searchQuery);

    return NextResponse.json(feed, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[AuraSync] Feed route error:", error);
    return NextResponse.json(
      {
        error: "internal_error",
        message: "Failed to generate AuraSync discovery feed.",
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { explainAuraSyncTopic, askTopicFollowUp } from "@/lib/aurasync/explanation-service";
import type { AuraSyncItem, TopicExplanation } from "@/lib/aurasync/types";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const item = body.item as AuraSyncItem;
    if (!item || !item.id || !item.title) {
      return NextResponse.json(
        { error: "Invalid item", message: "item with id and title is required." },
        { status: 400 }
      );
    }

    const question = typeof body.question === "string" ? body.question.trim() : null;
    const existingExplanation = body.existingExplanation as TopicExplanation | undefined;

    // Follow-up question mode
    if (question && existingExplanation) {
      const answer = await askTopicFollowUp(item, question, existingExplanation);
      return NextResponse.json({ answer });
    }

    // Initial topic explanation mode
    const explanation = await explainAuraSyncTopic(item);
    return NextResponse.json({ explanation });
  } catch (error) {
    console.error("[AuraSync] Explore route error:", error);
    return NextResponse.json(
      {
        error: "internal_error",
        message: "Failed to generate topic explanation.",
      },
      { status: 500 }
    );
  }
}

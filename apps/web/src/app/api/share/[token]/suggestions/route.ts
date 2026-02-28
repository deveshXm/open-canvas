import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "@/lib/supabase/verify_user_server";
import {
  ShareRecord,
  Suggestion,
  SuggestionType,
} from "@opencanvas/shared/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await params;

    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    // Verify share exists and is in suggest mode
    const shareItem = await lgClient.store.getItem(
      ["shared_artifacts", token],
      "share"
    );

    if (!shareItem || !shareItem.value) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    const shareRecord = shareItem.value as ShareRecord;
    if (shareRecord.mode !== "suggest") {
      return NextResponse.json(
        { error: "This share link does not accept suggestions" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { type, startOffset, endOffset, originalText, proposedText, comment } =
      body as {
        type: SuggestionType;
        startOffset: number;
        endOffset: number;
        originalText: string;
        proposedText: string;
        comment?: string;
      };

    if (type !== "edit" && type !== "comment") {
      return NextResponse.json(
        { error: "Invalid type. Must be edit or comment" },
        { status: 400 }
      );
    }

    const suggestionId = uuidv4();
    const suggestion: Suggestion = {
      id: suggestionId,
      authorId: authRes.user.id,
      createdAt: new Date().toISOString(),
      status: "pending",
      type,
      startOffset,
      endOffset,
      originalText: originalText || "",
      proposedText: proposedText || "",
      comment,
    };

    await lgClient.store.putItem(
      ["shared_artifacts", token, "suggestions"],
      suggestionId,
      suggestion as unknown as Record<string, unknown>
    );

    return NextResponse.json({ suggestion }, { status: 201 });
  } catch (error) {
    console.error("Failed to create suggestion:", error);
    return NextResponse.json(
      { error: "Failed to create suggestion" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await params;

    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    // Verify share exists
    const shareItem = await lgClient.store.getItem(
      ["shared_artifacts", token],
      "share"
    );

    if (!shareItem || !shareItem.value) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Search for all suggestions in this share's namespace
    const result = await lgClient.store.searchItems(
      ["shared_artifacts", token, "suggestions"],
      { limit: 100 }
    );

    const suggestions: Suggestion[] = result.items.map(
      (item) => item.value as Suggestion
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Failed to fetch suggestions:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions" },
      { status: 500 }
    );
  }
}

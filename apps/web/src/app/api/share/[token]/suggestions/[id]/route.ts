import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "@/lib/supabase/verify_user_server";
import {
  ShareRecord,
  Suggestion,
  SuggestionStatus,
} from "@opencanvas/shared/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token, id } = await params;

    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    // Verify share exists and user is owner
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
    if (shareRecord.ownerId !== authRes.user.id) {
      return NextResponse.json(
        { error: "Only the artifact owner can review suggestions" },
        { status: 403 }
      );
    }

    // Get the suggestion
    const suggestionItem = await lgClient.store.getItem(
      ["shared_artifacts", token, "suggestions"],
      id
    );

    if (!suggestionItem || !suggestionItem.value) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    const { status } = (await req.json()) as { status: SuggestionStatus };

    if (status !== "accepted" && status !== "rejected") {
      return NextResponse.json(
        { error: "Invalid status. Must be accepted or rejected" },
        { status: 400 }
      );
    }

    const suggestion = suggestionItem.value as Suggestion;
    const updatedSuggestion: Suggestion = {
      ...suggestion,
      status,
    };

    await lgClient.store.putItem(
      ["shared_artifacts", token, "suggestions"],
      id,
      updatedSuggestion as unknown as Record<string, unknown>
    );

    return NextResponse.json({ suggestion: updatedSuggestion });
  } catch (error) {
    console.error("Failed to update suggestion:", error);
    return NextResponse.json(
      { error: "Failed to update suggestion" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "@/lib/supabase/verify_user_server";
import { ShareRecord, ArtifactV3 } from "@opencanvas/shared/types";

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

    // Get the share record
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

    if (shareRecord.mode !== "copy") {
      return NextResponse.json(
        { error: "This share link does not allow copying" },
        { status: 403 }
      );
    }

    // Create a new thread for the user
    const newThread = await lgClient.threads.create({
      metadata: {
        supabase_user_id: authRes.user.id,
      },
    });

    // Create artifact with the shared content as version 1
    const newArtifact: ArtifactV3 = {
      currentIndex: 1,
      contents: [
        {
          ...shareRecord.artifact,
          index: 1,
        },
      ],
    };

    // Set the artifact in the new thread's state
    await lgClient.threads.updateState(newThread.thread_id, {
      values: { artifact: newArtifact },
    });

    return NextResponse.json({
      threadId: newThread.thread_id,
      success: true,
    });
  } catch (error) {
    console.error("Failed to copy artifact:", error);
    return NextResponse.json(
      { error: "Failed to copy artifact to workspace" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "@/lib/supabase/verify_user_server";
import { ShareRecord, ShareMode, ArtifactV3 } from "@opencanvas/shared/types";

export async function POST(req: NextRequest) {
  try {
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId, artifactVersionIndex, mode } = (await req.json()) as {
      threadId: string;
      artifactVersionIndex: number;
      mode: ShareMode;
    };

    if (!threadId || artifactVersionIndex == null || !mode) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: threadId, artifactVersionIndex, mode",
        },
        { status: 400 }
      );
    }

    if (!["view", "copy", "suggest"].includes(mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Must be view, copy, or suggest" },
        { status: 400 }
      );
    }

    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    // Load the thread to verify ownership and get artifact
    const thread = await lgClient.threads.get(threadId);
    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const threadUserId = (thread.metadata as Record<string, string>)
      ?.supabase_user_id;
    if (threadUserId !== authRes.user.id) {
      return NextResponse.json(
        { error: "You do not own this thread" },
        { status: 403 }
      );
    }

    // Extract the artifact from thread state
    const threadState = await lgClient.threads.getState(threadId);
    const artifact = (threadState.values as Record<string, unknown>)
      ?.artifact as ArtifactV3 | undefined;

    if (!artifact || !artifact.contents) {
      return NextResponse.json(
        { error: "No artifact found in this thread" },
        { status: 404 }
      );
    }

    const artifactVersion = artifact.contents.find(
      (c) => c.index === artifactVersionIndex
    );
    if (!artifactVersion) {
      return NextResponse.json(
        { error: `Artifact version ${artifactVersionIndex} not found` },
        { status: 404 }
      );
    }

    // Create share record
    const shareToken = uuidv4();
    const shareRecord: ShareRecord = {
      shareToken,
      createdAt: new Date().toISOString(),
      ownerId: authRes.user.id,
      sourceThreadId: threadId,
      artifactVersionIndex,
      artifact: artifactVersion,
      mode,
    };

    // Store in LangGraph Store
    await lgClient.store.putItem(
      ["shared_artifacts", shareToken],
      "share",
      shareRecord as unknown as Record<string, unknown>
    );

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
    const shareUrl = `${baseUrl}/share/${shareToken}`;

    return NextResponse.json({ shareToken, shareUrl }, { status: 201 });
  } catch (error) {
    console.error("Failed to create share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "@/lib/supabase/verify_user_server";
import { ShareRecord } from "@opencanvas/shared/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    const item = await lgClient.store.getItem(
      ["shared_artifacts", token],
      "share"
    );

    if (!item || !item.value) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    const shareRecord = item.value as ShareRecord;

    // View mode: no auth required
    if (shareRecord.mode === "view") {
      return NextResponse.json({
        artifact: shareRecord.artifact,
        mode: shareRecord.mode,
        createdAt: shareRecord.createdAt,
        artifactVersionIndex: shareRecord.artifactVersionIndex,
      });
    }

    // Copy and suggest modes: auth required
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json(
        {
          error: "Authentication required",
          mode: shareRecord.mode,
          artifactType: shareRecord.artifact.type,
          artifactTitle: shareRecord.artifact.title,
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      artifact: shareRecord.artifact,
      mode: shareRecord.mode,
      createdAt: shareRecord.createdAt,
      artifactVersionIndex: shareRecord.artifactVersionIndex,
      isOwner: shareRecord.ownerId === authRes.user.id,
    });
  } catch (error) {
    console.error("Failed to fetch share:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared artifact" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const item = await lgClient.store.getItem(
      ["shared_artifacts", token],
      "share"
    );

    if (!item || !item.value) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    const shareRecord = item.value as ShareRecord;
    if (shareRecord.ownerId !== authRes.user.id) {
      return NextResponse.json(
        { error: "You do not own this share link" },
        { status: 403 }
      );
    }

    await lgClient.store.deleteItem(["shared_artifacts", token], "share");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete share:", error);
    return NextResponse.json(
      { error: "Failed to delete share link" },
      { status: 500 }
    );
  }
}

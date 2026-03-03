import { NextRequest, NextResponse } from "next/server";
import { Client } from "@langchain/langgraph-sdk";
import { LANGGRAPH_API_URL } from "@/constants";
import { verifyUserAuthenticated } from "../../../../lib/supabase/verify_user_server";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    const authRes = await verifyUserAuthenticated();
    if (!authRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = authRes.user.id;
  } catch (e) {
    console.error("Failed to fetch user", e);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { query } = await req.json();

  const lgClient = new Client({
    apiKey: process.env.LANGCHAIN_API_KEY,
    apiUrl: LANGGRAPH_API_URL,
  });

  try {
    const PAGE_SIZE = 100;
    let allThreads: any[] = [];
    let offset = 0;

    while (true) {
      const batch = await lgClient.threads.search({
        metadata: { supabase_user_id: userId },
        limit: PAGE_SIZE,
        offset,
      });
      allThreads = allThreads.concat(batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const nonEmptyThreads = allThreads.filter(
      (thread) => thread.values && Object.keys(thread.values).length > 0
    );

    if (!query || query.trim() === "") {
      return NextResponse.json({ threads: nonEmptyThreads });
    }

    const lowerQuery = query.toLowerCase();
    const filtered = nonEmptyThreads.filter((thread) => {
      const title = (thread.metadata?.thread_title as string) ?? "";
      const firstMessage =
        (thread.values as Record<string, any>)?.messages?.[0]?.content ?? "";
      return (
        title.toLowerCase().includes(lowerQuery) ||
        (typeof firstMessage === "string" &&
          firstMessage.toLowerCase().includes(lowerQuery))
      );
    });

    return NextResponse.json({ threads: filtered });
  } catch (e) {
    console.error("Failed to search threads", e);
    return new NextResponse(
      JSON.stringify({ error: "Failed to search threads." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

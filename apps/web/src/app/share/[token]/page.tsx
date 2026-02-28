import { Client } from "@langchain/langgraph-sdk";
import { ShareRecord } from "@opencanvas/shared/types";
import { SharePageClient } from "./SharePageClient";

const LANGGRAPH_API_URL =
  process.env.LANGGRAPH_API_URL ?? "http://localhost:54367";

async function getShareRecord(token: string): Promise<ShareRecord | null> {
  try {
    const lgClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: LANGGRAPH_API_URL,
    });

    const item = await lgClient.store.getItem(
      ["shared_artifacts", token],
      "share"
    );

    if (!item || !item.value) return null;
    return item.value as ShareRecord;
  } catch {
    return null;
  }
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shareRecord = await getShareRecord(token);

  if (!shareRecord) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Not Found
          </h1>
          <p className="text-gray-500">
            This shared artifact no longer exists or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  return <SharePageClient shareRecord={shareRecord} />;
}

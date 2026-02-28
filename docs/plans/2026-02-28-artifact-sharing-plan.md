# Artifact Sharing ("Save Me From Brenda") Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add shareable artifact links with three modes: view-only (no auth), copy/fork (auth required), and suggest changes (auth required). Links are version-pinned snapshots stored in LangGraph Store.

**Architecture:** Token-based share links. When sharing, snapshot the selected artifact version into LangGraph Store with a UUID token. A new public Next.js route `/share/[token]` renders the artifact based on mode. Suggestions are stored as separate LangGraph Store entries keyed by suggestion UUID.

**Tech Stack:** Next.js 14 (App Router), LangGraph SDK (`@langchain/langgraph-sdk`), Supabase auth, CodeMirror v6, BlockNote, shadcn/ui (Dialog, Select, RadioGroup, Button), Lucide icons, uuid.

**Design doc:** `docs/plans/2026-02-28-artifact-sharing-design.md`

---

## Task 1: Add Share Types to Shared Package

**Files:**
- Modify: `packages/shared/src/types.ts` (append after line 229)

**Step 1: Add the ShareRecord and Suggestion types**

Add these types at the end of `packages/shared/src/types.ts`, before the closing of the file:

```typescript
export type ShareMode = "view" | "copy" | "suggest";

export interface ShareRecord {
  shareToken: string;
  createdAt: string;
  ownerId: string;
  sourceThreadId: string;
  artifactVersionIndex: number;
  artifact: ArtifactCodeV3 | ArtifactMarkdownV3;
  mode: ShareMode;
}

export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type SuggestionType = "edit" | "comment";

export interface Suggestion {
  id: string;
  authorId: string;
  createdAt: string;
  status: SuggestionStatus;
  type: SuggestionType;
  startOffset: number;
  endOffset: number;
  originalText: string;
  proposedText: string;
  comment?: string;
}
```

**Step 2: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build --filter=@opencanvas/shared`
Expected: Build succeeds with no type errors.

**Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add ShareRecord and Suggestion types for artifact sharing"
```

---

## Task 2: Update Middleware to Allow Share Routes

**Files:**
- Modify: `apps/web/src/middleware.ts`

**Step 1: Update the middleware to skip redirects for share and auth routes**

Replace the entire middleware function body. Currently it redirects all non-`/` paths to `/`. Change it to also allow `/share/` and `/auth/` and `/api/` paths:

```typescript
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow root, share pages, auth pages, and API routes
  if (
    pathname === "/" ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Step 2: Verify the dev server still works**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn dev`
Expected: App loads at `http://localhost:3000` without issues. Navigating to `/share/test` should NOT redirect to `/` (it will 404, which is correct — the page doesn't exist yet).

**Step 3: Commit**

```bash
git add apps/web/src/middleware.ts
git commit -m "feat: update middleware to allow /share/ routes"
```

---

## Task 3: Create Share API — POST /api/share/create

**Files:**
- Create: `apps/web/src/app/api/share/create/route.ts`

**Step 1: Write the create share endpoint**

This endpoint:
1. Verifies the user is authenticated
2. Loads the thread to verify ownership and get the artifact
3. Snapshots the requested version
4. Stores a ShareRecord in LangGraph Store
5. Returns the share URL

```typescript
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
        { error: "Missing required fields: threadId, artifactVersionIndex, mode" },
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
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
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
      shareRecord
    );

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
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
```

**Step 2: Install uuid if not already present**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn add uuid && yarn add -D @types/uuid`
Check first: `grep '"uuid"' /Users/yoda/Documents/personal/open-canvas/apps/web/package.json`

**Step 3: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/web/src/app/api/share/create/route.ts apps/web/package.json yarn.lock
git commit -m "feat: add POST /api/share/create endpoint"
```

---

## Task 4: Create Share API — GET /api/share/[token]

**Files:**
- Create: `apps/web/src/app/api/share/[token]/route.ts`

**Step 1: Write the fetch share endpoint**

This endpoint:
1. Looks up the ShareRecord by token
2. For `view` mode: returns artifact without auth
3. For `copy`/`suggest` modes: checks auth, returns 401 if unauthenticated
4. Returns the artifact and mode metadata

```typescript
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
          // Still return artifact type info for the login prompt UI
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
```

**Step 2: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/share/\[token\]/route.ts
git commit -m "feat: add GET/DELETE /api/share/[token] endpoint"
```

---

## Task 5: Create Suggestions API — /api/share/[token]/suggestions

**Files:**
- Create: `apps/web/src/app/api/share/[token]/suggestions/route.ts`

**Step 1: Write the suggestions endpoints**

POST: Add a new suggestion (auth required, non-owner only).
GET: List suggestions (auth required, owner or contributor can view their own).

```typescript
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
    const {
      type,
      startOffset,
      endOffset,
      originalText,
      proposedText,
      comment,
    } = body as {
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
      suggestion
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
    const items = await lgClient.store.searchItems(
      ["shared_artifacts", token, "suggestions"],
      { limit: 100 }
    );

    const suggestions: Suggestion[] = items.map(
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
```

**Step 2: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/share/\[token\]/suggestions/route.ts
git commit -m "feat: add POST/GET /api/share/[token]/suggestions endpoints"
```

---

## Task 6: Create Suggestion Review API — PATCH /api/share/[token]/suggestions/[id]

**Files:**
- Create: `apps/web/src/app/api/share/[token]/suggestions/[id]/route.ts`

**Step 1: Write the accept/reject suggestion endpoint**

Owner-only. Updates suggestion status to "accepted" or "rejected".

```typescript
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
      updatedSuggestion
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
```

**Step 2: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/share/\[token\]/suggestions/\[id\]/route.ts
git commit -m "feat: add PATCH /api/share/[token]/suggestions/[id] endpoint"
```

---

## Task 7: Create the Public Share Page

**Files:**
- Create: `apps/web/src/app/share/[token]/page.tsx`

**Step 1: Write the share page**

This is a server component that fetches the share record and renders a clean read-only page. It uses CodeMirror for code and a simple markdown renderer for text (avoiding BlockNote's heavy GraphContext dependency).

```tsx
import { Client } from "@langchain/langgraph-sdk";
import { ShareRecord, ArtifactCodeV3, ArtifactMarkdownV3 } from "@opencanvas/shared/types";
import { SharePageClient } from "./SharePageClient";

const LANGGRAPH_API_URL = process.env.LANGGRAPH_API_URL ?? "http://localhost:54367";

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

  return <SharePageClient shareRecord={shareRecord} token={token} />;
}
```

**Step 2: Create the client component**

Create `apps/web/src/app/share/[token]/SharePageClient.tsx`:

```tsx
"use client";

import { ShareRecord, ArtifactCodeV3, ArtifactMarkdownV3 } from "@opencanvas/shared/types";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { html } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

const getLanguageExtension = (language: string) => {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true, typescript: false });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "php":
      return php();
    case "python":
      return python();
    case "html":
      return html();
    case "sql":
      return sql();
    case "json":
      return json();
    case "rust":
      return rust();
    case "xml":
      return xml();
    default:
      return [];
  }
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          Copy to Clipboard
        </>
      )}
    </button>
  );
}

function CodeView({ artifact }: { artifact: ArtifactCodeV3 }) {
  const extensions = [getLanguageExtension(artifact.language)];

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200 rounded-t-lg">
        <span className="text-sm font-medium text-gray-700 capitalize">
          {artifact.language}
        </span>
        <span className="text-xs text-gray-500">
          v{artifact.index}
        </span>
      </div>
      <CodeMirror
        value={artifact.code}
        extensions={extensions}
        editable={false}
        className="border border-t-0 border-gray-200 rounded-b-lg overflow-hidden"
        height="auto"
        maxHeight="70vh"
      />
    </div>
  );
}

function TextView({ artifact }: { artifact: ArtifactMarkdownV3 }) {
  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
        <span className="text-sm font-medium text-gray-700">Markdown</span>
        <span className="text-xs text-gray-500">
          v{artifact.index}
        </span>
      </div>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown>{artifact.fullMarkdown}</ReactMarkdown>
      </div>
    </div>
  );
}

export function SharePageClient({
  shareRecord,
  token,
}: {
  shareRecord: ShareRecord;
  token: string;
}) {
  const { artifact, mode } = shareRecord;
  const isCode = artifact.type === "code";
  const content = isCode
    ? (artifact as ArtifactCodeV3).code
    : (artifact as ArtifactMarkdownV3).fullMarkdown;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {artifact.title}
            </h1>
            <p className="text-sm text-gray-500">
              Shared via Open Canvas
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 capitalize">
              {mode} mode
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {isCode ? (
          <CodeView artifact={artifact as ArtifactCodeV3} />
        ) : (
          <TextView artifact={artifact as ArtifactMarkdownV3} />
        )}

        <div className="mt-4 flex items-center justify-between">
          <CopyButton text={content} />

          {mode === "view" && (
            <a
              href="/"
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              Open in Open Canvas
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
```

**Step 3: Install react-markdown if not present**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn add react-markdown`
Check first: `grep '"react-markdown"' /Users/yoda/Documents/personal/open-canvas/apps/web/package.json`

**Step 4: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/app/share/
git commit -m "feat: add public share page for viewing shared artifacts"
```

---

## Task 8: Create the Share Dialog Component

**Files:**
- Create: `apps/web/src/components/artifacts/ShareDialog.tsx`
- Modify: `apps/web/src/components/artifacts/header/index.tsx`

**Step 1: Create the ShareDialog component**

This component renders a modal with version picker, mode selector, and link creation.

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Share2, Copy, Check, Loader2 } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/assistant-ui/tooltip-icon-button";
import { ArtifactV3, ShareMode } from "@opencanvas/shared/types";
import { useToast } from "@/hooks/use-toast";

interface ShareDialogProps {
  artifact: ArtifactV3;
  threadId: string | null;
}

export function ShareDialog({ artifact, threadId }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(
    artifact.currentIndex.toString()
  );
  const [selectedMode, setSelectedMode] = useState<ShareMode>("view");
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCreateLink = async () => {
    if (!threadId) {
      toast({
        title: "Error",
        description: "No thread selected",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setShareUrl(null);

    try {
      const response = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          artifactVersionIndex: parseInt(selectedVersion),
          mode: selectedMode,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create share link");
      }

      const data = await response.json();
      setShareUrl(data.shareUrl);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create share link",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setShareUrl(null);
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <TooltipIconButton
          tooltip="Share Artifact"
          variant="ghost"
          className="transition-colors w-fit h-fit p-2"
          delayDuration={400}
        >
          <Share2 className="w-[26px] h-[26px] text-gray-600" />
        </TooltipIconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Artifact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Version Picker */}
          <div className="space-y-2">
            <Label>Version</Label>
            <Select
              value={selectedVersion}
              onValueChange={setSelectedVersion}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {artifact.contents.map((content) => (
                  <SelectItem
                    key={content.index}
                    value={content.index.toString()}
                  >
                    v{content.index} — {content.title}
                    {content.index === artifact.currentIndex
                      ? " (current)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mode Selector */}
          <div className="space-y-2">
            <Label>Sharing mode</Label>
            <RadioGroup
              value={selectedMode}
              onValueChange={(v) => setSelectedMode(v as ShareMode)}
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="view" id="mode-view" />
                <Label htmlFor="mode-view" className="font-normal cursor-pointer">
                  <span className="font-medium">View only</span>
                  <span className="text-gray-500 block text-sm">
                    Anyone with the link can view. No login required.
                  </span>
                </Label>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="copy" id="mode-copy" />
                <Label htmlFor="mode-copy" className="font-normal cursor-pointer">
                  <span className="font-medium">Copy</span>
                  <span className="text-gray-500 block text-sm">
                    Recipients get their own copy. Login required.
                  </span>
                </Label>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="suggest" id="mode-suggest" />
                <Label htmlFor="mode-suggest" className="font-normal cursor-pointer">
                  <span className="font-medium">Suggest changes</span>
                  <span className="text-gray-500 block text-sm">
                    Recipients can propose inline edits. Login required.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Create / Result */}
          {shareUrl ? (
            <div className="space-y-2">
              <Label>Share link</Label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyUrl}
                >
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={handleCreateLink}
              disabled={isCreating}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Link"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Add ShareDialog to ArtifactHeader**

In `apps/web/src/components/artifacts/header/index.tsx`, add the Share button next to the ReflectionsDialog.

Add import at top:
```typescript
import { ShareDialog } from "../ShareDialog";
import { ArtifactV3 } from "@opencanvas/shared/types";
```

Update props interface to include:
```typescript
artifact: ArtifactV3 | undefined;
threadId: string | null;
```

Add `<ShareDialog>` in the JSX, right before `<ReflectionsDialog>`:
```tsx
{props.artifact && props.threadId && (
  <ShareDialog
    artifact={props.artifact}
    threadId={props.threadId}
  />
)}
```

**Step 3: Pass artifact and threadId from parent**

Find where `ArtifactHeader` is rendered (in `apps/web/src/components/artifacts/ArtifactRenderer.tsx`) and pass the `artifact` and `threadId` props down.

**Step 4: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/components/artifacts/ShareDialog.tsx apps/web/src/components/artifacts/header/index.tsx
git commit -m "feat: add ShareDialog component with version picker and mode selector"
```

---

## Task 9: Create Copy-to-Workspace API

**Files:**
- Create: `apps/web/src/app/api/share/[token]/copy/route.ts`

**Step 1: Write the copy endpoint**

This creates a new thread for the authenticated user and clones the shared artifact into it.

```typescript
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
```

**Step 2: Verify the build**

Run: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/share/\[token\]/copy/route.ts
git commit -m "feat: add POST /api/share/[token]/copy endpoint for forking artifacts"
```

---

## Task 10: Verify UI Components Exist (RadioGroup, Select, Label)

**Files:**
- Check: `apps/web/src/components/ui/radio-group.tsx`
- Check: `apps/web/src/components/ui/select.tsx`
- Check: `apps/web/src/components/ui/label.tsx`

**Step 1: Check which shadcn components are missing**

Run: `ls apps/web/src/components/ui/radio-group.tsx apps/web/src/components/ui/select.tsx apps/web/src/components/ui/label.tsx 2>&1`

**Step 2: Install any missing shadcn components**

For each missing component, run:
```bash
cd /Users/yoda/Documents/personal/open-canvas/apps/web
npx shadcn@latest add radio-group  # if missing
npx shadcn@latest add select       # if missing
npx shadcn@latest add label        # if missing
```

**Step 3: Commit if any were added**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: add missing shadcn/ui components for share dialog"
```

---

## Task 11: Integration Test — Manual End-to-End

**Step 1: Start both servers**

Terminal 1: `cd /Users/yoda/Documents/personal/open-canvas/apps/agents && yarn dev`
Terminal 2: `cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn dev`

**Step 2: Test view-only share flow**

1. Log in at `http://localhost:3000`
2. Create or open a thread with an artifact (code or text)
3. Click the Share icon in the artifact header
4. Select version 1, mode "View only"
5. Click "Create Link"
6. Copy the generated URL
7. Open an incognito/private window (not logged in)
8. Paste the URL
9. Verify: artifact renders read-only with syntax highlighting, no login wall

**Step 3: Test copy share flow**

1. In the logged-in window, create a "Copy" link for the same artifact
2. Open the link in incognito
3. Verify: see 401 / login prompt since copy requires auth
4. Log in with a different account
5. Click "Copy to My Workspace"
6. Verify: redirected to Canvas with a clone of the artifact

**Step 4: Test share link revocation**

1. In the logged-in window, note the share token from a URL
2. Call `DELETE /api/share/{token}` via browser console or curl
3. Verify: the share link now returns 404

---

## Task 12: Final Build and Lint

**Step 1: Full build**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: All packages build successfully.

**Step 2: Lint**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn lint`
Expected: No errors (warnings are acceptable).

**Step 3: Format**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn format`

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: lint and format artifact sharing feature"
```

---

## Summary of All Files

### New Files (10)
| File | Purpose |
|------|---------|
| `apps/web/src/app/api/share/create/route.ts` | POST create share link |
| `apps/web/src/app/api/share/[token]/route.ts` | GET/DELETE share record |
| `apps/web/src/app/api/share/[token]/copy/route.ts` | POST copy artifact |
| `apps/web/src/app/api/share/[token]/suggestions/route.ts` | POST/GET suggestions |
| `apps/web/src/app/api/share/[token]/suggestions/[id]/route.ts` | PATCH accept/reject |
| `apps/web/src/app/share/[token]/page.tsx` | Server component share page |
| `apps/web/src/app/share/[token]/SharePageClient.tsx` | Client component share renderer |
| `apps/web/src/components/artifacts/ShareDialog.tsx` | Share modal with version/mode picker |

### Modified Files (2)
| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Add ShareRecord, Suggestion types |
| `apps/web/src/middleware.ts` | Allow `/share/` routes |
| `apps/web/src/components/artifacts/header/index.tsx` | Add Share button |

### Dependencies to Add
| Package | Where | Why |
|---------|-------|-----|
| `uuid` + `@types/uuid` | `apps/web` | Generate share tokens |
| `react-markdown` | `apps/web` | Render markdown on share page |

# Thread Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side thread search by title with a search input in the thread history sidebar.

**Architecture:** New Next.js API route (`/api/threads/search`) fetches all user threads from LangGraph API with pagination, filters by case-insensitive substring match on title, returns matches. Frontend adds a debounced search input to the existing thread history sidebar that calls this endpoint and renders results via the existing `ThreadsList` component.

**Tech Stack:** Next.js API routes, `@langchain/langgraph-sdk` Client, `lodash/debounce`, existing `Input` + `lucide-react` components.

**Design doc:** `docs/plans/2026-03-03-thread-search-design.md`

---

### Task 1: Create the search API route

**Files:**
- Create: `apps/web/src/app/api/threads/search/route.ts`

**Context:** Follow the exact pattern of `apps/web/src/app/api/store/get/route.ts`. The route authenticates the user, gets their `user.id` (which is stored as `supabase_user_id` in thread metadata), fetches all threads from LangGraph with pagination, filters by query, and returns matches.

**Step 1: Create the route file**

```typescript
// apps/web/src/app/api/threads/search/route.ts
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
    // Paginate through all user threads
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

    // Filter out empty threads (same logic as getUserThreads in ThreadProvider.tsx)
    const nonEmptyThreads = allThreads.filter(
      (thread) => thread.values && Object.keys(thread.values).length > 0
    );

    // If no query, return all non-empty threads
    if (!query || query.trim() === "") {
      return NextResponse.json({ threads: nonEmptyThreads });
    }

    // Case-insensitive substring search on title or first message
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
```

**Step 2: Verify the route compiles**

Run: `cd /Users/yoda/Documents/personal/open-canvas && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -20`

Expected: No errors related to `apps/web/src/app/api/threads/search/route.ts`.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/threads/search/route.ts
git commit -m "feat: add server-side thread search API route

Fetches all user threads from LangGraph with pagination and filters
by case-insensitive substring match on title or first message."
```

---

### Task 2: Add search input and logic to thread history sidebar

**Files:**
- Modify: `apps/web/src/components/chat-interface/thread-history.tsx`

**Context:** Add a search input below the "Chat History" title. Use `lodash/debounce` (300ms) following the exact same pattern as `apps/web/src/components/assistant-select/icon-select.tsx:88-100`. When the user types, call `POST /api/threads/search` with the query. Show search results using the existing `ThreadsList` component or show "No threads found".

**Step 1: Add imports**

Add these imports at the top of the file (alongside existing imports):

```typescript
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { useMemo, useCallback } from "react"; // add useMemo, useCallback to existing import
import debounce from "lodash/debounce";
import { Thread } from "@langchain/langgraph-sdk"; // already imported
```

The existing `import { useEffect, useState } from "react";` line becomes:
```typescript
import { useEffect, useState, useMemo } from "react";
```

**Step 2: Add search state and handler inside `ThreadHistoryComponent`**

Inside the component, after the existing `const [open, setOpen] = useState(false);` line, add:

```typescript
const [searchQuery, setSearchQuery] = useState("");
const [searchResults, setSearchResults] = useState<Thread[] | null>(null);
const [isSearching, setIsSearching] = useState(false);

const performSearch = async (query: string) => {
  if (!query.trim()) {
    setSearchResults(null);
    setIsSearching(false);
    return;
  }
  setIsSearching(true);
  try {
    const res = await fetch("/api/threads/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    setSearchResults(data.threads ?? []);
  } catch (e) {
    console.error("Search failed", e);
    setSearchResults([]);
  } finally {
    setIsSearching(false);
  }
};

const debouncedSearch = useMemo(
  () => debounce((value: string) => performSearch(value), 300),
  []
);

useEffect(() => {
  return () => {
    debouncedSearch.cancel();
  };
}, [debouncedSearch]);
```

**Step 3: Update `groupedThreads` to use search results when active**

Change the existing `groupedThreads` computation to use search results when available:

```typescript
const threadsToDisplay = searchResults !== null ? searchResults : userThreads;

const groupedThreads = groupThreads(
  threadsToDisplay,
  (thread) => {
    switchSelectedThread(thread);
    props.switchSelectedThreadCallback(thread);
    setOpen(false);
  },
  handleDeleteThread
);
```

**Step 4: Add search input to the JSX**

After the `<SheetTitle>` block and before the loading/empty/list conditional, add the search input:

```tsx
<div className="relative px-2 pt-2">
  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
  <Input
    placeholder="Search threads..."
    className="pl-8"
    onChange={(e) => {
      setSearchQuery(e.target.value);
      debouncedSearch(e.target.value);
    }}
    value={searchQuery}
  />
</div>
```

**Step 5: Update the rendering conditional**

Replace the existing conditional rendering block (the `{isUserThreadsLoading && !userThreads.length ? ... }` ternary) with one that also handles search states:

```tsx
{isSearching ? (
  <div className="flex flex-col gap-1 px-2 pt-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <LoadingThread key={`search-loading-${i}`} />
    ))}
  </div>
) : isUserThreadsLoading && !userThreads.length ? (
  <div className="flex flex-col gap-1 px-2 pt-3">
    {Array.from({ length: 25 }).map((_, i) => (
      <LoadingThread key={`loading-thread-${i}`} />
    ))}
  </div>
) : searchResults !== null && searchResults.length === 0 ? (
  <p className="px-3 pt-3 text-gray-500">No threads found.</p>
) : !threadsToDisplay.length ? (
  <p className="px-3 text-gray-500">No items found in history.</p>
) : (
  <ThreadsList groupedThreads={groupedThreads} />
)}
```

Note: `threadsToDisplay` must be accessible here — it's declared before this JSX in Step 3.

**Step 6: Verify it compiles**

Run: `cd /Users/yoda/Documents/personal/open-canvas && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -20`

Expected: No errors.

**Step 7: Commit**

```bash
git add apps/web/src/components/chat-interface/thread-history.tsx
git commit -m "feat: add search input to thread history sidebar

Debounced search input calls /api/threads/search endpoint.
Shows filtered results or 'No threads found' message."
```

---

### Task 3: Manual smoke test

**Step 1: Start the dev server**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn dev`

**Step 2: Verify the search input appears**

1. Open `http://localhost:3000`
2. Log in
3. Click the chat history icon (left sidebar)
4. Verify a search input with a magnifying glass icon appears below "Chat History"

**Step 3: Test search behavior**

1. Type a query that matches an existing thread title
2. Verify results appear after ~300ms
3. Clear the input — verify all threads reappear
4. Type a query that matches nothing — verify "No threads found" message
5. Verify clicking a search result switches to that thread
6. Verify deleting a search result thread works

**Step 4: Commit (if any fixes needed)**

Only if smoke test reveals issues that need fixing.

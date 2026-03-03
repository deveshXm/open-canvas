# Thread Search — Design Document

**Date:** 2026-03-03
**Status:** Approved

## Problem

Users with many conversations cannot find specific threads. The thread history sidebar lists threads chronologically with no search capability. Scrolling through hundreds of threads to find a specific conversation is painful.

## Solution

Add server-side thread search by title. A search input in the thread history sidebar sends queries to a new Next.js API route that fetches all user threads from the LangGraph API and filters by case-insensitive substring match on thread titles.

## Architecture

```
Search Input (sidebar) → POST /api/threads/search { query }
                              ↓
                    verifyUserAuthenticated()
                              ↓
                    LangGraph client.threads.search()
                    (paginated, fetch all user threads)
                              ↓
                    Filter by title.includes(query)
                              ↓
                    Return matching Thread[]
                              ↓
                    Render via existing ThreadsList
```

## Backend: New API Route

**File:** `apps/web/src/app/api/threads/search/route.ts`

**Pattern:** Identical to existing `/api/store/get/route.ts`:
- Auth via `verifyUserAuthenticated()`
- Client via `new Client({ apiKey, apiUrl: LANGGRAPH_API_URL })`
- POST method, JSON request body
- try/catch with 500 error response

**Logic:**
1. Authenticate user
2. Parse `{ query }` from request body
3. Paginate through all threads for user via `client.threads.search({ metadata: { supabase_user_id }, limit: 100, offset })` in a loop
4. Filter out empty threads (same as existing `getUserThreads`)
5. If query is non-empty, filter by case-insensitive substring match on `metadata.thread_title` or first message content
6. Return filtered array

**Search algorithm:** `String.toLowerCase().includes(query.toLowerCase())` — simple substring containment.

## Frontend: Search Input in Sidebar

**File:** `apps/web/src/components/chat-interface/thread-history.tsx`

**Changes:**
- Add search input below "Chat History" title using existing `Input` component from `@/components/ui/input`
- Add `Search` icon from `lucide-react`
- Local state: `searchQuery`, `searchResults`, `isSearching`
- Debounced search using `lodash/debounce` (300ms, same pattern as `icon-select.tsx`)
- When query is empty: show `userThreads` (existing behavior)
- When query has results: show `searchResults` via same `ThreadsList` component
- When searching: show loading skeletons
- When no results: show "No threads found" message

## Dependencies

No new dependencies. Uses:
- `@langchain/langgraph-sdk` (existing)
- `lodash/debounce` (existing)
- `lucide-react` (existing)
- `@/components/ui/input` (existing)

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `apps/web/src/app/api/threads/search/route.ts` | New | Search API endpoint |
| `apps/web/src/components/chat-interface/thread-history.tsx` | Modified | Add search input + search logic |

## Decisions

- **Server-side filtering** over client-side: user explicitly requested backend search
- **Substring match** over fuzzy/semantic: simplest correct implementation for V0
- **No new Supabase tables**: LangGraph stores thread data in JSON files locally, not PostgreSQL
- **No new context/provider**: search state is local to the sidebar component
- **Debounce at 300ms**: matches existing `icon-select.tsx` pattern

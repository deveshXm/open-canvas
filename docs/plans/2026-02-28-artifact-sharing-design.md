# Artifact Sharing Design — "Save Me From Brenda"

## Overview

Add shareable links for Open Canvas artifacts with three modes: view-only (no auth), copy/fork (auth required), and suggest changes (auth required). Shared links are version-pinned snapshots — they show exactly the version the owner chose to share, regardless of later edits.

## Architecture: Token-Based Share Links

When a user shares an artifact, we snapshot that version into LangGraph Store with a UUID share token. The token encodes nothing — it's just a lookup key. The share record in the store contains the mode, the artifact snapshot, and metadata.

```
Share flow:
  User clicks Share → picks version + mode →
  POST /api/share/create → snapshots artifact into LangGraph Store →
  returns URL /share/{token} → copied to clipboard

View flow:
  Visitor opens /share/{token} →
  GET /api/share/{token} → reads ShareRecord from LangGraph Store →
  renders based on mode (view / copy / suggest)
```

## Data Model

### ShareRecord

Stored in LangGraph Store at namespace `["shared_artifacts", shareToken]`, key `"share"`.

```typescript
interface ShareRecord {
  shareToken: string;           // UUID v4
  createdAt: string;            // ISO timestamp
  ownerId: string;              // Supabase user ID of sharer

  sourceThreadId: string;       // Original thread
  artifactVersionIndex: number; // Index into ArtifactV3.contents[]
  artifact: ArtifactCodeV3 | ArtifactMarkdownV3;  // Snapshot of that version

  mode: "view" | "copy" | "suggest";
}
```

### Suggestion (Mode 3 only)

Stored at namespace `["shared_artifacts", shareToken, "suggestions"]`, key is the suggestion UUID.

```typescript
interface Suggestion {
  id: string;                   // UUID
  authorId: string;             // Supabase user ID of suggester
  createdAt: string;
  status: "pending" | "accepted" | "rejected";

  type: "edit" | "comment";

  // Character range in the shared artifact
  startOffset: number;
  endOffset: number;
  originalText: string;         // Text being replaced (edits)
  proposedText: string;         // Replacement text (edits)

  comment?: string;             // For comments, or note on edits
}
```

## API Endpoints

| Method  | Route                                   | Auth     | Purpose                       |
| ------- | --------------------------------------- | -------- | ----------------------------- |
| POST    | `/api/share/create`                     | Yes      | Create a share link           |
| GET     | `/api/share/[token]`                    | No\*     | Fetch shared artifact         |
| POST    | `/api/share/[token]/suggestions`        | Yes      | Add a suggestion (Mode 3)     |
| GET     | `/api/share/[token]/suggestions`        | Yes\*\*  | List suggestions              |
| PATCH   | `/api/share/[token]/suggestions/[id]`   | Yes\*\*  | Accept/reject a suggestion    |
| DELETE  | `/api/share/[token]`                    | Yes\*\*  | Revoke a share link           |

\* View mode needs no auth. Copy/suggest modes redirect to login if unauthenticated.
\*\* Owner-only operations.

### POST /api/share/create

**Request:**
```json
{
  "threadId": "thread-123",
  "artifactVersionIndex": 2,
  "mode": "view"
}
```

**Response:**
```json
{
  "shareToken": "a1b2c3d4-...",
  "shareUrl": "https://app.example.com/share/a1b2c3d4-..."
}
```

**Logic:**
1. Verify user owns the thread (match `supabase_user_id` in thread metadata)
2. Load thread state, extract `artifact.contents[versionIndex]`
3. Generate UUID v4 token
4. Store ShareRecord in LangGraph Store
5. Return URL

### GET /api/share/[token]

1. Look up ShareRecord from LangGraph Store
2. If mode is `view` → return artifact (no auth check)
3. If mode is `copy` or `suggest` → check auth, return 401 if unauthenticated
4. Return artifact + mode metadata

## Frontend

### Share Page: `/share/[token]`

New Next.js route outside the main Canvas layout. Clean, minimal page.

```
┌─────────────────────────────────────────────┐
│  Open Canvas          [Shared by Tomás]     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ Title: "useWebSocket.ts" ──────────┐   │
│  │  Language: TypeScript    v3 of 5     │   │
│  ├──────────────────────────────────────┤   │
│  │                                      │   │
│  │  // Code with syntax highlighting    │   │
│  │  // (CodeMirror, read-only)          │   │
│  │                                      │   │
│  │  export function useWebSocket<T>() { │   │
│  │    ...                               │   │
│  │  }                                   │   │
│  │                                      │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  [Copy to Clipboard]                        │
│                                             │
│  Mode-specific footer:                      │
│  View:    "Open in Open Canvas" CTA         │
│  Copy:    "Copy to My Workspace" button     │
│  Suggest: Inline suggestion UI              │
│                                             │
└─────────────────────────────────────────────┘
```

- Code artifacts: CodeMirror v6 read-only (reuse existing `CodeRenderer`)
- Text artifacts: BlockNote read-only (reuse existing `TextRenderer`)
- No chat panel, no action toolbars

### Share Dialog (in Canvas)

New button in artifact header (next to Reflections button). Opens a modal.

```
┌─── Share Artifact ────────────────────────┐
│                                           │
│  Version: [v3 ▾] of 5                    │
│                                           │
│  Sharing mode:                            │
│  ○ View only — anyone with the link       │
│  ○ Copy — recipients get their own copy   │
│  ○ Suggest — recipients can propose edits │
│                                           │
│  [Create Link]                            │
│                                           │
│  ── Active links ──                       │
│  🔗 View (v3) — created 2 days ago  [x]  │
│  🔗 Suggest (v3) — created 1 day ago [x] │
│                                           │
└───────────────────────────────────────────┘
```

### Suggestions UI (Mode 3)

**Reviewer experience** (on share page):
- Artifact renders with editable overlay
- Select text → floating toolbar: "Suggest Edit" / "Add Comment"
- Suggestions appear inline: green for additions, red/strikethrough for deletions
- Comments appear as margin annotations

**Owner experience** (in their Canvas):
- Notification badge on artifact: "3 suggestions"
- Review panel shows each suggestion inline with Accept / Reject buttons
- Accepted edits applied to a new version of the artifact (appended to `contents[]`)

## Auth & Access Control

### Middleware Update

Update `middleware.ts` to exclude `/share/[token]` from the redirect-to-root rule, so the share page can render as its own route.

### Access Rules

| Action              | Who                          |
| ------------------- | ---------------------------- |
| Create share link   | Artifact owner               |
| View shared artifact (view mode) | Anyone (no auth)   |
| Copy to workspace   | Authenticated users          |
| Submit suggestions  | Authenticated users          |
| Review suggestions  | Artifact owner               |
| Accept/reject       | Artifact owner               |
| Revoke share link   | Artifact owner               |

### Token Security

- UUID v4 (122 bits of entropy) — not guessable
- No enumeration endpoint
- Revocable by owner via DELETE

## End-to-End Flows

### Flow 1: View-Only (Marco views code)

```
Tomás → Share button → Dialog → version 3, "View only" → Create Link
     → POST /api/share/create → snapshot stored → URL copied
     → Pastes URL in Slack

Marco → clicks link → /share/abc123
     → No login required
     → Sees code with syntax highlighting, read-only
     → Can copy to clipboard
```

### Flow 2: Copy (Marco forks code)

```
Tomás → Share button → Dialog → version 3, "Copy" → Create Link

Marco → clicks link → /share/def456
     → Sees code preview + "Copy to My Workspace" button
     → Clicks button → prompted to log in
     → After login → POST /api/share/def456/copy
     → New thread created for Marco with cloned artifact
     → Redirected to Canvas with the artifact
```

### Flow 3: Suggest Changes (Lisa reviews chapter)

```
Tomás → Share button → Dialog → version 3, "Suggest" → Create Link

Lisa → clicks link → /share/ghi789
     → Logs in → sees Chapter 7 v3 with suggestion tools
     → Selects paragraph → "Suggest Edit" → types replacement → submits
     → POST /api/share/ghi789/suggestions

Tomás → opens Canvas → sees "3 suggestions" badge
     → Opens Review panel
     → Sees inline diffs on version 3
     → Accept / Reject each → accepted changes create version 6
```

### Flow 4: Meetup QR Code (50 viewers)

```
Tomás → creates View-Only link → generates QR code from URL
     → 50 people scan QR → all see clean read-only page
     → No auth wall, no signup prompt
```

## Error Handling & Edge Cases

| Scenario                              | Handling                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Invalid/deleted share token           | 404 page: "This shared artifact no longer exists"                          |
| Owner deletes original thread         | Share still works — artifact was snapshotted at share time                 |
| Suggestion on wrong version           | Not possible — suggestions reference the snapshot, not the live artifact   |
| Overlapping suggestion ranges         | Allow it. Accept in order. Conflict → notify owner to resolve manually    |
| View-only user tries to suggest       | UI doesn't show suggestion tools. API rejects with 403                    |
| Unauthenticated user on suggest link  | Show read-only preview + "Sign in to suggest changes" CTA                 |
| Owner accepts suggestion              | Creates new version appended to `artifact.contents[]`, increments index   |

## Files to Create/Modify

### New Files
- `apps/web/src/app/share/[token]/page.tsx` — Public share page
- `apps/web/src/app/api/share/create/route.ts` — Create share endpoint
- `apps/web/src/app/api/share/[token]/route.ts` — Fetch share endpoint
- `apps/web/src/app/api/share/[token]/suggestions/route.ts` — Suggestions CRUD
- `apps/web/src/components/artifacts/ShareDialog.tsx` — Share modal
- `apps/web/src/components/share/SharePageRenderer.tsx` — Share page layout
- `apps/web/src/components/share/SuggestionsOverlay.tsx` — Inline suggestion UI
- `apps/web/src/components/share/ReviewPanel.tsx` — Owner suggestion review
- `packages/shared/src/types.ts` — Add ShareRecord, Suggestion types

### Modified Files
- `apps/web/src/middleware.ts` — Exclude `/share/` from redirect
- `apps/web/src/components/artifacts/header/index.tsx` — Add Share button
- `apps/web/src/contexts/GraphContext.tsx` — Add suggestion notification logic

## Trade-offs & Decisions

| Decision                        | Rationale                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| LangGraph Store over Supabase   | No new infra, fits existing patterns, sufficient for key-value share records                   |
| Snapshot over pointer           | Ensures version pinning — shared link always shows exact version chosen, immune to later edits |
| Token-based over signed URLs    | Simpler, revocable, supports suggestion state storage                                          |
| Diff-based over CRDT            | Story describes async review (not real-time collab), diffs are far simpler                     |
| New route over iframe/embed     | Cleaner UX, proper SEO/social preview potential, full control over layout                      |

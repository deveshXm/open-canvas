# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Interview Assignment Context

This repo is being used for a product engineer interview challenge. Key constraints:
- Write a **PLAN.md** manually (no AI) documenting decisions, reasoning, and trade-offs
- Push all changes as **pull requests**, not directly to main
- Keep a clean commit history
- Two stories to implement: "Save Me From Brenda" (urgent) and "Studio Apartment Problem" (lower priority)
- Fix small bugs encountered along the way
- Only Anthropic API key is provided; only Claude models work. The Haiku model is broken — use the "(old)" label or fix it
- 3-hour time limit — prioritize and push whatever is ready

## Commands

### Install & Run
```bash
yarn install                  # Install all workspace dependencies (use --ignore-engines if node version issues)
cd apps/agents && yarn dev    # Start LangGraph agent server on port 54367
cd apps/web && yarn dev       # Start Next.js frontend on port 3000 (separate terminal)
```

### Build & Lint
```bash
yarn build                    # Build all packages (turbo)
yarn lint                     # Lint all packages
yarn lint:fix                 # Auto-fix lint issues
yarn format                   # Format all packages with prettier
yarn format:check             # Check formatting
```

### Testing
```bash
cd apps/web && yarn eval      # Run Vitest evaluations
```

## Architecture

**Monorepo** managed by Yarn Workspaces + Turbo with 4 packages:

| Package | Purpose |
|---------|---------|
| `apps/web` | Next.js 14 frontend (App Router, React 18) |
| `apps/agents` | LangGraph agent server (TypeScript, runs on port 54367) |
| `packages/shared` | Shared types, constants, model configs, prompts |
| `packages/evals` | Evaluation/testing utilities |

### Data Flow

1. User sends message → `GraphContext.streamMessage()` in frontend
2. Request proxied through `apps/web/src/app/api/[..._path]/route.ts` to LangGraph server (adds Supabase auth)
3. LangGraph routes to appropriate node via `generatePath` conditional edge
4. Response streamed back via **Web Worker** (`apps/web/src/workers/`)
5. Reflection agent auto-triggers after artifact changes, storing memories in LangGraph's namespaced store

### Agent Graphs (defined in `langgraph.json`)

- **agent** (`apps/agents/src/open-canvas/index.ts`) — Main graph: routing, artifact generation/editing, conversation, web search
- **reflection** (`apps/agents/src/reflection/index.ts`) — Memory/style rules extraction
- **thread_title** — Auto-generates thread titles
- **summarizer** — Summarizes conversation when token limit (~75k tokens / 300k chars) approached
- **web_search** — Exa-powered web search

### Agent Node Pattern

Each node in `apps/agents/src/open-canvas/nodes/` follows:
```typescript
export const nodeName = async (
  state: typeof OpenCanvasGraphAnnotation.State,
  config: LangGraphRunnableConfig
): Promise<OpenCanvasGraphReturnType>
```

Key nodes: `generatePath` (router), `generateArtifact`, `rewriteArtifact`, `updateArtifact`, `replyToGeneralInput`, `generateFollowup`, `reflect`, `customAction`

### Artifacts

Artifacts are versioned content (text or code) defined in `packages/shared/src/types.ts`:
```typescript
interface ArtifactV3 {
  currentIndex: number;
  contents: (ArtifactMarkdownV3 | ArtifactCodeV3)[];  // All versions kept
}
```

### Frontend State Management

Primary state via React Context (not Redux):
- `GraphContext` — Messages, artifacts, streaming, thread switching
- `AssistantContext` — Assistant/model selection
- `ThreadProvider` — Thread/conversation management
- `UserContext` — Supabase authentication

### Key UI Libraries
- **shadcn/ui** + Radix UI for components
- **CodeMirror v6** for code editing
- **BlockNote** for rich text/markdown editing
- **@assistant-ui/react** for chat interface
- **framer-motion** for animations

### API Routes (`apps/web/src/app/api/`)
- `[..._path]/` — Generic proxy to LangGraph (auth-gated)
- `store/get|put|delete` — Persistent store operations
- `runs/feedback|share` — User feedback and sharing
- `whisper/audio` — Audio transcription (Groq)
- `firecrawl/scrape` — Web scraping

## Environment

Two `.env` files required:
- **Root `.env`** — API keys (Anthropic, OpenAI, etc.), Supabase credentials, LangSmith config
- **`apps/web/.env`** — Feature flags (`NEXT_PUBLIC_*_ENABLED`), Supabase public keys, Ollama config

## Code Style

- Prettier: 80 width, 2-space indent, double quotes, trailing commas (es5), LF line endings
- ESLint extends `next/core-web-vitals` and `@typescript-eslint/recommended`
- Path alias: `@/*` → `./src/*` in both apps
- TypeScript strict mode enabled

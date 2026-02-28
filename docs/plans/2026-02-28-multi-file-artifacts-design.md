# Multi-File Artifacts Design

**Date**: 2026-02-28
**Story**: "The Studio Apartment Problem" (Story 2)
**Approach**: Extend existing types with optional `files` array (Approach A)

## Problem

When the AI generates multiple files, they're crammed into a single artifact with comment separators. No tabs, no per-file syntax highlighting, quick actions affect all files, and version navigation can crash when file counts change between versions.

## Design Decisions

1. **Data model**: Add optional `files: ArtifactFileEntry[]` to `ArtifactCodeV3` and `ArtifactMarkdownV3` — backward compatible
2. **Agent output**: Structured tool schema with `files` array — no comment separator parsing
3. **UI**: Horizontal tabs above the editor, VS Code-style
4. **Scope**: Full vertical slice (data model + agent + UI + version history). Quick action per-file and selection context deferred.

## Data Model

```typescript
interface ArtifactFileEntry {
  name: string;                          // e.g., "types.ts"
  content: string;                       // file content
  language?: ProgrammingLanguageOptions; // per-file language (code only)
}

// ArtifactCodeV3: add `files?: ArtifactFileEntry[]`
// ArtifactMarkdownV3: add `files?: ArtifactFileEntry[]`
```

**Rules**:
- `files` present + non-empty → multi-file (tabs)
- `files` absent/empty → single-file (current behavior)
- `code`/`fullMarkdown` still populated for backward compat
- Each version independently decides single vs multi

## Agent Tool Schema

```typescript
// generate_artifact tool schema additions
files?: [{
  name: string,      // filename with extension
  content: string,   // file content
  language?: string  // per-file language
}]
```

- When generating multiple files, agent uses `files` array
- Single-file uses existing `artifact` field
- Prompts updated to instruct structured multi-file output
- Quick action nodes receive only active file's content, return result for that file

## Frontend Architecture

```
ArtifactRenderer
├── ArtifactHeader (existing: title, version nav arrows)
├── FileTabBar (NEW) — only if files?.length > 1
│   └── Clickable tabs with filenames
├── ContentArea
│   ├── CodeRenderer — receives single file's code + language
│   └── TextRenderer — receives single file's markdown
└── ActionsToolbar — passes activeFileIndex context
```

**State**: `activeFileIndex` is local UI state (useState), not persisted.
- On version navigation: clamp to valid range or reset to 0
- On tab click: set activeFileIndex
- Single-file artifacts render identically to today

## Version History

Each version in `contents[]` is self-contained. Version 1 may have 1 file, version 3 may have 3 files. The arrows change `currentIndex` as they do today — file tab count adapts per version. Edge cases:
- Navigating to a version with fewer files: activeFileIndex clamped to last file
- Navigating to single-file version: tabs hidden entirely

## Story Requirements Checklist

- [x] Separate files as tabs, not one blob
- [x] Click filename to see only that file
- [x] Per-file syntax highlighting
- [x] Don't parse comment separators — use structured data
- [x] Version history works across changing file counts
- [x] No phantom tabs, empty panes, or glitches
- [x] Fix version navigation crashes (audit)
- [x] Quick actions apply to current file (vertical slice)
- [ ] Ask Open Canvas knows which file (deferred)
- [x] Markdown artifacts get tabs too
- [x] Fix broken stuff found along the way

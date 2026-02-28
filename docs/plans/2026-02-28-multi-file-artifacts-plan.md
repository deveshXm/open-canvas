# Multi-File Artifacts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable artifacts to contain multiple files with a tabbed UI, structured agent output, per-file syntax highlighting, and working version history.

**Architecture:** Extend existing `ArtifactCodeV3`/`ArtifactMarkdownV3` types with an optional `files` array. Modify agent tool schemas to output structured multi-file data. Add a `FileTabBar` component to the frontend. All changes are backward compatible — single-file artifacts render identically to today.

**Tech Stack:** TypeScript, Zod (schemas), React (frontend), CodeMirror v6 (code editor), BlockNote (markdown editor), LangGraph (agent), shadcn/ui (components)

**Design doc:** `docs/plans/2026-02-28-multi-file-artifacts-design.md`

---

### Task 1: Add ArtifactFileEntry type and extend artifact types

**Files:**
- Modify: `packages/shared/src/types.ts:106-124`

**Step 1: Add ArtifactFileEntry interface**

Add before line 106 (before `ArtifactMarkdownV3`):

```typescript
export interface ArtifactFileEntry {
  name: string;
  content: string;
  language?: ProgrammingLanguageOptions;
}
```

**Step 2: Add `files?` field to ArtifactMarkdownV3**

Change lines 106-111 to:

```typescript
export interface ArtifactMarkdownV3 {
  index: number;
  type: "text";
  title: string;
  fullMarkdown: string;
  files?: ArtifactFileEntry[];
}
```

**Step 3: Add `files?` field to ArtifactCodeV3**

Change lines 113-119 to:

```typescript
export interface ArtifactCodeV3 {
  index: number;
  type: "code";
  title: string;
  language: ProgrammingLanguageOptions;
  code: string;
  files?: ArtifactFileEntry[];
}
```

**Step 4: Add `activeFileIndex?` to GraphInput**

At `packages/shared/src/types.ts:225` (after `customQuickActionId`), add:

```typescript
activeFileIndex?: number;
```

**Step 5: Add ArtifactFileEntry to the barrel export**

Check `packages/shared/src/types.ts` exports and ensure `ArtifactFileEntry` is exported.

**Step 6: Add utility helpers to artifacts.ts**

Modify: `packages/shared/src/utils/artifacts.ts`

Add these helper functions at the end of the file:

```typescript
export const isMultiFileArtifact = (
  content: ArtifactCodeV3 | ArtifactMarkdownV3
): boolean => {
  return !!content.files && content.files.length > 0;
};

export const getFileCount = (
  content: ArtifactCodeV3 | ArtifactMarkdownV3
): number => {
  return content.files?.length ?? 1;
};

export const getActiveFile = (
  content: ArtifactCodeV3 | ArtifactMarkdownV3,
  activeFileIndex: number
): ArtifactFileEntry | undefined => {
  if (!content.files || content.files.length === 0) return undefined;
  const clampedIndex = Math.min(activeFileIndex, content.files.length - 1);
  return content.files[clampedIndex];
};
```

**Step 7: Build to verify types compile**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds with no type errors.

**Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/utils/artifacts.ts
git commit -m "feat: add ArtifactFileEntry type and multi-file support to artifact types"
```

---

### Task 2: Update agent tool schema for multi-file generation

**Files:**
- Modify: `apps/agents/src/open-canvas/nodes/generate-artifact/schemas.ts`
- Modify: `apps/agents/src/open-canvas/nodes/generate-artifact/utils.ts`
- Modify: `apps/agents/src/open-canvas/prompts.ts:13-30`

**Step 1: Add files array to ARTIFACT_TOOL_SCHEMA**

In `apps/agents/src/open-canvas/nodes/generate-artifact/schemas.ts`, add the `files` field to the zod schema. The full file should become:

```typescript
import { PROGRAMMING_LANGUAGES } from "@opencanvas/shared/constants";
import { z } from "zod";

const FILE_ENTRY_SCHEMA = z.object({
  name: z.string().describe("The filename with extension (e.g., 'types.ts', 'README.md')."),
  content: z.string().describe("The content of this file."),
  language: z
    .enum(
      PROGRAMMING_LANGUAGES.map((lang) => lang.language) as [
        string,
        ...string[],
      ]
    )
    .optional()
    .describe("The programming language of this file. Use for code files."),
});

export const ARTIFACT_TOOL_SCHEMA = z.object({
  type: z
    .enum(["code", "text"])
    .describe("The content type of the artifact generated."),
  language: z
    .enum(
      PROGRAMMING_LANGUAGES.map((lang) => lang.language) as [
        string,
        ...string[],
      ]
    )
    .optional()
    .describe(
      "The language/programming language of the artifact generated.\n" +
        "If generating code, it should be one of the options, or 'other'.\n" +
        "If not generating code, the language should ALWAYS be 'other'."
    ),
  isValidReact: z
    .boolean()
    .optional()
    .describe(
      "Whether or not the generated code is valid React code. Only populate this field if generating code."
    ),
  artifact: z.string().describe("The content of the artifact to generate. For single-file artifacts, this is the entire content. For multi-file artifacts, this can be a summary or the primary file content."),
  title: z
    .string()
    .describe(
      "A short title to give to the artifact. Should be less than 5 words."
    ),
  files: z
    .array(FILE_ENTRY_SCHEMA)
    .optional()
    .describe(
      "For multi-file artifacts: an array of files with names and content. " +
      "Use this when the user requests multiple separate files (e.g., components, types, styles). " +
      "Each file should have a descriptive filename with the correct extension. " +
      "Do NOT use this for single-file outputs — use the 'artifact' field instead."
    ),
});
```

**Step 2: Update createArtifactContent to handle files**

In `apps/agents/src/open-canvas/nodes/generate-artifact/utils.ts`, update `createArtifactContent`:

```typescript
import { NEW_ARTIFACT_PROMPT } from "../../prompts.js";
import {
  ArtifactCodeV3,
  ArtifactFileEntry,
  ArtifactMarkdownV3,
  ProgrammingLanguageOptions,
} from "@opencanvas/shared/types";
import { z } from "zod";
import { ARTIFACT_TOOL_SCHEMA } from "./schemas.js";

export const formatNewArtifactPrompt = (
  memoriesAsString: string,
  modelName: string
): string => {
  return NEW_ARTIFACT_PROMPT.replace("{reflections}", memoriesAsString).replace(
    "{disableChainOfThought}",
    modelName.includes("claude")
      ? "\n\nIMPORTANT: Do NOT preform chain of thought beforehand. Instead, go STRAIGHT to generating the tool response. This is VERY important."
      : ""
  );
};

export const createArtifactContent = (
  toolCall: z.infer<typeof ARTIFACT_TOOL_SCHEMA>
): ArtifactCodeV3 | ArtifactMarkdownV3 => {
  const artifactType = toolCall?.type;
  const files: ArtifactFileEntry[] | undefined = toolCall?.files?.map((f) => ({
    name: f.name,
    content: f.content,
    language: f.language as ProgrammingLanguageOptions | undefined,
  }));
  const hasFiles = files && files.length > 0;

  if (artifactType === "code") {
    return {
      index: 1,
      type: "code",
      title: toolCall?.title,
      code: hasFiles ? files[0].content : toolCall?.artifact,
      language: toolCall?.language as ProgrammingLanguageOptions,
      ...(hasFiles && { files }),
    };
  }

  return {
    index: 1,
    type: "text",
    title: toolCall?.title,
    fullMarkdown: hasFiles ? files[0].content : toolCall?.artifact,
    ...(hasFiles && { files }),
  };
};
```

**Step 3: Update NEW_ARTIFACT_PROMPT to instruct multi-file usage**

In `apps/agents/src/open-canvas/prompts.ts`, update the `NEW_ARTIFACT_PROMPT` (lines 13-30). Add the multi-file instruction to the rules-guidelines section:

Find the closing `</rules-guidelines>` in `NEW_ARTIFACT_PROMPT` and add before it:

```
- When the user's request involves multiple logically separate files (e.g., separate components, types, styles, tests), use the 'files' array in the tool call to output each file separately. Each file must have a descriptive filename with the correct extension (e.g., 'MetricCard.tsx', 'types.ts', 'styles.css'). Do NOT concatenate multiple files into a single 'artifact' string with comment separators.
- For single-file outputs, use the 'artifact' field as normal. Only use 'files' when there are genuinely multiple distinct files.
```

**Step 4: Build to verify**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/agents/src/open-canvas/nodes/generate-artifact/schemas.ts apps/agents/src/open-canvas/nodes/generate-artifact/utils.ts apps/agents/src/open-canvas/prompts.ts
git commit -m "feat: add multi-file support to agent tool schema and prompts"
```

---

### Task 3: Update frontend streaming utils for multi-file artifacts

**Files:**
- Modify: `apps/web/src/contexts/utils.ts:73-99` (createNewGeneratedArtifactFromTool)
- Modify: `apps/web/src/contexts/utils.ts:359-395` (handleGenerateArtifactToolCallChunk)

**Step 1: Update ArtifactToolResponse type**

In `packages/shared/src/types.ts`, update the `ArtifactToolResponse` interface (lines 52-57):

```typescript
export interface ArtifactToolResponse {
  artifact?: string;
  title?: string;
  language?: string;
  type?: string;
  files?: { name: string; content: string; language?: string }[];
}
```

**Step 2: Update createNewGeneratedArtifactFromTool**

In `apps/web/src/contexts/utils.ts`, update `createNewGeneratedArtifactFromTool` (lines 73-99) to pass `files` through:

```typescript
export const createNewGeneratedArtifactFromTool = (
  artifactTool: ArtifactToolResponse
): ArtifactMarkdownV3 | ArtifactCodeV3 | undefined => {
  if (!artifactTool.type) {
    console.error("Received new artifact without type");
    return;
  }

  const files: ArtifactFileEntry[] | undefined = artifactTool.files?.map(
    (f) => ({
      name: f.name,
      content: f.content,
      language: f.language as ProgrammingLanguageOptions | undefined,
    })
  );
  const hasFiles = files && files.length > 0;

  if (artifactTool.type === "text") {
    return {
      index: 1,
      type: "text",
      title: artifactTool.title || "",
      fullMarkdown: hasFiles
        ? files[0].content
        : artifactTool.artifact || "",
      ...(hasFiles && { files }),
    };
  } else {
    if (!artifactTool.language) {
      console.error("Received new code artifact without language");
    }
    return {
      index: 1,
      type: "code",
      title: artifactTool.title || "",
      code: hasFiles ? files[0].content : artifactTool.artifact || "",
      language: artifactTool.language as ProgrammingLanguageOptions,
      ...(hasFiles && { files }),
    };
  }
};
```

Add the import for `ArtifactFileEntry` at the top of the file:

```typescript
import {
  Artifact,
  ArtifactCodeV3,
  ArtifactFileEntry,
  ArtifactMarkdownV3,
  ArtifactToolResponse,
  ArtifactV3,
  ProgrammingLanguageOptions,
  RewriteArtifactMetaToolResponse,
} from "@opencanvas/shared/types";
```

**Step 3: Build to verify**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts apps/web/src/contexts/utils.ts
git commit -m "feat: update streaming utils to handle multi-file artifact tool responses"
```

---

### Task 4: Create FileTabBar component

**Files:**
- Create: `apps/web/src/components/artifacts/FileTabBar.tsx`

**Step 1: Create the FileTabBar component**

```typescript
import { cn } from "@/lib/utils";
import { ArtifactFileEntry } from "@opencanvas/shared/types";

interface FileTabBarProps {
  files: ArtifactFileEntry[];
  activeFileIndex: number;
  onTabClick: (index: number) => void;
}

export function FileTabBar({
  files,
  activeFileIndex,
  onTabClick,
}: FileTabBarProps) {
  return (
    <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
      {files.map((file, index) => (
        <button
          key={`${file.name}-${index}`}
          onClick={() => onTabClick(index)}
          className={cn(
            "px-3 py-1.5 text-sm font-mono whitespace-nowrap border-r border-gray-200 transition-colors",
            index === activeFileIndex
              ? "bg-white text-gray-900 border-b-2 border-b-blue-500"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          )}
        >
          {file.name}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/artifacts/FileTabBar.tsx
git commit -m "feat: add FileTabBar component for multi-file artifact navigation"
```

---

### Task 5: Integrate FileTabBar into ArtifactRenderer

**Files:**
- Modify: `apps/web/src/components/artifacts/ArtifactRenderer.tsx`

**Step 1: Add imports and state**

At the top of `ArtifactRenderer.tsx`, add:

```typescript
import { FileTabBar } from "./FileTabBar";
import { isMultiFileArtifact, getActiveFile } from "@opencanvas/shared/utils/artifacts";
```

Inside `ArtifactRendererComponent`, after line 65 (`const [isValidSelectionOrigin, ...`), add:

```typescript
const [activeFileIndex, setActiveFileIndex] = useState(0);
```

**Step 2: Add effect to clamp activeFileIndex on version change**

After the `activeFileIndex` state declaration, add:

```typescript
useEffect(() => {
  if (currentArtifactContent && isMultiFileArtifact(currentArtifactContent)) {
    const fileCount = currentArtifactContent.files!.length;
    if (activeFileIndex >= fileCount) {
      setActiveFileIndex(Math.max(0, fileCount - 1));
    }
  } else {
    setActiveFileIndex(0);
  }
}, [artifact?.currentIndex]);
```

Note: `currentArtifactContent` is derived on line 287-289. We need to move this derivation earlier, or add the effect after it. Looking at the code, the effect will use the `currentArtifactContent` computed at line 287. Since React effects run after render, this will work — the `currentArtifactContent` will be available during the effect.

Actually, we need to be careful. The `currentArtifactContent` is computed at line 287 but the `useEffect` needs to be before the early returns at lines 291-297. Let me restructure:

Move the `currentArtifactContent` computation before all the useEffects (e.g., right after the refs/state declarations around line 66), and use it in the effect.

**Step 3: Render FileTabBar between ArtifactHeader and content**

In the JSX return (around line 308-321), after `<ArtifactHeader ... />` and before the `<div ref={contentRef}>` block, add:

```typescript
{currentArtifactContent && isMultiFileArtifact(currentArtifactContent) && (
  <FileTabBar
    files={currentArtifactContent.files!}
    activeFileIndex={activeFileIndex}
    onTabClick={setActiveFileIndex}
  />
)}
```

**Step 4: Pass active file content to renderers**

The renderers currently pull content from GraphContext internally. We need to modify the approach so that when multi-file is active, the renderer sees only the active file's content.

For `CodeRenderer` (line 348-353): The `CodeRenderer` directly calls `getArtifactContent(artifact)` internally (line 82 of CodeRenderer.tsx). We need to either:
- Pass the active file content as a prop, OR
- Add a `activeFileIndex` context/prop

The simplest approach: pass `activeFileIndex` as a prop to both `CodeRenderer` and `TextRenderer`, and have them use it internally.

Update CodeRenderer props and usage:

```typescript
// In ArtifactRenderer.tsx, pass activeFileIndex
<CodeRenderer
  editorRef={editorRef}
  isHovering={isHoveringOverArtifact}
  activeFileIndex={activeFileIndex}
/>
```

```typescript
// Similarly for TextRenderer
<TextRenderer
  isInputVisible={isInputVisible}
  isEditing={props.isEditing}
  isHovering={isHoveringOverArtifact}
  activeFileIndex={activeFileIndex}
/>
```

**Step 5: Commit**

```bash
git add apps/web/src/components/artifacts/ArtifactRenderer.tsx
git commit -m "feat: integrate FileTabBar into ArtifactRenderer with version-aware tab clamping"
```

---

### Task 6: Update CodeRenderer for multi-file support

**Files:**
- Modify: `apps/web/src/components/artifacts/CodeRenderer.tsx`

**Step 1: Add activeFileIndex prop**

Update `CodeRendererProps`:

```typescript
export interface CodeRendererProps {
  editorRef: MutableRefObject<EditorView | null>;
  isHovering: boolean;
  activeFileIndex: number;
}
```

**Step 2: Use active file content when multi-file**

After the existing `const artifactContent = getArtifactContent(artifact) as ArtifactCodeV3;` (line 82), add logic to get the active file:

```typescript
const artifactContent = getArtifactContent(artifact) as ArtifactCodeV3;

// Multi-file: use active file's content and language
const isMultiFile = !!artifactContent.files && artifactContent.files.length > 0;
const activeFile = isMultiFile
  ? artifactContent.files![Math.min(props.activeFileIndex, artifactContent.files!.length - 1)]
  : undefined;

const displayCode = activeFile ? activeFile.content : artifactContent.code;
const displayLanguage = activeFile?.language ?? artifactContent.language;
```

**Step 3: Update CodeMirror value and language**

Change the CodeMirror component's `value` prop from `cleanContent(artifactContent.code)` to `cleanContent(displayCode)`.

Change the language extension lookup to use `displayLanguage` instead of `artifactContent.language`.

**Step 4: Update onChange handler**

The onChange currently does: `onChange={(c) => setArtifactContent(artifactContent.index, c)}`

For multi-file, we need to update the specific file in the files array. Update the onChange:

```typescript
onChange={(c) => {
  if (isMultiFile && artifactContent.files) {
    // Update the specific file in the files array
    const updatedFiles = artifactContent.files.map((f, i) =>
      i === Math.min(props.activeFileIndex, artifactContent.files!.length - 1)
        ? { ...f, content: c }
        : f
    );
    // Also update the main code field for backward compat
    setArtifact((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contents: prev.contents.map((content) => {
          if (content.index === artifactContent.index) {
            return { ...content, code: c, files: updatedFiles };
          }
          return content;
        }),
      };
    });
  } else {
    setArtifactContent(artifactContent.index, c);
  }
}}
```

This requires adding `setArtifact` from GraphContext. Add it to the destructuring at the top of the component where `artifact` is accessed.

**Step 5: Build to verify**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add apps/web/src/components/artifacts/CodeRenderer.tsx
git commit -m "feat: update CodeRenderer to display per-file content with correct language"
```

---

### Task 7: Update TextRenderer for multi-file support

**Files:**
- Modify: `apps/web/src/components/artifacts/TextRenderer.tsx`

**Step 1: Add activeFileIndex prop**

Update `TextRendererProps`:

```typescript
export interface TextRendererProps {
  isEditing: boolean;
  isHovering: boolean;
  isInputVisible: boolean;
  activeFileIndex: number;
}
```

**Step 2: Use active file content when multi-file**

Similar to CodeRenderer, after getting the artifact content, check for multi-file:

```typescript
const isMultiFile = !!currentContent?.files && currentContent.files.length > 0;
const activeFile = isMultiFile
  ? currentContent!.files![Math.min(props.activeFileIndex, currentContent!.files!.length - 1)]
  : undefined;

const displayMarkdown = activeFile ? activeFile.content : (currentContent as ArtifactMarkdownV3)?.fullMarkdown;
```

Update the BlockNote editor to use `displayMarkdown` instead of the full `fullMarkdown`.

**Step 3: Update onChange handler**

Similar to CodeRenderer, when multi-file, update the specific file in the files array instead of the full `fullMarkdown`.

**Step 4: Build to verify**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/components/artifacts/TextRenderer.tsx
git commit -m "feat: update TextRenderer to display per-file markdown content"
```

---

### Task 8: Update rewriteCodeArtifactTheme for per-file quick actions

**Files:**
- Modify: `apps/agents/src/open-canvas/nodes/rewriteCodeArtifactTheme.ts`
- Modify: `apps/agents/src/open-canvas/state.ts` (add activeFileIndex to state)

**Step 1: Add activeFileIndex to the agent state**

Find the `OpenCanvasGraphAnnotation` in `apps/agents/src/open-canvas/state.ts` and add `activeFileIndex` field (matching the `GraphInput` type):

```typescript
activeFileIndex: {
  value: (x: number | undefined, y: number | undefined) => y ?? x,
  default: () => undefined as number | undefined,
},
```

**Step 2: Update rewriteCodeArtifactTheme to handle multi-file**

In `apps/agents/src/open-canvas/nodes/rewriteCodeArtifactTheme.ts`, after getting `currentArtifactContent` (line 32-40), add multi-file handling:

```typescript
const isMultiFile = !!currentArtifactContent.files && currentArtifactContent.files.length > 0;
const activeFileIndex = state.activeFileIndex ?? 0;
const activeFile = isMultiFile
  ? currentArtifactContent.files![Math.min(activeFileIndex, currentArtifactContent.files!.length - 1)]
  : undefined;

// Use active file's code for the prompt, or fall back to full code
const codeForPrompt = activeFile ? activeFile.content : currentArtifactContent.code;
```

Change line 88 from:
```typescript
formattedPrompt = formattedPrompt.replace("{artifactContent}", currentArtifactContent.code);
```
to:
```typescript
formattedPrompt = formattedPrompt.replace("{artifactContent}", codeForPrompt);
```

When creating the new artifact content (lines 108-115), if multi-file, update only the active file:

```typescript
let newFiles: ArtifactFileEntry[] | undefined;
if (isMultiFile && currentArtifactContent.files) {
  const clampedIndex = Math.min(activeFileIndex, currentArtifactContent.files.length - 1);
  newFiles = currentArtifactContent.files.map((f, i) =>
    i === clampedIndex
      ? { ...f, content: artifactContentText, language: state.portLanguage ? (state.portLanguage as ProgrammingLanguageOptions) : f.language }
      : f
  );
}

const newArtifactContent: ArtifactCodeV3 = {
  index: state.artifact.contents.length + 1,
  type: "code",
  title: currentArtifactContent.title,
  language: state.portLanguage || currentArtifactContent.language,
  code: isMultiFile ? (newFiles![activeFile ? Math.min(activeFileIndex, currentArtifactContent.files!.length - 1) : 0].content) : artifactContentText,
  ...(newFiles && { files: newFiles }),
};
```

Add the import for `ArtifactFileEntry`:

```typescript
import { ArtifactCodeV3, ArtifactFileEntry, ArtifactV3 } from "@opencanvas/shared/types";
```

**Step 3: Update frontend quick action calls to pass activeFileIndex**

In `apps/web/src/components/artifacts/actions_toolbar/code/index.tsx`, update the quick action handlers to pass `activeFileIndex`. This requires the component to receive `activeFileIndex` as a prop.

Update `CodeToolbarProps`:

```typescript
export interface CodeToolbarProps {
  streamMessage: (params: GraphInput) => Promise<void>;
  isTextSelected: boolean;
  language: ProgrammingLanguageOptions;
  activeFileIndex: number;
}
```

Update the handler calls:

```typescript
if (optionId === "addComments") {
  await streamMessage({ addComments: true, activeFileIndex: props.activeFileIndex });
} else if (optionId === "addLogs") {
  await streamMessage({ addLogs: true, activeFileIndex: props.activeFileIndex });
} else if (optionId === "fixBugs") {
  await streamMessage({ fixBugs: true, activeFileIndex: props.activeFileIndex });
}
```

And in `ArtifactRenderer.tsx`, pass `activeFileIndex` to `CodeToolBar`:

```typescript
<CodeToolBar
  streamMessage={streamMessage}
  isTextSelected={isSelectionActive || selectedBlocks !== undefined}
  language={currentArtifactContent.language as ProgrammingLanguageOptions}
  activeFileIndex={activeFileIndex}
/>
```

**Step 4: Build to verify**

Run: `cd /Users/yoda/Documents/personal/open-canvas && yarn build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/agents/src/open-canvas/nodes/rewriteCodeArtifactTheme.ts apps/agents/src/open-canvas/state.ts apps/web/src/components/artifacts/actions_toolbar/code/index.tsx apps/web/src/components/artifacts/ArtifactRenderer.tsx
git commit -m "feat: quick actions apply to active file only in multi-file artifacts"
```

---

### Task 9: Update rewriteArtifact node for multi-file preservation

**Files:**
- Modify: `apps/agents/src/open-canvas/nodes/rewrite-artifact/index.ts`

**Step 1: Preserve files array during rewrites**

When creating a new artifact version in `rewriteArtifact`, if the current artifact has files, the rewrite should preserve the multi-file structure. The rewrite currently replaces the entire artifact content as a single string.

For the initial vertical slice: when rewriting a multi-file artifact, pass the full files context to the model so it can return the complete rewritten set. The simplest approach is to include all files in the prompt and have the model output the full rewritten content.

However, for rewrites the model outputs raw text (not a tool call). For multi-file artifacts, we'd need the model to output structured data. This is complex — for the initial implementation, rewrites of multi-file artifacts will produce a single-file result (the files get merged). This is acceptable for the vertical slice since the primary use case (generation) is handled.

Add a comment noting this limitation:

```typescript
// TODO: Multi-file rewrite support - currently rewrites produce single-file output
// A future enhancement would parse structured output to preserve multi-file structure
```

**Step 2: Commit**

```bash
git add apps/agents/src/open-canvas/nodes/rewrite-artifact/index.ts
git commit -m "docs: note multi-file rewrite limitation in rewriteArtifact node"
```

---

### Task 10: Manual testing and bug fixes

**Step 1: Start the dev servers**

```bash
cd /Users/yoda/Documents/personal/open-canvas/apps/agents && yarn dev
# In another terminal:
cd /Users/yoda/Documents/personal/open-canvas/apps/web && yarn dev
```

**Step 2: Test single-file artifacts still work**

- Create a new thread
- Ask: "Write a Python hello world program"
- Verify: renders in CodeMirror with Python highlighting, no tabs shown
- Click version arrows — should work as before

**Step 3: Test multi-file artifact generation**

- Ask: "Create a React component with separate files for the component, types, and styles"
- Verify: tabs appear with file names
- Click each tab — correct content and syntax highlighting per file
- The first file is selected by default

**Step 4: Test version history with multi-file**

- After generating multi-file artifact, ask: "Add a test file"
- Navigate back to previous version — should show original files
- Navigate forward — should show version with test file
- No crashes, no phantom tabs

**Step 5: Test quick actions on multi-file**

- On a multi-file code artifact, select a tab (e.g., the types file)
- Click "Add Comments"
- Verify: only the selected file gets comments added, other files unchanged

**Step 6: Test markdown multi-file**

- Ask: "Create a README.md and CONTRIBUTING.md for a project"
- Verify: tabs show both files, markdown renders correctly per file

**Step 7: Fix any bugs found**

Document and fix issues encountered during testing.

**Step 8: Commit fixes**

```bash
git add -A
git commit -m "fix: address bugs found during multi-file artifact testing"
```

---

### Task 11: Final build verification and cleanup

**Step 1: Run full build**

```bash
cd /Users/yoda/Documents/personal/open-canvas && yarn build
```

**Step 2: Run lint**

```bash
cd /Users/yoda/Documents/personal/open-canvas && yarn lint
```

**Step 3: Fix any lint errors**

**Step 4: Run format**

```bash
cd /Users/yoda/Documents/personal/open-canvas && yarn format
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: lint and format multi-file artifacts feature"
```

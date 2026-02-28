import { PROGRAMMING_LANGUAGES } from "@opencanvas/shared/constants";
import { z } from "zod";

const FILE_ENTRY_SCHEMA = z.object({
  name: z
    .string()
    .describe("The filename with extension (e.g., 'types.ts', 'README.md')."),
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
  artifact: z
    .string()
    .describe(
      "The content of the artifact to generate. For single-file artifacts, this is the entire content. For multi-file artifacts, this can be a summary or the primary file content."
    ),
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

import { v4 as uuidv4 } from "uuid";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
  extractThinkingAndResponseTokens,
  isThinkingModel,
} from "@opencanvas/shared/utils/thinking";
import {
  isArtifactCodeContent,
  getArtifactContent,
} from "@opencanvas/shared/utils/artifacts";
import {
  ArtifactCodeV3,
  ArtifactFileEntry,
  ArtifactV3,
  ProgrammingLanguageOptions,
} from "@opencanvas/shared/types";
import { getModelConfig, getModelFromConfig } from "../../utils.js";
import {
  ADD_COMMENTS_TO_CODE_ARTIFACT_PROMPT,
  ADD_LOGS_TO_CODE_ARTIFACT_PROMPT,
  FIX_BUGS_CODE_ARTIFACT_PROMPT,
  PORT_LANGUAGE_CODE_ARTIFACT_PROMPT,
} from "../prompts.js";
import {
  OpenCanvasGraphAnnotation,
  OpenCanvasGraphReturnType,
} from "../state.js";
import { AIMessage } from "@langchain/core/messages";

export const rewriteCodeArtifactTheme = async (
  state: typeof OpenCanvasGraphAnnotation.State,
  config: LangGraphRunnableConfig
): Promise<OpenCanvasGraphReturnType> => {
  const { modelName } = getModelConfig(config);
  const smallModel = await getModelFromConfig(config);

  const currentArtifactContent = state.artifact
    ? getArtifactContent(state.artifact)
    : undefined;
  if (!currentArtifactContent) {
    throw new Error("No artifact found");
  }
  if (!isArtifactCodeContent(currentArtifactContent)) {
    throw new Error("Current artifact content is not code");
  }

  // Multi-file: use active file's code for quick actions
  const isMultiFile =
    !!currentArtifactContent.files && currentArtifactContent.files.length > 0;
  const activeFileIdx = state.activeFileIndex ?? 0;
  const clampedFileIdx = isMultiFile
    ? Math.min(activeFileIdx, currentArtifactContent.files!.length - 1)
    : 0;
  const activeFile = isMultiFile
    ? currentArtifactContent.files![clampedFileIdx]
    : undefined;
  const codeForPrompt = activeFile
    ? activeFile.content
    : currentArtifactContent.code;

  let formattedPrompt = "";
  if (state.addComments) {
    formattedPrompt = ADD_COMMENTS_TO_CODE_ARTIFACT_PROMPT;
  } else if (state.portLanguage) {
    let newLanguage = "";
    switch (state.portLanguage) {
      case "typescript":
        newLanguage = "TypeScript";
        break;
      case "javascript":
        newLanguage = "JavaScript";
        break;
      case "cpp":
        newLanguage = "C++";
        break;
      case "java":
        newLanguage = "Java";
        break;
      case "php":
        newLanguage = "PHP";
        break;
      case "python":
        newLanguage = "Python";
        break;
      case "html":
        newLanguage = "HTML";
        break;
      case "sql":
        newLanguage = "SQL";
        break;
    }
    formattedPrompt = PORT_LANGUAGE_CODE_ARTIFACT_PROMPT.replace(
      "{newLanguage}",
      newLanguage
    );
  } else if (state.addLogs) {
    formattedPrompt = ADD_LOGS_TO_CODE_ARTIFACT_PROMPT;
  } else if (state.fixBugs) {
    formattedPrompt = FIX_BUGS_CODE_ARTIFACT_PROMPT;
  } else {
    throw new Error("No theme selected");
  }

  // Insert the code into the artifact placeholder in the prompt
  formattedPrompt = formattedPrompt.replace("{artifactContent}", codeForPrompt);

  const newArtifactValues = await smallModel.invoke([
    { role: "user", content: formattedPrompt },
  ]);

  let thinkingMessage: AIMessage | undefined;
  let artifactContentText = newArtifactValues.content as string;

  if (isThinkingModel(modelName)) {
    const { thinking, response } =
      extractThinkingAndResponseTokens(artifactContentText);
    thinkingMessage = new AIMessage({
      id: `thinking-${uuidv4()}`,
      content: thinking,
    });
    artifactContentText = response;
  }

  // For multi-file, update only the active file and preserve others
  let newFiles: ArtifactFileEntry[] | undefined;
  if (isMultiFile && currentArtifactContent.files) {
    newFiles = currentArtifactContent.files.map((f, i) =>
      i === clampedFileIdx
        ? {
            ...f,
            content: artifactContentText,
            language: state.portLanguage
              ? (state.portLanguage as ProgrammingLanguageOptions)
              : f.language,
          }
        : f
    );
  }

  const newArtifactContent: ArtifactCodeV3 = {
    index: state.artifact.contents.length + 1,
    type: "code",
    title: currentArtifactContent.title,
    language: state.portLanguage || currentArtifactContent.language,
    code: isMultiFile ? newFiles![clampedFileIdx].content : artifactContentText,
    ...(newFiles && { files: newFiles }),
  };

  const newArtifact: ArtifactV3 = {
    ...state.artifact,
    currentIndex: state.artifact.contents.length + 1,
    contents: [...state.artifact.contents, newArtifactContent],
  };

  return {
    artifact: newArtifact,
    messages: [...(thinkingMessage ? [thinkingMessage] : [])],
    _messages: [...(thinkingMessage ? [thinkingMessage] : [])],
  };
};

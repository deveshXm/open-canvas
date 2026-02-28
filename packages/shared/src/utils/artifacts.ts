import {
  Artifact,
  ArtifactCodeV3,
  ArtifactFileEntry,
  ArtifactMarkdownV3,
  ArtifactV3,
} from "../types.js";

export const isArtifactCodeContent = (
  content: unknown
): content is ArtifactCodeV3 => {
  return !!(
    typeof content === "object" &&
    content &&
    "type" in content &&
    content.type === "code"
  );
};

export const isArtifactMarkdownContent = (
  content: unknown
): content is ArtifactMarkdownV3 => {
  return !!(
    typeof content === "object" &&
    content &&
    "type" in content &&
    content.type === "text"
  );
};

export const isDeprecatedArtifactType = (
  artifact: unknown
): artifact is Artifact => {
  return !!(
    typeof artifact === "object" &&
    artifact &&
    "currentContentIndex" in artifact &&
    typeof artifact.currentContentIndex === "number"
  );
};

export const getArtifactContent = (
  artifact: ArtifactV3
): ArtifactCodeV3 | ArtifactMarkdownV3 => {
  if (!artifact) {
    throw new Error("No artifact found.");
  }
  const currentContent = artifact.contents.find(
    (a) => a.index === artifact.currentIndex
  );
  if (!currentContent) {
    return artifact.contents[artifact.contents.length - 1];
  }
  return currentContent;
};

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

"use client";

import {
  ShareRecord,
  ArtifactCodeV3,
  ArtifactMarkdownV3,
} from "@opencanvas/shared/types";
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
        <span className="text-xs text-gray-500">v{artifact.index}</span>
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
        <span className="text-xs text-gray-500">v{artifact.index}</span>
      </div>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown>{artifact.fullMarkdown}</ReactMarkdown>
      </div>
    </div>
  );
}

export function SharePageClient({
  shareRecord,
}: {
  shareRecord: ShareRecord;
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
            <p className="text-sm text-gray-500">Shared via Open Canvas</p>
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

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

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Share2, Copy, Check, Loader2 } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/assistant-ui/tooltip-icon-button";
import { ArtifactV3, ShareMode } from "@opencanvas/shared/types";
import { useToast } from "@/hooks/use-toast";

interface ShareDialogProps {
  artifact: ArtifactV3;
  threadId: string | null;
}

export function ShareDialog({ artifact, threadId }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(
    artifact.currentIndex.toString()
  );
  const [selectedMode, setSelectedMode] = useState<ShareMode>("view");
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCreateLink = async () => {
    if (!threadId) {
      toast({
        title: "Error",
        description: "No thread selected",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setShareUrl(null);

    try {
      const response = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          artifactVersionIndex: parseInt(selectedVersion),
          mode: selectedMode,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create share link");
      }

      const data = await response.json();
      setShareUrl(data.shareUrl);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create share link",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setShareUrl(null);
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <TooltipIconButton
          tooltip="Share Artifact"
          variant="ghost"
          className="transition-colors w-fit h-fit p-2"
          delayDuration={400}
        >
          <Share2 className="w-[26px] h-[26px] text-gray-600" />
        </TooltipIconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Artifact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Version Picker */}
          <div className="space-y-2">
            <Label>Version</Label>
            <Select
              value={selectedVersion}
              onValueChange={setSelectedVersion}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {artifact.contents.map((content) => (
                  <SelectItem
                    key={content.index}
                    value={content.index.toString()}
                  >
                    v{content.index} — {content.title}
                    {content.index === artifact.currentIndex
                      ? " (current)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mode Selector */}
          <div className="space-y-2">
            <Label>Sharing mode</Label>
            <RadioGroup
              value={selectedMode}
              onValueChange={(v) => setSelectedMode(v as ShareMode)}
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="view" id="mode-view" />
                <Label
                  htmlFor="mode-view"
                  className="font-normal cursor-pointer"
                >
                  <span className="font-medium">View only</span>
                  <span className="text-gray-500 block text-sm">
                    Anyone with the link can view. No login required.
                  </span>
                </Label>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="copy" id="mode-copy" />
                <Label
                  htmlFor="mode-copy"
                  className="font-normal cursor-pointer"
                >
                  <span className="font-medium">Copy</span>
                  <span className="text-gray-500 block text-sm">
                    Recipients get their own copy. Login required.
                  </span>
                </Label>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="suggest" id="mode-suggest" />
                <Label
                  htmlFor="mode-suggest"
                  className="font-normal cursor-pointer"
                >
                  <span className="font-medium">Suggest changes</span>
                  <span className="text-gray-500 block text-sm">
                    Recipients can propose inline edits. Login required.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Create / Result */}
          {shareUrl ? (
            <div className="space-y-2">
              <Label>Share link</Label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50"
                />
                <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={handleCreateLink}
              disabled={isCreating}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Link"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import type { StatusView } from "./view-model";

// Folder names and list shapes shared by the server views and the browser list. No database imports here:
// client components import this file.

export const FOLDERS = ["all", "attention", "processing", "draft", "failed", "skipped"] as const;
export type Folder = (typeof FOLDERS)[number];
export const FOLDER_LABEL: Record<Folder, string> = {
  all: "Inbox",
  attention: "Needs attention",
  processing: "Processing",
  draft: "Draft saved",
  failed: "Failed",
  skipped: "Skipped",
};

export const LIST_PAGE_SIZE = 50;

export type ListQuery = { folder: Folder; q: string; page: number; sort: "newest" | "oldest" };

export type ListRow = {
  id: string;
  name: string;
  sender: string;
  senderAddress: string | null;
  subject: string | null;
  status: StatusView;
  reason: string | null;
  at: string;
  inEmail: number;
  needsYou: boolean; // shown like an unread message
  canRetry: boolean;
  canApprove: boolean; // waiting only for a plain approval of a known position: safe to approve in bulk
  hasDraft: boolean;
};


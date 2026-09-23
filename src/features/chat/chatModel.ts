import { createId } from "../../utils/id";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "pending" | "completed" | "error";

export interface ChatMedia {
  id: string;
  uri: string;
  mimeType: string;
  kind?: "image" | "video";
}

/** A compact, persisted copy of a user-provided reference asset. */
export interface ChatAttachment {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  kind: "image";
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: number;
  status: ChatMessageStatus;
  error?: string;
  media?: ChatMedia[];
  attachments?: ChatAttachment[];
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const CHAT_CONVERSATIONS_STORAGE_KEY = "inspiration-drawer-tablet-chat-v1";
const CHAT_ACTIVE_CONVERSATION_STORAGE_KEY = "inspiration-drawer-tablet-chat-active-v1";
const MAX_CONVERSATIONS = 24;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export function createChatConversation(): ChatConversation {
  const now = Date.now();
  return {
    id: createId("chat-conversation"),
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function readChatConversations(): ChatConversation[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_CONVERSATIONS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeConversation)
      .filter((conversation): conversation is ChatConversation => Boolean(conversation))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function writeChatConversations(conversations: ChatConversation[]): void {
  try {
    const compact = conversations
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CONVERSATIONS)
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
      }));
    window.localStorage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Chat remains usable for the current session when storage is unavailable.
  }
}

export function readActiveChatConversationId(): string {
  return window.localStorage.getItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY) ?? "";
}

export function writeActiveChatConversationId(id: string): void {
  try {
    window.localStorage.setItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY, id);
  } catch {
    // Ignore private-mode or full-storage failures.
  }
}

export function createConversationTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "新对话";
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact;
}

function normalizeConversation(value: unknown): ChatConversation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<ChatConversation>;
  if (typeof source.id !== "string" || !source.id) return undefined;
  const createdAt = finiteTimestamp(source.createdAt);
  const updatedAt = finiteTimestamp(source.updatedAt, createdAt);
  const messages = Array.isArray(source.messages)
    ? source.messages
      .map(normalizeMessage)
      .filter((message): message is ChatMessage => Boolean(message))
      .slice(-MAX_MESSAGES_PER_CONVERSATION)
    : [];
  return {
    id: source.id,
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "新对话",
    createdAt,
    updatedAt,
    messages,
  };
}

function normalizeMessage(value: unknown): ChatMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<ChatMessage>;
  if (typeof source.id !== "string" || !source.id) return undefined;
  if (source.role !== "user" && source.role !== "assistant") return undefined;
  if (typeof source.content !== "string") return undefined;
  const status = source.status === "pending" || source.status === "error"
    ? "error"
    : "completed";
  return {
    id: source.id,
    role: source.role,
    content: source.content,
    createdAt: finiteTimestamp(source.createdAt),
    status,
    media: Array.isArray(source.media)
      ? source.media.filter((media): media is ChatMedia => Boolean(
        media && typeof media === "object"
        && typeof media.id === "string"
        && typeof media.uri === "string"
        && typeof media.mimeType === "string",
      )).map((media) => ({
        ...media,
        kind: media.kind === "video" ? "video" as const : "image" as const,
      })).slice(0, 4)
      : undefined,
    attachments: Array.isArray(source.attachments)
      ? source.attachments.filter((attachment): attachment is ChatAttachment => Boolean(
        attachment && typeof attachment === "object"
        && typeof attachment.id === "string"
        && typeof attachment.name === "string"
        && typeof attachment.uri === "string"
        && typeof attachment.mimeType === "string",
      )).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        uri: attachment.uri,
        mimeType: attachment.mimeType,
        kind: "image" as const,
      })).slice(0, 6)
      : undefined,
    error: status === "error" && typeof source.error === "string"
      ? source.error
      : status === "error" ? "上次回复未完成，请重试" : undefined,
  };
}

function finiteTimestamp(value: unknown, fallback = Date.now()): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

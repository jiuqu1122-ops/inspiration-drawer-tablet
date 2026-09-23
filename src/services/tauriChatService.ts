import { invoke, isTauri } from "@tauri-apps/api/core";

export type ServerChatRole = "system" | "user" | "assistant" | "tool";

export interface ServerChatMessage {
  role: ServerChatRole;
  content: string | null | Array<Record<string, unknown>>;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
}

export interface ServerChatCompletionRequest {
  requestId: string;
  messages: ServerChatMessage[];
  model?: string;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: string | Record<string, unknown>;
  usageContext?: "chat" | "canvas_text_agent" | "workflow" | "system_internal";
}

interface NativeChatCompletion {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: Record<string, unknown>;
}

export interface ServerChatCompletion {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage?: Record<string, unknown>;
}

export interface ServerChatModels {
  models: string[];
  defaultModel?: string;
  catalog?: Array<{
    id: string;
    displayName?: string;
    modality?: string;
    capabilities?: ServerImageModelCapabilities;
  }>;
}

export interface ServerWebSearchResult {
  query: string;
  provider: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
  }>;
}

/**
 * Public, provider-independent image promises returned by the server catalog.
 * Keep this deliberately wider than the bundled presets: the server may add a
 * model, resolution, or exact output size without requiring a mobile release.
 */
export interface ServerImageModelCapabilities {
  resolutions?: unknown;
  defaultResolution?: unknown;
  aspectRatios?: unknown;
  defaultAspectRatio?: unknown;
  aspectRatiosByResolution?: Record<string, string[]>;
  maxReferenceImages?: unknown;
  maxOutputs?: unknown;
  durations?: unknown;
  defaultDuration?: unknown;
  supportsReferenceImages?: unknown;
  maxReferenceVideos?: unknown;
}

export async function completeChatWithServer(
  request: ServerChatCompletionRequest,
): Promise<ServerChatCompletion> {
  if (!isTauri()) {
    throw new Error("Chat 需要在 Inspiration Drawer 移动端应用中运行");
  }

  const result = await invoke<NativeChatCompletion>("complete_server_chat", {
    input: request,
  });
  const text = result.text.trim();
  const toolCalls = result.toolCalls ?? [];
  if (!text && !toolCalls.length) {
    throw new Error("Chat 没有返回有效内容");
  }
  return { text, toolCalls, usage: result.usage };
}

export async function listServerChatModels(): Promise<ServerChatModels> {
  if (!isTauri()) return { models: [] };
  return invoke<ServerChatModels>("list_server_chat_models");
}

export async function listServerImageModels(): Promise<ServerChatModels> {
  if (!isTauri()) return { models: [] };
  return invoke<ServerChatModels>("list_server_image_models");
}

export async function listServerVideoModels(): Promise<ServerChatModels> {
  if (!isTauri()) return { models: [] };
  return invoke<ServerChatModels>("list_server_video_models");
}

export async function searchWebWithServer(
  query: string,
  limit = 6,
): Promise<ServerWebSearchResult> {
  if (!isTauri()) {
    throw new Error("联网搜索需要在 Inspiration Drawer 移动端应用中运行");
  }
  return invoke<ServerWebSearchResult>("chat_web_search", {
    query: query.trim(),
    limit: Math.min(8, Math.max(1, Math.round(limit))),
  });
}

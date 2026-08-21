import { invoke, isTauri } from "@tauri-apps/api/core";

interface NativeGeneratedText {
  text: string;
}

export interface TextGenerationRequest {
  requestId: string;
  prompt: string;
  systemPrompt?: string;
  context: string[];
}

export async function generateTextWithServer(request: TextGenerationRequest): Promise<string> {
  if (!isTauri()) {
    throw new Error("文字 LLM 节点需要在 Android 应用中运行");
  }
  const result = await invoke<NativeGeneratedText>("generate_server_text", {
    input: request,
  });
  const text = result.text.trim();
  if (!text) {
    throw new Error("文字 LLM 节点没有返回内容");
  }
  return text;
}

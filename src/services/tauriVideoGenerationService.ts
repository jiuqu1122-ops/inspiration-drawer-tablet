import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  GeneratedVideoResult,
  ImageAsset,
  VideoGenerationRequest,
} from "../../shared";
import { buildImageGenerationPrompt } from "../../shared";
import { createId } from "../utils/id";

interface NativeGeneratedVideo {
  uri: string;
  mimeType: string;
}

interface VideoReference {
  name: string;
  mimeType: string;
  dataUri: string;
}

export class TauriVideoGenerationService {
  async generate(
    request: VideoGenerationRequest,
    inputAssets: ImageAsset[],
    signal?: AbortSignal,
  ): Promise<GeneratedVideoResult[]> {
    if (!isTauri()) throw new Error("视频生成需要在 Android 应用中运行");
    if (signal?.aborted) throw new DOMException("生成任务已取消", "AbortError");
    if (request.model.provider !== "server-gateway") throw new Error("移动端视频模型必须通过服务端网关运行");
    const model = request.model.model.trim();
    if (!model || !/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new Error("视频模型标识无效");
    await setGenerationKeepAlive(true);
    try {
      const references = await Promise.all(inputAssets.slice(0, 9).map(toServerImageReference));
      const prompt = buildImageGenerationPrompt([
        request.prompt,
        references.length ? `Reference material count: ${references.length}. Preserve connected references as the visual direction.` : "No reference images are connected.",
      ].filter(Boolean).join("\n\n"));
      const count = Math.min(4, Math.max(1, Math.round(request.count)));
      const nativeResults = await invoke<NativeGeneratedVideo[]>("generate_server_videos", {
        input: {
          requestId: request.id,
          model,
          prompt,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          duration: request.duration,
          inputMode: request.inputMode ?? "REF",
          count,
          references,
        },
      });
      if (signal?.aborted) throw new DOMException("生成任务已取消", "AbortError");
      return nativeResults.map((result) => ({
        id: createId("generated-video"),
        requestId: request.id,
        uri: result.uri,
        mimeType: result.mimeType || "video/mp4",
        createdAt: Date.now(),
      }));
    } finally {
      await setGenerationKeepAlive(false);
    }
  }
}

async function setGenerationKeepAlive(active: boolean): Promise<void> {
  await invoke("set_generation_keep_alive", { input: { active } }).catch(() => undefined);
}

async function toServerImageReference(asset: ImageAsset): Promise<VideoReference> {
  const response = await fetch(asset.uri.startsWith("data:") ? asset.uri : asset.uri);
  if (!response.ok) throw new Error(`无法读取参考素材：${asset.name}`);
  const blob = await response.blob();
  return {
    name: asset.name,
    mimeType: blob.type || asset.mimeType || "image/png",
    dataUri: await blobToDataUri(blob),
  };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("参考素材编码失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

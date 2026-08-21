import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  GeneratedImageResult,
  ImageAsset,
  ImageGenerationContext,
  ImageGenerationRequest,
  ImageGenerationService,
} from "../../shared";
import {
  buildImageRulePrompt,
  buildIndustrialDesignPrompt,
  isImageModelPresetId,
} from "../../shared";
import { createId } from "../utils/id";

interface NativeGeneratedImage {
  dataUri: string;
  mimeType: string;
}

interface NativePromptOptimization {
  optimizedPrompt: string;
}

interface ServerImageReference {
  name: string;
  mimeType: string;
  dataUri: string;
}

/**
 * The mobile app never receives provider API keys or provider-specific endpoints.
 * It sends stable public model IDs to the Inspiration Drawer application server,
 * where the same XAIS / New API / Bigmodel routes as the desktop client are selected.
 */
export class TauriImageGenerationService implements ImageGenerationService {
  async generate(
    request: ImageGenerationRequest,
    context: ImageGenerationContext,
  ): Promise<GeneratedImageResult[]> {
    assertTauriRuntime();
    assertNotAborted(context.signal);

    if (request.model.provider !== "server-gateway") {
      throw new Error("移动端只能通过 Inspiration Drawer 服务端网关生图");
    }
    if (!isImageModelPresetId(request.model.model)) {
      throw new Error("请选择移动端预设的生图模型");
    }

    const references = await Promise.all(
      context.inputAssets.slice(0, 8).map(toServerImageReference),
    );
    assertNotAborted(context.signal);

    const rulePrompt = buildImageRulePrompt(context.rules);
    const prompt = buildIndustrialDesignPrompt([
      request.prompt,
      rulePrompt,
      references.length
        ? `Reference material count: ${references.length}. Preserve connected references as the visual direction.`
        : "No reference images are connected.",
      `Target aspect ratio: ${request.aspectRatio}. Detail tier: ${request.resolution}.`,
    ].filter(Boolean).join("\n\n"));
    const images = await invoke<NativeGeneratedImage[]>("generate_server_images", {
      input: {
        requestId: request.id,
        model: request.model.model,
        prompt,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        count: request.count,
        references,
      },
    });
    assertNotAborted(context.signal);

    return images.map((image) => ({
      id: createId("generated-result"),
      requestId: request.id,
      uri: image.dataUri,
      mimeType: image.mimeType,
      createdAt: Date.now(),
    }));
  }

  async optimizePrompt(prompt: string): Promise<string> {
    assertTauriRuntime();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      throw new Error("请先输入需要优化的提示词");
    }
    const result = await invoke<NativePromptOptimization>("optimize_server_prompt", {
      input: {
        prompt: cleanPrompt,
        mediaType: "image",
        locale: "zh-CN",
      },
    });
    return result.optimizedPrompt.trim();
  }
}

function assertTauriRuntime(): void {
  if (!isTauri()) {
    throw new Error("该功能需要在 Android 应用中运行");
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("生成任务已取消", "AbortError");
  }
}

async function toServerImageReference(asset: ImageAsset): Promise<ServerImageReference> {
  if (asset.uri.startsWith("data:image/")) {
    return {
      name: asset.name,
      mimeType: asset.mimeType,
      dataUri: asset.uri,
    };
  }

  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new Error(`无法读取参考素材：${asset.name}`);
  }
  const blob = await response.blob();
  if (blob.size > 25 * 1024 * 1024) {
    throw new Error(`参考素材超过 25 MB：${asset.name}`);
  }
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

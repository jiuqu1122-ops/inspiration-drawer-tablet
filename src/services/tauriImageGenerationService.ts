import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  GeneratedImageResult,
  ImageGenerationContext,
  ImageGenerationRequest,
  ImageGenerationService,
} from "../../shared";
import { buildIndustrialDesignPrompt } from "../../shared";
import { createId } from "../utils/id";

interface NativeGeneratedImage {
  dataUri: string;
  mimeType: string;
}

export class TauriImageGenerationService implements ImageGenerationService {
  async generate(
    request: ImageGenerationRequest,
    context: ImageGenerationContext,
  ): Promise<GeneratedImageResult[]> {
    if (context.signal?.aborted) {
      throw new DOMException("生成任务已取消", "AbortError");
    }
    if (!isTauri()) {
      throw new Error("生图请求需要在 Tauri 桌面预览或 Android 应用中运行");
    }
    if (request.model.provider !== "openai-compatible" && request.model.provider !== "custom") {
      throw new Error(`当前版本暂不支持 ${request.model.provider} 生图协议`);
    }

    const images = await invoke<NativeGeneratedImage[]>("generate_openai_images", {
      input: {
        prompt: buildIndustrialDesignPrompt([
          request.prompt,
          context.inputAssets.length
            ? `Reference material count: ${context.inputAssets.length}. Preserve the connected references as the visual direction.`
            : "No reference images are connected.",
          `Target aspect ratio: ${request.aspectRatio}. Detail tier: ${request.resolution}.`,
        ].join("\n")),
        size: getOpenAiSize(request.aspectRatio),
        quality: getOpenAiQuality(request.resolution),
        count: request.count,
      },
    });

    return images.map((image) => ({
      id: createId("generated-result"),
      requestId: request.id,
      uri: image.dataUri,
      mimeType: image.mimeType,
      createdAt: Date.now(),
    }));
  }
}

function getOpenAiQuality(resolution: ImageGenerationRequest["resolution"]): string {
  if (resolution === "4k") {
    return "high";
  }
  if (resolution === "2k") {
    return "medium";
  }
  return "low";
}

function getOpenAiSize(aspectRatio: ImageGenerationRequest["aspectRatio"]): string {
  if (aspectRatio === "4:3" || aspectRatio === "16:9") {
    return "1536x1024";
  }
  if (aspectRatio === "3:4" || aspectRatio === "9:16") {
    return "1024x1536";
  }
  return "1024x1024";
}

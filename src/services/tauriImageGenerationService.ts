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
  buildImageGenerationPrompt,
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
    await setGenerationKeepAlive(true);

    try {
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

    const aspectRatio = normalizeGatewayAspectRatio(request.aspectRatio);
    const rulePrompt = buildImageRulePrompt(context.rules);
    const basePrompt = buildImageGenerationPrompt([
      request.prompt,
      rulePrompt,
      references.length
        ? `Reference material count: ${references.length}. Preserve connected references as the visual direction.`
        : "No reference images are connected.",
      `Target aspect ratio: ${aspectRatio}. Detail tier: ${request.resolution}.`,
    ].filter(Boolean).join("\n\n"));
    const count = Math.min(4, Math.max(1, Math.round(request.count)));
    const tasks = Array.from({ length: count }, (_, index) => {
      // The gateway deduplicates by clientRequestId. A separate ID per image is
      // therefore required; sending count=2 on one request creates one task.
      const taskRequestId = count === 1 ? request.id : `${request.id}-${index + 1}`;
      const variationPrompt = count === 1
        ? ""
        : `Variation ${index + 1} of ${count}: produce a distinct alternative design. Do not duplicate another variation.`;
      return this.generateSingle(
        {
          requestId: taskRequestId,
          model: request.model.model,
          prompt: [basePrompt, variationPrompt].filter(Boolean).join("\n\n"),
          aspectRatio,
          resolution: request.resolution,
          references,
        },
        request.id,
        context.signal,
      );
    });

    const results = await Promise.all(tasks);
    return results.flat();
    } finally {
      await setGenerationKeepAlive(false);
    }
  }

  private async generateSingle(
    input: {
      requestId: string;
      model: string;
      prompt: string;
      aspectRatio: string;
      resolution: ImageGenerationRequest["resolution"];
      references: ServerImageReference[];
    },
    parentRequestId: string,
    signal?: AbortSignal,
  ): Promise<GeneratedImageResult[]> {
    assertNotAborted(signal);
    let images: NativeGeneratedImage[];
    try {
      images = await invoke<NativeGeneratedImage[]>("generate_server_images", {
        input: { ...input, count: 1 },
      });
    } catch (generationError) {
      // Android may suspend the WebView while the native request continues.
      // Recover this individual task instead of retrying a shared parent ID.
      if (signal?.aborted) throw generationError;
      try {
        images = await invoke<NativeGeneratedImage[]>("recover_server_images", {
          input: { requestId: input.requestId, count: 1, maxWaitSeconds: 90 },
        });
      } catch {
        throw generationError;
      }
    }
    assertNotAborted(signal);

    return images.map((image) => ({
      id: createId("generated-result"),
      requestId: parentRequestId,
      uri: image.dataUri,
      mimeType: image.mimeType,
      createdAt: Date.now(),
    }));
  }

  async recover(
    requestId: string,
    count: number,
    options: { maxWaitSeconds?: number } = {},
  ): Promise<GeneratedImageResult[]> {
    assertTauriRuntime();
    await setGenerationKeepAlive(true);
    try {
      const safeCount = Math.min(4, Math.max(1, Math.round(count)));
      const requestIds = safeCount === 1
        ? [requestId]
        : Array.from({ length: safeCount }, (_, index) => `${requestId}-${index + 1}`);
      const images = (await Promise.all(requestIds.map((taskRequestId) => invoke<NativeGeneratedImage[]>("recover_server_images", {
        input: {
          requestId: taskRequestId,
          count: 1,
          maxWaitSeconds: options.maxWaitSeconds ?? 900,
        },
      })))).flat();
      return images.map((image) => ({
        id: createId("generated-result"),
        requestId,
        uri: image.dataUri,
        mimeType: image.mimeType,
        createdAt: Date.now(),
      }));
    } finally {
      await setGenerationKeepAlive(false);
    }
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

function normalizeGatewayAspectRatio(value: string): "1:1" | "3:4" | "4:3" | "9:16" | "16:9" {
  const clean = String(value || "").trim().replace(/[^0-9:]/g, "x");
  if (["1:1", "3:4", "4:3", "9:16", "16:9"].includes(clean)) {
    return clean as "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  }
  const [width, height] = clean.split(/[x:]/).map(Number);
  const target = width > 0 && height > 0 ? width / height : 16 / 9;
  return (["1:1", "3:4", "4:3", "9:16", "16:9"] as const).reduce((best, candidate) => {
    const [bestW, bestH] = best.split(":").map(Number);
    const [candidateW, candidateH] = candidate.split(":").map(Number);
    return Math.abs(candidateW / candidateH - target) < Math.abs(bestW / bestH - target)
      ? candidate
      : best;
  }, "16:9");
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

let keepAliveUsers = 0;

async function setGenerationKeepAlive(active: boolean): Promise<void> {
  if (!isTauri()) return;
  if (active) {
    keepAliveUsers += 1;
    if (keepAliveUsers !== 1) return;
  } else {
    keepAliveUsers = Math.max(0, keepAliveUsers - 1);
    if (keepAliveUsers !== 0) return;
  }
  try {
    await invoke("set_generation_keep_alive", { input: { active } });
  } catch {
    // The resume recovery path still works if the optional native service is unavailable.
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

export type ImageGenerationProvider =
  | "server-gateway"
  | "openai-compatible"
  | "new-api"
  | "xais-chat"
  | "bigmodel"
  | "custom";

export type StandardImageAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageAspectRatio = StandardImageAspectRatio | `${number}x${number}`;
export type ImageResolution = "1k" | "2k" | "4k";

export interface ImageModelConfig {
  provider: ImageGenerationProvider;
  model: string;
  endpoint?: string;
}

export interface ImageGenerationRequest {
  id: string;
  prompt: string;
  inputAssetIds: string[];
  ruleNodeIds?: string[];
  model: ImageModelConfig;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  count: number;
  createdAt: number;
}

export interface GeneratedImageResult {
  id: string;
  requestId: string;
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: number;
}

export type ImageGenerationStatus = "idle" | "queued" | "running" | "success" | "error";

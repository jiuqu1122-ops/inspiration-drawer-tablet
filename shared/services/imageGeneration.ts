import type {
  GeneratedImageResult,
  ImageGenerationRequest,
} from "../types/generation";
import type { ImageAsset } from "../types/media";

export interface ImageGenerationContext {
  inputAssets: ImageAsset[];
  signal?: AbortSignal;
}

export interface ImageGenerationService {
  generate(
    request: ImageGenerationRequest,
    context: ImageGenerationContext,
  ): Promise<GeneratedImageResult[]>;
}

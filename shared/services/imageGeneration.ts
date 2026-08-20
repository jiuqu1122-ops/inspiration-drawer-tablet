import type {
  GeneratedImageResult,
  ImageGenerationRequest,
} from "../types/generation";
import type { ImageAsset } from "../types/media";
import type { ImageRuleState } from "../types/imageRules";

export interface ImageGenerationContext {
  inputAssets: ImageAsset[];
  rules?: ImageRuleState;
  signal?: AbortSignal;
}

export interface ImageGenerationService {
  generate(
    request: ImageGenerationRequest,
    context: ImageGenerationContext,
  ): Promise<GeneratedImageResult[]>;
}

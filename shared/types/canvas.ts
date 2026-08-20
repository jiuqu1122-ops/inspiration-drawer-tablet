import type {
  GeneratedImageResult,
  ImageGenerationRequest,
  ImageGenerationStatus,
} from "./generation";
import type { ImageRulePresetId, ImageRuleState } from "./imageRules";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasViewport extends CanvasPoint {
  scale: number;
}

interface CanvasNodeBase extends CanvasPoint, CanvasSize {
  id: string;
  createdAt: number;
  zIndex: number;
}

export interface CanvasImageNode extends CanvasNodeBase {
  type: "image";
  assetId: string;
  title: string;
}

export interface CanvasGenerationNode extends CanvasNodeBase {
  type: "generation";
  title: string;
  request: ImageGenerationRequest;
  status: ImageGenerationStatus;
  results: GeneratedImageResult[];
  error?: string;
}

export interface CanvasRuleNode extends CanvasNodeBase {
  type: "rule";
  title: string;
  presetId: ImageRulePresetId;
  rules: ImageRuleState;
}

export type CanvasNode = CanvasImageNode | CanvasGenerationNode | CanvasRuleNode;

export interface CanvasProject {
  id: string;
  name: string;
  nodes: CanvasNode[];
  viewport: CanvasViewport;
  createdAt: number;
  updatedAt: number;
}

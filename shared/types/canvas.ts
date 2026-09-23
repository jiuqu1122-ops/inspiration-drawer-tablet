import type {
  GeneratedImageResult,
  GeneratedVideoResult,
  ImageGenerationRequest,
  ImageGenerationStatus,
  VideoGenerationRequest,
  VideoGenerationStatus,
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
  workflowInstanceId?: string;
  workflowTemplateId?: string;
  workflowOrder?: number;
  groupId?: string;
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

export interface CanvasVideoNode extends CanvasNodeBase {
  type: "video";
  title: string;
  request: VideoGenerationRequest;
  status: VideoGenerationStatus;
  results: GeneratedVideoResult[];
  error?: string;
}

export interface CanvasRuleNode extends CanvasNodeBase {
  type: "rule";
  title: string;
  presetId: ImageRulePresetId;
  rules: ImageRuleState;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  title: string;
  prompt: string;
  systemPrompt: string;
  inputNodeIds: string[];
  output: string;
  status: "idle" | "running" | "success" | "error";
  error?: string;
}

export type CanvasNode = CanvasImageNode | CanvasGenerationNode | CanvasVideoNode | CanvasRuleNode | CanvasTextNode;

export interface CanvasProject {
  id: string;
  name: string;
  nodes: CanvasNode[];
  viewport: CanvasViewport;
  createdAt: number;
  updatedAt: number;
}

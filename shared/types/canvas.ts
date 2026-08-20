import type {
  GeneratedImageResult,
  ImageGenerationRequest,
  ImageGenerationStatus,
} from "./generation";

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

export type CanvasNode = CanvasImageNode | CanvasGenerationNode;

export interface CanvasProject {
  id: string;
  name: string;
  nodes: CanvasNode[];
  viewport: CanvasViewport;
  createdAt: number;
  updatedAt: number;
}

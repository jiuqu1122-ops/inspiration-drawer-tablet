import type { ImageAspectRatio, ImageResolution } from "../types/generation";

export interface WorkflowInputSlot {
  id: string;
  label: string;
  type: "image" | "text";
  required: boolean;
  multiple?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  inputSlots: WorkflowInputSlot[];
  nodes: WorkflowNodeDefinition[];
  createdAt: number;
}

export interface CanvasNodePresetDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  aspectRatio: WorkflowImageNodeDefinition["aspectRatio"];
  resolution: WorkflowImageNodeDefinition["resolution"];
  count: number;
  createdAt: number;
}

export interface CanvasTemplateLibraryData {
  workflows: WorkflowDefinition[];
  nodePresets: CanvasNodePresetDefinition[];
  hiddenWorkflowPresetIds?: string[];
}

export type WorkflowNodeDefinition = WorkflowTextNodeDefinition | WorkflowImageNodeDefinition;

interface WorkflowNodeDefinitionBase {
  id: string;
  title: string;
  description: string;
  inputs: string[];
  x: number;
  y: number;
}

export interface WorkflowTextNodeDefinition extends WorkflowNodeDefinitionBase {
  type: "text-llm";
  prompt: string;
  systemPrompt: string;
}

export interface WorkflowImageNodeDefinition extends WorkflowNodeDefinitionBase {
  type: "image-generation";
  prompt: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  count: number;
}

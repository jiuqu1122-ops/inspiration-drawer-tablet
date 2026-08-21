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
  aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  resolution: "1k" | "2k" | "4k";
  count: number;
}

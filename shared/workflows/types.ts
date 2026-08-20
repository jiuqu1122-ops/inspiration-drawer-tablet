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
  createdAt: number;
}

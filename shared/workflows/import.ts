import type { ImageAspectRatio, ImageResolution } from "../types/generation";
import type {
  CanvasNodePresetDefinition,
  WorkflowDefinition,
  WorkflowImageNodeDefinition,
  WorkflowNodeDefinition,
  WorkflowTextNodeDefinition,
} from "./types";

const DEFAULT_TEXT_SYSTEM_PROMPT = [
  "你是 Inspiration Drawer 的图片创作文字 LLM 节点。",
  "根据当前节点指令和上游结果工作，不调用 Agent 或外部工具。",
  "只输出可直接交给下游文字或生图节点使用的内容，不限制题材类型。",
].join("\n");

export interface CanvasTemplateImportResult {
  workflows: WorkflowDefinition[];
  nodePresets: CanvasNodePresetDefinition[];
  convertedTextNodeCount: number;
  skippedNodeCount: number;
}

interface ImportCandidates {
  presets: unknown[];
  workflows: unknown[];
}

interface ImportContext {
  importedAt: number;
  workflowIndex: number;
  presetIndex: number;
}

export function parseCanvasTemplateJson(
  text: string,
  importedAt = Date.now(),
): CanvasTemplateImportResult {
  return importCanvasTemplateValue(JSON.parse(text) as unknown, importedAt);
}

export function importCanvasTemplateValue(
  rawValue: unknown,
  importedAt = Date.now(),
): CanvasTemplateImportResult {
  const candidates = getImportCandidates(rawValue);
  const context: ImportContext = { importedAt, workflowIndex: 0, presetIndex: 0 };
  const nodePresets = candidates.presets
    .map((candidate) => normalizeNodePreset(candidate, context))
    .filter((candidate): candidate is CanvasNodePresetDefinition => Boolean(candidate));

  let convertedTextNodeCount = 0;
  let skippedNodeCount = 0;
  const workflows = candidates.workflows.flatMap((candidate) => {
    const result = normalizeWorkflow(candidate, context);
    if (!result) return [];
    convertedTextNodeCount += result.convertedTextNodeCount;
    skippedNodeCount += result.skippedNodeCount;
    return [result.workflow];
  });

  return { workflows, nodePresets, convertedTextNodeCount, skippedNodeCount };
}

function getImportCandidates(rawValue: unknown): ImportCandidates {
  const result: ImportCandidates = { presets: [], workflows: [] };
  if (Array.isArray(rawValue)) {
    rawValue.forEach((candidate) => classifyCandidate(candidate, result));
    return result;
  }
  if (!isRecord(rawValue)) return result;

  if (
    rawValue.type === "inspiration-drawer-workflow-instance"
    && isRecord(rawValue.workflow)
  ) {
    result.workflows.push(rawValue.workflow);
    return result;
  }

  const isContainer = Array.isArray(rawValue.presets)
    || Array.isArray(rawValue.nodePresets)
    || Array.isArray(rawValue.workflows)
    || isRecord(rawValue.preset)
    || isRecord(rawValue.workflow);
  if (!isContainer) {
    classifyCandidate(rawValue, result);
    return result;
  }

  if (Array.isArray(rawValue.presets)) rawValue.presets.forEach((value) => classifyCandidate(value, result));
  if (Array.isArray(rawValue.nodePresets)) rawValue.nodePresets.forEach((value) => classifyCandidate(value, result));
  if (Array.isArray(rawValue.workflows)) rawValue.workflows.forEach((value) => classifyCandidate(value, result));
  if (isRecord(rawValue.preset)) classifyCandidate(rawValue.preset, result);
  if (isRecord(rawValue.workflow)) classifyCandidate(rawValue.workflow, result);
  return result;
}

function classifyCandidate(value: unknown, result: ImportCandidates) {
  if (!isRecord(value)) return;
  const name = readString(value.label, value.name);
  if (name && typeof value.prompt === "string") result.presets.push(value);
  if (name && Array.isArray(value.nodes)) result.workflows.push(value);
}

function normalizeNodePreset(
  value: unknown,
  context: ImportContext,
): CanvasNodePresetDefinition | null {
  if (!isRecord(value)) return null;
  const name = readString(value.label, value.name).slice(0, 48);
  const prompt = readString(value.prompt).trim();
  if (!name || !prompt) return null;
  const index = context.presetIndex++;
  const sourceId = readString(value.id) || `preset-${index + 1}`;
  return {
    id: `imported-preset-${sanitizeId(sourceId)}`,
    name,
    description: readString(value.hint, value.description).slice(0, 96) || "从桌面端导入的节点预设",
    prompt,
    aspectRatio: normalizeAspectRatio(value.aspectRatio),
    resolution: normalizeResolution(value.resolution),
    count: normalizeCount(value.count),
    createdAt: context.importedAt + index,
  };
}

function normalizeWorkflow(
  value: unknown,
  context: ImportContext,
): {
  workflow: WorkflowDefinition;
  convertedTextNodeCount: number;
  skippedNodeCount: number;
} | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null;
  const name = readString(value.label, value.name).slice(0, 64);
  if (!name) return null;

  const rawNodes = value.nodes;
  const converted = rawNodes
    .map((node, index) => normalizeWorkflowNode(node, index))
    .filter((node): node is WorkflowNodeDefinition => Boolean(node));
  if (converted.length === 0) return null;

  const retainedIds = new Set(converted.map((node) => node.id));
  const nodes = converted.map((node) => ({
    ...node,
    inputs: node.inputs.filter((inputId) => retainedIds.has(inputId) && inputId !== node.id),
  }));
  const workflowIndex = context.workflowIndex++;
  const sourceId = readString(value.id) || `workflow-${workflowIndex + 1}`;
  const inputSlots = collectInputSlots(rawNodes);
  return {
    workflow: {
      id: `imported-workflow-${sanitizeId(sourceId)}-${context.importedAt.toString(36)}-${workflowIndex}`,
      name,
      description: readString(value.hint, value.description).slice(0, 120) || "从桌面端导入的工作流",
      inputSlots,
      nodes,
      createdAt: context.importedAt + workflowIndex,
    },
    convertedTextNodeCount: nodes.filter((node) => node.type === "text-llm").length,
    skippedNodeCount: Math.max(0, rawNodes.length - nodes.length),
  };
}

function normalizeWorkflowNode(value: unknown, index: number): WorkflowNodeDefinition | null {
  if (!isRecord(value)) return null;
  if (value.type === "image-generation") return normalizeTabletImageNode(value, index);
  if (value.type === "text-llm") return normalizeTabletTextNode(value, index);

  const item = isRecord(value.item) ? value.item : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  const id = readString(value.id) || `node-${index + 1}`;
  const title = readString(item.name, ai.presetLabel, value.title) || `节点 ${index + 1}`;
  const description = readString(item.remark, value.description).slice(0, 120);
  const inputs = readStringArray(value.inputs);

  if (ai.type === "image-generator") {
    return {
      id,
      type: "image-generation",
      title,
      description: description || "桌面端生图节点",
      prompt: readString(ai.presetPrompt, ai.prompt, item.content, title),
      inputs,
      x: readNumber(value.x, index * 430),
      y: readNumber(value.y, 0),
      aspectRatio: normalizeAspectRatio(ai.aspectRatio),
      resolution: normalizeResolution(ai.resolution),
      count: normalizeCount(ai.count),
    } satisfies WorkflowImageNodeDefinition;
  }

  const isExecutableText = item.type === "text"
    && value.fixedInput !== true
    && (value.textMode === "agent" || value.outputType === "text");
  if (!isExecutableText) return null;
  const prompt = readString(item.content, value.prompt).trim();
  if (!prompt) return null;
  return {
    id,
    type: "text-llm",
    title,
    description: description || "已从桌面文字节点转换为通用 LLM 节点",
    prompt,
    systemPrompt: readString(value.systemPrompt) || DEFAULT_TEXT_SYSTEM_PROMPT,
    inputs,
    x: readNumber(value.x, index * 430),
    y: readNumber(value.y, 0),
  } satisfies WorkflowTextNodeDefinition;
}

function normalizeTabletImageNode(
  value: Record<string, unknown>,
  index: number,
): WorkflowImageNodeDefinition | null {
  const prompt = readString(value.prompt).trim();
  if (!prompt) return null;
  return {
    id: readString(value.id) || `image-node-${index + 1}`,
    type: "image-generation",
    title: readString(value.title) || `生图节点 ${index + 1}`,
    description: readString(value.description).slice(0, 120),
    prompt,
    inputs: readStringArray(value.inputs),
    x: readNumber(value.x, index * 430),
    y: readNumber(value.y, 0),
    aspectRatio: normalizeAspectRatio(value.aspectRatio),
    resolution: normalizeResolution(value.resolution),
    count: normalizeCount(value.count),
  };
}

function normalizeTabletTextNode(
  value: Record<string, unknown>,
  index: number,
): WorkflowTextNodeDefinition | null {
  const prompt = readString(value.prompt).trim();
  if (!prompt) return null;
  return {
    id: readString(value.id) || `text-node-${index + 1}`,
    type: "text-llm",
    title: readString(value.title) || `文字 LLM ${index + 1}`,
    description: readString(value.description).slice(0, 120),
    prompt,
    systemPrompt: readString(value.systemPrompt) || DEFAULT_TEXT_SYSTEM_PROMPT,
    inputs: readStringArray(value.inputs),
    x: readNumber(value.x, index * 430),
    y: readNumber(value.y, 0),
  };
}

function collectInputSlots(rawNodes: unknown[]) {
  return rawNodes.flatMap((value, index) => {
    if (!isRecord(value) || value.acceptsExternalInputs !== true) return [];
    const item = isRecord(value.item) ? value.item : {};
    const types = readStringArray(value.externalInputTypes);
    const type = types.includes("image") || item.type === "image" ? "image" as const : "text" as const;
    return [{
      id: readString(value.id) || `input-${index + 1}`,
      label: readString(item.name) || (type === "image" ? "参考图片" : "文字输入"),
      type,
      required: false,
      multiple: value.outputType === "image[]",
    }];
  });
}

function normalizeAspectRatio(value: unknown): ImageAspectRatio {
  const normalized = readString(value).replace("×", "x");
  if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(normalized)) {
    const supported = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (supported.includes(normalized)) return normalized as ImageAspectRatio;
    const [width, height] = normalized.split(":").map(Number);
    const target = width / height;
    return supported.reduce((best, option) => {
      const [bestWidth, bestHeight] = best.split(":").map(Number);
      const [optionWidth, optionHeight] = option.split(":").map(Number);
      return Math.abs(optionWidth / optionHeight - target) < Math.abs(bestWidth / bestHeight - target)
        ? option
        : best;
    }, "16:9") as ImageAspectRatio;
  }
  if (/^\d+x\d+$/i.test(normalized)) return normalized.toLowerCase() as ImageAspectRatio;
  return "16:9";
}

function normalizeResolution(value: unknown): ImageResolution {
  const normalized = readString(value).toLowerCase();
  return normalized === "1k" || normalized === "4k" ? normalized : "2k";
}

function normalizeCount(value: unknown): number {
  const count = Math.round(Number(value) || 1);
  return Math.min(4, Math.max(1, count));
}

function readString(...values: unknown[]): string {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((candidate) => String(candidate ?? "").trim()).filter(Boolean))]
    : [];
}

function readNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "template";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

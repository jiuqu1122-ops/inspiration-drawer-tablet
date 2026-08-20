import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasGenerationNode,
  CanvasImageNode,
  CanvasNode,
  CanvasPoint,
  CanvasProject,
  CanvasRuleNode,
  CanvasViewport,
  GeneratedImageResult,
  ImageAsset,
  ImageGenerationRequest,
  ImageRulePresetId,
  ImageRuleState,
} from "../../shared";
import {
  getImageModelPreset,
  IMAGE_RULE_PRESETS,
  isImageModelPresetId,
  mergeImageRuleStates,
  normalizeImageAspectRatio,
} from "../../shared";
import { CanvasToolDock } from "../components/CanvasToolDock";
import { ResourceRail, type ResourceSection } from "../components/ResourceRail";
import { TopBar } from "../components/TopBar";
import {
  CanvasStage,
  type CanvasAssetView,
  type GenerationNodeUpdate,
} from "../features/canvas/CanvasStage";
import { readDeviceImage } from "../features/inspiration/readDeviceImages";
import { TauriImageGenerationService } from "../services/tauriImageGenerationService";
import { tabletStorage } from "../storage/indexedDbStorageService";
import { createId } from "../utils/id";

const DEFAULT_PROJECT_ID = "tablet-local-project";
const DEFAULT_PROJECT_NAME = "未命名工业设计项目";
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
const MANAGED_IMAGE_MODEL = {
  provider: "server-gateway" as const,
  model: "nano-banana-pro",
};

interface WorkbenchNotice {
  tone: "neutral" | "success" | "error";
  message: string;
}

export function TabletWorkbench() {
  const [resourceSection, setResourceSection] = useState<ResourceSection>("materials");
  const [isResourceDrawerOpen, setIsResourceDrawerOpen] = useState(false);
  const [assets, setAssets] = useState<CanvasAssetView[]>([]);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(DEFAULT_PROJECT_ID);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [notice, setNotice] = useState<WorkbenchNotice>();
  const [isImporting, setIsImporting] = useState(false);
  const [optimizingNodeIds, setOptimizingNodeIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);
  const nodesRef = useRef<CanvasNode[]>([]);
  const projectsRef = useRef<CanvasProject[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkbench() {
      try {
        const [projects, storedAssets] = await Promise.all([
          tabletStorage.listProjects(),
          tabletStorage.listImageAssets(),
        ]);
        const assetResults = await Promise.allSettled(
          storedAssets.map(async (asset) => ({
            asset,
            displayUri: await tabletStorage.resolveDisplayUri(asset),
          })),
        );

        if (cancelled) {
          return;
        }

        const project = projects.find((candidate) => candidate.id === DEFAULT_PROJECT_ID) ?? projects[0];
        const initialProject = project ?? createBlankProject(DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME);
        if (!project) {
          await tabletStorage.saveProject(initialProject);
        }
        setAssets(
          assetResults
            .filter((result): result is PromiseFulfilledResult<CanvasAssetView> => result.status === "fulfilled")
            .map((result) => result.value),
        );
        setProjects(project ? projects : [initialProject]);
        setActiveProjectId(initialProject.id);
        setNodes(initialProject.nodes.map(normalizeStoredNode));
        setViewport(initialProject.viewport);
        hydratedRef.current = true;
      } catch (error) {
        setNotice({ tone: "error", message: getErrorMessage(error, "无法读取本地项目") });
        hydratedRef.current = true;
      }
    }

    void hydrateWorkbench();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const now = Date.now();
      const existing = projectsRef.current.find((project) => project.id === activeProjectId);
      const project: CanvasProject = {
        id: activeProjectId,
        name: existing?.name ?? DEFAULT_PROJECT_NAME,
        nodes,
        viewport,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      void tabletStorage.saveProject(project)
        .then(() => setProjects((current) => upsertProject(current, project)))
        .catch((error) => {
          setNotice({ tone: "error", message: getErrorMessage(error, "画布保存失败") });
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [activeProjectId, nodes, viewport]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(undefined), notice.tone === "error" ? 5200 : 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const requestImageImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDeviceImages = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    setIsImporting(true);
    setNotice({ tone: "neutral", message: "正在把图片保存到应用沙盒" });

    try {
      const imported = await Promise.all(
        [...files].map(async (file) => {
          const pending = await readDeviceImage(file);
          try {
            const asset = await tabletStorage.importDeviceImage(pending.input);
            return {
              asset,
              displayUri: await tabletStorage.resolveDisplayUri(asset),
            } satisfies CanvasAssetView;
          } finally {
            pending.release();
          }
        }),
      );

      setAssets((current) => [...imported.slice().reverse(), ...current]);
      setNodes((current) => {
        const center = getViewportCenter(viewport);
        const appended = imported.map((entry, index) =>
          createImageNode(entry.asset, current.length + index, {
            x: center.x - 360 + index * 34,
            y: center.y - 170 + index * 30,
          }),
        );
        setSelectedNodeId(appended[appended.length - 1]?.id);
        return [...current, ...appended];
      });
      setResourceSection("materials");
      setIsResourceDrawerOpen(true);
      setNotice({ tone: "success", message: `已导入 ${imported.length} 张图片到画布` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "图片导入失败") });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const addAssetToCanvas = (assetId: string) => {
    const existing = nodes.find((node) => node.type === "image" && node.assetId === assetId);
    if (existing) {
      setSelectedNodeId(existing.id);
      setIsResourceDrawerOpen(false);
      return;
    }
    const asset = assets.find((entry) => entry.asset.id === assetId)?.asset;
    if (!asset) {
      return;
    }
    const center = getViewportCenter(viewport);
    const node = createImageNode(asset, nodes.length, {
      x: center.x - 160,
      y: center.y - 120,
    });
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setIsResourceDrawerOpen(false);
  };

  const removeDeviceAsset = async (assetId: string) => {
    const entry = assets.find((candidate) => candidate.asset.id === assetId);
    if (!entry || entry.asset.source !== "device") {
      return;
    }
    if (!window.confirm(`确定移除设备素材“${entry.asset.name}”吗？所有项目中的对应画布节点和连线也会移除。`)) {
      return;
    }
    try {
      const currentNodes = removeAssetReferences(nodesRef.current, assetId);
      const nextProjects = projectsRef.current.map((project) => ({
        ...project,
        nodes: project.id === activeProjectId
          ? currentNodes
          : removeAssetReferences(project.nodes, assetId),
        updatedAt: Date.now(),
      }));
      await tabletStorage.removeImageAsset(assetId);
      await Promise.all(nextProjects.map((project) => tabletStorage.saveProject(project)));
      setAssets((current) => current.filter((candidate) => candidate.asset.id !== assetId));
      setNodes(currentNodes);
      setProjects(nextProjects);
      setSelectedNodeId((current) => current && currentNodes.some((node) => node.id === current) ? current : undefined);
      setNotice({ tone: "success", message: "设备素材及其画布引用已移除" });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "移除设备素材失败") });
    }
  };

  const saveActiveProject = async () => {
    const existing = projectsRef.current.find((project) => project.id === activeProjectId);
    const now = Date.now();
    const snapshot: CanvasProject = {
      id: activeProjectId,
      name: existing?.name ?? DEFAULT_PROJECT_NAME,
      nodes: nodesRef.current,
      viewport,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await tabletStorage.saveProject(snapshot);
    setProjects((current) => upsertProject(current, snapshot));
    return snapshot;
  };

  const createProject = async () => {
    try {
      await saveActiveProject();
      const nextNumber = projectsRef.current.length + 1;
      const project = createBlankProject(
        createId("tablet-project"),
        nextNumber === 1 ? DEFAULT_PROJECT_NAME : `未命名工业设计项目 ${nextNumber}`,
      );
      await tabletStorage.saveProject(project);
      setProjects((current) => [...current, project]);
      setActiveProjectId(project.id);
      setNodes([]);
      setViewport(DEFAULT_VIEWPORT);
      setSelectedNodeId(undefined);
      setNotice({ tone: "success", message: `已创建“${project.name}”` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "新建项目失败") });
    }
  };

  const selectProject = async (projectId: string) => {
    if (projectId === activeProjectId) {
      return;
    }
    const target = projectsRef.current.find((project) => project.id === projectId);
    if (!target) {
      return;
    }
    try {
      await saveActiveProject();
      setActiveProjectId(target.id);
      setNodes(target.nodes.map(normalizeStoredNode));
      setViewport(target.viewport);
      setSelectedNodeId(undefined);
      setIsResourceDrawerOpen(false);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "切换项目失败") });
    }
  };

  const addGenerationNode = () => {
    const center = getViewportCenter(viewport);
    const request: ImageGenerationRequest = {
      id: createId("generation-request"),
      prompt: "",
      inputAssetIds: [],
      model: MANAGED_IMAGE_MODEL,
      aspectRatio: "16:9",
      resolution: "2k",
      count: 4,
      createdAt: Date.now(),
    };
    const generationNode = createGenerationNode(request, nodes.length, {
      x: center.x - 186,
      y: center.y - 250,
    });
    setNodes((current) => [...current, generationNode]);
    setSelectedNodeId(generationNode.id);
    setIsResourceDrawerOpen(false);
    setNotice({ tone: "neutral", message: "已创建生图节点，在节点内描述设计任务即可运行" });
  };

  const addRuleNode = () => {
    const center = getViewportCenter(viewport);
    const preset = IMAGE_RULE_PRESETS[0];
    const node = createRuleNode(preset.id, preset.name, preset.rules, nodes.length, {
      x: center.x - 410,
      y: center.y - 190,
    });
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setIsResourceDrawerOpen(false);
    setNotice({ tone: "neutral", message: "已创建规则节点，从右侧输出点拖到生图节点即可应用" });
  };

  const updateGenerationNode = (nodeId: string, update: GenerationNodeUpdate) => {
    setNodes((current) => current.map((node) =>
      node.id === nodeId && node.type === "generation"
        ? { ...node, request: { ...node.request, ...update } }
        : node,
    ));
  };

  const updateRuleNode = (
    nodeId: string,
    presetId: ImageRulePresetId,
    rules: ImageRuleState,
  ) => {
    const preset = IMAGE_RULE_PRESETS.find((candidate) => candidate.id === presetId);
    setNodes((current) => current.map((node) =>
      node.id === nodeId && node.type === "rule"
        ? { ...node, presetId, title: preset?.name ?? node.title, rules }
        : node,
    ));
  };

  const optimizeGenerationPrompt = async (nodeId: string) => {
    const sourceNode = nodes.find((node): node is CanvasGenerationNode => node.id === nodeId && node.type === "generation");
    const originalPrompt = sourceNode?.request.prompt.trim() ?? "";
    if (!sourceNode || !originalPrompt) {
      setNotice({ tone: "error", message: "请先输入需要优化的提示词" });
      return;
    }
    setOptimizingNodeIds((current) => new Set(current).add(nodeId));
    setNotice({ tone: "neutral", message: "正在按工业设计任务优化提示词" });
    try {
      const optimizedPrompt = await new TauriImageGenerationService().optimizePrompt(originalPrompt);
      if (!optimizedPrompt.trim()) {
        throw new Error("服务端没有返回可用的优化结果");
      }
      const currentNode = nodesRef.current.find(
        (node): node is CanvasGenerationNode => node.id === nodeId && node.type === "generation",
      );
      if (!currentNode || currentNode.request.prompt.trim() !== originalPrompt) {
        setNotice({ tone: "neutral", message: "提示词已被修改，未覆盖当前内容" });
      } else {
        setNodes((current) => current.map((node) => (
          node.id === nodeId && node.type === "generation"
            ? { ...node, request: { ...node.request, prompt: optimizedPrompt.trim() } }
            : node
        )));
        setNotice({ tone: "success", message: "提示词已优化" });
      }
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "提示词优化失败") });
    } finally {
      setOptimizingNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const runGenerationNode = async (nodeId: string) => {
    const sourceNode = nodes.find((node): node is CanvasGenerationNode => node.id === nodeId && node.type === "generation");
    if (!sourceNode) {
      return;
    }
    const cleanPrompt = sourceNode.request.prompt.trim();
    if (!cleanPrompt) {
      setNotice({ tone: "error", message: "请先在生图节点中描述产品设计任务" });
      return;
    }

    const request: ImageGenerationRequest = {
      ...sourceNode.request,
      id: createId("generation-request"),
      prompt: cleanPrompt,
      createdAt: Date.now(),
    };
    setNodes((current) => current.map((node) =>
      node.id === nodeId && node.type === "generation"
        ? { ...node, request, status: "running", error: undefined }
        : node,
    ));
    setSelectedNodeId(nodeId);
    setNotice({ tone: "neutral", message: "正在生成产品概念图" });

    try {
      const inputAssets = request.inputAssetIds
        .map((assetId) => assets.find((entry) => entry.asset.id === assetId))
        .map((entry) => entry ? { ...entry.asset, uri: entry.displayUri } : undefined)
        .filter((asset): asset is ImageAsset => Boolean(asset));
      const rules = mergeImageRuleStates(...(request.ruleNodeIds ?? [])
        .map((ruleNodeId) => nodes.find((node): node is CanvasRuleNode => node.id === ruleNodeId && node.type === "rule")?.rules));
      const service = new TauriImageGenerationService();
      const results = await service.generate(request, { inputAssets, rules });
      const savedEntries = await Promise.all(results.map(async (result, index) => {
        const asset = await tabletStorage.saveGeneratedImage(
          createGeneratedAsset(result, request, index),
        );
        return {
          asset,
          displayUri: await tabletStorage.resolveDisplayUri(asset),
        } satisfies CanvasAssetView;
      }));
      const storedResults: GeneratedImageResult[] = savedEntries.map(({ asset }) => ({
        id: asset.id,
        requestId: request.id,
        uri: asset.uri,
        mimeType: asset.mimeType,
        width: asset.dimensions?.width,
        height: asset.dimensions?.height,
        createdAt: asset.createdAt,
      }));

      setAssets((current) => [...savedEntries.slice().reverse(), ...current]);
      setNodes((current) => current.map((node) =>
        node.id === nodeId && node.type === "generation"
          ? { ...node, status: "success", results: storedResults, error: undefined }
          : node,
      ));
      setNotice({ tone: "success", message: `已生成 ${storedResults.length} 张图片并保存到素材库` });
    } catch (error) {
      const message = getErrorMessage(error, "图片生成失败");
      setNodes((current) => current.map((node) =>
        node.id === nodeId && node.type === "generation"
          ? { ...node, status: "error", error: message }
          : node,
      ));
      setNotice({ tone: "error", message });
    }
  };

  const connectNodes = (sourceNodeId: string, targetNodeId: string) => {
    const source = nodes.find((node) => node.id === sourceNodeId);
    if (!source || source.type === "generation") {
      return;
    }
    setNodes((current) => current.map((node) => {
      if (node.id !== targetNodeId || node.type !== "generation") {
        return node;
      }
      if (source.type === "image") {
        if (node.request.inputAssetIds.includes(source.assetId)) return node;
        return {
          ...node,
          request: { ...node.request, inputAssetIds: [...node.request.inputAssetIds, source.assetId] },
        };
      }
      if ((node.request.ruleNodeIds ?? []).includes(source.id)) return node;
      return {
        ...node,
        request: { ...node.request, ruleNodeIds: [...(node.request.ruleNodeIds ?? []), source.id] },
      };
    }));
    setSelectedNodeId(targetNodeId);
    setNotice({ tone: "success", message: source.type === "image" ? "参考图片已连接到生图节点" : "图像规则已连接到生图节点" });
  };

  const disconnectReference = (targetNodeId: string, assetId: string) => {
    setNodes((current) => current.map((node) =>
      node.id === targetNodeId && node.type === "generation"
        ? {
            ...node,
            request: {
              ...node.request,
              inputAssetIds: node.request.inputAssetIds.filter((candidate) => candidate !== assetId),
            },
          }
        : node,
    ));
  };

  const disconnectRule = (targetNodeId: string, ruleNodeId: string) => {
    setNodes((current) => current.map((node) =>
      node.id === targetNodeId && node.type === "generation"
        ? { ...node, request: { ...node.request, ruleNodeIds: (node.request.ruleNodeIds ?? []).filter((candidate) => candidate !== ruleNodeId) } }
        : node,
    ));
  };

  const removeNode = (nodeId: string) => {
    setNodes((current) => {
      const removed = current.find((node) => node.id === nodeId);
      return current
        .filter((node) => node.id !== nodeId)
        .map((node) => {
          if (node.type !== "generation") return node;
          if (removed?.type === "image") {
            return { ...node, request: { ...node.request, inputAssetIds: node.request.inputAssetIds.filter((assetId) => assetId !== removed.assetId) } };
          }
          if (removed?.type === "rule") {
            return { ...node, request: { ...node.request, ruleNodeIds: (node.request.ruleNodeIds ?? []).filter((ruleNodeId) => ruleNodeId !== removed.id) } };
          }
          return node;
        });
    });
    setSelectedNodeId(undefined);
  };

  const runSelectedGeneration = () => {
    const selected = nodes.find((node): node is CanvasGenerationNode => node.id === selectedNodeId && node.type === "generation");
    const fallback = [...nodes].reverse().find((node): node is CanvasGenerationNode => node.type === "generation");
    const target = selected ?? fallback;
    if (target) {
      void runGenerationNode(target.id);
    }
  };

  const arrangeCanvas = () => {
    let imageIndex = 0;
    let ruleIndex = 0;
    let generationIndex = 0;
    setNodes((current) => current.map((node) => {
      if (node.type === "image") {
        const index = imageIndex++;
        return {
          ...node,
          x: 96 + (index % 2) * 380,
          y: 96 + Math.floor(index / 2) * 330,
          zIndex: index + 1,
        };
      }
      if (node.type === "rule") {
        const index = ruleIndex++;
        return {
          ...node,
          x: 560 + (index % 2) * 330,
          y: 96 + Math.floor(index / 2) * 370,
          zIndex: imageIndex + index + 10,
        };
      }
      const index = generationIndex++;
      return {
        ...node,
        x: 930 + (index % 2) * 430,
        y: 84 + Math.floor(index / 2) * 550,
        zIndex: imageIndex + index + 20,
      };
    }));
    setViewport({ x: 78, y: 56, scale: 0.72 });
    setNotice({ tone: "success", message: "已按素材与生图节点整理画布" });
  };

  const canRunGeneration = nodes.some((node) => node.type === "generation" && node.status !== "running");
  const activeProject = projects.find((project) => project.id === activeProjectId);

  return (
    <main className="tablet-app">
      <TopBar
        projectName={activeProject?.name ?? DEFAULT_PROJECT_NAME}
        zoom={Math.round(viewport.scale * 100)}
        isImporting={isImporting}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
        onProjectsOpen={() => {
          setResourceSection("projects");
          setIsResourceDrawerOpen(true);
        }}
      />
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => void handleDeviceImages(event.currentTarget.files)}
      />

      <section className="canvas-shell" aria-label="设计画布">
        <CanvasStage
          nodes={nodes}
          assets={assets}
          viewport={viewport}
          selectedNodeId={selectedNodeId}
          optimizingNodeIds={optimizingNodeIds}
          onImportRequest={requestImageImport}
          onGenerateRequest={addGenerationNode}
          onViewportChange={setViewport}
          onNodeMove={(nodeId, point) => {
            setNodes((current) => current.map((node) =>
              node.id === nodeId ? { ...node, ...point } : node,
            ));
          }}
          onNodeRemove={removeNode}
          onSelectNode={setSelectedNodeId}
          onGenerationChange={updateGenerationNode}
          onRuleNodeChange={updateRuleNode}
          onOptimizePrompt={(nodeId) => void optimizeGenerationPrompt(nodeId)}
          onRunGeneration={(nodeId) => void runGenerationNode(nodeId)}
          onConnect={connectNodes}
          onDisconnectReference={disconnectReference}
          onDisconnectRule={disconnectRule}
        />
      </section>

      <ResourceRail
        active={resourceSection}
        isOpen={isResourceDrawerOpen}
        assets={assets}
        projects={projects}
        activeProjectId={activeProjectId}
        onAssetSelect={addAssetToCanvas}
        onAssetRemove={(assetId) => void removeDeviceAsset(assetId)}
        onProjectCreate={() => void createProject()}
        onProjectSelect={(projectId) => void selectProject(projectId)}
        onChange={setResourceSection}
        onOpenChange={setIsResourceDrawerOpen}
        onImport={requestImageImport}
      />

      <CanvasToolDock
        canRun={canRunGeneration}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
        onAddRules={addRuleNode}
        onRun={runSelectedGeneration}
        onArrange={arrangeCanvas}
        onWorkflow={() => setNotice({ tone: "neutral", message: "工作流将在节点基础能力完成后接入" })}
      />

      {notice && (
        <div className={`workbench-notice is-${notice.tone}`} role="status" aria-live="polite">
          {notice.message}
        </div>
      )}
    </main>
  );
}

function createImageNode(asset: ImageAsset, index: number, point: CanvasPoint): CanvasImageNode {
  const size = fitCanvasSize(asset);
  return {
    id: createId("canvas-image"),
    type: "image",
    assetId: asset.id,
    title: asset.name.replace(/\.[^/.]+$/, ""),
    x: point.x,
    y: point.y,
    width: size.width,
    height: size.height,
    zIndex: index + 1,
    createdAt: Date.now() + index,
  };
}

function createBlankProject(id: string, name: string): CanvasProject {
  const now = Date.now();
  return {
    id,
    name,
    nodes: [],
    viewport: DEFAULT_VIEWPORT,
    createdAt: now,
    updatedAt: now,
  };
}

function upsertProject(projects: CanvasProject[], project: CanvasProject): CanvasProject[] {
  const index = projects.findIndex((candidate) => candidate.id === project.id);
  if (index < 0) {
    return [...projects, project];
  }
  return projects.map((candidate) => candidate.id === project.id ? project : candidate);
}

function removeAssetReferences(nodes: CanvasNode[], assetId: string): CanvasNode[] {
  return nodes
    .filter((node) => node.type !== "image" || node.assetId !== assetId)
    .map((node) => {
      if (node.type !== "generation") {
        return node;
      }
      return {
        ...node,
        request: {
          ...node.request,
          inputAssetIds: node.request.inputAssetIds.filter((candidate) => candidate !== assetId),
        },
        results: node.results.filter((result) => result.id !== assetId),
      };
    });
}

function createGenerationNode(
  request: ImageGenerationRequest,
  index: number,
  point: CanvasPoint,
): CanvasGenerationNode {
  return {
    id: createId("canvas-generation"),
    type: "generation",
    title: "AI 产品概念图",
    request,
    status: "idle",
    results: [],
    x: point.x,
    y: point.y,
    width: 372,
    height: 574,
    zIndex: index + 1,
    createdAt: Date.now(),
  };
}

function createRuleNode(
  presetId: ImageRulePresetId,
  title: string,
  rules: ImageRuleState,
  index: number,
  point: CanvasPoint,
): CanvasRuleNode {
  return {
    id: createId("canvas-rule"),
    type: "rule",
    title,
    presetId,
    rules: { ...rules },
    x: point.x,
    y: point.y,
    width: 292,
    height: 342,
    zIndex: index + 1,
    createdAt: Date.now(),
  };
}

function normalizeStoredNode(node: CanvasNode): CanvasNode {
  if (node.type === "image") {
    return node;
  }
  if (node.type === "rule") {
    return { ...node, width: 292, height: 342 };
  }
  const modelId = isImageModelPresetId(node.request.model.model)
    ? node.request.model.model
    : "nano-banana-pro";
  const preset = getImageModelPreset(modelId);
  return {
    ...node,
    width: 372,
    height: 574,
    status: node.status === "running" ? "idle" : node.status,
    request: {
      ...node.request,
      model: { provider: "server-gateway", model: preset.id },
      resolution: preset.resolutions.includes(node.request.resolution) ? node.request.resolution : preset.defaultResolution,
      aspectRatio: normalizeImageAspectRatio(
        preset.id,
        preset.resolutions.includes(node.request.resolution)
          ? node.request.resolution
          : preset.defaultResolution,
        node.request.aspectRatio,
      ),
      ruleNodeIds: node.request.ruleNodeIds ?? [],
    },
  };
}

function createGeneratedAsset(
  result: GeneratedImageResult,
  request: ImageGenerationRequest,
  index: number,
): ImageAsset {
  const dimensions = generationPixelSize(request.aspectRatio);
  return {
    id: result.id,
    kind: "image",
    name: `AI 产品概念图 ${index + 1}.png`,
    mimeType: result.mimeType,
    storageKind: "memory",
    uri: result.uri,
    dimensions,
    createdAt: result.createdAt,
    source: "generated",
  };
}

function getViewportCenter(viewport: CanvasViewport): CanvasPoint {
  return {
    x: (window.innerWidth / 2 - viewport.x) / viewport.scale,
    y: ((window.innerHeight - 52) / 2 - viewport.y) / viewport.scale,
  };
}

function generationPixelSize(aspectRatio: ImageGenerationRequest["aspectRatio"]) {
  const [rawWidth, rawHeight] = String(aspectRatio).split(/[x×:]/).map(Number);
  if (!rawWidth || !rawHeight) {
    return { width: 1024, height: 1024 };
  }
  if (String(aspectRatio).includes("x") || String(aspectRatio).includes("×")) {
    return { width: rawWidth, height: rawHeight };
  }
  const ratio = rawWidth / rawHeight;
  return ratio >= 1
    ? { width: 1536, height: Math.round(1536 / ratio) }
    : { width: Math.round(1536 * ratio), height: 1536 };
}

function fitCanvasSize(asset: ImageAsset) {
  const sourceWidth = asset.dimensions?.width ?? 320;
  const sourceHeight = asset.dimensions?.height ?? 240;
  const ratio = Math.min(360 / sourceWidth, 280 / sourceHeight, 1);
  return {
    width: Math.max(120, Math.round(sourceWidth * ratio)),
    height: Math.max(90, Math.round(sourceHeight * ratio)),
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

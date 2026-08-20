import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasGenerationNode,
  CanvasImageNode,
  CanvasNode,
  CanvasPoint,
  CanvasProject,
  CanvasViewport,
  GeneratedImageResult,
  ImageAsset,
  ImageGenerationRequest,
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
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
const MANAGED_IMAGE_MODEL = {
  provider: "openai-compatible" as const,
  model: "managed-image",
};

interface WorkbenchNotice {
  tone: "neutral" | "success" | "error";
  message: string;
}

export function TabletWorkbench() {
  const [resourceSection, setResourceSection] = useState<ResourceSection>("materials");
  const [isResourceDrawerOpen, setIsResourceDrawerOpen] = useState(false);
  const [assets, setAssets] = useState<CanvasAssetView[]>([]);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [notice, setNotice] = useState<WorkbenchNotice>();
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);

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

        const project = projects.find((candidate) => candidate.id === DEFAULT_PROJECT_ID);
        setAssets(
          assetResults
            .filter((result): result is PromiseFulfilledResult<CanvasAssetView> => result.status === "fulfilled")
            .map((result) => result.value),
        );
        if (project) {
          setNodes(project.nodes.map(normalizeStoredNode));
          setViewport(project.viewport);
        }
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
      const project: CanvasProject = {
        id: DEFAULT_PROJECT_ID,
        name: "未命名工业设计项目",
        nodes,
        viewport,
        createdAt: now,
        updatedAt: now,
      };
      void tabletStorage.saveProject(project).catch((error) => {
        setNotice({ tone: "error", message: getErrorMessage(error, "画布保存失败") });
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [nodes, viewport]);

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

  const addGenerationNode = () => {
    const center = getViewportCenter(viewport);
    const request: ImageGenerationRequest = {
      id: createId("generation-request"),
      prompt: "",
      inputAssetIds: [],
      model: MANAGED_IMAGE_MODEL,
      aspectRatio: "1:1",
      resolution: "1k",
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

  const updateGenerationNode = (nodeId: string, update: GenerationNodeUpdate) => {
    setNodes((current) => current.map((node) =>
      node.id === nodeId && node.type === "generation"
        ? { ...node, request: { ...node.request, ...update } }
        : node,
    ));
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
        .map((assetId) => assets.find((entry) => entry.asset.id === assetId)?.asset)
        .filter((asset): asset is ImageAsset => Boolean(asset));
      const service = new TauriImageGenerationService();
      const results = await service.generate(request, { inputAssets });
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
    const source = nodes.find((node): node is CanvasImageNode => node.id === sourceNodeId && node.type === "image");
    if (!source) {
      return;
    }
    setNodes((current) => current.map((node) => {
      if (node.id !== targetNodeId || node.type !== "generation" || node.request.inputAssetIds.includes(source.assetId)) {
        return node;
      }
      return {
        ...node,
        request: {
          ...node.request,
          inputAssetIds: [...node.request.inputAssetIds, source.assetId],
        },
      };
    }));
    setSelectedNodeId(targetNodeId);
    setNotice({ tone: "success", message: "参考图片已连接到生图节点" });
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

  const removeNode = (nodeId: string) => {
    setNodes((current) => {
      const removed = current.find((node) => node.id === nodeId);
      return current
        .filter((node) => node.id !== nodeId)
        .map((node) => removed?.type === "image" && node.type === "generation"
          ? {
              ...node,
              request: {
                ...node.request,
                inputAssetIds: node.request.inputAssetIds.filter((assetId) => assetId !== removed.assetId),
              },
            }
          : node);
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

  return (
    <main className="tablet-app">
      <TopBar
        zoom={Math.round(viewport.scale * 100)}
        isImporting={isImporting}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
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
          onRunGeneration={(nodeId) => void runGenerationNode(nodeId)}
          onConnect={connectNodes}
          onDisconnectReference={disconnectReference}
        />
      </section>

      <ResourceRail
        active={resourceSection}
        isOpen={isResourceDrawerOpen}
        assets={assets}
        onAssetSelect={addAssetToCanvas}
        onChange={setResourceSection}
        onOpenChange={setIsResourceDrawerOpen}
        onImport={requestImageImport}
      />

      <CanvasToolDock
        canRun={canRunGeneration}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
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
    height: 506,
    zIndex: index + 1,
    createdAt: Date.now(),
  };
}

function normalizeStoredNode(node: CanvasNode): CanvasNode {
  if (node.type === "image") {
    return node;
  }
  return {
    ...node,
    width: 372,
    height: 506,
    status: node.status === "running" ? "idle" : node.status,
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
  if (aspectRatio === "4:3" || aspectRatio === "16:9") {
    return { width: 1536, height: 1024 };
  }
  if (aspectRatio === "3:4" || aspectRatio === "9:16") {
    return { width: 1024, height: 1536 };
  }
  return { width: 1024, height: 1024 };
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

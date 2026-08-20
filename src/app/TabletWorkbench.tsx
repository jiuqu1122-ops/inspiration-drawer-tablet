import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasGenerationNode,
  CanvasImageNode,
  CanvasNode,
  CanvasProject,
  CanvasViewport,
  GeneratedImageResult,
  ImageAsset,
  ImageGenerationRequest,
} from "../../shared";
import {
  AssistantPanel,
  type AssistantTab,
  type GenerationSettings,
} from "../components/AssistantPanel";
import { ResourceRail, type ResourceSection } from "../components/ResourceRail";
import { TopBar } from "../components/TopBar";
import {
  CanvasStage,
  type CanvasAssetView,
} from "../features/canvas/CanvasStage";
import { readDeviceImage } from "../features/inspiration/readDeviceImages";
import { TauriImageGenerationService } from "../services/tauriImageGenerationService";
import { tabletStorage } from "../storage/indexedDbStorageService";
import { createId } from "../utils/id";

const DEFAULT_PROJECT_ID = "tablet-local-project";
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  aspectRatio: "1:1",
  resolution: "1k",
  count: 1,
};

interface WorkbenchNotice {
  tone: "neutral" | "success" | "error";
  message: string;
}

export function TabletWorkbench() {
  const [resourceSection, setResourceSection] = useState<ResourceSection>("materials");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("prompt");
  const [prompt, setPrompt] = useState("");
  const [generationSettings, setGenerationSettings] = useState(DEFAULT_GENERATION_SETTINGS);
  const [assets, setAssets] = useState<CanvasAssetView[]>([]);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [notice, setNotice] = useState<WorkbenchNotice>();
  const [isImporting, setIsImporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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
          setNodes(project.nodes);
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

      setAssets((current) => [...imported.reverse(), ...current]);
      setNodes((current) => {
        const appended = imported.map((entry, index) =>
          createImageNode(entry.asset, current.length + index),
        );
        setSelectedNodeId(appended[appended.length - 1]?.id);
        return [...current, ...appended];
      });
      setResourceSection("materials");
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
    const existing = nodes.find((node) =>
      node.type === "image"
        ? node.assetId === assetId
        : node.results.some((result) => result.id === assetId),
    );
    if (existing) {
      setSelectedNodeId(existing.id);
      return;
    }
    const asset = assets.find((entry) => entry.asset.id === assetId)?.asset;
    if (!asset) {
      return;
    }
    const node = createImageNode(asset, nodes.length);
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
  };

  const openGenerationPrompt = () => {
    setAssistantTab("prompt");
    setNotice({ tone: "neutral", message: "描述产品概念后即可创建生成任务" });
  };

  const generateImage = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setNotice({ tone: "error", message: "请先输入产品设计描述" });
      return;
    }
    if (!generationSettings.endpoint.trim() || !generationSettings.model.trim() || !generationSettings.apiKey.trim()) {
      setNotice({ tone: "error", message: "请先完成模型、接口地址和 API Key 配置" });
      return;
    }

    const request: ImageGenerationRequest = {
      id: createId("generation-request"),
      prompt: cleanPrompt,
      inputAssetIds: [],
      model: {
        provider: "openai-compatible",
        endpoint: generationSettings.endpoint.trim(),
        model: generationSettings.model.trim(),
      },
      aspectRatio: generationSettings.aspectRatio,
      resolution: generationSettings.resolution,
      count: generationSettings.count,
      createdAt: Date.now(),
    };
    const generationNode = createGenerationNode(request, nodes.length);
    setNodes((current) => [...current, generationNode]);
    setSelectedNodeId(generationNode.id);
    setIsGenerating(true);
    setNotice({ tone: "neutral", message: "正在生成产品概念图" });

    try {
      const service = new TauriImageGenerationService(generationSettings.apiKey);
      const results = await service.generate(request, { inputAssets: [] });
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

      setAssets((current) => [...savedEntries.reverse(), ...current]);
      setNodes((current) => current.map((node) =>
        node.id === generationNode.id && node.type === "generation"
          ? { ...node, status: "success", results: storedResults }
          : node,
      ));
      setResourceSection("materials");
      setNotice({ tone: "success", message: `已生成 ${storedResults.length} 张图片并保存到沙盒` });
    } catch (error) {
      const message = getErrorMessage(error, "图片生成失败");
      setNodes((current) => current.map((node) =>
        node.id === generationNode.id && node.type === "generation"
          ? { ...node, status: "error", error: message }
          : node,
      ));
      setNotice({ tone: "error", message });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="tablet-app">
      <TopBar
        zoom={Math.round(viewport.scale * 100)}
        isImporting={isImporting}
        onImport={requestImageImport}
        onGenerate={openGenerationPrompt}
      />
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => void handleDeviceImages(event.currentTarget.files)}
      />
      <div className="workbench">
        <ResourceRail
          active={resourceSection}
          assets={assets}
          onAssetSelect={addAssetToCanvas}
          onChange={setResourceSection}
          onImport={requestImageImport}
        />

        <section className="canvas-shell" aria-label="设计画布">
          <CanvasStage
            nodes={nodes}
            assets={assets}
            viewport={viewport}
            selectedNodeId={selectedNodeId}
            onImportRequest={requestImageImport}
            onGenerateRequest={openGenerationPrompt}
            onViewportChange={setViewport}
            onNodeMove={(nodeId, point) => {
              setNodes((current) => current.map((node) =>
                node.id === nodeId ? { ...node, ...point } : node,
              ));
            }}
            onNodeRemove={(nodeId) => {
              setNodes((current) => current.filter((node) => node.id !== nodeId));
              setSelectedNodeId(undefined);
            }}
            onSelectNode={setSelectedNodeId}
          />
        </section>

        <AssistantPanel
          activeTab={assistantTab}
          onTabChange={setAssistantTab}
          prompt={prompt}
          onPromptChange={setPrompt}
          settings={generationSettings}
          onSettingsChange={setGenerationSettings}
          isGenerating={isGenerating}
          onGenerate={() => void generateImage()}
        />
      </div>

      {notice && (
        <div className={`workbench-notice is-${notice.tone}`} role="status" aria-live="polite">
          {notice.message}
        </div>
      )}
    </main>
  );
}

function createImageNode(asset: ImageAsset, index: number): CanvasImageNode {
  const size = fitCanvasSize(asset);
  return {
    id: createId("canvas-image"),
    type: "image",
    assetId: asset.id,
    title: asset.name.replace(/\.[^/.]+$/, ""),
    x: 64 + (index % 3) * 54,
    y: 64 + (index % 4) * 42,
    width: size.width,
    height: size.height,
    zIndex: index + 1,
    createdAt: Date.now() + index,
  };
}

function createGenerationNode(
  request: ImageGenerationRequest,
  index: number,
): CanvasGenerationNode {
  const size = generationCanvasSize(request.aspectRatio);
  return {
    id: createId("canvas-generation"),
    type: "generation",
    title: "AI 产品概念图",
    request,
    status: "running",
    results: [],
    x: 72 + (index % 3) * 48,
    y: 72 + (index % 4) * 38,
    width: size.width,
    height: size.height,
    zIndex: index + 1,
    createdAt: Date.now(),
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

function generationCanvasSize(aspectRatio: ImageGenerationRequest["aspectRatio"]) {
  if (aspectRatio === "4:3" || aspectRatio === "16:9") {
    return { width: 360, height: 240 };
  }
  if (aspectRatio === "3:4" || aspectRatio === "9:16") {
    return { width: 220, height: 300 };
  }
  return { width: 280, height: 280 };
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
  return error instanceof Error ? error.message : fallback;
}

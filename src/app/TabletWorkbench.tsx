import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CanvasImageNode,
  CanvasProject,
  CanvasViewport,
  ImageAsset,
} from "../../shared";
import { AssistantPanel, type AssistantTab } from "../components/AssistantPanel";
import { ResourceRail, type ResourceSection } from "../components/ResourceRail";
import { TopBar } from "../components/TopBar";
import {
  CanvasStage,
  type CanvasAssetView,
} from "../features/canvas/CanvasStage";
import { readDeviceImage } from "../features/inspiration/readDeviceImages";
import { tabletStorage } from "../storage/indexedDbStorageService";
import { createId } from "../utils/id";

const DEFAULT_PROJECT_ID = "tablet-local-project";
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };

interface WorkbenchNotice {
  tone: "neutral" | "success" | "error";
  message: string;
}

export function TabletWorkbench() {
  const [resourceSection, setResourceSection] = useState<ResourceSection>("materials");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("prompt");
  const [prompt, setPrompt] = useState("");
  const [assets, setAssets] = useState<CanvasAssetView[]>([]);
  const [nodes, setNodes] = useState<CanvasImageNode[]>([]);
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
          setNodes(project.nodes.filter((node): node is CanvasImageNode => node.type === "image"));
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
    const existing = nodes.find((node) => node.assetId === assetId);
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

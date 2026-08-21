import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  CanvasNodePresetDefinition,
  CanvasGenerationNode,
  CanvasImageNode,
  CanvasNode,
  CanvasPoint,
  CanvasProject,
  CanvasRuleNode,
  CanvasTextNode,
  CanvasViewport,
  GeneratedImageResult,
  ImageAsset,
  ImageGenerationRequest,
  ImageRulePresetId,
  ImageRuleState,
  WorkflowDefinition,
} from "../../shared";
import {
  getImageModelPreset,
  IMAGE_RULE_PRESETS,
  parseCanvasTemplateJson,
  isImageModelPresetId,
  mergeImageRuleStates,
  normalizeImageAspectRatio,
  TABLET_WORKFLOW_PRESETS,
} from "../../shared";
import { CanvasToolDock } from "../components/CanvasToolDock";
import { AccountDialog } from "../components/AccountDialog";
import { ResourceRail, type ResourceSection } from "../components/ResourceRail";
import { TopBar } from "../components/TopBar";
import {
  CanvasStage,
  type CanvasAssetView,
  type GenerationNodeUpdate,
} from "../features/canvas/CanvasStage";
import { readDeviceImage } from "../features/inspiration/readDeviceImages";
import { WorkflowLibrary } from "../features/workflow/WorkflowLibrary";
import { TabletUpdateDialog } from "../features/app-update/TabletUpdateDialog";
import { TauriImageGenerationService } from "../services/tauriImageGenerationService";
import { generateTextWithServer } from "../services/tauriTextGenerationService";
import {
  getServerSession,
  type ServerSession,
} from "../services/tauriServerSessionService";
import {
  checkTabletUpdate,
  getTabletVersion,
  installTabletUpdate,
  type TabletUpdateInfo,
  type TabletUpdateProgress,
} from "../services/tabletUpdateService";
import { tabletStorage } from "../storage/indexedDbStorageService";
import { createId } from "../utils/id";

const DEFAULT_PROJECT_ID = "tablet-local-project";
const DEFAULT_PROJECT_NAME = "未命名工业设计项目";
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
const MANAGED_IMAGE_MODEL = {
  provider: "server-gateway" as const,
  model: "nano-banana-pro",
};
const THEME_STORAGE_KEY = "inspiration-drawer-tablet-theme";
const UPDATE_CHECK_STORAGE_KEY = "inspiration-drawer-tablet-update-checked-at";
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

type ThemeMode = "system" | "light" | "dark";

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
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [isWorkflowLibraryOpen, setIsWorkflowLibraryOpen] = useState(false);
  const [isTemplateImporting, setIsTemplateImporting] = useState(false);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowDefinition[]>([]);
  const [nodePresets, setNodePresets] = useState<CanvasNodePresetDefinition[]>([]);
  const [hiddenWorkflowPresetIds, setHiddenWorkflowPresetIds] = useState<string[]>([]);
  const [serverSession, setServerSession] = useState<ServerSession>({ authenticated: false });
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [availableUpdate, setAvailableUpdate] = useState<TabletUpdateInfo>();
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState<string>();
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [systemDarkMode, setSystemDarkMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [optimizingNodeIds, setOptimizingNodeIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);
  const assetsRef = useRef<CanvasAssetView[]>([]);
  const nodesRef = useRef<CanvasNode[]>([]);
  const projectsRef = useRef<CanvasProject[]>([]);
  const runningNodeIdsRef = useRef<Set<string>>(new Set());

  const updateNodesState = useCallback((updater: (current: CanvasNode[]) => CanvasNode[]) => {
    setNodes((current) => {
      const next = updater(current);
      nodesRef.current = next;
      return next;
    });
  }, []);

  const updateAssetsState = useCallback((updater: (current: CanvasAssetView[]) => CanvasAssetView[]) => {
    setAssets((current) => {
      const next = updater(current);
      assetsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemDarkMode(event.matches);
    setSystemDarkMode(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    void getTabletVersion().then(setAppVersion).catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void listen<TabletUpdateProgress>("tablet-update-progress", (event) => {
      const progress = event.payload;
      setUpdateProgress(progress.progress);
      setUpdateMessage(progress.stage === "verified"
        ? "安全校验通过，正在打开系统安装器"
        : `正在下载更新 ${progress.progress}%`);
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  const checkForTabletUpdate = useCallback(async (silent = false) => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const result = await checkTabletUpdate();
      setAvailableUpdate(result.available ? result : undefined);
      if (result.available) {
        setUpdateMessage(undefined);
        setUpdateProgress(0);
        setIsUpdateDialogOpen(true);
      } else if (!silent) {
        setNotice({ tone: "success", message: `当前已是最新版本 ${result.currentVersion}` });
      }
    } catch (error) {
      if (!silent) {
        setNotice({ tone: "error", message: getErrorMessage(error, "检查更新失败") });
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [isCheckingUpdate]);

  useEffect(() => {
    const lastCheckedAt = Number(window.localStorage.getItem(UPDATE_CHECK_STORAGE_KEY) ?? 0);
    const elapsed = Number.isFinite(lastCheckedAt) ? Date.now() - lastCheckedAt : UPDATE_CHECK_INTERVAL_MS;
    const delay = lastCheckedAt > 0
      ? Math.max(1_000, UPDATE_CHECK_INTERVAL_MS - elapsed)
      : 15_000;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, String(Date.now()));
      void checkForTabletUpdate(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [checkForTabletUpdate]);

  const beginTabletUpdate = async () => {
    if (!availableUpdate || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateProgress(0);
    setUpdateMessage("正在准备更新包");
    try {
      const result = await installTabletUpdate(availableUpdate.version);
      if (result.permissionRequired) {
        setUpdateMessage("请允许“安装未知应用”，返回后再次点击下载并安装");
      } else if (result.installerLaunched) {
        setUpdateProgress(100);
        setUpdateMessage("系统安装器已打开，请确认升级");
      }
    } catch (error) {
      const message = getErrorMessage(error, "安装更新失败");
      setUpdateMessage(message);
      setNotice({ tone: "error", message });
    } finally {
      setIsInstallingUpdate(false);
    }
  };

  const isDarkMode = themeMode === "dark" || (themeMode === "system" && systemDarkMode);

  useEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? "dark" : "light";
    document.documentElement.style.colorScheme = isDarkMode ? "dark" : "light";
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    void getServerSession()
      .then((session) => {
        if (!cancelled) setServerSession(session);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkbench() {
      try {
        const [projects, storedAssets, templateLibrary] = await Promise.all([
          tabletStorage.listProjects(),
          tabletStorage.listImageAssets(),
          tabletStorage.loadCanvasTemplateLibrary(),
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
        setCustomWorkflows(templateLibrary.workflows);
        setNodePresets(templateLibrary.nodePresets);
        setHiddenWorkflowPresetIds(templateLibrary.hiddenWorkflowPresetIds ?? []);
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

  const renameProject = async (projectId: string, requestedName: string) => {
    const name = requestedName.trim().slice(0, 48);
    const target = projectsRef.current.find((project) => project.id === projectId);
    if (!target || !name || name === target.name) return;
    const renamed: CanvasProject = {
      ...target,
      name,
      nodes: projectId === activeProjectId ? nodesRef.current : target.nodes,
      viewport: projectId === activeProjectId ? viewport : target.viewport,
      updatedAt: Date.now(),
    };
    try {
      await tabletStorage.saveProject(renamed);
      setProjects((current) => upsertProject(current, renamed));
      setNotice({ tone: "success", message: `项目已重命名为“${name}”` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "项目重命名失败") });
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

  const addTextNode = () => {
    const center = getViewportCenter(viewport);
    const node = createTextNode("文字 LLM", nodes.length, {
      x: center.x - 180,
      y: center.y - 210,
    });
    updateNodesState((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setNotice({ tone: "neutral", message: "已创建文字 LLM 节点，可连接到生图或下一个文字节点" });
  };

  const addWorkflowToCanvas = (workflow: WorkflowDefinition) => {
    const center = getViewportCenter(viewport);
    const workflowNodes = instantiateWorkflow(workflow, nodes.length, {
      x: center.x - 340,
      y: center.y - 260,
    });
    updateNodesState((current) => [...current, ...workflowNodes]);
    setSelectedNodeId(workflowNodes[0]?.id);
    setIsWorkflowLibraryOpen(false);
    setNotice({ tone: "success", message: `已添加工作流“${workflow.name}”，选择其中任一节点后可整组运行` });
  };

  const addNodePresetToCanvas = (preset: CanvasNodePresetDefinition) => {
    const center = getViewportCenter(viewport);
    const model = getImageModelPreset(MANAGED_IMAGE_MODEL.model);
    const resolution = model.resolutions.includes(preset.resolution)
      ? preset.resolution
      : model.defaultResolution;
    const request: ImageGenerationRequest = {
      id: createId("generation-request"),
      prompt: preset.prompt,
      inputAssetIds: [],
      model: MANAGED_IMAGE_MODEL,
      aspectRatio: normalizeImageAspectRatio(model.id, resolution, preset.aspectRatio),
      resolution,
      count: Math.min(4, Math.max(1, Math.round(preset.count))),
      createdAt: Date.now(),
    };
    const node = {
      ...createGenerationNode(request, nodesRef.current.length, {
        x: center.x - 186,
        y: center.y - 250,
      }),
      title: preset.name,
    };
    updateNodesState((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setIsWorkflowLibraryOpen(false);
    setNotice({ tone: "success", message: `已添加节点预设“${preset.name}”` });
  };

  const importCanvasTemplates = async (files: FileList | null) => {
    if (!files?.length || isTemplateImporting) return;
    setIsTemplateImporting(true);
    setNotice({ tone: "neutral", message: "正在解析桌面端 JSON 模板" });
    try {
      const importedWorkflows: WorkflowDefinition[] = [];
      const importedPresets: CanvasNodePresetDefinition[] = [];
      let convertedTextNodeCount = 0;
      let skippedNodeCount = 0;
      let failedCount = 0;

      for (const [index, file] of [...files].entries()) {
        try {
          const result = parseCanvasTemplateJson(await file.text(), Date.now() + index);
          importedWorkflows.push(...result.workflows);
          importedPresets.push(...result.nodePresets);
          convertedTextNodeCount += result.convertedTextNodeCount;
          skippedNodeCount += result.skippedNodeCount;
        } catch (error) {
          failedCount += 1;
          console.warn(`JSON 模板读取失败：${file.name}`, error);
        }
      }

      if (importedWorkflows.length === 0 && importedPresets.length === 0) {
        throw new Error(failedCount > 0 ? "JSON 文件读取失败或格式无效" : "没有识别到工作流或节点预设");
      }
      const nextWorkflows = mergeTemplates(customWorkflows, importedWorkflows, 48);
      const nextPresets = mergeTemplates(nodePresets, importedPresets, 48);
      await tabletStorage.saveCanvasTemplateLibrary({
        workflows: nextWorkflows,
        nodePresets: nextPresets,
        hiddenWorkflowPresetIds,
      });
      setCustomWorkflows(nextWorkflows);
      setNodePresets(nextPresets);
      const details = [
        `${importedWorkflows.length} 个工作流`,
        `${importedPresets.length} 个节点预设`,
        convertedTextNodeCount > 0 ? `${convertedTextNodeCount} 个文字步骤已转为 LLM` : "",
        skippedNodeCount > 0 ? `${skippedNodeCount} 个不兼容节点已忽略` : "",
        failedCount > 0 ? `${failedCount} 个文件失败` : "",
      ].filter(Boolean).join("、");
      setNotice({ tone: "success", message: `导入完成：${details}` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "JSON 模板导入失败") });
    } finally {
      setIsTemplateImporting(false);
    }
  };

  const removeWorkflowTemplate = async (workflow: WorkflowDefinition) => {
    if (!window.confirm(`删除工作流“${workflow.name}”？已添加到画布的节点不会受影响。`)) return;
    const isBuiltIn = TABLET_WORKFLOW_PRESETS.some((preset) => preset.id === workflow.id);
    const nextWorkflows = isBuiltIn
      ? customWorkflows
      : customWorkflows.filter((candidate) => candidate.id !== workflow.id);
    const nextHiddenIds = isBuiltIn
      ? [...new Set([...hiddenWorkflowPresetIds, workflow.id])]
      : hiddenWorkflowPresetIds;
    try {
      await tabletStorage.saveCanvasTemplateLibrary({
        workflows: nextWorkflows,
        nodePresets,
        hiddenWorkflowPresetIds: nextHiddenIds,
      });
      setCustomWorkflows(nextWorkflows);
      setHiddenWorkflowPresetIds(nextHiddenIds);
      setNotice({ tone: "success", message: `已从模板库删除工作流“${workflow.name}”` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "删除工作流失败") });
    }
  };

  const removeNodePresetTemplate = async (preset: CanvasNodePresetDefinition) => {
    if (!window.confirm(`删除节点预设“${preset.name}”？已添加到画布的节点不会受影响。`)) return;
    const nextPresets = nodePresets.filter((candidate) => candidate.id !== preset.id);
    try {
      await tabletStorage.saveCanvasTemplateLibrary({
        workflows: customWorkflows,
        nodePresets: nextPresets,
        hiddenWorkflowPresetIds,
      });
      setNodePresets(nextPresets);
      setNotice({ tone: "success", message: `已删除节点预设“${preset.name}”` });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error, "删除节点预设失败") });
    }
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

  const updateTextNode = (nodeId: string, update: Partial<Pick<CanvasTextNode, "prompt" | "systemPrompt">>) => {
    updateNodesState((current) => current.map((node) => (
      node.id === nodeId && node.type === "text" ? { ...node, ...update } : node
    )));
  };

  const optimizeGenerationPrompt = async (nodeId: string) => {
    const sourceNode = nodesRef.current.find((node): node is CanvasGenerationNode => node.id === nodeId && node.type === "generation");
    const originalPrompt = sourceNode?.request.prompt.trim() ?? "";
    if (!sourceNode || !originalPrompt) {
      setNotice({ tone: "error", message: "请先输入需要优化的提示词" });
      return false;
    }
    if (!serverSession.authenticated) {
      setIsAccountDialogOpen(true);
      setNotice({ tone: "neutral", message: "请先登录已绑定额度的邮箱，再优化提示词" });
      return false;
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

  const runTextNode = async (nodeId: string, quiet = false): Promise<boolean> => {
    const sourceNode = nodesRef.current.find((node): node is CanvasTextNode => node.id === nodeId && node.type === "text");
    if (!sourceNode || !sourceNode.prompt.trim()) return false;
    if (runningNodeIdsRef.current.has(nodeId)) return false;
    if (!serverSession.authenticated) {
      setIsAccountDialogOpen(true);
      setNotice({ tone: "neutral", message: "请先登录同一邮箱账号，再运行文字 LLM 节点" });
      return false;
    }
    runningNodeIdsRef.current.add(nodeId);
    const context = sourceNode.inputNodeIds.flatMap((inputNodeId) => {
      const inputNode = nodesRef.current.find((node) => node.id === inputNodeId);
      if (inputNode?.type === "text" && inputNode.output.trim()) {
        return [`${inputNode.title}：\n${inputNode.output.trim()}`];
      }
      if (inputNode?.type === "generation" && inputNode.results.length > 0) {
        return [`${inputNode.title}已生成 ${inputNode.results.length} 张图。节点指令：\n${inputNode.request.prompt}`];
      }
      return [];
    });
    updateNodesState((current) => current.map((node) => (
      node.id === nodeId && node.type === "text"
        ? { ...node, status: "running", error: undefined }
        : node
    )));
    if (!quiet) setNotice({ tone: "neutral", message: `正在运行文字 LLM：${sourceNode.title}` });
    try {
      const output = await generateTextWithServer({
        requestId: createId("tablet-text-llm"),
        prompt: sourceNode.prompt,
        systemPrompt: sourceNode.systemPrompt,
        context,
      });
      updateNodesState((current) => current.map((node) => (
        node.id === nodeId && node.type === "text"
          ? { ...node, status: "success", output, error: undefined }
          : node
      )));
      if (!quiet) setNotice({ tone: "success", message: `文字 LLM“${sourceNode.title}”已完成` });
      void getServerSession().then(setServerSession).catch(() => undefined);
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "文字 LLM 节点运行失败");
      updateNodesState((current) => current.map((node) => (
        node.id === nodeId && node.type === "text"
          ? { ...node, status: "error", error: message }
          : node
      )));
      setNotice({ tone: "error", message });
      return false;
    } finally {
      runningNodeIdsRef.current.delete(nodeId);
    }
  };

  const runGenerationNode = async (nodeId: string, quiet = false): Promise<boolean> => {
    const sourceNode = nodesRef.current.find((node): node is CanvasGenerationNode => node.id === nodeId && node.type === "generation");
    if (!sourceNode) {
      return false;
    }
    if (runningNodeIdsRef.current.has(nodeId)) return false;
    const cleanPrompt = sourceNode.request.prompt.trim();
    if (!cleanPrompt) {
      setNotice({ tone: "error", message: "请先在生图节点中描述产品设计任务" });
      return false;
    }
    if (!serverSession.authenticated) {
      setIsAccountDialogOpen(true);
      setNotice({ tone: "neutral", message: "请先登录已绑定额度的邮箱，再运行生图节点" });
      return false;
    }
    runningNodeIdsRef.current.add(nodeId);

    const request: ImageGenerationRequest = {
      ...sourceNode.request,
      id: createId("generation-request"),
      prompt: cleanPrompt,
      createdAt: Date.now(),
    };
    updateNodesState((current) => current.map((node) =>
      node.id === nodeId && node.type === "generation"
        ? { ...node, request, status: "running", error: undefined }
        : node,
    ));
    setSelectedNodeId(nodeId);
    if (!quiet) setNotice({ tone: "neutral", message: `正在运行生图节点：${sourceNode.title}` });

    try {
      const upstreamAssetIds = (request.upstreamNodeIds ?? []).flatMap((upstreamNodeId) => {
        const upstream = nodesRef.current.find((node) => node.id === upstreamNodeId);
        return upstream?.type === "generation" ? upstream.results.map((result) => result.id) : [];
      });
      const textContext = (request.textNodeIds ?? []).flatMap((textNodeId) => {
        const textNode = nodesRef.current.find((node) => node.id === textNodeId);
        return textNode?.type === "text" && textNode.output.trim()
          ? [`上游文字节点“${textNode.title}”：\n${textNode.output.trim()}`]
          : [];
      });
      const executionRequest: ImageGenerationRequest = {
        ...request,
        prompt: [request.prompt, ...textContext].filter(Boolean).join("\n\n"),
        inputAssetIds: Array.from(new Set([...request.inputAssetIds, ...upstreamAssetIds])),
      };
      const inputAssets = executionRequest.inputAssetIds
        .map((assetId) => assetsRef.current.find((entry) => entry.asset.id === assetId))
        .map((entry) => entry ? { ...entry.asset, uri: entry.displayUri } : undefined)
        .filter((asset): asset is ImageAsset => Boolean(asset));
      const rules = mergeImageRuleStates(...(request.ruleNodeIds ?? [])
        .map((ruleNodeId) => nodesRef.current.find((node): node is CanvasRuleNode => node.id === ruleNodeId && node.type === "rule")?.rules));
      const service = new TauriImageGenerationService();
      const results = await service.generate(executionRequest, { inputAssets, rules });
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

      updateAssetsState((current) => [...savedEntries.slice().reverse(), ...current]);
      updateNodesState((current) => current.map((node) =>
        node.id === nodeId && node.type === "generation"
          ? { ...node, status: "success", results: storedResults, error: undefined }
          : node,
      ));
      if (!quiet) setNotice({ tone: "success", message: `已生成 ${storedResults.length} 张图片并保存到素材库` });
      void getServerSession().then(setServerSession).catch(() => undefined);
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "图片生成失败");
      updateNodesState((current) => current.map((node) =>
        node.id === nodeId && node.type === "generation"
          ? { ...node, status: "error", error: message }
          : node,
      ));
      setNotice({ tone: "error", message });
      return false;
    } finally {
      runningNodeIdsRef.current.delete(nodeId);
    }
  };

  const connectNodes = (sourceNodeId: string, targetNodeId: string) => {
    const source = nodesRef.current.find((node) => node.id === sourceNodeId);
    const target = nodesRef.current.find((node) => node.id === targetNodeId);
    if (!source || !target || source.id === target.id) return;
    updateNodesState((current) => current.map((node) => {
      if (node.id !== targetNodeId) return node;
      if (node.type === "text") {
        if ((source.type !== "text" && source.type !== "generation") || node.inputNodeIds.includes(source.id)) return node;
        return { ...node, inputNodeIds: [...node.inputNodeIds, source.id] };
      }
      if (node.type !== "generation") return node;
      if (source.type === "image") {
        if (node.request.inputAssetIds.includes(source.assetId)) return node;
        return { ...node, request: { ...node.request, inputAssetIds: [...node.request.inputAssetIds, source.assetId] } };
      }
      if (source.type === "rule") {
        if ((node.request.ruleNodeIds ?? []).includes(source.id)) return node;
        return { ...node, request: { ...node.request, ruleNodeIds: [...(node.request.ruleNodeIds ?? []), source.id] } };
      }
      if (source.type === "text") {
        if ((node.request.textNodeIds ?? []).includes(source.id)) return node;
        return { ...node, request: { ...node.request, textNodeIds: [...(node.request.textNodeIds ?? []), source.id] } };
      }
      if ((node.request.upstreamNodeIds ?? []).includes(source.id)) return node;
      return { ...node, request: { ...node.request, upstreamNodeIds: [...(node.request.upstreamNodeIds ?? []), source.id] } };
    }));
    setSelectedNodeId(targetNodeId);
    setNotice({ tone: "success", message: `已连接“${source.title}”到“${target.title}”` });
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

  const disconnectNode = (targetNodeId: string, sourceNodeId: string) => {
    updateNodesState((current) => current.map((node) => {
      if (node.id !== targetNodeId) return node;
      if (node.type === "text") {
        return { ...node, inputNodeIds: node.inputNodeIds.filter((candidate) => candidate !== sourceNodeId) };
      }
      if (node.type === "generation") {
        return {
          ...node,
          request: {
            ...node.request,
            upstreamNodeIds: (node.request.upstreamNodeIds ?? []).filter((candidate) => candidate !== sourceNodeId),
            textNodeIds: (node.request.textNodeIds ?? []).filter((candidate) => candidate !== sourceNodeId),
          },
        };
      }
      return node;
    }));
  };

  const removeNode = (nodeId: string) => {
    updateNodesState((current) => {
      const removed = current.find((node) => node.id === nodeId);
      return current
        .filter((node) => node.id !== nodeId)
        .map((node) => {
          if (node.type === "text") {
            return { ...node, inputNodeIds: node.inputNodeIds.filter((candidate) => candidate !== nodeId) };
          }
          if (node.type !== "generation") return node;
          if (removed?.type === "image") {
            return { ...node, request: { ...node.request, inputAssetIds: node.request.inputAssetIds.filter((assetId) => assetId !== removed.assetId) } };
          }
          if (removed?.type === "rule") {
            return { ...node, request: { ...node.request, ruleNodeIds: (node.request.ruleNodeIds ?? []).filter((ruleNodeId) => ruleNodeId !== removed.id) } };
          }
          return {
            ...node,
            request: {
              ...node.request,
              upstreamNodeIds: (node.request.upstreamNodeIds ?? []).filter((candidate) => candidate !== nodeId),
              textNodeIds: (node.request.textNodeIds ?? []).filter((candidate) => candidate !== nodeId),
            },
          };
        });
    });
    setSelectedNodeId(undefined);
  };

  const runWorkflowInstance = async (workflowInstanceId: string) => {
    const workflowNodes = nodesRef.current
      .filter((node) => node.workflowInstanceId === workflowInstanceId && (node.type === "text" || node.type === "generation"))
      .sort((left, right) => (left.workflowOrder ?? 0) - (right.workflowOrder ?? 0));
    if (!workflowNodes.length) return;
    setNotice({ tone: "neutral", message: `正在运行工作流，共 ${workflowNodes.length} 个节点` });
    for (const node of workflowNodes) {
      const completed = node.type === "text"
        ? await runTextNode(node.id, true)
        : await runGenerationNode(node.id, true);
      if (!completed) return;
    }
    setNotice({ tone: "success", message: "工作流已全部运行完成" });
  };

  const runSelectedGeneration = () => {
    const selected = nodesRef.current.find((node) => node.id === selectedNodeId);
    if (selected?.workflowInstanceId) {
      void runWorkflowInstance(selected.workflowInstanceId);
      return;
    }
    if (selected?.type === "text") {
      void runTextNode(selected.id);
      return;
    }
    if (selected?.type === "generation") {
      void runGenerationNode(selected.id);
      return;
    }
    const fallback = [...nodesRef.current].reverse().find((node) => node.type === "generation" || node.type === "text");
    if (fallback?.type === "text") void runTextNode(fallback.id);
    if (fallback?.type === "generation") void runGenerationNode(fallback.id);
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

  const canRunGeneration = nodes.some((node) => (
    (node.type === "generation" || node.type === "text") && node.status !== "running"
  ));
  const activeProject = projects.find((project) => project.id === activeProjectId);

  return (
    <main className="tablet-app">
      <TopBar
        projectName={activeProject?.name ?? DEFAULT_PROJECT_NAME}
        zoom={Math.round(viewport.scale * 100)}
        isImporting={isImporting}
        isDarkMode={isDarkMode}
        session={serverSession}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
        onThemeToggle={() => {
          const nextMode: ThemeMode = isDarkMode ? "light" : "dark";
          window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
          setThemeMode(nextMode);
        }}
        onAccountOpen={() => setIsAccountDialogOpen(true)}
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
          onTextNodeChange={updateTextNode}
          onRunTextNode={(nodeId) => void runTextNode(nodeId)}
          onOptimizePrompt={(nodeId) => void optimizeGenerationPrompt(nodeId)}
          onRunGeneration={(nodeId) => void runGenerationNode(nodeId)}
          onConnect={connectNodes}
          onDisconnectReference={disconnectReference}
          onDisconnectRule={disconnectRule}
          onDisconnectNode={disconnectNode}
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
        onProjectRename={(projectId, name) => void renameProject(projectId, name)}
        onChange={setResourceSection}
        onOpenChange={setIsResourceDrawerOpen}
        onImport={requestImageImport}
      />

      <CanvasToolDock
        canRun={canRunGeneration}
        onImport={requestImageImport}
        onAddGeneration={addGenerationNode}
        onAddRules={addRuleNode}
        onAddText={addTextNode}
        onRun={runSelectedGeneration}
        onArrange={arrangeCanvas}
        onWorkflow={() => setIsWorkflowLibraryOpen(true)}
      />

      <WorkflowLibrary
        open={isWorkflowLibraryOpen}
        workflows={[
          ...TABLET_WORKFLOW_PRESETS.filter((workflow) => !hiddenWorkflowPresetIds.includes(workflow.id)),
          ...customWorkflows,
        ]}
        nodePresets={nodePresets}
        importing={isTemplateImporting}
        onClose={() => setIsWorkflowLibraryOpen(false)}
        onAddWorkflow={addWorkflowToCanvas}
        onAddNodePreset={addNodePresetToCanvas}
        onRemoveWorkflow={(workflow) => void removeWorkflowTemplate(workflow)}
        onRemoveNodePreset={(preset) => void removeNodePresetTemplate(preset)}
        onImport={(files) => void importCanvasTemplates(files)}
      />

      {notice && (
        <div className={`workbench-notice is-${notice.tone}`} role="status" aria-live="polite">
          {notice.message}
        </div>
      )}
      <AccountDialog
        open={isAccountDialogOpen}
        session={serverSession}
        appVersion={appVersion}
        checkingUpdate={isCheckingUpdate}
        onCheckUpdate={() => void checkForTabletUpdate(false)}
        onClose={() => setIsAccountDialogOpen(false)}
        onSessionChange={setServerSession}
      />
      <TabletUpdateDialog
        open={isUpdateDialogOpen}
        update={availableUpdate}
        installing={isInstallingUpdate}
        progress={updateProgress}
        message={updateMessage}
        onClose={() => setIsUpdateDialogOpen(false)}
        onInstall={() => void beginTabletUpdate()}
      />
    </main>
  );
}

function readThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
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

function createTextNode(title: string, index: number, point: CanvasPoint): CanvasTextNode {
  return {
    id: createId("canvas-text-llm"),
    type: "text",
    title,
    prompt: "",
    systemPrompt: "你是 Inspiration Drawer 的工业设计文字 LLM 节点。只输出可直接交付给下游节点的内容。",
    inputNodeIds: [],
    output: "",
    status: "idle",
    x: point.x,
    y: point.y,
    width: 360,
    height: 448,
    zIndex: index + 1,
    createdAt: Date.now(),
  };
}

function instantiateWorkflow(
  workflow: WorkflowDefinition,
  startIndex: number,
  origin: CanvasPoint,
): CanvasNode[] {
  const workflowInstanceId = createId(`workflow-${workflow.id}`);
  const nodeIds = new Map(workflow.nodes.map((definition) => [definition.id, createId(`workflow-node-${definition.id}`)]));
  const definitionsById = new Map(workflow.nodes.map((definition) => [definition.id, definition]));
  return workflow.nodes.map((definition, index): CanvasNode => {
    const id = nodeIds.get(definition.id)!;
    const common = {
      id,
      title: definition.title,
      x: origin.x + definition.x,
      y: origin.y + definition.y,
      zIndex: startIndex + index + 1,
      workflowInstanceId,
      workflowTemplateId: workflow.id,
      workflowOrder: index,
      createdAt: Date.now() + index,
    };
    if (definition.type === "text-llm") {
      return {
        ...common,
        type: "text",
        width: 360,
        height: 448,
        prompt: definition.prompt,
        systemPrompt: definition.systemPrompt,
        inputNodeIds: definition.inputs.map((inputId) => nodeIds.get(inputId)).filter((value): value is string => Boolean(value)),
        output: "",
        status: "idle",
      };
    }
    const textNodeIds = definition.inputs
      .filter((inputId) => definitionsById.get(inputId)?.type === "text-llm")
      .map((inputId) => nodeIds.get(inputId)!)
      .filter(Boolean);
    const upstreamNodeIds = definition.inputs
      .filter((inputId) => definitionsById.get(inputId)?.type === "image-generation")
      .map((inputId) => nodeIds.get(inputId)!)
      .filter(Boolean);
    const model = getImageModelPreset(MANAGED_IMAGE_MODEL.model);
    const resolution = model.resolutions.includes(definition.resolution)
      ? definition.resolution
      : model.defaultResolution;
    return {
      ...common,
      type: "generation",
      width: 372,
      height: 574,
      request: {
        id: createId("generation-request"),
        prompt: definition.prompt,
        inputAssetIds: [],
        upstreamNodeIds,
        textNodeIds,
        ruleNodeIds: [],
        model: MANAGED_IMAGE_MODEL,
        aspectRatio: normalizeImageAspectRatio(model.id, resolution, definition.aspectRatio),
        resolution,
        count: Math.min(4, Math.max(1, Math.round(definition.count))),
        createdAt: Date.now() + index,
      },
      status: "idle",
      results: [],
    };
  });
}

function mergeTemplates<T extends { id: string }>(
  current: T[],
  imported: T[],
  limit: number,
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  imported.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].slice(-limit);
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
  if (node.type === "text") {
    return {
      ...node,
      width: 360,
      height: 448,
      inputNodeIds: node.inputNodeIds ?? [],
      output: node.output ?? "",
      status: node.status === "running" ? "idle" : node.status,
    };
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
      upstreamNodeIds: node.request.upstreamNodeIds ?? [],
      textNodeIds: node.request.textNodeIds ?? [],
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

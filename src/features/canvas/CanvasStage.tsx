import {
  ArrowLeft,
  ArrowRight,
  DotsThree,
  DownloadSimple,
  HandTap,
  ImageSquare,
  Link,
  MagicWand,
  Play,
  Selection,
  ShareNetwork,
  SlidersHorizontal,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  getImageAspectRatioOptions,
  getImageModelPreset,
  IMAGE_MODEL_PRESETS,
  IMAGE_RULE_DEFINITIONS,
  IMAGE_RULE_KEYS,
  IMAGE_RULE_PRESETS,
  normalizeImageAspectRatio,
  type CanvasGenerationNode,
  type CanvasNode,
  type CanvasPoint,
  type CanvasRuleNode,
  type CanvasTextNode,
  type CanvasVideoNode,
  type CanvasViewport,
  type ImageAsset,
  type ImageGenerationRequest,
  type ImageRulePresetId,
  type ImageRuleState,
  type VideoGenerationRequest,
} from "../../../shared";
import { saveImageToGallery, shareImage } from "../../services/tabletMediaService";
import type { ServerImageModelCapabilities } from "../../services/tauriChatService";

export interface CanvasAssetView {
  asset: ImageAsset;
  displayUri: string;
}

export interface CanvasImageModelOption {
  id: string;
  displayName?: string;
  capabilities?: ServerImageModelCapabilities;
}

export interface CanvasVideoModelOption {
  id: string;
  displayName?: string;
  capabilities?: ServerImageModelCapabilities;
}

export type GenerationNodeUpdate = Partial<
  Pick<ImageGenerationRequest, "prompt" | "aspectRatio" | "resolution" | "count" | "model">
>;

export type VideoNodeUpdate = Partial<
  Pick<VideoGenerationRequest, "prompt" | "aspectRatio" | "resolution" | "duration" | "count" | "model" | "inputMode">
>;

interface CanvasStageProps {
  nodes: CanvasNode[];
  assets: CanvasAssetView[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  selectedNodeIds?: ReadonlySet<string>;
  optimizingNodeIds: ReadonlySet<string>;
  onImportRequest: () => void;
  onGenerateRequest: () => void;
  imageModelOptions?: CanvasImageModelOption[];
  videoModelOptions?: CanvasVideoModelOption[];
  defaultImageModel?: string;
  defaultVideoModel?: string;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodeMove: (nodeId: string, point: CanvasPoint) => void;
  onNodesMove?: (moves: Array<{ nodeId: string; point: CanvasPoint }>) => void;
  onNodeRemove: (nodeId: string) => void;
  onNodesRemove?: (nodeIds: string[]) => void;
  onSelectNode: (nodeId?: string) => void;
  onSelectNodes?: (nodeIds: string[]) => void;
  onGroupNodes?: (nodeIds: string[]) => void;
  onGenerationChange: (nodeId: string, update: GenerationNodeUpdate) => void;
  onVideoChange?: (nodeId: string, update: VideoNodeUpdate) => void;
  onRuleNodeChange: (nodeId: string, presetId: ImageRulePresetId, rules: ImageRuleState) => void;
  onTextNodeChange: (nodeId: string, update: Partial<Pick<CanvasTextNode, "prompt" | "systemPrompt">>) => void;
  onRunTextNode: (nodeId: string) => void;
  onOptimizePrompt: (nodeId: string) => void;
  onRunGeneration: (nodeId: string) => void;
  onRunVideo?: (nodeId: string) => void;
  onGeneratedResultSave: (assetId: string) => void;
  onGeneratedResultRemove: (assetId: string) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onDisconnectReference: (targetNodeId: string, assetId: string) => void;
  onDisconnectRule: (targetNodeId: string, ruleNodeId: string) => void;
  onDisconnectNode: (targetNodeId: string, sourceNodeId: string) => void;
}

type Gesture =
  | {
      mode: "pan";
      pointerId: number;
      startPoint: CanvasPoint;
      startViewport: CanvasViewport;
    }
  | {
      mode: "pinch";
      startDistance: number;
      anchorWorld: CanvasPoint;
    }
  | {
      mode: "drag";
      pointerId: number;
      nodeId: string;
      startPoint: CanvasPoint;
      startNode: CanvasPoint;
      currentNode: CanvasPoint;
      selectedNodeIds: string[];
      startNodes: Record<string, CanvasPoint>;
    }
  | {
      mode: "select";
      pointerId: number;
      startPoint: CanvasPoint;
      currentPoint: CanvasPoint;
    }
  | {
      mode: "connect";
      pointerId: number;
      sourceNodeId: string;
      startPoint: CanvasPoint;
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      targetNodeId?: string;
      moved: boolean;
    }
  | {
      mode: "connection-menu";
      pointerId: number;
      startPoint: CanvasPoint;
    };

interface ConnectionDraft {
  sourceNodeId: string;
  start: CanvasPoint;
  current: CanvasPoint;
  targetNodeId?: string;
}

interface ContextMenuState {
  nodeId: string;
  left: number;
  top: number;
  nodeIds: string[];
}

interface ConnectionMenuState {
  sourceNodeId: string;
  targetNodeId: string;
  kind: "image" | "rule" | "text" | "generation";
  left: number;
  top: number;
}

interface ImagePreviewState {
  items: CanvasAssetView[];
  index: number;
  busy: "save" | "share" | undefined;
  error?: string;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const LONG_PRESS_MS = 520;
const CONNECTION_DRAG_THRESHOLD = 8;

export function CanvasStage({
  nodes,
  assets,
  viewport,
  selectedNodeId,
  selectedNodeIds,
  optimizingNodeIds,
  onImportRequest,
  onGenerateRequest,
  imageModelOptions,
  videoModelOptions,
  defaultImageModel,
  defaultVideoModel,
  onViewportChange,
  onNodeMove,
  onNodesMove,
  onNodeRemove,
  onNodesRemove,
  onSelectNode,
  onSelectNodes,
  onGroupNodes,
  onGenerationChange,
  onVideoChange,
  onRuleNodeChange,
  onTextNodeChange,
  onRunTextNode,
  onOptimizePrompt,
  onRunGeneration,
  onRunVideo,
  onGeneratedResultSave,
  onGeneratedResultRemove,
  onConnect,
  onDisconnectReference,
  onDisconnectRule,
  onDisconnectNode,
}: CanvasStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportLayerRef = useRef<HTMLDivElement>(null);
  const connectionLayerRef = useRef<SVGSVGElement>(null);
  const connectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const nodeElementsRef = useRef(new Map<string, HTMLDivElement>());
  const activePointersRef = useRef(new Map<number, CanvasPoint>());
  const gestureRef = useRef<Gesture | undefined>(undefined);
  const liveViewportRef = useRef(viewport);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressOriginRef = useRef<CanvasPoint | undefined>(undefined);
  const connectionPressTimerRef = useRef<number | undefined>(undefined);
  const connectionLayoutFrameRef = useRef<number | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ start: CanvasPoint; current: CanvasPoint }>();
  const [connectionMenu, setConnectionMenu] = useState<ConnectionMenuState>();
  const [connectionSourceId, setConnectionSourceId] = useState<string>();
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>();
  const [connectionLayoutRevision, setConnectionLayoutRevision] = useState(0);
  const [connectionPortPoints, setConnectionPortPoints] = useState<Record<string, {
    start: CanvasPoint;
    end: CanvasPoint;
  }>>({});
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>();

  const assetsById = useMemo(
    () => new Map(assets.map((entry) => [entry.asset.id, entry])),
    [assets],
  );
  const rulesById = useMemo(
    () => new Map(nodes.filter((node): node is CanvasRuleNode => node.type === "rule").map((node) => [node.id, node])),
    [nodes],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const connections = useMemo(() => collectConnections(nodes), [nodes]);

  useEffect(() => {
    setImagePreview((current) => {
      if (!current) return current;
      const items = current.items.filter((item) => assetsById.has(item.asset.id));
      if (!items.length) return undefined;
      return {
        ...current,
        items,
        index: Math.min(current.index, items.length - 1),
      };
    });
  }, [assetsById]);

  const openImagePreview = useCallback((items: CanvasAssetView[], index: number) => {
    setImagePreview({ items, index, busy: undefined });
  }, []);

  const runImagePreviewAction = useCallback(async (action: "save" | "share") => {
    if (!imagePreview) return;
    const current = imagePreview.items[imagePreview.index];
    if (!current) return;
    setImagePreview((state) => state ? { ...state, busy: action, error: undefined } : state);
    try {
      const fileName = current.asset.name || `inspiration-drawer-${current.asset.id}.jpg`;
      if (action === "save") {
        await saveImageToGallery(current.displayUri, fileName, current.asset.mimeType);
      } else {
        await shareImage(current.displayUri, fileName, current.asset.mimeType);
      }
      setImagePreview((state) => state ? { ...state, busy: undefined } : state);
    } catch (error) {
      setImagePreview((state) => state ? {
        ...state,
        busy: undefined,
        error: error instanceof Error ? error.message : "操作失败",
      } : state);
    }
  }, [imagePreview]);

  const refreshConnectionLayout = useCallback(() => {
    if (connectionLayoutFrameRef.current !== undefined) return;
    connectionLayoutFrameRef.current = window.requestAnimationFrame(() => {
      connectionLayoutFrameRef.current = undefined;
      setConnectionLayoutRevision((revision) => revision + 1);
    });
  }, []);

  const applyViewport = useCallback((next: CanvasViewport) => {
    liveViewportRef.current = next;
    if (viewportLayerRef.current) {
      viewportLayerRef.current.style.transform =
        `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    }
    if (connectionLayerRef.current) {
      const inverseScale = 1 / Math.max(next.scale, MIN_SCALE);
      connectionLayerRef.current.style.transformOrigin = "0 0";
      connectionLayerRef.current.style.transform =
        `matrix(${inverseScale}, 0, 0, ${inverseScale}, ${-next.x * inverseScale}, ${-next.y * inverseScale})`;
    }
    // The CSS transform is applied imperatively during a gesture and in an
    // effect after React renders. Re-measure ports after it is on the layer so
    // SVG connection points cannot retain a previous device/viewport matrix.
    refreshConnectionLayout();
  }, [refreshConnectionLayout]);

  useEffect(() => {
    applyViewport(viewport);
  }, [applyViewport, viewport]);

  useEffect(() => () => {
    window.clearTimeout(longPressTimerRef.current);
    window.clearTimeout(connectionPressTimerRef.current);
    if (connectionLayoutFrameRef.current !== undefined) {
      window.cancelAnimationFrame(connectionLayoutFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    refreshConnectionLayout();
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(refreshConnectionLayout);
    if (stageRef.current) observer?.observe(stageRef.current);
    nodeElementsRef.current.forEach((element) => observer?.observe(element));
    window.addEventListener("resize", refreshConnectionLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refreshConnectionLayout);
    };
  }, [nodes, refreshConnectionLayout]);

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
  }, []);

  const clearConnectionPress = useCallback(() => {
    window.clearTimeout(connectionPressTimerRef.current);
    connectionPressTimerRef.current = undefined;
  }, []);

  const getStagePointFromClient = (clientX: number, clientY: number): CanvasPoint => {
    const bounds = stageRef.current?.getBoundingClientRect();
    return {
      x: clientX - (bounds?.left ?? 0),
      y: clientY - (bounds?.top ?? 0),
    };
  };

  const getStagePoint = (event: ReactPointerEvent<HTMLDivElement>): CanvasPoint => (
    getStagePointFromClient(event.clientX, event.clientY)
  );

  const worldToStage = (point: CanvasPoint): CanvasPoint => {
    const current = liveViewportRef.current;
    return {
      x: point.x * current.scale + current.x,
      y: point.y * current.scale + current.y,
    };
  };

  const getPortStagePoint = useCallback((
    node: CanvasNode,
    selector: ".output-port" | ".input-port",
    fallback: CanvasPoint,
  ): CanvasPoint => {
    const nodeElement = nodeElementsRef.current.get(node.id);
    const portElement = nodeElement?.querySelector<HTMLElement>(selector);
    if (!nodeElement || !portElement) return fallback;
    const stageBounds = stageRef.current?.getBoundingClientRect();
    const portBounds = portElement.getBoundingClientRect();
    if (!stageBounds || portBounds.width <= 0 || portBounds.height <= 0) return fallback;
    // Store points in stage/screen coordinates. The SVG is rendered outside
    // the transformed node layer, so these are the exact same coordinates the
    // user sees on the device regardless of WebView scale or DPR.
    return {
      x: portBounds.left + portBounds.width / 2 - stageBounds.left,
      y: portBounds.top + portBounds.height / 2 - stageBounds.top,
    };
  }, []);

  useLayoutEffect(() => {
    const nextPoints = Object.fromEntries(connections.map((connection) => [
      connection.key,
      {
        start: getPortStagePoint(
          connection.source,
          ".output-port",
          worldToStage(getOutputPoint(connection.source)),
        ),
        end: getPortStagePoint(
          connection.target,
          ".input-port",
          worldToStage(getInputPoint(connection.target)),
        ),
      },
    ]));
    setConnectionPortPoints(nextPoints);
  }, [connections, connectionLayoutRevision, getPortStagePoint, viewport.scale]);

  const renderedConnections = useMemo(() => connections.map((connection) => {
    const measured = connectionPortPoints[connection.key];
    const start = measured?.start ?? worldToStage(getOutputPoint(connection.source));
    const end = measured?.end ?? worldToStage(getInputPoint(connection.target));
    return { ...connection, start, end, path: createConnectionPath(start, end) };
  }), [connections, connectionPortPoints]);

  // Draw the visible connections in a stage-level canvas. Keeping this layer
  // outside the transformed node viewport avoids a WebView/SVG compositing
  // bug present on some Android devices where saved paths are offset from the
  // measured ports. Both the ports and canvas use the same CSS pixel space.
  useLayoutEffect(() => {
    const canvas = connectionCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const bounds = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    renderedConnections.forEach(({ start, end, kind }) => {
      drawCanvasConnection(context, start, end, kind);
    });
    if (connectionDraft) {
      drawCanvasDraft(context, connectionDraft.start, connectionDraft.current);
    }
  }, [connectionDraft, connectionLayoutRevision, renderedConnections]);

  const beginPinch = useCallback(() => {
    const points = [...activePointersRef.current.values()];
    if (points.length < 2) {
      return;
    }
    const [first, second] = points;
    const midpoint = getMidpoint(first, second);
    const current = liveViewportRef.current;
    gestureRef.current = {
      mode: "pinch",
      startDistance: Math.max(getDistance(first, second), 1),
      anchorWorld: {
        x: (midpoint.x - current.x) / current.scale,
        y: (midpoint.y - current.y) / current.scale,
      },
    };
  }, []);

  const promoteToPinch = useCallback(() => {
    clearLongPress();
    clearConnectionPress();
    setSelectionRect(undefined);
    const currentGesture = gestureRef.current;
    if (currentGesture?.mode === "drag") {
      const delta = {
        x: currentGesture.currentNode.x - currentGesture.startNode.x,
        y: currentGesture.currentNode.y - currentGesture.startNode.y,
      };
      const moves = currentGesture.selectedNodeIds.map((nodeId) => ({
        nodeId,
        point: {
          x: (currentGesture.startNodes[nodeId]?.x ?? currentGesture.currentNode.x) + delta.x,
          y: (currentGesture.startNodes[nodeId]?.y ?? currentGesture.currentNode.y) + delta.y,
        },
      }));
      if (onNodesMove && moves.length > 1) onNodesMove(moves);
      else onNodeMove(currentGesture.nodeId, currentGesture.currentNode);
    }
    if (currentGesture?.mode === "connect") {
      setConnectionDraft(undefined);
      setConnectionSourceId(undefined);
    }
    beginPinch();
  }, [beginPinch, clearConnectionPress, clearLongPress, onNodeMove]);

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    activePointersRef.current.set(event.pointerId, getStagePoint(event));
    if (activePointersRef.current.size < 2) return;

    // Capture both fingers at the stage once a pinch begins. The first finger
    // may have landed on a textarea, select, button, or image inside a node.
    // Single-finger taps remain native controls; two fingers always control
    // the canvas viewport.
    event.preventDefault();
    for (const pointerId of activePointersRef.current.keys()) {
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch {
        // Some Android WebViews only allow capture by the original target.
        // Pointer events still bubble through the canvas stage in that case.
      }
    }
    promoteToPinch();
  };

  const beginConnection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sourceNode: CanvasNode,
  ) => {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (activePointersRef.current.size >= 2) {
      promoteToPinch();
      return;
    }
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stagePoint = getStagePointFromClient(event.clientX, event.clientY);
    // For the live drag preview, use the exact point where the finger pressed
    // the port. This keeps the preview visually attached even if a device
    // reports a stale transformed DOMRect for the enlarged hit target.
    const startStagePoint = stagePoint;
    stage.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, stagePoint);
    gestureRef.current = {
      mode: "connect",
      pointerId: event.pointerId,
      sourceNodeId: sourceNode.id,
      startPoint: stagePoint,
      startWorld: startStagePoint,
      currentWorld: startStagePoint,
      moved: false,
    };
    setConnectionSourceId(sourceNode.id);
    setConnectionDraft({ sourceNodeId: sourceNode.id, start: startStagePoint, current: startStagePoint });
    onSelectNode(sourceNode.id);
  };

  function showConnectionMenu(
    connection: (typeof connections)[number],
    point: CanvasPoint,
  ) {
    setContextMenu(undefined);
    setConnectionMenu({
      sourceNodeId: connection.source.id,
      targetNodeId: connection.target.id,
      kind: connection.kind,
      left: point.x,
      top: point.y,
    });
  }

  const deleteConnection = (menu: ConnectionMenuState) => {
    const source = nodesById.get(menu.sourceNodeId);
    if (menu.kind === "image" && source?.type === "image") {
      onDisconnectReference(menu.targetNodeId, source.assetId);
    } else if (menu.kind === "rule") {
      onDisconnectRule(menu.targetNodeId, menu.sourceNodeId);
    } else {
      onDisconnectNode(menu.targetNodeId, menu.sourceNodeId);
    }
    setConnectionMenu(undefined);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-canvas-control='true']")) {
      return;
    }
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }

    const point = getStagePoint(event);
    activePointersRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setContextMenu(undefined);
    setConnectionMenu(undefined);

    if (activePointersRef.current.size >= 2) {
      promoteToPinch();
      return;
    }

    const nodeElement = (event.target as HTMLElement).closest<HTMLElement>("[data-canvas-node-id]");
    const nodeId = nodeElement?.dataset.canvasNodeId;
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;

    if (node) {
      const selected = new Set(selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []));
      const groupMembers = node.groupId
        ? nodes.filter((candidate) => candidate.groupId === node.groupId).map((candidate) => candidate.id)
        : [node.id];
      let nextSelected = [...selected];
      if (event.shiftKey) {
        const shouldRemove = groupMembers.every((candidateId) => selected.has(candidateId));
        nextSelected = shouldRemove
          ? nextSelected.filter((candidate) => !groupMembers.includes(candidate))
          : Array.from(new Set([...nextSelected, ...groupMembers]));
        if (!nextSelected.length) nextSelected = [node.id];
      } else if (!selected.has(node.id) || groupMembers.some((candidateId) => !selected.has(candidateId))) {
        nextSelected = groupMembers;
      }
      if (onSelectNodes) onSelectNodes(nextSelected);
      if (!onSelectNodes) onSelectNode(node.id);
      const draggedNodeIds = nextSelected.length > 1 ? nextSelected : [node.id];
      const startNodes = Object.fromEntries(draggedNodeIds.flatMap((candidateId) => {
        const candidate = nodesById.get(candidateId);
        return candidate ? [[candidateId, { x: candidate.x, y: candidate.y }]] : [];
      }));
      gestureRef.current = {
        mode: "drag",
        pointerId: event.pointerId,
        nodeId: node.id,
        startPoint: point,
        startNode: { x: node.x, y: node.y },
        currentNode: { x: node.x, y: node.y },
        selectedNodeIds: draggedNodeIds,
        startNodes,
      };
      longPressOriginRef.current = point;
      longPressTimerRef.current = window.setTimeout(() => {
        if (nextSelected.some((candidateId) => !selected.has(candidateId))) {
          onSelectNodes?.(nextSelected);
        }
        setContextMenu({
          nodeId: node.id,
          nodeIds: draggedNodeIds,
          left: point.x,
          top: point.y,
        });
      }, LONG_PRESS_MS);
      return;
    }

    const nearbyConnection = findNearbyConnection(point, renderedConnections, 20);
    if (nearbyConnection) {
      clearConnectionPress();
      gestureRef.current = {
        mode: "connection-menu",
        pointerId: event.pointerId,
        startPoint: point,
      };
      connectionPressTimerRef.current = window.setTimeout(() => {
        showConnectionMenu(nearbyConnection, point);
        connectionPressTimerRef.current = undefined;
      }, LONG_PRESS_MS);
      return;
    }

    setConnectionSourceId(undefined);
    setConnectionDraft(undefined);
    if (selectionMode || (event.pointerType === "mouse" && event.shiftKey)) {
      gestureRef.current = {
        mode: "select",
        pointerId: event.pointerId,
        startPoint: point,
        currentPoint: point,
      };
      setSelectionRect({ start: point, current: point });
    } else {
      onSelectNode(undefined);
      onSelectNodes?.([]);
      gestureRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startPoint: point,
        startViewport: { ...liveViewportRef.current },
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) {
      return;
    }

    const point = getStagePoint(event);
    activePointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;

    if (gesture?.mode === "connection-menu" && gesture.pointerId === event.pointerId) {
      if (getDistance(gesture.startPoint, point) > 10) clearConnectionPress();
      return;
    }

    if (gesture?.mode === "select" && gesture.pointerId === event.pointerId) {
      gesture.currentPoint = point;
      setSelectionRect({ start: gesture.startPoint, current: point });
      return;
    }

    if (gesture?.mode === "connect" && gesture.pointerId === event.pointerId) {
      const targetNodeId = findConnectionTargetAtPoint(event.clientX, event.clientY);
      // Keep the draft endpoint under the finger. The target highlight and
      // the final persisted connection still use the node's input port.
      const currentStagePoint = point;
      gesture.currentWorld = currentStagePoint;
      gesture.targetNodeId = targetNodeId;
      gesture.moved = gesture.moved || getDistance(gesture.startPoint, point) >= CONNECTION_DRAG_THRESHOLD;
      setConnectionDraft({
        sourceNodeId: gesture.sourceNodeId,
        start: gesture.startWorld,
        current: currentStagePoint,
        targetNodeId,
      });
      return;
    }

    if (longPressOriginRef.current && getDistance(longPressOriginRef.current, point) > 8) {
      clearLongPress();
    }

    if (activePointersRef.current.size >= 2) {
      if (gesture?.mode !== "pinch") {
        beginPinch();
        return;
      }
      const [first, second] = [...activePointersRef.current.values()];
      const midpoint = getMidpoint(first, second);
      const nextScale = clamp(
        liveViewportRef.current.scale * (getDistance(first, second) / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      gesture.startDistance = Math.max(getDistance(first, second), 1);
      applyViewport({
        x: midpoint.x - gesture.anchorWorld.x * nextScale,
        y: midpoint.y - gesture.anchorWorld.y * nextScale,
        scale: nextScale,
      });
      gesture.anchorWorld = {
        x: (midpoint.x - liveViewportRef.current.x) / nextScale,
        y: (midpoint.y - liveViewportRef.current.y) / nextScale,
      };
      return;
    }

    if (gesture?.mode === "pan" && gesture.pointerId === event.pointerId) {
      applyViewport({
        x: gesture.startViewport.x + point.x - gesture.startPoint.x,
        y: gesture.startViewport.y + point.y - gesture.startPoint.y,
        scale: gesture.startViewport.scale,
      });
      return;
    }

    if (gesture?.mode === "drag" && gesture.pointerId === event.pointerId) {
      const scale = liveViewportRef.current.scale;
      const next = {
        x: gesture.startNode.x + (point.x - gesture.startPoint.x) / scale,
        y: gesture.startNode.y + (point.y - gesture.startPoint.y) / scale,
      };
      gesture.currentNode = next;
      const delta = {
        x: (point.x - gesture.startPoint.x) / scale,
        y: (point.y - gesture.startPoint.y) / scale,
      };
      gesture.selectedNodeIds.forEach((selectedId) => {
        const start = gesture.startNodes[selectedId];
        const element = nodeElementsRef.current.get(selectedId);
        if (start && element) {
          element.style.transform = `translate3d(${start.x + delta.x}px, ${start.y + delta.y}px, 0)`;
        }
      });
      refreshConnectionLayout();
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) {
      return;
    }

    clearLongPress();
    longPressOriginRef.current = undefined;
    const gesture = gestureRef.current;
    activePointersRef.current.delete(event.pointerId);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture?.mode === "connect" && gesture.pointerId === event.pointerId) {
      const targetNodeId = gesture.targetNodeId ?? findConnectionTargetAtPoint(event.clientX, event.clientY);
      if (targetNodeId && targetNodeId !== gesture.sourceNodeId) {
        onConnect(gesture.sourceNodeId, targetNodeId);
        setConnectionSourceId(undefined);
      } else if (gesture.moved) {
        setConnectionSourceId(undefined);
      }
      setConnectionDraft(undefined);
      gestureRef.current = undefined;
      return;
    }

    if (gesture?.mode === "connection-menu" && gesture.pointerId === event.pointerId) {
      clearConnectionPress();
      gestureRef.current = undefined;
      onViewportChange({ ...liveViewportRef.current });
      return;
    }

    if (gesture?.mode === "select" && gesture.pointerId === event.pointerId) {
      const bounds = normalizeRect(gesture.startPoint, gesture.currentPoint);
      const scale = liveViewportRef.current.scale;
      const currentViewport = liveViewportRef.current;
      const selectedIds = nodes.filter((node) => {
        const left = node.x * scale + currentViewport.x;
        const top = node.y * scale + currentViewport.y;
        const right = left + node.width * scale;
        const bottom = top + node.height * scale;
        return right >= bounds.left && left <= bounds.right && bottom >= bounds.top && top <= bounds.bottom;
      }).map((node) => node.id);
      const selectedSet = new Set(selectedIds);
      nodes.forEach((node) => {
        if (node.groupId && selectedSet.has(node.id)) {
          nodes.filter((candidate) => candidate.groupId === node.groupId).forEach((candidate) => selectedSet.add(candidate.id));
        }
      });
      const expandedSelectedIds = nodes.filter((node) => selectedSet.has(node.id)).map((node) => node.id);
      if (onSelectNodes) onSelectNodes(expandedSelectedIds);
      if (!onSelectNodes) onSelectNode(expandedSelectedIds[expandedSelectedIds.length - 1]);
      setSelectionRect(undefined);
      gestureRef.current = undefined;
      onViewportChange({ ...liveViewportRef.current });
      return;
    }

    if (gesture?.mode === "drag" && gesture.pointerId === event.pointerId) {
      const scale = liveViewportRef.current.scale;
      const delta = {
        x: (getStagePoint(event).x - gesture.startPoint.x) / scale,
        y: (getStagePoint(event).y - gesture.startPoint.y) / scale,
      };
      const moves = gesture.selectedNodeIds.map((nodeId) => ({
        nodeId,
        point: {
          x: (gesture.startNodes[nodeId]?.x ?? gesture.currentNode.x) + delta.x,
          y: (gesture.startNodes[nodeId]?.y ?? gesture.currentNode.y) + delta.y,
        },
      }));
      if (onNodesMove && moves.length > 1) onNodesMove(moves);
      else onNodeMove(gesture.nodeId, gesture.currentNode);
    }

    if (activePointersRef.current.size === 1) {
      const [pointerId, remainingPoint] = [...activePointersRef.current.entries()][0];
      gestureRef.current = {
        mode: "pan",
        pointerId,
        startPoint: remainingPoint,
        startViewport: { ...liveViewportRef.current },
      };
      onViewportChange({ ...liveViewportRef.current });
      return;
    }

    gestureRef.current = undefined;
    onViewportChange({ ...liveViewportRef.current });
  };

  return (
    <div
      ref={stageRef}
      className="canvas-stage"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="canvas-grid" aria-hidden="true" />
      <div className="canvas-selection-toolbar" data-canvas-control="true">
        <button
          type="button"
          className={selectionMode ? "is-active" : ""}
          aria-pressed={selectionMode}
          onClick={() => {
            setSelectionMode((current) => !current);
            setSelectionRect(undefined);
          }}
          title="框选节点"
        >
          <Selection />
          <span>{selectionMode ? "退出多选" : "框选节点"}</span>
        </button>
        {(selectedNodeIds?.size ?? (selectedNodeId ? 1 : 0)) > 1 && (
          <span className="canvas-selection-count">已选 {selectedNodeIds?.size ?? 0}</span>
        )}
      </div>
      {selectionRect && (
        <div
          className="canvas-selection-rect"
          style={selectionRectStyle(selectionRect.start, selectionRect.current)}
          aria-hidden="true"
        />
      )}
      <canvas
        ref={connectionCanvasRef}
        className="node-connections-canvas"
        aria-hidden="true"
      />
      <div ref={viewportLayerRef} className="canvas-viewport">
        <svg ref={connectionLayerRef} className="node-connections" aria-label="节点连线层">
          <defs>
            <linearGradient id="node-connection-gradient" gradientUnits="userSpaceOnUse" x1="0" x2="420">
              <stop offset="0" stopColor="#10bce5" />
              <stop offset="1" stopColor="#e2b841" />
            </linearGradient>
            <linearGradient id="rule-connection-gradient" gradientUnits="userSpaceOnUse" x1="0" x2="420">
              <stop offset="0" stopColor="#e7a930" />
              <stop offset="1" stopColor="#55a984" />
            </linearGradient>
          </defs>
          {renderedConnections.map(({ source, target, key, kind, start, end, path }) => {
            const connection = { source, target, key, kind };
            return (
              <g key={key}>
                <path className="node-connection-halo" d={path} />
                <path className={`node-connection-line is-${kind}`} d={path} />
                <path
                  className="node-connection-hit-area"
                  d={path}
                  data-connection-key={key}
                  data-edge-source-node-id={source.id}
                  data-edge-target-node-id={target.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`连线：${source.title} 到 ${target.title}，长按删除`}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    showConnectionMenu(connection, getStagePointFromClient(
                      bounds.left + bounds.width / 2,
                      bounds.top + bounds.height / 2,
                    ));
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                />
                <circle className={`connection-point source is-${kind}`} cx={start.x} cy={start.y} r="5" />
                <circle className="connection-point target" cx={end.x} cy={end.y} r="5" />
              </g>
            );
          })}
          {connectionDraft && (
            <g>
              <path className="node-connection-halo is-draft" d={createConnectionPath(connectionDraft.start, connectionDraft.current)} />
              <path className="node-connection-draft" d={createConnectionPath(connectionDraft.start, connectionDraft.current)} />
              <circle className="connection-draft-point" cx={connectionDraft.current.x} cy={connectionDraft.current.y} r="6" />
            </g>
          )}
        </svg>

        {nodes.map((node) => {
          if (node.type === "image") {
            const assetView = assetsById.get(node.assetId);
            if (!assetView) {
              return null;
            }
            return (
              <ImageCanvasNode
                key={node.id}
                node={node}
                assetView={assetView}
                isSelected={selectedNodeIds?.has(node.id) ?? selectedNodeId === node.id}
                isConnectionSource={connectionSourceId === node.id}
                registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
                onBeginConnection={(event) => beginConnection(event, node)}
              />
            );
          }

          if (node.type === "rule") {
            return (
              <RuleCanvasNode
                key={node.id}
                node={node}
                isSelected={selectedNodeIds?.has(node.id) ?? selectedNodeId === node.id}
                isConnectionSource={connectionSourceId === node.id}
                registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
                onBeginConnection={(event) => beginConnection(event, node)}
                onChange={(presetId, rules) => onRuleNodeChange(node.id, presetId, rules)}
              />
            );
          }

          if (node.type === "text") {
            return (
              <TextCanvasNode
                key={node.id}
                node={node}
                nodesById={nodesById}
                isSelected={selectedNodeIds?.has(node.id) ?? selectedNodeId === node.id}
                isConnectionSource={connectionSourceId === node.id}
                hasPendingConnection={Boolean(connectionSourceId && connectionSourceId !== node.id)}
                isConnectionTarget={connectionDraft?.targetNodeId === node.id}
                registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
                onBeginConnection={(event) => beginConnection(event, node)}
                onAcceptConnection={() => {
                  if (connectionSourceId) {
                    onConnect(connectionSourceId, node.id);
                    setConnectionSourceId(undefined);
                  }
                }}
                onChange={(update) => onTextNodeChange(node.id, update)}
                onRun={() => onRunTextNode(node.id)}
                onDisconnectNode={(sourceNodeId) => onDisconnectNode(node.id, sourceNodeId)}
              />
            );
          }

          if (node.type === "video") {
            return (
              <VideoCanvasNode
                key={node.id}
                node={node}
                videoModelOptions={videoModelOptions}
                defaultVideoModel={defaultVideoModel}
                assetsById={assetsById}
                isSelected={selectedNodeIds?.has(node.id) ?? selectedNodeId === node.id}
                hasPendingConnection={Boolean(connectionSourceId)}
                isConnectionTarget={connectionDraft?.targetNodeId === node.id}
                registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
                onAcceptConnection={() => {
                  if (connectionSourceId) {
                    onConnect(connectionSourceId, node.id);
                    setConnectionSourceId(undefined);
                  }
                }}
                onChange={(update) => onVideoChange?.(node.id, update)}
                onRun={() => onRunVideo?.(node.id)}
                onBeginConnection={(event) => beginConnection(event, node)}
              />
            );
          }

          return (
            <GenerationCanvasNode
              key={node.id}
              node={node}
              imageModelOptions={imageModelOptions}
              defaultImageModel={defaultImageModel}
              assetsById={assetsById}
              rulesById={rulesById}
              nodesById={nodesById}
              isSelected={selectedNodeIds?.has(node.id) ?? selectedNodeId === node.id}
              isOptimizing={optimizingNodeIds.has(node.id)}
              hasPendingConnection={Boolean(connectionSourceId)}
              isConnectionTarget={connectionDraft?.targetNodeId === node.id}
              registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
              onAcceptConnection={() => {
                if (connectionSourceId) {
                  onConnect(connectionSourceId, node.id);
                  setConnectionSourceId(undefined);
                }
              }}
              onChange={(update) => onGenerationChange(node.id, update)}
              onOptimize={() => onOptimizePrompt(node.id)}
              onRun={() => onRunGeneration(node.id)}
              onPreview={openImagePreview}
              onSaveResult={onGeneratedResultSave}
              onRemoveResult={onGeneratedResultRemove}
              onBeginConnection={(event) => beginConnection(event, node)}
              onDisconnectReference={(assetId) => onDisconnectReference(node.id, assetId)}
              onDisconnectRule={(ruleNodeId) => onDisconnectRule(node.id, ruleNodeId)}
              onDisconnectNode={(sourceNodeId) => onDisconnectNode(node.id, sourceNodeId)}
            />
          );
        })}
      </div>

      {nodes.length === 0 && (
        <div className="canvas-empty-state">
          <span className="canvas-empty-icon"><ImageSquare /></span>
          <span className="eyebrow">INFINITE CANVAS</span>
          <h1>从一张灵感，开始设计</h1>
          <p>导入手机图片作为参考，或新建生图节点。所有素材和生成结果都会留在这张画布上。</p>
          <div className="canvas-empty-actions" data-canvas-control="true">
            <button className="secondary-action" type="button" onClick={onImportRequest}>
              <ImageSquare />导入图片
            </button>
            <button className="primary-action" type="button" onClick={onGenerateRequest}>
              <MagicWand />新建生图节点
            </button>
          </div>
        </div>
      )}

      {connectionSourceId && !connectionDraft && (
        <div className="connection-hint" data-canvas-control="true">
          <Link />已选择输出，点击生图节点输入点，或从输出点直接拖拽连线
          <button type="button" onClick={() => setConnectionSourceId(undefined)} aria-label="取消连接"><X /></button>
        </div>
      )}

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          data-canvas-control="true"
        >
          {contextMenu.nodeIds.length > 1 && onGroupNodes && (
            <button
              type="button"
              className="canvas-context-group-action"
              onClick={() => {
                onGroupNodes(contextMenu.nodeIds);
                setContextMenu(undefined);
              }}
            >
              <Selection />编组 {contextMenu.nodeIds.length} 个节点
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (onNodesRemove && contextMenu.nodeIds.length > 1) onNodesRemove(contextMenu.nodeIds);
              else onNodeRemove(contextMenu.nodeId);
              onSelectNodes?.([]);
              setContextMenu(undefined);
            }}
          >
            <Trash />从画布移除
          </button>
        </div>
      )}

      {connectionMenu && (
        <div
          className="canvas-context-menu connection-context-menu"
          style={{ left: connectionMenu.left, top: connectionMenu.top }}
          data-canvas-control="true"
        >
          <button type="button" onClick={() => deleteConnection(connectionMenu)}>
            <Trash />删除这条连线
          </button>
        </div>
      )}

      <div className="gesture-hint">
        <HandTap />
        <span>拖拽端口连线 · 双指缩放 · 长按节点或连线</span>
      </div>

      {imagePreview && imagePreview.items[imagePreview.index] && typeof document !== "undefined" && createPortal(
        <div
          className="image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="图片大图预览"
          data-canvas-control="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) setImagePreview(undefined);
          }}
        >
          <div className="image-preview-dialog">
            <header className="image-preview-header">
              <span>{imagePreview.index + 1} / {imagePreview.items.length}</span>
              <button type="button" className="dialog-close-action" onClick={() => setImagePreview(undefined)} aria-label="关闭预览"><X /></button>
            </header>
            <div className="image-preview-body">
              {imagePreview.items.length > 1 && (
                <button
                  type="button"
                  className="image-preview-nav is-left"
                  onClick={() => setImagePreview((state) => state ? { ...state, index: (state.index - 1 + state.items.length) % state.items.length, error: undefined } : state)}
                  aria-label="上一张"
                ><ArrowLeft /></button>
              )}
              <img
                src={imagePreview.items[imagePreview.index].displayUri}
                alt={imagePreview.items[imagePreview.index].asset.name || "生成图片"}
              />
              {imagePreview.items.length > 1 && (
                <button
                  type="button"
                  className="image-preview-nav is-right"
                  onClick={() => setImagePreview((state) => state ? { ...state, index: (state.index + 1) % state.items.length, error: undefined } : state)}
                  aria-label="下一张"
                ><ArrowRight /></button>
              )}
            </div>
            <footer className="image-preview-footer">
              <button type="button" className="secondary-action" onClick={() => void runImagePreviewAction("save")} disabled={Boolean(imagePreview.busy)}>
                <DownloadSimple />{imagePreview.busy === "save" ? "保存中…" : "保存到相册"}
              </button>
              <button type="button" className="primary-action" onClick={() => void runImagePreviewAction("share")} disabled={Boolean(imagePreview.busy)}>
                <ShareNetwork />{imagePreview.busy === "share" ? "准备分享…" : "分享图片"}
              </button>
              {imagePreview.error && <small className="image-preview-error">{imagePreview.error}</small>}
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ImageCanvasNode({
  node,
  assetView,
  isSelected,
  isConnectionSource,
  registerElement,
  onBeginConnection,
}: {
  node: Extract<CanvasNode, { type: "image" }>;
  assetView: CanvasAssetView;
  isSelected: boolean;
  isConnectionSource: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onBeginConnection: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node image-node is-selected" : "canvas-node image-node"}${isConnectionSource ? " is-connection-source" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-group-id={node.groupId}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <img src={assetView.displayUri} alt={node.title} draggable={false} />
      <span className="node-title">{node.title}</span>
      <span className="node-more" aria-hidden="true"><DotsThree weight="bold" /></span>
      <button
        className="node-port output-port"
        type="button"
        data-canvas-control="true"
        aria-pressed={isConnectionSource}
        aria-label="拖拽连接图片到生图节点"
        onPointerDown={onBeginConnection}
      >
        <span />
      </button>
    </div>
  );
}

function RuleCanvasNode({
  node,
  isSelected,
  isConnectionSource,
  registerElement,
  onBeginConnection,
  onChange,
}: {
  node: CanvasRuleNode;
  isSelected: boolean;
  isConnectionSource: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onBeginConnection: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onChange: (presetId: ImageRulePresetId, rules: ImageRuleState) => void;
}) {
  const enabledCount = IMAGE_RULE_KEYS.filter((key) => node.rules[key]).length;
  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node rule-node is-selected" : "canvas-node rule-node"}${isConnectionSource ? " is-connection-source" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-group-id={node.groupId}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <header className="rule-node-header">
        <span className="rule-node-icon"><SlidersHorizontal /></span>
        <span><strong>{node.title}</strong><small>{enabledCount} 条规则已启用</small></span>
      </header>
      <div className="rule-node-content" data-canvas-control="true">
        <label className="rule-preset-field">
          <span>规则预设</span>
          <select
            value={node.presetId}
            onChange={(event) => {
              const preset = IMAGE_RULE_PRESETS.find((candidate) => candidate.id === event.currentTarget.value) ?? IMAGE_RULE_PRESETS[0];
              onChange(preset.id, { ...preset.rules });
            }}
          >
            {IMAGE_RULE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <div className="rule-toggle-list">
          {IMAGE_RULE_KEYS.map((key) => {
            const definition = IMAGE_RULE_DEFINITIONS[key];
            const enabled = node.rules[key] === true;
            return (
              <button
                key={key}
                className={enabled ? "rule-toggle is-enabled" : "rule-toggle"}
                type="button"
                role="switch"
                aria-checked={enabled}
                title={definition.description}
                onClick={() => onChange(node.presetId, { ...node.rules, [key]: !enabled })}
              >
                <span>{definition.label}</span><i />
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="node-port output-port rule-output-port"
        type="button"
        data-canvas-control="true"
        aria-pressed={isConnectionSource}
        aria-label="拖拽连接规则到生图节点"
        onPointerDown={onBeginConnection}
      >
        <span />
      </button>
    </div>
  );
}

function TextCanvasNode({
  node,
  nodesById,
  isSelected,
  isConnectionSource,
  hasPendingConnection,
  isConnectionTarget,
  registerElement,
  onBeginConnection,
  onAcceptConnection,
  onChange,
  onRun,
  onDisconnectNode,
}: {
  node: CanvasTextNode;
  nodesById: Map<string, CanvasNode>;
  isSelected: boolean;
  isConnectionSource: boolean;
  hasPendingConnection: boolean;
  isConnectionTarget: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onBeginConnection: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAcceptConnection: () => void;
  onChange: (update: Partial<Pick<CanvasTextNode, "prompt" | "systemPrompt">>) => void;
  onRun: () => void;
  onDisconnectNode: (sourceNodeId: string) => void;
}) {
  const inputs = node.inputNodeIds
    .map((sourceNodeId) => nodesById.get(sourceNodeId))
    .filter((sourceNode): sourceNode is CanvasGenerationNode | CanvasTextNode => (
      sourceNode?.type === "generation" || sourceNode?.type === "text"
    ));
  const statusLabel = node.status === "running" ? "生成中" : node.status === "success" ? "完成" : node.status === "error" ? "失败" : "待运行";
  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node text-node is-selected" : "canvas-node text-node"} is-${node.status}${isConnectionSource ? " is-connection-source" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-group-id={node.groupId}
      data-connection-target-node-id={node.id}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <header className="text-node-header">
        <span className="text-node-icon"><TextT weight="bold" /></span>
        <span><strong>{node.title}</strong><small>文字 LLM · {inputs.length} 个上游</small></span>
        <span className={`node-status is-${node.status}`}>{statusLabel}</span>
      </header>
      <button
        className={`${hasPendingConnection ? "node-port input-port is-ready" : "node-port input-port"}${isConnectionTarget ? " is-targeted" : ""}`}
        type="button"
        data-canvas-control="true"
        data-connection-input-node-id={node.id}
        aria-label="接收上游节点连接"
        onClick={onAcceptConnection}
      ><span /></button>
      <button
        className="node-port output-port text-output-port"
        type="button"
        data-canvas-control="true"
        aria-pressed={isConnectionSource}
        aria-label="连接文字结果到下游节点"
        onPointerDown={onBeginConnection}
      ><span /></button>
      <div className="text-node-content" data-canvas-control="true">
        {inputs.length > 0 && (
          <div className="text-node-inputs">
            {inputs.map((sourceNode) => (
              <span key={sourceNode.id}>
                {sourceNode.type === "text" ? <TextT /> : <MagicWand />}{sourceNode.title}
                <button type="button" onClick={() => onDisconnectNode(sourceNode.id)}><X /></button>
              </span>
            ))}
          </div>
        )}
        <label>
          <span>节点指令</span>
          <textarea value={node.prompt} onChange={(event) => onChange({ prompt: event.currentTarget.value })} placeholder="输入需要 LLM 完成的文字任务" />
        </label>
        <details>
          <summary>系统提示词</summary>
          <textarea value={node.systemPrompt} onChange={(event) => onChange({ systemPrompt: event.currentTarget.value })} />
        </details>
        <div className={`text-node-result is-${node.status}`}>
          {node.status === "running"
            ? <><span className="generation-spinner" /><small>正在生成文字结果…</small></>
            : node.status === "error"
              ? <small>{node.error}</small>
              : node.output
                ? <pre>{node.output}</pre>
                : <small>运行后，结果可连接到生图或下一个文字节点。</small>}
        </div>
        <button className="text-node-run-action" type="button" onClick={onRun} disabled={node.status === "running" || !node.prompt.trim()}>
          {node.status === "running" ? <span className="button-spinner" /> : <Play weight="fill" />}
          {node.status === "running" ? "生成中" : "运行文字 LLM"}
        </button>
      </div>
    </div>
  );
}

function GenerationCanvasNode({
  node,
  imageModelOptions,
  defaultImageModel,
  assetsById,
  rulesById,
  nodesById,
  isSelected,
  isOptimizing,
  hasPendingConnection,
  isConnectionTarget,
  registerElement,
  onAcceptConnection,
  onChange,
  onOptimize,
  onRun,
  onPreview,
  onSaveResult,
  onRemoveResult,
  onBeginConnection,
  onDisconnectReference,
  onDisconnectRule,
  onDisconnectNode,
}: {
  node: CanvasGenerationNode;
  imageModelOptions?: CanvasImageModelOption[];
  defaultImageModel?: string;
  assetsById: Map<string, CanvasAssetView>;
  rulesById: Map<string, CanvasRuleNode>;
  nodesById: Map<string, CanvasNode>;
  isSelected: boolean;
  isOptimizing: boolean;
  hasPendingConnection: boolean;
  isConnectionTarget: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onAcceptConnection: () => void;
  onChange: (update: GenerationNodeUpdate) => void;
  onOptimize: () => void;
  onRun: () => void;
  onPreview: (items: CanvasAssetView[], index: number) => void;
  onSaveResult: (assetId: string) => void;
  onRemoveResult: (assetId: string) => void;
  onBeginConnection: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDisconnectReference: (assetId: string) => void;
  onDisconnectRule: (ruleNodeId: string) => void;
  onDisconnectNode: (sourceNodeId: string) => void;
}) {
  const modelOption = imageModelOptions?.find((option) => option.id === node.request.model.model);
  const modelPreset = getImageModelPreset(node.request.model.model);
  const modelName = modelOption?.displayName?.trim()
    || modelOption?.id
    || (node.request.model.model === defaultImageModel ? "默认模型" : modelPreset.name);
  const resolutions = getCanvasModelResolutions(modelOption, modelPreset);
  const resolution = resolutions.includes(node.request.resolution)
    ? node.request.resolution
    : getCanvasModelDefaultResolution(modelOption, modelPreset);
  const aspectRatioOptions = getCanvasModelAspectRatios(modelOption, modelPreset, resolution);
  const aspectRatioValue = normalizeCanvasModelAspectRatio(
    modelOption,
    modelPreset.id,
    resolution,
    node.request.aspectRatio,
  );
  const countMax = getCanvasModelMaxOutputs(modelOption);
  const countValue = Math.min(countMax, Math.max(1, Math.round(node.request.count)));
  const resultViews = node.results
    .map((result) => assetsById.get(result.id))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const referenceViews = node.request.inputAssetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const connectedRules = (node.request.ruleNodeIds ?? [])
    .map((ruleNodeId) => rulesById.get(ruleNodeId))
    .filter((ruleNode): ruleNode is CanvasRuleNode => Boolean(ruleNode));
  const connectedNodes = [
    ...(node.request.upstreamNodeIds ?? []),
    ...(node.request.textNodeIds ?? []),
  ]
    .map((sourceNodeId) => nodesById.get(sourceNodeId))
    .filter((sourceNode): sourceNode is CanvasGenerationNode | CanvasTextNode => (
      sourceNode?.type === "generation" || sourceNode?.type === "text"
    ));
  const statusLabel = node.status === "running" ? "生成中" : node.status === "success" ? "完成" : node.status === "error" ? "失败" : "待运行";

  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node generation-node is-selected" : "canvas-node generation-node"} is-${node.status}`}
      data-canvas-node-id={node.id}
      data-canvas-group-id={node.groupId}
      data-generation-target-node-id={node.id}
      data-connection-target-node-id={node.id}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <header className="generation-node-header">
        <span className="generation-node-icon"><MagicWand weight="fill" /></span>
        <span><strong>{node.title}</strong><small>{modelName} · {referenceViews.length} 参考 · {connectedRules.length} 规则</small></span>
        <span className={`node-status is-${node.status}`}>{statusLabel}</span>
      </header>

      <button
        className="node-port output-port generation-output-port"
        type="button"
        data-canvas-control="true"
        aria-label="连接生成结果到下游节点"
        onPointerDown={onBeginConnection}
      ><span /></button>

      <button
        className={`${hasPendingConnection ? "node-port input-port is-ready" : "node-port input-port"}${isConnectionTarget ? " is-targeted" : ""}`}
        type="button"
        data-canvas-control="true"
        data-generation-input-node-id={node.id}
        data-connection-input-node-id={node.id}
        aria-label="接收图片或规则节点连接"
        onClick={onAcceptConnection}
      >
        <span />
      </button>

      <div className="generation-node-content" data-canvas-control="true">
        <label className="model-select-field">
          <span className="field-label">模型</span>
          <select
            value={node.request.model.model}
            title={`模型：${modelName}`}
            onChange={(event) => {
              const selectedId = event.currentTarget.value;
              const selectedOption = imageModelOptions?.find((option) => option.id === selectedId);
              const preset = getImageModelPreset(selectedId);
              const nextResolutions = getCanvasModelResolutions(selectedOption, preset);
              const nextResolution = nextResolutions.includes(node.request.resolution)
                ? node.request.resolution
                : getCanvasModelDefaultResolution(selectedOption, preset);
              onChange({
                model: { provider: "server-gateway", model: selectedId },
                resolution: nextResolution,
                aspectRatio: normalizeCanvasModelAspectRatio(
                  selectedOption,
                  preset.id,
                  nextResolution,
                  node.request.aspectRatio,
                ),
              });
            }}
          >
            {(imageModelOptions?.length
              ? imageModelOptions
              : IMAGE_MODEL_PRESETS.map((preset) => ({ id: preset.id, displayName: preset.name })))
              .map((option) => (
              <option key={option.id} value={option.id}>{option.displayName || option.id}</option>
            ))}
          </select>
        </label>

        <div className="node-inputs-strip">
          <span className="field-label">输入</span>
          <div className="node-input-items">
            {referenceViews.map(({ asset, displayUri }) => (
              <span className="reference-thumb" key={asset.id}>
                <img src={displayUri} alt={asset.name} />
                <button type="button" onClick={() => onDisconnectReference(asset.id)} aria-label={`移除参考图 ${asset.name}`}><X /></button>
              </span>
            ))}
            {connectedRules.map((ruleNode) => (
              <span className="connected-rule-chip" key={ruleNode.id}>
                <SlidersHorizontal /><span>{ruleNode.title}</span>
                <button type="button" onClick={() => onDisconnectRule(ruleNode.id)} aria-label={`断开规则 ${ruleNode.title}`}><X /></button>
              </span>
            ))}
            {connectedNodes.map((sourceNode) => (
              <span className={`connected-node-chip is-${sourceNode.type}`} key={sourceNode.id}>
                {sourceNode.type === "text" ? <TextT /> : <MagicWand />}
                <span>{sourceNode.title}</span>
                <button type="button" onClick={() => onDisconnectNode(sourceNode.id)} aria-label={`断开节点 ${sourceNode.title}`}><X /></button>
              </span>
            ))}
            {!referenceViews.length && !connectedRules.length && !connectedNodes.length && (
              <span className="reference-empty"><Link />拖入图片或规则节点</span>
            )}
          </div>
        </div>

        <div className={`generation-preview is-${node.status}`}>
          {node.status !== "running" && resultViews.length ? (
            <div
              className={`generation-result-grid count-${Math.min(resultViews.length, 4)}`}
              data-canvas-control="true"
              onClick={(event) => {
                const target = event.target as HTMLElement;
                const image = target.closest("img");
                if (!image) return;
                const images = Array.from(event.currentTarget.querySelectorAll("img"));
                const index = images.indexOf(image);
                if (index >= 0) onPreview(resultViews, index);
              }}
            >
              {resultViews.slice(0, 4).map(({ asset, displayUri }, index) => (
                <div className="generation-result-item" key={asset.id}>
                  <img src={displayUri} alt={`${node.title} 结果 ${index + 1}`} />
                  <div className="generation-result-actions" data-canvas-control="true">
                    <button
                      type="button"
                      aria-label="保存生成结果到相册"
                      title="保存到相册"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSaveResult(asset.id);
                      }}
                    >
                      <DownloadSimple />
                    </button>
                    <button
                      type="button"
                      aria-label="删除生成结果"
                      title="删除生成结果"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveResult(asset.id);
                      }}
                    >
                      <Trash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : node.status === "running" ? (
            <>
              <div
                className={`generation-result-grid count-${Math.min(Math.max(1, node.request.count), 4)} is-generating`}
                data-canvas-control="true"
                aria-label={`姝ｅ湪骞跺彂鐢熸垚 ${node.request.count} 寮犲浘鐗囥€?}`}
              >
                {Array.from({ length: Math.min(Math.max(1, node.request.count), 4) }, (_, index) => (
                  <div className="generation-placeholder" key={`generation-placeholder-${index}`}>
                    <span className="generation-spinner" />
                    <small>{index + 1}</small>
                  </div>
                ))}
              </div>
            <div className="generation-preview-state"><span className="generation-spinner" /><strong>正在生成图片</strong><small>结果会直接保存在素材库</small></div>
              </>
          ) : node.status === "error" ? (
            <div className="generation-preview-state is-error"><span>!</span><strong>生成失败</strong><small>{node.error}</small></div>
          ) : (
            <div className="generation-preview-state"><MagicWand /><strong>生成结果</strong><small>选择模型、连接素材并运行当前节点</small></div>
          )}
        </div>

        <label className="node-prompt-field">
          <span className="prompt-field-heading">
            <span className="field-label">描述你想生成的图片</span>
            <button type="button" className="prompt-optimize-action" onClick={onOptimize} disabled={isOptimizing || !node.request.prompt.trim()}>
              {isOptimizing ? <span className="button-spinner" /> : <MagicWand />}
              {isOptimizing ? "优化中" : "优化提示词"}
            </button>
          </span>
          <textarea
            value={node.request.prompt}
            placeholder="例如：雨夜街头的霓虹倒影、自然光下的人物肖像、极简产品摄影、奇幻森林插画……"
            onChange={(event) => onChange({ prompt: event.currentTarget.value })}
          />
        </label>

        <footer className={aspectRatioValue.includes("x")
          ? "generation-node-footer is-wide-ratio"
          : "generation-node-footer"}
        >
          <label>
            <span>比例</span>
            <select value={aspectRatioValue} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value as ImageGenerationRequest["aspectRatio"] })}>
              {aspectRatioOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>清晰度</span>
            <select
              value={resolution}
              onChange={(event) => {
                const resolution = event.currentTarget.value as ImageGenerationRequest["resolution"];
                onChange({
                  resolution,
                  aspectRatio: normalizeCanvasModelAspectRatio(
                    modelOption,
                    modelPreset.id,
                    resolution,
                    node.request.aspectRatio,
                  ),
                });
              }}
            >
              {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution.toUpperCase()}</option>)}
            </select>
          </label>
          <label>
            <span>张数</span>
            <select value={countValue} onChange={(event) => onChange({ count: Number(event.currentTarget.value) })}>
              {Array.from({ length: countMax }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <button className="node-run-action" type="button" onClick={onRun} disabled={node.status === "running" || !node.request.prompt.trim()}>
            {node.status === "running" ? <span className="button-spinner" /> : <Play weight="fill" />}
            <span>{node.status === "running" ? "生成中" : "运行"}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

function VideoCanvasNode({
  node,
  videoModelOptions,
  defaultVideoModel,
  assetsById,
  isSelected,
  hasPendingConnection,
  isConnectionTarget,
  registerElement,
  onAcceptConnection,
  onChange,
  onRun,
  onBeginConnection,
}: {
  node: CanvasVideoNode;
  videoModelOptions?: CanvasVideoModelOption[];
  defaultVideoModel?: string;
  assetsById: Map<string, CanvasAssetView>;
  isSelected: boolean;
  hasPendingConnection: boolean;
  isConnectionTarget: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onAcceptConnection: () => void;
  onChange: (update: VideoNodeUpdate) => void;
  onRun: () => void;
  onBeginConnection: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const modelOption = videoModelOptions?.find((option) => option.id === node.request.model.model);
  const modelName = modelOption?.displayName?.trim() || modelOption?.id
    || (node.request.model.model === defaultVideoModel ? "默认视频模型" : node.request.model.model);
  const models = videoModelOptions?.length
    ? videoModelOptions
    : [{ id: node.request.model.model || "seedance-2.0", displayName: modelName }];
  const capabilities = modelOption?.capabilities;
  const resolutions = getVideoCapabilityValues(capabilities?.resolutions, ["720p", "1080p"]);
  const resolution = node.request.resolution && resolutions.includes(node.request.resolution)
    ? node.request.resolution
    : String(capabilities?.defaultResolution ?? resolutions[0] ?? "720p");
  const aspectRatios = getVideoCapabilityValues(capabilities?.aspectRatios, ["16:9", "9:16", "1:1"]);
  const aspectRatio = node.request.aspectRatio && aspectRatios.includes(node.request.aspectRatio)
    ? node.request.aspectRatio
    : String(capabilities?.defaultAspectRatio ?? aspectRatios[0] ?? "16:9");
  const durations = getVideoDurationValues(capabilities?.durations, [5, 10]);
  const duration = durations.includes(Number(node.request.duration))
    ? Number(node.request.duration)
    : Number(capabilities?.defaultDuration ?? durations[0] ?? 5);
  const maxOutputs = Math.min(4, Math.max(1, Number(capabilities?.maxOutputs ?? 1) || 1));
  const count = Math.min(maxOutputs, Math.max(1, Math.round(node.request.count)));
  const references = node.request.inputAssetIds.map((id) => assetsById.get(id)).filter(Boolean) as CanvasAssetView[];
  const statusLabel = node.status === "running" ? "生成中" : node.status === "success" ? "完成" : node.status === "error" ? "失败" : "待运行";

  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node generation-node video-node is-selected" : "canvas-node generation-node video-node"} is-${node.status}`}
      data-canvas-node-id={node.id}
      data-canvas-group-id={node.groupId}
      data-connection-target-node-id={node.id}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <header className="generation-node-header video-node-header">
        <span className="generation-node-icon"><Play weight="fill" /></span>
        <span><strong>{node.title}</strong><small>{modelName} · {references.length} 个参考图</small></span>
        <span className={`node-status is-${node.status}`}>{statusLabel}</span>
      </header>
      <button className="node-port output-port generation-output-port" type="button" data-canvas-control="true" aria-label="连接视频结果" onPointerDown={onBeginConnection}><span /></button>
      <button className={`${hasPendingConnection ? "node-port input-port is-ready" : "node-port input-port"}${isConnectionTarget ? " is-targeted" : ""}`} type="button" data-canvas-control="true" data-connection-input-node-id={node.id} onClick={onAcceptConnection}><span /></button>
      <div className="generation-node-content" data-canvas-control="true">
        <label className="model-select-field"><span className="field-label">模型</span><select value={node.request.model.model} onChange={(event) => onChange({ model: { provider: "server-gateway", model: event.currentTarget.value } })}>{models.map((option) => <option key={option.id} value={option.id}>{option.displayName || option.id}</option>)}</select></label>
        {references.length > 0 && <div className="node-inputs-strip"><span className="field-label">参考图</span><div className="node-input-items">{references.slice(0, 4).map(({ asset, displayUri }) => <span className="reference-thumb" key={asset.id}><img src={displayUri} alt={asset.name} /></span>)}</div></div>}
        <div className={`generation-preview is-${node.status}`}>
          {node.results.length > 0 && node.status !== "running" ? <div className="video-result-grid">{node.results.slice(0, 4).map((result) => <video key={result.id} src={result.uri} controls playsInline preload="metadata" />)}</div>
            : node.status === "running" ? <div className="generation-preview-state"><span className="generation-spinner" /><strong>正在生成视频</strong><small>服务端任务完成后会自动显示</small></div>
              : node.status === "error" ? <div className="generation-preview-state is-error"><span>!</span><strong>生成失败</strong><small>{node.error}</small></div>
                : <div className="generation-preview-state"><Play /><strong>视频生成结果</strong><small>输入提示词后运行当前节点</small></div>}
        </div>
        <label className="node-prompt-field"><span className="prompt-field-heading"><span className="field-label">视频提示词</span></span><textarea value={node.request.prompt} placeholder="描述镜头、主体运动、光线和风格…" onChange={(event) => onChange({ prompt: event.currentTarget.value })} /></label>
        <footer className="generation-node-footer video-node-footer">
          <label><span>比例</span><select value={aspectRatio} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value })}>{aspectRatios.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>分辨率</span><select value={resolution} onChange={(event) => onChange({ resolution: event.currentTarget.value })}>{resolutions.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label><span>时长</span><select value={duration} onChange={(event) => onChange({ duration: Number(event.currentTarget.value) })}>{durations.map((value) => <option key={value} value={value}>{value}s</option>)}</select></label>
          <label><span>数量</span><select value={count} onChange={(event) => onChange({ count: Number(event.currentTarget.value) })}>{Array.from({ length: maxOutputs }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <button className="node-run-action" type="button" onClick={onRun} disabled={node.status === "running" || !node.request.prompt.trim()}>{node.status === "running" ? <span className="button-spinner" /> : <Play weight="fill" />}<span>{node.status === "running" ? "生成中" : "运行"}</span></button>
        </footer>
      </div>
    </div>
  );
}

function getVideoCapabilityValues(value: unknown, fallback: string[]): string[] {
  const values = Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
  return Array.from(new Set(values.length ? values : fallback));
}

function getVideoDurationValues(value: unknown, fallback: number[]): number[] {
  const values = Array.isArray(value)
    ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];
  return Array.from(new Set(values.length ? values : fallback));
}

function getCanvasModelResolutions(
  option: CanvasImageModelOption | undefined,
  preset: ReturnType<typeof getImageModelPreset>,
): ImageGenerationRequest["resolution"][] {
  const values = Array.isArray(option?.capabilities?.resolutions)
    ? option.capabilities.resolutions
      .map((value) => String(value).trim().toLowerCase())
      .filter((value): value is ImageGenerationRequest["resolution"] => /^(?:1k|2k|4k)$/.test(value))
    : [];
  const unique = Array.from(new Set(values));
  return unique.length ? unique : preset.resolutions;
}

function getCanvasModelDefaultResolution(
  option: CanvasImageModelOption | undefined,
  preset: ReturnType<typeof getImageModelPreset>,
): ImageGenerationRequest["resolution"] {
  const values = getCanvasModelResolutions(option, preset);
  const configured = String(option?.capabilities?.defaultResolution ?? "").trim().toLowerCase();
  return values.includes(configured as ImageGenerationRequest["resolution"])
    ? configured as ImageGenerationRequest["resolution"]
    : values.includes(preset.defaultResolution) ? preset.defaultResolution : values[0] ?? "2k";
}

function getCanvasModelAspectRatios(
  option: CanvasImageModelOption | undefined,
  preset: ReturnType<typeof getImageModelPreset>,
  resolution: ImageGenerationRequest["resolution"],
) {
  const byResolution = option?.capabilities?.aspectRatiosByResolution?.[resolution];
  const configured = Array.isArray(byResolution)
    ? byResolution
    : Array.isArray(option?.capabilities?.aspectRatios)
      ? option.capabilities.aspectRatios
      : undefined;
  const values = configured
    ?.map((value) => String(value).trim().replace(/脳/g, "x"))
    .filter((value) => /^\d{1,5}(?::|x)\d{1,5}$/.test(value));
  if (values?.length) {
    return Array.from(new Set(values)).map((value) => ({ value, label: value.replace("x", "×") }));
  }
  return getImageAspectRatioOptions(preset.id, resolution);
}

function normalizeCanvasModelAspectRatio(
  option: CanvasImageModelOption | undefined,
  presetId: ReturnType<typeof getImageModelPreset>["id"],
  resolution: ImageGenerationRequest["resolution"],
  value: unknown,
): ImageGenerationRequest["aspectRatio"] {
  const options = getCanvasModelAspectRatios(option, getImageModelPreset(presetId), resolution);
  const clean = String(value ?? "").trim().replace(/脳/g, "x");
  if (options.some((candidate) => candidate.value === clean)) return clean as ImageGenerationRequest["aspectRatio"];
  return normalizeImageAspectRatio(presetId, resolution, clean);
}

function getCanvasModelMaxOutputs(option: CanvasImageModelOption | undefined): number {
  const raw = Number(option?.capabilities?.maxOutputs);
  return Number.isFinite(raw) ? Math.min(4, Math.max(1, Math.round(raw))) : 4;
}

function collectConnections(nodes: CanvasNode[]) {
  const connections: Array<{
    source: CanvasNode;
    target: CanvasGenerationNode | CanvasVideoNode | CanvasTextNode;
    key: string;
    kind: "image" | "rule" | "text" | "generation";
  }> = [];
  for (const target of nodes) {
    if (target.type === "text") {
      target.inputNodeIds.forEach((sourceNodeId) => {
        const source = nodes.find((node) => node.id === sourceNodeId);
        if (source && (source.type === "text" || source.type === "generation")) {
          connections.push({ source, target, key: `${source.id}-${target.id}-${source.type}`, kind: source.type });
        }
      });
      continue;
    }
    if (target.type !== "generation" && target.type !== "video") {
      continue;
    }
    target.request.inputAssetIds.forEach((assetId) => {
      const source = nodes.find((node) => node.type === "image" && node.assetId === assetId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-image`, kind: "image" });
    });
    if (target.type === "generation") {
      (target.request.ruleNodeIds ?? []).forEach((ruleNodeId) => {
      const source = nodes.find((node) => node.type === "rule" && node.id === ruleNodeId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-rule`, kind: "rule" });
      });
    }
    (target.request.upstreamNodeIds ?? []).forEach((sourceNodeId) => {
      const source = nodes.find((node) => node.type === "generation" && node.id === sourceNodeId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-generation`, kind: "generation" });
    });
    (target.request.textNodeIds ?? []).forEach((sourceNodeId) => {
      const source = nodes.find((node) => node.type === "text" && node.id === sourceNodeId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-text`, kind: "text" });
    });
  }
  return connections;
}

function findConnectionTargetAtPoint(clientX: number, clientY: number): string | undefined {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const inputTarget = element.closest<HTMLElement>("[data-connection-input-node-id]");
    if (inputTarget?.dataset.connectionInputNodeId) {
      return inputTarget.dataset.connectionInputNodeId;
    }
    const nodeTarget = element.closest<HTMLElement>("[data-connection-target-node-id]");
    if (nodeTarget?.dataset.connectionTargetNodeId) {
      return nodeTarget.dataset.connectionTargetNodeId;
    }
  }
  return undefined;
}

function getOutputPoint(node: CanvasNode): CanvasPoint {
  // The output button is positioned with right:-28px and is 52px wide, so
  // its visible center is two world pixels beyond the node edge.
  return { x: node.x + node.width + 2, y: node.y + node.height / 2 };
}

function getInputPoint(node: CanvasGenerationNode | CanvasVideoNode | CanvasTextNode): CanvasPoint {
  // The input button is positioned with left:-28px and is 52px wide.
  return { x: node.x - 2, y: node.y + 76 };
}

function findNearbyConnection<T extends { start: CanvasPoint; end: CanvasPoint }>(
  point: CanvasPoint,
  connections: T[],
  tolerance: number,
): T | undefined {
  let nearest: { connection: T; distance: number } | undefined;
  for (const connection of connections) {
    const distance = distanceToConnectionCurve(point, connection.start, connection.end);
    if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
      nearest = { connection, distance };
    }
  }
  return nearest?.connection;
}

function distanceToConnectionCurve(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number {
  const bend = Math.max(Math.abs(end.x - start.x) * 0.46, 70);
  const firstControl = { x: start.x + bend, y: start.y };
  const secondControl = { x: end.x - bend, y: end.y };
  let minimum = Number.POSITIVE_INFINITY;
  let previous = start;
  for (let index = 1; index <= 32; index += 1) {
    const t = index / 32;
    const current = cubicBezierPoint(start, firstControl, secondControl, end, t);
    minimum = Math.min(minimum, distanceToSegment(point, previous, current));
    previous = current;
  }
  return minimum;
}

function cubicBezierPoint(
  start: CanvasPoint,
  firstControl: CanvasPoint,
  secondControl: CanvasPoint,
  end: CanvasPoint,
  t: number,
): CanvasPoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x
      + 3 * inverse ** 2 * t * firstControl.x
      + 3 * inverse * t ** 2 * secondControl.x
      + t ** 3 * end.x,
    y: inverse ** 3 * start.y
      + 3 * inverse ** 2 * t * firstControl.y
      + 3 * inverse * t ** 2 * secondControl.y
      + t ** 3 * end.y,
  };
}

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return getDistance(point, start);
  const t = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return getDistance(point, { x: start.x + t * deltaX, y: start.y + t * deltaY });
}

function createConnectionPath(start: CanvasPoint, end: CanvasPoint): string {
  const distance = Math.max(Math.abs(end.x - start.x) * 0.46, 70);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
}

function traceCanvasConnection(
  context: CanvasRenderingContext2D,
  start: CanvasPoint,
  end: CanvasPoint,
) {
  const distance = Math.max(Math.abs(end.x - start.x) * 0.46, 70);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(
    start.x + distance,
    start.y,
    end.x - distance,
    end.y,
    end.x,
    end.y,
  );
}

function drawCanvasConnection(
  context: CanvasRenderingContext2D,
  start: CanvasPoint,
  end: CanvasPoint,
  kind: "image" | "rule" | "text" | "generation",
) {
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  if (kind === "rule") {
    gradient.addColorStop(0, "#e7a930");
    gradient.addColorStop(1, "#55a984");
  } else {
    gradient.addColorStop(0, "#10bce5");
    gradient.addColorStop(1, "#e2b841");
  }

  context.save();
  traceCanvasConnection(context, start, end);
  context.strokeStyle = "rgba(255, 255, 255, 0.96)";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.stroke();
  traceCanvasConnection(context, start, end);
  context.strokeStyle = gradient;
  context.lineWidth = 2.5;
  context.stroke();
  context.restore();

  drawCanvasPoint(context, start, kind === "rule" ? "#dda22d" : "#12bfe8");
  drawCanvasPoint(context, end, "#3c8ff0");
}

function drawCanvasDraft(
  context: CanvasRenderingContext2D,
  start: CanvasPoint,
  end: CanvasPoint,
) {
  context.save();
  traceCanvasConnection(context, start, end);
  context.strokeStyle = "rgba(255, 255, 255, 0.96)";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.stroke();
  traceCanvasConnection(context, start, end);
  context.strokeStyle = "#169fdd";
  context.lineWidth = 3;
  context.setLineDash([9, 7]);
  context.stroke();
  context.restore();
  drawCanvasPoint(context, end, "#169fdd", 6);
}

function drawCanvasPoint(
  context: CanvasRenderingContext2D,
  point: CanvasPoint,
  color: string,
  radius = 5,
) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = color;
  context.stroke();
  context.restore();
}

function registerNodeElement(nodeId: string, element: HTMLDivElement | null, elements: Map<string, HTMLDivElement>) {
  if (element) elements.set(nodeId, element);
  else elements.delete(nodeId);
}

function getDistance(first: CanvasPoint, second: CanvasPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function getMidpoint(first: CanvasPoint, second: CanvasPoint): CanvasPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeRect(start: CanvasPoint, current: CanvasPoint) {
  return {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    right: Math.max(start.x, current.x),
    bottom: Math.max(start.y, current.y),
  };
}

function selectionRectStyle(start: CanvasPoint, current: CanvasPoint): CSSProperties {
  const bounds = normalizeRect(start, current);
  return {
    left: bounds.left,
    top: bounds.top,
    width: Math.max(1, bounds.right - bounds.left),
    height: Math.max(1, bounds.bottom - bounds.top),
  };
}

import {
  DotsThree,
  HandTap,
  ImageSquare,
  Link,
  MagicWand,
  Play,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  type CanvasViewport,
  type ImageAsset,
  type ImageGenerationRequest,
  type ImageRulePresetId,
  type ImageRuleState,
} from "../../../shared";

export interface CanvasAssetView {
  asset: ImageAsset;
  displayUri: string;
}

export type GenerationNodeUpdate = Partial<
  Pick<ImageGenerationRequest, "prompt" | "aspectRatio" | "resolution" | "count" | "model">
>;

interface CanvasStageProps {
  nodes: CanvasNode[];
  assets: CanvasAssetView[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  optimizingNodeIds: ReadonlySet<string>;
  onImportRequest: () => void;
  onGenerateRequest: () => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodeMove: (nodeId: string, point: CanvasPoint) => void;
  onNodeRemove: (nodeId: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onGenerationChange: (nodeId: string, update: GenerationNodeUpdate) => void;
  onRuleNodeChange: (nodeId: string, presetId: ImageRulePresetId, rules: ImageRuleState) => void;
  onOptimizePrompt: (nodeId: string) => void;
  onRunGeneration: (nodeId: string) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onDisconnectReference: (targetNodeId: string, assetId: string) => void;
  onDisconnectRule: (targetNodeId: string, ruleNodeId: string) => void;
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
  optimizingNodeIds,
  onImportRequest,
  onGenerateRequest,
  onViewportChange,
  onNodeMove,
  onNodeRemove,
  onSelectNode,
  onGenerationChange,
  onRuleNodeChange,
  onOptimizePrompt,
  onRunGeneration,
  onConnect,
  onDisconnectReference,
  onDisconnectRule,
}: CanvasStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportLayerRef = useRef<HTMLDivElement>(null);
  const nodeElementsRef = useRef(new Map<string, HTMLDivElement>());
  const activePointersRef = useRef(new Map<number, CanvasPoint>());
  const gestureRef = useRef<Gesture | undefined>(undefined);
  const liveViewportRef = useRef(viewport);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressOriginRef = useRef<CanvasPoint | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [connectionSourceId, setConnectionSourceId] = useState<string>();
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>();

  const assetsById = useMemo(
    () => new Map(assets.map((entry) => [entry.asset.id, entry])),
    [assets],
  );
  const rulesById = useMemo(
    () => new Map(nodes.filter((node): node is CanvasRuleNode => node.type === "rule").map((node) => [node.id, node])),
    [nodes],
  );
  const connections = useMemo(() => collectConnections(nodes), [nodes]);

  const applyViewport = useCallback((next: CanvasViewport) => {
    liveViewportRef.current = next;
    if (viewportLayerRef.current) {
      viewportLayerRef.current.style.transform =
        `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    }
  }, []);

  useEffect(() => {
    applyViewport(viewport);
  }, [applyViewport, viewport]);

  useEffect(() => () => window.clearTimeout(longPressTimerRef.current), []);

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
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

  const stageToWorld = (point: CanvasPoint): CanvasPoint => {
    const current = liveViewportRef.current;
    return {
      x: (point.x - current.x) / current.scale,
      y: (point.y - current.y) / current.scale,
    };
  };

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

  const beginConnection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sourceNode: Extract<CanvasNode, { type: "image" | "rule" }>,
  ) => {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stagePoint = getStagePointFromClient(event.clientX, event.clientY);
    const startWorld = getOutputPoint(sourceNode);
    stage.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, stagePoint);
    gestureRef.current = {
      mode: "connect",
      pointerId: event.pointerId,
      sourceNodeId: sourceNode.id,
      startPoint: stagePoint,
      startWorld,
      currentWorld: startWorld,
      moved: false,
    };
    setConnectionSourceId(sourceNode.id);
    setConnectionDraft({ sourceNodeId: sourceNode.id, start: startWorld, current: startWorld });
    onSelectNode(sourceNode.id);
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

    if (activePointersRef.current.size >= 2) {
      clearLongPress();
      const currentGesture = gestureRef.current;
      if (currentGesture?.mode === "drag") {
        onNodeMove(currentGesture.nodeId, currentGesture.currentNode);
      }
      if (currentGesture?.mode === "connect") {
        setConnectionDraft(undefined);
        setConnectionSourceId(undefined);
      }
      beginPinch();
      return;
    }

    const nodeElement = (event.target as HTMLElement).closest<HTMLElement>("[data-canvas-node-id]");
    const nodeId = nodeElement?.dataset.canvasNodeId;
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;

    if (node) {
      onSelectNode(node.id);
      gestureRef.current = {
        mode: "drag",
        pointerId: event.pointerId,
        nodeId: node.id,
        startPoint: point,
        startNode: { x: node.x, y: node.y },
        currentNode: { x: node.x, y: node.y },
      };
      longPressOriginRef.current = point;
      longPressTimerRef.current = window.setTimeout(() => {
        setContextMenu({ nodeId: node.id, left: point.x, top: point.y });
      }, LONG_PRESS_MS);
      return;
    }

    setConnectionSourceId(undefined);
    setConnectionDraft(undefined);
    onSelectNode(undefined);
    gestureRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      startPoint: point,
      startViewport: { ...liveViewportRef.current },
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) {
      return;
    }

    const point = getStagePoint(event);
    activePointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;

    if (gesture?.mode === "connect" && gesture.pointerId === event.pointerId) {
      const targetNodeId = findGenerationTargetAtPoint(event.clientX, event.clientY);
      const targetNode = targetNodeId
        ? nodes.find((node): node is CanvasGenerationNode => node.id === targetNodeId && node.type === "generation")
        : undefined;
      const currentWorld = targetNode ? getInputPoint(targetNode) : stageToWorld(point);
      gesture.currentWorld = currentWorld;
      gesture.targetNodeId = targetNodeId;
      gesture.moved = gesture.moved || getDistance(gesture.startPoint, point) >= CONNECTION_DRAG_THRESHOLD;
      setConnectionDraft({
        sourceNodeId: gesture.sourceNodeId,
        start: gesture.startWorld,
        current: currentWorld,
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
      const element = nodeElementsRef.current.get(gesture.nodeId);
      if (element) {
        element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      }
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
      const targetNodeId = gesture.targetNodeId ?? findGenerationTargetAtPoint(event.clientX, event.clientY);
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

    if (gesture?.mode === "drag" && gesture.pointerId === event.pointerId) {
      onNodeMove(gesture.nodeId, gesture.currentNode);
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="canvas-grid" aria-hidden="true" />
      <div ref={viewportLayerRef} className="canvas-viewport">
        <svg className="node-connections" aria-hidden="true">
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
          {connections.map(({ source, target, key, kind }) => {
            const start = getOutputPoint(source);
            const end = getInputPoint(target);
            const path = createConnectionPath(start, end);
            return (
              <g key={key}>
                <path className="node-connection-halo" d={path} />
                <path className={`node-connection-line is-${kind}`} d={path} />
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
                isSelected={selectedNodeId === node.id}
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
                isSelected={selectedNodeId === node.id}
                isConnectionSource={connectionSourceId === node.id}
                registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
                onBeginConnection={(event) => beginConnection(event, node)}
                onChange={(presetId, rules) => onRuleNodeChange(node.id, presetId, rules)}
              />
            );
          }

          return (
            <GenerationCanvasNode
              key={node.id}
              node={node}
              assetsById={assetsById}
              rulesById={rulesById}
              isSelected={selectedNodeId === node.id}
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
              onDisconnectReference={(assetId) => onDisconnectReference(node.id, assetId)}
              onDisconnectRule={(ruleNodeId) => onDisconnectRule(node.id, ruleNodeId)}
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
          <button
            type="button"
            onClick={() => {
              onNodeRemove(contextMenu.nodeId);
              setContextMenu(undefined);
            }}
          >
            <Trash />从画布移除
          </button>
        </div>
      )}

      <div className="gesture-hint">
        <HandTap />
        <span>拖拽端口连线 · 双指缩放 · 长按节点</span>
      </div>
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

function GenerationCanvasNode({
  node,
  assetsById,
  rulesById,
  isSelected,
  isOptimizing,
  hasPendingConnection,
  isConnectionTarget,
  registerElement,
  onAcceptConnection,
  onChange,
  onOptimize,
  onRun,
  onDisconnectReference,
  onDisconnectRule,
}: {
  node: CanvasGenerationNode;
  assetsById: Map<string, CanvasAssetView>;
  rulesById: Map<string, CanvasRuleNode>;
  isSelected: boolean;
  isOptimizing: boolean;
  hasPendingConnection: boolean;
  isConnectionTarget: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onAcceptConnection: () => void;
  onChange: (update: GenerationNodeUpdate) => void;
  onOptimize: () => void;
  onRun: () => void;
  onDisconnectReference: (assetId: string) => void;
  onDisconnectRule: (ruleNodeId: string) => void;
}) {
  const modelPreset = getImageModelPreset(node.request.model.model);
  const aspectRatioOptions = getImageAspectRatioOptions(modelPreset.id, node.request.resolution);
  const aspectRatioValue = normalizeImageAspectRatio(
    modelPreset.id,
    node.request.resolution,
    node.request.aspectRatio,
  );
  const resultViews = node.results
    .map((result) => assetsById.get(result.id))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const referenceViews = node.request.inputAssetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const connectedRules = (node.request.ruleNodeIds ?? [])
    .map((ruleNodeId) => rulesById.get(ruleNodeId))
    .filter((ruleNode): ruleNode is CanvasRuleNode => Boolean(ruleNode));
  const statusLabel = node.status === "running" ? "生成中" : node.status === "success" ? "完成" : node.status === "error" ? "失败" : "待运行";

  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node generation-node is-selected" : "canvas-node generation-node"} is-${node.status}`}
      data-canvas-node-id={node.id}
      data-generation-target-node-id={node.id}
      style={{ width: node.width, height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.zIndex }}
    >
      <header className="generation-node-header">
        <span className="generation-node-icon"><MagicWand weight="fill" /></span>
        <span><strong>{node.title}</strong><small>{modelPreset.name} · {referenceViews.length} 参考 · {connectedRules.length} 规则</small></span>
        <span className={`node-status is-${node.status}`}>{statusLabel}</span>
      </header>

      <button
        className={`${hasPendingConnection ? "node-port input-port is-ready" : "node-port input-port"}${isConnectionTarget ? " is-targeted" : ""}`}
        type="button"
        data-canvas-control="true"
        data-generation-input-node-id={node.id}
        aria-label="接收图片或规则节点连接"
        onClick={onAcceptConnection}
      >
        <span />
      </button>

      <div className="generation-node-content" data-canvas-control="true">
        <label className="model-select-field">
          <span className="field-label">模型</span>
          <select
            value={modelPreset.id}
            title={`模型：${modelPreset.name}`}
            onChange={(event) => {
              const preset = getImageModelPreset(event.currentTarget.value);
              const resolution = preset.resolutions.includes(node.request.resolution)
                ? node.request.resolution
                : preset.defaultResolution;
              onChange({
                model: { provider: "server-gateway", model: preset.id },
                resolution,
                aspectRatio: normalizeImageAspectRatio(
                  preset.id,
                  resolution,
                  node.request.aspectRatio,
                ),
              });
            }}
          >
            {IMAGE_MODEL_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
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
            {!referenceViews.length && !connectedRules.length && (
              <span className="reference-empty"><Link />拖入图片或规则节点</span>
            )}
          </div>
        </div>

        <div className={`generation-preview is-${node.status}`}>
          {resultViews.length ? (
            <div className={`generation-result-grid count-${Math.min(resultViews.length, 4)}`}>
              {resultViews.slice(0, 4).map(({ asset, displayUri }, index) => (
                <img key={asset.id} src={displayUri} alt={`${node.title} 结果 ${index + 1}`} />
              ))}
            </div>
          ) : node.status === "running" ? (
            <div className="generation-preview-state"><span className="generation-spinner" /><strong>正在生成产品概念图</strong><small>结果会直接保存在素材库</small></div>
          ) : node.status === "error" ? (
            <div className="generation-preview-state is-error"><span>!</span><strong>生成失败</strong><small>{node.error}</small></div>
          ) : (
            <div className="generation-preview-state"><MagicWand /><strong>生成结果</strong><small>选择模型、连接素材并运行当前节点</small></div>
          )}
        </div>

        <label className="node-prompt-field">
          <span className="prompt-field-heading">
            <span className="field-label">描述产品设计任务</span>
            <button type="button" className="prompt-optimize-action" onClick={onOptimize} disabled={isOptimizing || !node.request.prompt.trim()}>
              {isOptimizing ? <span className="button-spinner" /> : <MagicWand />}
              {isOptimizing ? "优化中" : "优化提示词"}
            </button>
          </span>
          <textarea
            value={node.request.prompt}
            placeholder="例如：便携式桌面投影仪，圆润一体化机身，磨砂铝与暖灰织物 CMF，工作室产品摄影……"
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
              value={node.request.resolution}
              onChange={(event) => {
                const resolution = event.currentTarget.value as ImageGenerationRequest["resolution"];
                onChange({
                  resolution,
                  aspectRatio: normalizeImageAspectRatio(
                    modelPreset.id,
                    resolution,
                    node.request.aspectRatio,
                  ),
                });
              }}
            >
              {modelPreset.resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution.toUpperCase()}</option>)}
            </select>
          </label>
          <label>
            <span>张数</span>
            <select value={node.request.count} onChange={(event) => onChange({ count: Number(event.currentTarget.value) })}>
              <option value={1}>1</option><option value={2}>2</option><option value={4}>4</option>
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

function collectConnections(nodes: CanvasNode[]) {
  const sourceNodes = nodes.filter((node): node is Extract<CanvasNode, { type: "image" | "rule" }> => node.type === "image" || node.type === "rule");
  const connections: Array<{
    source: Extract<CanvasNode, { type: "image" | "rule" }>;
    target: CanvasGenerationNode;
    key: string;
    kind: "image" | "rule";
  }> = [];
  for (const target of nodes) {
    if (target.type !== "generation") {
      continue;
    }
    target.request.inputAssetIds.forEach((assetId) => {
      const source = sourceNodes.find((node) => node.type === "image" && node.assetId === assetId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-image`, kind: "image" });
    });
    (target.request.ruleNodeIds ?? []).forEach((ruleNodeId) => {
      const source = sourceNodes.find((node) => node.type === "rule" && node.id === ruleNodeId);
      if (source) connections.push({ source, target, key: `${source.id}-${target.id}-rule`, kind: "rule" });
    });
  }
  return connections;
}

function findGenerationTargetAtPoint(clientX: number, clientY: number): string | undefined {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const inputTarget = element.closest<HTMLElement>("[data-generation-input-node-id]");
    if (inputTarget?.dataset.generationInputNodeId) {
      return inputTarget.dataset.generationInputNodeId;
    }
    const nodeTarget = element.closest<HTMLElement>("[data-generation-target-node-id]");
    if (nodeTarget?.dataset.generationTargetNodeId) {
      return nodeTarget.dataset.generationTargetNodeId;
    }
  }
  return undefined;
}

function getOutputPoint(node: Extract<CanvasNode, { type: "image" | "rule" }>): CanvasPoint {
  return { x: node.x + node.width + 8, y: node.y + node.height / 2 };
}

function getInputPoint(node: CanvasGenerationNode): CanvasPoint {
  return { x: node.x - 8, y: node.y + 76 };
}

function createConnectionPath(start: CanvasPoint, end: CanvasPoint): string {
  const distance = Math.max(Math.abs(end.x - start.x) * 0.46, 70);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
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

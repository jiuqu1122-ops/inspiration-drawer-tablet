import {
  DotsThree,
  HandTap,
  ImageSquare,
  Link,
  MagicWand,
  Play,
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
import type {
  CanvasGenerationNode,
  CanvasNode,
  CanvasPoint,
  CanvasViewport,
  ImageAsset,
  ImageGenerationRequest,
} from "../../../shared";

export interface CanvasAssetView {
  asset: ImageAsset;
  displayUri: string;
}

export type GenerationNodeUpdate = Partial<
  Pick<ImageGenerationRequest, "prompt" | "aspectRatio" | "resolution" | "count">
>;

interface CanvasStageProps {
  nodes: CanvasNode[];
  assets: CanvasAssetView[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  onImportRequest: () => void;
  onGenerateRequest: () => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodeMove: (nodeId: string, point: CanvasPoint) => void;
  onNodeRemove: (nodeId: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onGenerationChange: (nodeId: string, update: GenerationNodeUpdate) => void;
  onRunGeneration: (nodeId: string) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onDisconnectReference: (targetNodeId: string, assetId: string) => void;
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
    };

interface ContextMenuState {
  nodeId: string;
  left: number;
  top: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const LONG_PRESS_MS = 520;

export function CanvasStage({
  nodes,
  assets,
  viewport,
  selectedNodeId,
  onImportRequest,
  onGenerateRequest,
  onViewportChange,
  onNodeMove,
  onNodeRemove,
  onSelectNode,
  onGenerationChange,
  onRunGeneration,
  onConnect,
  onDisconnectReference,
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

  const assetsById = useMemo(
    () => new Map(assets.map((entry) => [entry.asset.id, entry])),
    [assets],
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

  const getStagePoint = (event: ReactPointerEvent<HTMLDivElement>): CanvasPoint => {
    const bounds = stageRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
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
          </defs>
          {connections.map(({ source, target, key }, index) => {
            const start = { x: source.x + source.width + 8, y: source.y + source.height / 2 };
            const end = { x: target.x - 8, y: target.y + 76 + index * 2 };
            const path = createConnectionPath(start, end);
            return (
              <g key={key}>
                <path className="node-connection-halo" d={path} />
                <path className="node-connection-line" d={path} />
                <circle className="connection-point source" cx={start.x} cy={start.y} r="5" />
                <circle className="connection-point target" cx={end.x} cy={end.y} r="5" />
              </g>
            );
          })}
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
                onArmConnection={() => {
                  setConnectionSourceId((current) => current === node.id ? undefined : node.id);
                  onSelectNode(node.id);
                }}
              />
            );
          }

          return (
            <GenerationCanvasNode
              key={node.id}
              node={node}
              assetsById={assetsById}
              isSelected={selectedNodeId === node.id}
              hasPendingConnection={Boolean(connectionSourceId)}
              registerElement={(element) => registerNodeElement(node.id, element, nodeElementsRef.current)}
              onAcceptConnection={() => {
                if (connectionSourceId) {
                  onConnect(connectionSourceId, node.id);
                  setConnectionSourceId(undefined);
                }
              }}
              onChange={(update) => onGenerationChange(node.id, update)}
              onRun={() => onRunGeneration(node.id)}
              onDisconnectReference={(assetId) => onDisconnectReference(node.id, assetId)}
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

      {connectionSourceId && (
        <div className="connection-hint" data-canvas-control="true">
          <Link />已选择参考图，点击生图节点左侧连接点
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
        <span>双指缩放 · 拖动画布 · 长按节点</span>
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
  onArmConnection,
}: {
  node: Extract<CanvasNode, { type: "image" }>;
  assetView: CanvasAssetView;
  isSelected: boolean;
  isConnectionSource: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onArmConnection: () => void;
}) {
  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node image-node is-selected" : "canvas-node image-node"}${isConnectionSource ? " is-connection-source" : ""}`}
      data-canvas-node-id={node.id}
      style={{
        width: node.width,
        height: node.height,
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        zIndex: node.zIndex,
      }}
    >
      <img src={assetView.displayUri} alt={node.title} draggable={false} />
      <span className="node-title">{node.title}</span>
      <span className="node-more" aria-hidden="true"><DotsThree weight="bold" /></span>
      <button
        className="node-port output-port"
        type="button"
        data-canvas-control="true"
        aria-pressed={isConnectionSource}
        aria-label="把图片连接到生图节点"
        onClick={onArmConnection}
      >
        <span />
      </button>
    </div>
  );
}

function GenerationCanvasNode({
  node,
  assetsById,
  isSelected,
  hasPendingConnection,
  registerElement,
  onAcceptConnection,
  onChange,
  onRun,
  onDisconnectReference,
}: {
  node: CanvasGenerationNode;
  assetsById: Map<string, CanvasAssetView>;
  isSelected: boolean;
  hasPendingConnection: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
  onAcceptConnection: () => void;
  onChange: (update: GenerationNodeUpdate) => void;
  onRun: () => void;
  onDisconnectReference: (assetId: string) => void;
}) {
  const resultViews = node.results
    .map((result) => assetsById.get(result.id))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const referenceViews = node.request.inputAssetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((view): view is CanvasAssetView => Boolean(view));
  const statusLabel = node.status === "running"
    ? "生成中"
    : node.status === "success"
      ? "完成"
      : node.status === "error"
        ? "失败"
        : "待运行";

  return (
    <div
      ref={registerElement}
      className={`${isSelected ? "canvas-node generation-node is-selected" : "canvas-node generation-node"} is-${node.status}`}
      data-canvas-node-id={node.id}
      style={{
        width: node.width,
        height: node.height,
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        zIndex: node.zIndex,
      }}
    >
      <header className="generation-node-header">
        <span className="generation-node-icon"><MagicWand weight="fill" /></span>
        <span><strong>{node.title}</strong><small>{referenceViews.length} 张参考图</small></span>
        <span className={`node-status is-${node.status}`}>{statusLabel}</span>
      </header>

      <button
        className={hasPendingConnection ? "node-port input-port is-ready" : "node-port input-port"}
        type="button"
        data-canvas-control="true"
        aria-label="接收参考图片连接"
        onClick={onAcceptConnection}
      >
        <span />
      </button>

      <div className="generation-node-content" data-canvas-control="true">
        <div className="reference-strip">
          <span className="field-label">参考图</span>
          <div className="reference-items">
            {referenceViews.length ? referenceViews.map(({ asset, displayUri }) => (
              <span className="reference-thumb" key={asset.id}>
                <img src={displayUri} alt={asset.name} />
                <button type="button" onClick={() => onDisconnectReference(asset.id)} aria-label={`移除参考图 ${asset.name}`}>
                  <X />
                </button>
              </span>
            )) : (
              <span className="reference-empty"><Link />从图片节点连接参考素材</span>
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
            <div className="generation-preview-state"><MagicWand /><strong>生成结果</strong><small>填写描述后运行当前节点</small></div>
          )}
        </div>

        <label className="node-prompt-field">
          <span className="field-label">描述产品设计任务</span>
          <textarea
            value={node.request.prompt}
            placeholder="例如：便携式桌面投影仪，圆润一体化机身，磨砂铝与暖灰织物 CMF，工作室产品摄影……"
            onChange={(event) => onChange({ prompt: event.currentTarget.value })}
          />
        </label>

        <footer className="generation-node-footer">
          <label>
            <span>比例</span>
            <select value={node.request.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value as ImageGenerationRequest["aspectRatio"] })}>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
          </label>
          <label>
            <span>清晰度</span>
            <select value={node.request.resolution} onChange={(event) => onChange({ resolution: event.currentTarget.value as ImageGenerationRequest["resolution"] })}>
              <option value="1k">1K</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
            </select>
          </label>
          <label>
            <span>张数</span>
            <select value={node.request.count} onChange={(event) => onChange({ count: Number(event.currentTarget.value) })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={4}>4</option>
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
  const imageNodes = nodes.filter((node): node is Extract<CanvasNode, { type: "image" }> => node.type === "image");
  const connections: Array<{
    source: Extract<CanvasNode, { type: "image" }>;
    target: CanvasGenerationNode;
    key: string;
  }> = [];

  for (const target of nodes) {
    if (target.type !== "generation") {
      continue;
    }
    target.request.inputAssetIds.forEach((assetId) => {
      const source = imageNodes.find((node) => node.assetId === assetId);
      if (source) {
        connections.push({ source, target, key: `${source.id}-${target.id}` });
      }
    });
  }
  return connections;
}

function createConnectionPath(start: CanvasPoint, end: CanvasPoint): string {
  const distance = Math.max(Math.abs(end.x - start.x) * 0.46, 70);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
}

function registerNodeElement(
  nodeId: string,
  element: HTMLDivElement | null,
  elements: Map<string, HTMLDivElement>,
) {
  if (element) {
    elements.set(nodeId, element);
  } else {
    elements.delete(nodeId);
  }
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

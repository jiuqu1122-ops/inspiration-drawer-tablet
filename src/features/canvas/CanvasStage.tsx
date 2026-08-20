import {
  DotsThree,
  HandTap,
  ImageSquare,
  Trash,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  CanvasNode,
  CanvasPoint,
  CanvasViewport,
  ImageAsset,
} from "../../../shared";

export interface CanvasAssetView {
  asset: ImageAsset;
  displayUri: string;
}

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

  const assetsById = new Map(assets.map((entry) => [entry.asset.id, entry]));

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
        {nodes.map((node) => {
          const assetView = node.type === "image"
            ? assetsById.get(node.assetId)
            : assetsById.get(node.results[0]?.id);
          if (node.type === "image" && !assetView) {
            return null;
          }

          const stateClass = node.type === "generation" ? ` is-${node.status}` : "";

          return (
            <div
              key={node.id}
              ref={(element) => {
                if (element) {
                  nodeElementsRef.current.set(node.id, element);
                } else {
                  nodeElementsRef.current.delete(node.id);
                }
              }}
              className={`${selectedNodeId === node.id ? "canvas-node is-selected" : "canvas-node"}${stateClass}`}
              data-canvas-node-id={node.id}
              style={{
                width: node.width,
                height: node.height,
                transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
                zIndex: node.zIndex,
              }}
            >
              {assetView ? (
                <img src={assetView.displayUri} alt={node.title} draggable={false} />
              ) : node.type === "generation" ? (
                <div className="generation-node-state">
                  {node.status === "running" ? <span className="generation-spinner" /> : <MagicPromptIcon />}
                  <strong>{node.status === "error" ? "生成失败" : "正在生成概念图"}</strong>
                  <p>{node.status === "error" ? node.error : node.request.prompt}</p>
                </div>
              ) : null}
              <span className="node-title">{node.title}</span>
              {node.type === "generation" && node.status === "success" && node.results.length > 1 && (
                <span className="node-result-count">+{node.results.length - 1}</span>
              )}
              <span className="node-more" aria-hidden="true"><DotsThree weight="bold" /></span>
            </div>
          );
        })}
      </div>

      {nodes.length === 0 && (
        <div className="canvas-empty-state">
          <span className="canvas-empty-icon"><ImageSquare /></span>
          <span className="eyebrow">EMPTY CANVAS</span>
          <h1>把灵感放进画布</h1>
          <p>从设备导入图片素材，或使用 AI 生成第一张产品概念图。</p>
          <div className="canvas-empty-actions">
            <button className="primary-action" type="button" onClick={onImportRequest}>
              <ImageSquare />导入图片
            </button>
            <button className="canvas-text-action" type="button" onClick={onGenerateRequest}>
              <span aria-hidden="true">✦</span>开始生成
            </button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
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
        <span>双指缩放 · 拖动画布 · 长按打开菜单</span>
      </div>
    </div>
  );
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

function MagicPromptIcon() {
  return <span className="generation-error-icon" aria-hidden="true">!</span>;
}

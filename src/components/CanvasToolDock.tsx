import {
  ArrowsOutCardinal,
  FlowArrow,
  ImageSquare,
  MagicWand,
  Play,
  SlidersHorizontal,
  TextT,
} from "@phosphor-icons/react";

interface CanvasToolDockProps {
  canRun: boolean;
  onImport: () => void;
  onAddGeneration: () => void;
  onAddRules: () => void;
  onAddText: () => void;
  onRun: () => void;
  onArrange: () => void;
  onWorkflow: () => void;
}

export function CanvasToolDock({
  canRun,
  onImport,
  onAddGeneration,
  onAddRules,
  onAddText,
  onRun,
  onArrange,
  onWorkflow,
}: CanvasToolDockProps) {
  return (
    <nav className="canvas-tool-dock" aria-label="画布节点工具">
      <ToolButton label="图片" icon={ImageSquare} onClick={onImport} />
      <ToolButton label="生图节点" icon={MagicWand} onClick={onAddGeneration} />
      <ToolButton label="规则节点" icon={SlidersHorizontal} onClick={onAddRules} />
      <ToolButton label="文字 LLM" icon={TextT} onClick={onAddText} />
      <ToolButton label="工作流" icon={FlowArrow} onClick={onWorkflow} />
      <span className="tool-dock-divider" aria-hidden="true" />
      <ToolButton label="运行" icon={Play} onClick={onRun} disabled={!canRun} />
      <ToolButton label="整理" icon={ArrowsOutCardinal} onClick={onArrange} />
    </nav>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof ImageSquare;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}>
      <Icon />
      <span>{label}</span>
    </button>
  );
}

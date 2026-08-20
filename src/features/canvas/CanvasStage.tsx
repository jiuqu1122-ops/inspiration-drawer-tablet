import { HandTap, ImageSquare } from "@phosphor-icons/react";

export function CanvasStage() {
  return (
    <div className="canvas-stage">
      <div className="canvas-grid" aria-hidden="true" />
      <div className="canvas-empty-state">
        <span className="canvas-empty-icon"><ImageSquare /></span>
        <span className="eyebrow">EMPTY CANVAS</span>
        <h1>把灵感放进画布</h1>
        <p>从设备导入图片素材，或使用 AI 生成第一张产品概念图。</p>
        <div className="canvas-empty-actions">
          <button className="primary-action" type="button"><ImageSquare />导入图片</button>
          <button className="canvas-text-action" type="button"><MagicPromptIcon />开始生成</button>
        </div>
      </div>
      <div className="gesture-hint">
        <HandTap />
        <span>双指缩放 · 拖动画布 · 长按打开菜单</span>
      </div>
    </div>
  );
}

function MagicPromptIcon() {
  return <span aria-hidden="true">✦</span>;
}

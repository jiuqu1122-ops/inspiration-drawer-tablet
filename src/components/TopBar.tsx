import {
  ArrowCounterClockwise,
  ArrowUDownLeft,
  ImageSquare,
  MagicWand,
  SquaresFour,
} from "@phosphor-icons/react";

interface TopBarProps {
  zoom: number;
  isImporting: boolean;
  onImport: () => void;
  onGenerate: () => void;
}

export function TopBar({ zoom, isImporting, onImport, onGenerate }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup" aria-label="Inspiration Drawer Tablet">
        <span className="brand-mark" aria-hidden="true">
          <SquaresFour weight="fill" />
        </span>
        <span className="brand-text">INSPIRATION DRAWER</span>
      </div>

      <button className="project-switcher" type="button">
        <span className="project-kicker">当前项目</span>
        <strong>未命名工业设计项目</strong>
      </button>

      <div className="top-actions">
        <div className="history-actions" aria-label="历史操作">
          <button className="icon-button" type="button" disabled aria-label="撤销">
            <ArrowUDownLeft />
          </button>
          <button className="icon-button" type="button" disabled aria-label="重做">
            <ArrowCounterClockwise />
          </button>
        </div>
        <span className="zoom-readout" aria-label={`画布缩放 ${zoom}%`}>{zoom}%</span>
        <button className="secondary-action" type="button" onClick={onImport} disabled={isImporting}>
          <ImageSquare />
          <span>{isImporting ? "导入中" : "导入素材"}</span>
        </button>
        <button className="primary-action" type="button" onClick={onGenerate}>
          <MagicWand weight="fill" />
          <span>生成图像</span>
        </button>
      </div>
    </header>
  );
}

import {
  ArrowCounterClockwise,
  ArrowUDownLeft,
  ImageSquare,
  MagicWand,
  Moon,
  SquaresFour,
  Sun,
  UserCircle,
} from "@phosphor-icons/react";
import type { ServerSession } from "../services/tauriServerSessionService";

interface TopBarProps {
  projectName: string;
  zoom: number;
  isImporting: boolean;
  isDarkMode: boolean;
  session: ServerSession;
  onImport: () => void;
  onAddGeneration: () => void;
  onProjectsOpen: () => void;
  onThemeToggle: () => void;
  onAccountOpen: () => void;
}

export function TopBar({
  projectName,
  zoom,
  isImporting,
  isDarkMode,
  session,
  onImport,
  onAddGeneration,
  onProjectsOpen,
  onThemeToggle,
  onAccountOpen,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup" aria-label="Inspiration Drawer Mobile">
        <span className="brand-mark" aria-hidden="true">
          <SquaresFour weight="fill" />
        </span>
        <span className="brand-text">INSPIRATION DRAWER</span>
        <span className="tablet-badge">MOBILE</span>
      </div>

      <button className="project-switcher" type="button" onClick={onProjectsOpen}>
        <strong>{projectName}</strong>
        <span>无限画布</span>
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
        <button className="icon-button theme-toggle" type="button" onClick={onThemeToggle} aria-label={isDarkMode ? "切换到日间模式" : "切换到夜间模式"} title={isDarkMode ? "日间模式" : "夜间模式"}>
          {isDarkMode ? <Sun /> : <Moon />}
        </button>
        <button className={session.authenticated ? "account-chip is-authenticated" : "account-chip"} type="button" onClick={onAccountOpen}>
          <UserCircle weight={session.authenticated ? "fill" : "regular"} />
          <span>{session.authenticated ? formatCredits(session.availableCredits) : "登录"}</span>
        </button>
        <button className="secondary-action" type="button" onClick={onImport} disabled={isImporting}>
          <ImageSquare />
          <span>{isImporting ? "导入中" : "导入素材"}</span>
        </button>
        <button className="primary-action" type="button" onClick={onAddGeneration}>
          <MagicWand weight="fill" />
          <span>生图节点</span>
        </button>
      </div>
    </header>
  );
}

function formatCredits(value?: string): string {
  if (!value) return "额度";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(numeric)} 积分`
    : `${value} 积分`;
}

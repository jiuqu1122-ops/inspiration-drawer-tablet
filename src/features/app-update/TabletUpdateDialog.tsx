import { ArrowClockwise, CheckCircle, DownloadSimple, ShieldCheck, X } from "@phosphor-icons/react";
import type { TabletUpdateInfo } from "../../services/tabletUpdateService";

interface TabletUpdateDialogProps {
  open: boolean;
  update?: TabletUpdateInfo;
  installing: boolean;
  progress: number;
  message?: string;
  onClose: () => void;
  onInstall: () => void;
}

export function TabletUpdateDialog({
  open,
  update,
  installing,
  progress,
  message,
  onClose,
  onInstall,
}: TabletUpdateDialogProps) {
  if (!open || !update) return null;
  return (
    <div className="modal-backdrop tablet-update-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !installing && !update.mandatory) onClose();
    }}>
      <section className="tablet-update-dialog" role="dialog" aria-modal="true" aria-labelledby="tablet-update-title">
        <header>
          <span className="tablet-update-icon"><ArrowClockwise weight="bold" /></span>
          <span>
            <small>ANDROID UPDATE</small>
            <strong id="tablet-update-title">发现新版本 {update.version}</strong>
          </span>
          {!update.mandatory && (
            <button type="button" onClick={onClose} disabled={installing} aria-label="稍后更新"><X /></button>
          )}
        </header>
        <div className="tablet-update-content">
          <div className="tablet-update-meta">
            <span>当前版本 {update.currentVersion}</span>
            <span>{formatBytes(update.size)}</span>
            <span>{update.architecture}</span>
          </div>
          <p className="tablet-update-notes">{update.notes?.trim() || "性能优化与问题修复"}</p>
          <div className="tablet-update-security">
            <ShieldCheck weight="fill" />
            <span>下载完成后会校验文件哈希、应用标识与 Android 签名。</span>
          </div>
          {installing && (
            <div className="tablet-update-progress" aria-live="polite">
              <div><span style={{ width: `${Math.max(3, progress)}%` }} /></div>
              <p>{message || `正在下载更新 ${progress}%`}</p>
            </div>
          )}
          {!installing && message && (
            <p className="tablet-update-message"><CheckCircle weight="fill" />{message}</p>
          )}
          <div className="tablet-update-actions">
            {!update.mandatory && <button type="button" onClick={onClose} disabled={installing}>稍后</button>}
            <button className="is-primary" type="button" onClick={onInstall} disabled={installing}>
              <DownloadSimple weight="bold" />{installing ? "准备安装" : "下载并安装"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

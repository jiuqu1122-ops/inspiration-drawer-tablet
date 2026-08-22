import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TabletUpdateInfo {
  available: boolean;
  currentVersion: string;
  version: string;
  notes?: string;
  pubDate?: string;
  mandatory: boolean;
  size: number;
  architecture: string;
  sourceName: string;
}

export interface TabletUpdateInstallResult {
  version: string;
  downloaded: boolean;
  installerLaunched: boolean;
  permissionRequired: boolean;
}

export interface TabletUpdateProgress {
  stage: "downloading" | "verified";
  version: string;
  loaded: number;
  total: number;
  progress: number;
}

export async function getTabletVersion(): Promise<string> {
  return isTauri() ? getVersion() : "0.1.2";
}

export async function checkTabletUpdate(): Promise<TabletUpdateInfo> {
  assertTauriRuntime();
  return invoke<TabletUpdateInfo>("check_tablet_update");
}

export async function installTabletUpdate(version: string): Promise<TabletUpdateInstallResult> {
  assertTauriRuntime();
  return invoke<TabletUpdateInstallResult>("install_tablet_update", { version });
}

function assertTauriRuntime(): void {
  if (!isTauri()) {
    throw new Error("自动更新需要在 Android 应用中运行");
  }
}

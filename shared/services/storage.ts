import type { CanvasProject } from "../types/canvas";
import type { DeviceImageImport, ImageAsset } from "../types/media";

export interface StorageService {
  listProjects(): Promise<CanvasProject[]>;
  loadProject(projectId: string): Promise<CanvasProject | null>;
  saveProject(project: CanvasProject): Promise<void>;
  importDeviceImage(input: DeviceImageImport): Promise<ImageAsset>;
  saveGeneratedImage(input: ImageAsset): Promise<ImageAsset>;
  getImageAsset(assetId: string): Promise<ImageAsset | null>;
  resolveDisplayUri(asset: ImageAsset): Promise<string>;
  removeImageAsset(assetId: string): Promise<void>;
}

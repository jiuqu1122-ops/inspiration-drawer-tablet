import type {
  CanvasTemplateLibraryData,
  CanvasProject,
  DeviceImageImport,
  ImageAsset,
  StorageService,
} from "../../shared";
import { createId } from "../utils/id";

const DATABASE_NAME = "inspiration-drawer-tablet";
const DATABASE_VERSION = 2;
const PROJECT_STORE = "projects";
const IMAGE_STORE = "images";
const TEMPLATE_STORE = "templates";
const TEMPLATE_LIBRARY_ID = "canvas-template-library";

interface StoredTemplateLibrary extends CanvasTemplateLibraryData {
  id: typeof TEMPLATE_LIBRARY_ID;
}

interface StoredImageRecord {
  asset: ImageAsset;
  blob: Blob;
}

export class IndexedDbStorageService implements StorageService {
  private readonly displayUris = new Map<string, string>();
  private databasePromise?: Promise<IDBDatabase>;

  async listProjects(): Promise<CanvasProject[]> {
    return this.getAll<CanvasProject>(PROJECT_STORE);
  }

  async loadProject(projectId: string): Promise<CanvasProject | null> {
    return (await this.get<CanvasProject>(PROJECT_STORE, projectId)) ?? null;
  }

  async saveProject(project: CanvasProject): Promise<void> {
    await this.put(PROJECT_STORE, project);
  }

  async importDeviceImage(input: DeviceImageImport): Promise<ImageAsset> {
    const blob = await fetch(input.sourceUri).then((response) => {
      if (!response.ok) {
        throw new Error("无法读取所选图片");
      }
      return response.blob();
    });
    const asset: ImageAsset = {
      id: createId("image"),
      kind: "image",
      name: input.name,
      mimeType: input.mimeType || blob.type || "image/*",
      storageKind: "sandbox",
      uri: "",
      dimensions: input.dimensions,
      byteSize: input.byteSize ?? blob.size,
      createdAt: Date.now(),
      source: "device",
    };
    asset.uri = `asset://${asset.id}`;

    await this.put(IMAGE_STORE, { asset, blob } satisfies StoredImageRecord);
    return asset;
  }

  async saveGeneratedImage(input: ImageAsset): Promise<ImageAsset> {
    const blob = await fetch(input.uri).then((response) => {
      if (!response.ok) {
        throw new Error("无法保存生成图片");
      }
      return response.blob();
    });
    const asset: ImageAsset = {
      ...input,
      id: input.id || createId("generated-image"),
      storageKind: "sandbox",
      source: "generated",
    };
    asset.uri = `asset://${asset.id}`;

    await this.put(IMAGE_STORE, { asset, blob } satisfies StoredImageRecord);
    return asset;
  }

  async listImageAssets(): Promise<ImageAsset[]> {
    const records = await this.getAll<StoredImageRecord>(IMAGE_STORE);
    return records.map((record) => record.asset).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getImageAsset(assetId: string): Promise<ImageAsset | null> {
    return (await this.get<StoredImageRecord>(IMAGE_STORE, assetId))?.asset ?? null;
  }

  async resolveDisplayUri(asset: ImageAsset): Promise<string> {
    const cached = this.displayUris.get(asset.id);
    if (cached) {
      return cached;
    }

    if (asset.storageKind === "remote" || asset.storageKind === "memory") {
      return asset.uri;
    }

    const record = await this.get<StoredImageRecord>(IMAGE_STORE, asset.id);
    if (!record) {
      throw new Error(`图片素材不存在：${asset.name}`);
    }

    const uri = URL.createObjectURL(record.blob);
    this.displayUris.set(asset.id, uri);
    return uri;
  }

  async removeImageAsset(assetId: string): Promise<void> {
    const cached = this.displayUris.get(assetId);
    if (cached) {
      URL.revokeObjectURL(cached);
      this.displayUris.delete(assetId);
    }
    await this.delete(IMAGE_STORE, assetId);
  }

  async loadCanvasTemplateLibrary(): Promise<CanvasTemplateLibraryData> {
    const stored = await this.get<StoredTemplateLibrary>(TEMPLATE_STORE, TEMPLATE_LIBRARY_ID);
    return {
      workflows: Array.isArray(stored?.workflows) ? stored.workflows : [],
      nodePresets: Array.isArray(stored?.nodePresets) ? stored.nodePresets : [],
      hiddenWorkflowPresetIds: Array.isArray(stored?.hiddenWorkflowPresetIds)
        ? stored.hiddenWorkflowPresetIds
        : [],
    };
  }

  async saveCanvasTemplateLibrary(library: CanvasTemplateLibraryData): Promise<void> {
    await this.put(TEMPLATE_STORE, {
      id: TEMPLATE_LIBRARY_ID,
      workflows: library.workflows,
      nodePresets: library.nodePresets,
      hiddenWorkflowPresetIds: library.hiddenWorkflowPresetIds ?? [],
    } satisfies StoredTemplateLibrary);
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onerror = () => reject(request.error ?? new Error("无法打开应用存储"));
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(PROJECT_STORE)) {
            database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(IMAGE_STORE)) {
            database.createObjectStore(IMAGE_STORE, { keyPath: "asset.id" });
          }
          if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
            database.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }
    return this.databasePromise;
  }

  private async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onerror = () => reject(request.error ?? new Error("读取本地数据失败"));
      request.onsuccess = () => resolve(request.result as T | undefined);
    });
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onerror = () => reject(request.error ?? new Error("读取本地数据失败"));
      request.onsuccess = () => resolve(request.result as T[]);
    });
  }

  private async put(storeName: string, value: unknown): Promise<void> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("写入本地数据失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("写入本地数据已取消"));
    });
  }

  private async delete(storeName: string, key: IDBValidKey): Promise<void> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("删除本地数据失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("删除本地数据已取消"));
    });
  }
}

export const tabletStorage = new IndexedDbStorageService();

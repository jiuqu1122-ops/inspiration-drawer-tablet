import { invoke, isTauri } from "@tauri-apps/api/core";

interface ImageActionInput {
  dataUri: string;
  fileName: string;
  mimeType: string;
}

interface ImageActionResult {
  uri?: string;
  fileName?: string;
}

export async function saveImageToGallery(
  uri: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const input = await createActionInput(uri, fileName, mimeType);
  if (isTauri()) {
    try {
      await invoke<ImageActionResult>("save_image_to_gallery", { input });
      return;
    } catch (error) {
      // Desktop/browser previews still get a usable download fallback. Android
      // production builds use the native MediaStore command above.
      if (isAndroidRuntime()) throw error;
    }
  }
  downloadBlob(input.dataUri, input.fileName);
}

export async function shareImage(
  uri: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const input = await createActionInput(uri, fileName, mimeType);
  if (isTauri()) {
    try {
      await invoke<ImageActionResult>("share_image", { input });
      return;
    } catch (error) {
      if (isAndroidRuntime()) throw error;
    }
  }

  const blob = dataUriToBlob(input.dataUri);
  const file = new File([blob], input.fileName, { type: input.mimeType });
  if (typeof navigator.share === "function") {
    const canShareFiles = typeof navigator.canShare !== "function"
      || navigator.canShare({ files: [file] });
    if (canShareFiles) {
      await navigator.share({ files: [file], title: input.fileName });
      return;
    }
    await navigator.share({ title: input.fileName, text: "Inspiration Drawer 生成图片" });
    return;
  }
  downloadBlob(input.dataUri, input.fileName);
}

async function createActionInput(uri: string, fileName: string, mimeType: string): Promise<ImageActionInput> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("无法读取图片数据");
  const blob = await response.blob();
  return {
    dataUri: await blobToDataUri(blob),
    fileName: normalizeFileName(fileName, blob.type || mimeType),
    mimeType: blob.type || mimeType || "image/jpeg",
  };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, encoded] = dataUri.split(",", 2);
  const mimeType = header.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
  const bytes = atob(encoded || "");
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mimeType });
}

function downloadBlob(dataUri: string, fileName: string): void {
  const url = URL.createObjectURL(dataUriToBlob(dataUri));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function normalizeFileName(name: string, mimeType: string): string {
  const clean = name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  if (clean.includes(".")) return clean;
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `${clean || "inspiration-drawer"}.${extension}`;
}

function isAndroidRuntime(): boolean {
  return /Android/i.test(navigator.userAgent);
}

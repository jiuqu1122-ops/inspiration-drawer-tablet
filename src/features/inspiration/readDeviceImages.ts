import type { DeviceImageImport } from "../../../shared";

export interface PendingDeviceImage {
  input: DeviceImageImport;
  release: () => void;
}

export async function readDeviceImage(file: File): Promise<PendingDeviceImage> {
  const sourceUri = URL.createObjectURL(file);

  try {
    const dimensions = await readDimensions(file);

    return {
      input: {
        sourceUri,
        name: file.name || `device-image-${Date.now()}`,
        mimeType: file.type || "image/*",
        byteSize: file.size,
        dimensions,
      },
      release: () => URL.revokeObjectURL(sourceUri),
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUri);
    throw error;
  }
}

async function readDimensions(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  const uri = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`无法读取图片尺寸：${file.name}`));
      image.src = uri;
    });
  } finally {
    URL.revokeObjectURL(uri);
  }
}

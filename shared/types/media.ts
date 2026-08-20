export type MediaKind = "image";

export type MediaStorageKind =
  | "sandbox"
  | "content-uri"
  | "remote"
  | "memory";

export interface MediaDimensions {
  width: number;
  height: number;
}

export interface ImageAsset {
  id: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  storageKind: MediaStorageKind;
  uri: string;
  thumbnailUri?: string;
  dimensions?: MediaDimensions;
  byteSize?: number;
  createdAt: number;
  source: "device" | "generated";
}

export interface DeviceImageImport {
  sourceUri: string;
  name: string;
  mimeType: string;
  byteSize?: number;
  dimensions?: MediaDimensions;
}

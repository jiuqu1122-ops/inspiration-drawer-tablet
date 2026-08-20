import type { ImageResolution } from "./generation";

export type ImageModelPresetId =
  | "nano-banana-pro"
  | "nano-banana-2"
  | "gpt-image-2";

export type ImageChannelProvider = "xais-chat" | "new-api" | "bigmodel";

export interface ImageModelChannelRoute {
  provider: ImageChannelProvider;
  models: Partial<Record<ImageResolution, string>>;
}

export interface ImageModelPreset {
  id: ImageModelPresetId;
  name: string;
  shortName: string;
  description: string;
  defaultResolution: ImageResolution;
  resolutions: ImageResolution[];
  routes: ImageModelChannelRoute[];
}

export const IMAGE_MODEL_PRESETS: ImageModelPreset[] = [
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    shortName: "Nano Pro",
    description: "产品质感、参考图一致性与高完成度概念渲染",
    defaultResolution: "2k",
    resolutions: ["2k", "4k"],
    routes: [
      { provider: "xais-chat", models: { "2k": "Xais Nano Pro_2K", "4k": "Xais Nano Pro_4K" } },
      { provider: "new-api", models: { "2k": "gemini-3-pro-image", "4k": "gemini-3-pro-image" } },
      { provider: "bigmodel", models: { "2k": "gemini-3-pro-image-preview", "4k": "gemini-3-pro-image-preview" } },
    ],
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    shortName: "Nano 2",
    description: "快速设计发散、多方案探索与参考图重组",
    defaultResolution: "2k",
    resolutions: ["2k", "4k"],
    routes: [
      { provider: "xais-chat", models: { "2k": "Xais Nano2_2K", "4k": "Xais Nano2_4K" } },
      { provider: "new-api", models: { "2k": "gemini-3.1-flash-image", "4k": "gemini-3.1-flash-image" } },
    ],
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    shortName: "Image 2",
    description: "构图控制、文字理解与复杂编辑任务",
    defaultResolution: "2k",
    resolutions: ["1k", "2k", "4k"],
    routes: [
      { provider: "xais-chat", models: { "2k": "Xais Img2_2K", "4k": "Xais Img2_4K" } },
      { provider: "new-api", models: { "1k": "gpt-image-2", "2k": "gpt-image-2", "4k": "gpt-image-2" } },
      { provider: "bigmodel", models: { "1k": "gpt-image-2", "2k": "gpt-image-2", "4k": "gpt-image-2" } },
    ],
  },
];

export function isImageModelPresetId(value: unknown): value is ImageModelPresetId {
  return IMAGE_MODEL_PRESETS.some((preset) => preset.id === value);
}

export function getImageModelPreset(value: unknown): ImageModelPreset {
  return IMAGE_MODEL_PRESETS.find((preset) => preset.id === value) ?? IMAGE_MODEL_PRESETS[0];
}

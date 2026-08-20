import type {
  ImageAspectRatio,
  ImageResolution,
  StandardImageAspectRatio,
} from "./generation";

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

export interface ImageAspectRatioOption {
  value: ImageAspectRatio;
  label: string;
}

export const STANDARD_IMAGE_ASPECT_RATIOS: StandardImageAspectRatio[] = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
];

const GPT_IMAGE_2_DIMENSIONS: Record<"2k" | "4k", ImageAspectRatio[]> = {
  "2k": [
    "2048x2048", "2048x1152", "1152x2048", "2064x1376", "1376x2064",
    "2048x1536", "1536x2048", "2016x864", "864x2016", "2080x1664",
    "1664x2080", "2048x1024", "2064x688",
  ],
  "4k": [
    "2880x2880", "3840x2160", "2160x3840", "3520x2352", "2352x3520",
    "3312x2480", "2480x3312", "3840x1648", "1648x3840", "3216x2576",
    "2576x3216", "3840x1920", "3840x1280", "1280x3840",
  ],
};

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

export function getImageAspectRatioOptions(
  model: ImageModelPresetId,
  resolution: ImageResolution,
): ImageAspectRatioOption[] {
  if (model === "gpt-image-2" && (resolution === "2k" || resolution === "4k")) {
    return GPT_IMAGE_2_DIMENSIONS[resolution].map((value) => ({
      value,
      label: `${value.replace("x", "×")} (${formatRatio(value)})`,
    }));
  }
  return STANDARD_IMAGE_ASPECT_RATIOS.map((value) => ({ value, label: value }));
}

export function normalizeImageAspectRatio(
  model: ImageModelPresetId,
  resolution: ImageResolution,
  value: unknown,
): ImageAspectRatio {
  const options = getImageAspectRatioOptions(model, resolution);
  const cleanValue = String(value ?? "").trim().replace("×", "x") as ImageAspectRatio;
  if (options.some((option) => option.value === cleanValue)) {
    return cleanValue;
  }
  const target = parseAspectRatio(cleanValue) ?? parseAspectRatio("16:9")!;
  return options.reduce((closest, option) => {
    const closestDistance = Math.abs((parseAspectRatio(closest) ?? 1) - target);
    const optionDistance = Math.abs((parseAspectRatio(option.value) ?? 1) - target);
    return optionDistance < closestDistance ? option.value : closest;
  }, options[0].value);
}

function formatRatio(value: string): string {
  const [rawWidth, rawHeight] = value.split(/[x×:]/).map(Number);
  if (!rawWidth || !rawHeight) return "16:9";
  const divisor = greatestCommonDivisor(rawWidth, rawHeight);
  return `${Math.round(rawWidth / divisor)}:${Math.round(rawHeight / divisor)}`;
}

function parseAspectRatio(value: string): number | undefined {
  const [width, height] = value.split(/[x×:]/).map(Number);
  return width > 0 && height > 0 ? width / height : undefined;
}

function greatestCommonDivisor(first: number, second: number): number {
  let width = Math.abs(Math.round(first));
  let height = Math.abs(Math.round(second));
  while (height) {
    const remainder = width % height;
    width = height;
    height = remainder;
  }
  return width || 1;
}

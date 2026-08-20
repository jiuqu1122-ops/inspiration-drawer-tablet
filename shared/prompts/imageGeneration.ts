export const INDUSTRIAL_DESIGN_RENDER_PROMPT = [
  "Preserve the product silhouette, proportions, controls, openings, parting lines and CMF boundaries from every reference image.",
  "Improve only the presentation: physically credible materials, controlled studio lighting, clean contact shadows and product-photography perspective.",
  "Keep the complete product visible and make it the visual focus.",
  "Do not add logos, text, watermarks, fictional functions or unrelated accessories.",
].join("\n");

export const buildIndustrialDesignPrompt = (userPrompt: string) => [
  userPrompt.trim(),
  INDUSTRIAL_DESIGN_RENDER_PROMPT,
].filter(Boolean).join("\n\n");

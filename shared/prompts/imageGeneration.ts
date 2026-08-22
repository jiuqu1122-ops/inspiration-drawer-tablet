export const IMAGE_GENERATION_QUALITY_PROMPT = [
  "Preserve the user's subject, intent, requested style and important details.",
  "Improve visual coherence with appropriate composition, lighting, color, materials, perspective and level of detail for the requested subject.",
  "Keep the main subject clear and fully inside the frame unless the user asks for a crop or abstract composition.",
  "Do not add unrequested logos, text, watermarks, fictional functions or unrelated objects.",
].join("\n");

export const buildImageGenerationPrompt = (userPrompt: string) => [
  userPrompt.trim(),
  IMAGE_GENERATION_QUALITY_PROMPT,
].filter(Boolean).join("\n\n");

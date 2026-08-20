import {
  IMAGE_RULE_DEFINITIONS,
  IMAGE_RULE_KEYS,
  type ImageRuleState,
  normalizeImageRuleState,
} from "../types/imageRules";

export interface ImageRulePromptFragments {
  positive: string[];
  negative: string[];
}

export function buildImageRulePromptFragments(
  rules: ImageRuleState | undefined,
): ImageRulePromptFragments {
  const normalized = normalizeImageRuleState(rules);
  return IMAGE_RULE_KEYS.reduce<ImageRulePromptFragments>((result, key) => {
    if (!normalized[key]) {
      return result;
    }
    const definition = IMAGE_RULE_DEFINITIONS[key];
    if (definition.constraint === "negative") {
      result.negative.push(definition.fragment);
    } else {
      result.positive.push(definition.fragment);
    }
    return result;
  }, { positive: [], negative: [] });
}

export function buildImageRulePrompt(rules: ImageRuleState | undefined): string {
  const fragments = buildImageRulePromptFragments(rules);
  return [
    fragments.positive.length
      ? `Image quality rules:\n${fragments.positive.map((fragment) => `- ${fragment}`).join("\n")}`
      : "",
    fragments.negative.length
      ? `Negative constraints:\n${fragments.negative.map((fragment) => `- ${fragment}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
}

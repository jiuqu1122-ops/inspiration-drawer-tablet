import {
  ChatCircleDots,
  Check,
  FlowArrow,
  GearSix,
  MagicWand,
  PaperPlaneTilt,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { ImageAspectRatio, ImageResolution } from "../../shared";

export type AssistantTab = "chat" | "prompt" | "workflow";

export interface GenerationSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  count: number;
}

interface AssistantPanelProps {
  activeTab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}

const tabs: Array<{ id: AssistantTab; label: string; icon: typeof ChatCircleDots }> = [
  { id: "chat", label: "AI 对话", icon: ChatCircleDots },
  { id: "prompt", label: "提示词", icon: MagicWand },
  { id: "workflow", label: "工作流", icon: FlowArrow },
];

const aspectRatios: ImageAspectRatio[] = ["1:1", "4:3", "3:4", "16:9"];
const resolutions: ImageResolution[] = ["1k", "2k", "4k"];

export function AssistantPanel({
  activeTab,
  onTabChange,
  prompt,
  onPromptChange,
  settings,
  onSettingsChange,
  isGenerating,
  onGenerate,
}: AssistantPanelProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const isConfigured = Boolean(
    settings.endpoint.trim() && settings.model.trim() && settings.apiKey.trim(),
  );

  const updateSettings = <Key extends keyof GenerationSettings>(
    key: Key,
    value: GenerationSettings[Key],
  ) => onSettingsChange({ ...settings, [key]: value });

  return (
    <aside className="assistant-panel" aria-label="AI 设计助手">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="assistant-heading">
        <div>
          <span className="eyebrow">DESIGN AGENT</span>
          <h2>AI 设计助手</h2>
        </div>
        <button
          className={isConfigured ? "model-state is-ready" : "model-state"}
          type="button"
          aria-expanded={isConfigOpen}
          onClick={() => setIsConfigOpen((current) => !current)}
        >
          <i />{isConfigured ? settings.model : "配置模型"}<GearSix />
        </button>
      </div>

      <div className="assistant-tabs" role="tablist" aria-label="助手功能">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            className={activeTab === id ? "assistant-tab is-active" : "assistant-tab"}
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => onTabChange(id)}
          >
            <Icon weight={activeTab === id ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {isConfigOpen && (
        <div className="model-config" aria-label="生图模型配置">
          <div className="model-config-heading">
            <div>
              <strong>OpenAI-compatible</strong>
              <span>Key 仅保留在当前运行内存</span>
            </div>
            <button type="button" onClick={() => setIsConfigOpen(false)} aria-label="完成模型配置">
              <Check weight="bold" />
            </button>
          </div>
          <label>
            <span>API Base URL</span>
            <input
              type="url"
              value={settings.endpoint}
              inputMode="url"
              placeholder="https://api.openai.com/v1"
              onChange={(event) => updateSettings("endpoint", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              type="text"
              value={settings.model}
              placeholder="gpt-image-1"
              onChange={(event) => updateSettings("model", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={settings.apiKey}
              autoComplete="off"
              placeholder="sk-..."
              onChange={(event) => updateSettings("apiKey", event.currentTarget.value)}
            />
          </label>
        </div>
      )}

      {activeTab === "prompt" ? (
        <div className="assistant-body">
          <div className="assistant-intro">
            <span className="intro-icon"><MagicWand weight="fill" /></span>
            <div>
              <strong>从设计意图开始</strong>
              <p>描述产品、材料、形态与使用场景，生成结果会直接进入画布。</p>
            </div>
          </div>

          <div className="generation-options" aria-label="生图参数">
            <div className="option-group">
              <span>画幅</span>
              <div>
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio}
                    className={settings.aspectRatio === ratio ? "is-active" : ""}
                    type="button"
                    aria-pressed={settings.aspectRatio === ratio}
                    onClick={() => updateSettings("aspectRatio", ratio)}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
            <div className="option-group">
              <span>精度</span>
              <div>
                {resolutions.map((resolution) => (
                  <button
                    key={resolution}
                    className={settings.resolution === resolution ? "is-active" : ""}
                    type="button"
                    aria-pressed={settings.resolution === resolution}
                    onClick={() => updateSettings("resolution", resolution)}
                  >
                    {resolution.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="prompt-composer">
            <label htmlFor="design-prompt">设计描述</label>
            <textarea
              id="design-prompt"
              value={prompt}
              maxLength={1200}
              onChange={(event) => onPromptChange(event.currentTarget.value)}
              placeholder="例如：一款适合共享办公空间的模块化桌面照明产品，阳极氧化铝与半透明树脂材质..."
            />
            <div className="composer-footer">
              <span>{prompt.length}/1200</span>
              <button
                className="send-action"
                type="button"
                disabled={!prompt.trim() || isGenerating}
                aria-label={isGenerating ? "正在生成图像" : "生成图像"}
                onClick={onGenerate}
              >
                {isGenerating ? <SpinnerGap className="spin" /> : <PaperPlaneTilt weight="fill" />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="assistant-mode-empty">
          {activeTab === "chat" ? <ChatCircleDots /> : <FlowArrow />}
          <strong>{activeTab === "chat" ? "AI 对话即将接入" : "工作流即将接入"}</strong>
          <p>当前开发阶段优先完成生图画布与移动图片素材。</p>
        </div>
      )}
    </aside>
  );
}

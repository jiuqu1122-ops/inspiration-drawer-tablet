import { ChatCircleDots, FlowArrow, MagicWand, PaperPlaneTilt } from "@phosphor-icons/react";

export type AssistantTab = "chat" | "prompt" | "workflow";

interface AssistantPanelProps {
  activeTab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}

const tabs: Array<{ id: AssistantTab; label: string; icon: typeof ChatCircleDots }> = [
  { id: "chat", label: "AI 对话", icon: ChatCircleDots },
  { id: "prompt", label: "提示词", icon: MagicWand },
  { id: "workflow", label: "工作流", icon: FlowArrow },
];

export function AssistantPanel({
  activeTab,
  onTabChange,
  prompt,
  onPromptChange,
}: AssistantPanelProps) {
  return (
    <aside className="assistant-panel" aria-label="AI 设计助手">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="assistant-heading">
        <div>
          <span className="eyebrow">DESIGN AGENT</span>
          <h2>AI 设计助手</h2>
        </div>
        <span className="model-state"><i />模型待配置</span>
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

      <div className="assistant-body">
        <div className="assistant-intro">
          <span className="intro-icon"><MagicWand weight="fill" /></span>
          <div>
            <strong>从设计意图开始</strong>
            <p>描述产品、材料、形态与使用场景，生成结果会直接进入画布。</p>
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
            <button className="send-action" type="button" disabled={!prompt.trim()} aria-label="提交设计描述">
              <PaperPlaneTilt weight="fill" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

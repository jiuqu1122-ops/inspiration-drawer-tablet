import { useRef, useState } from "react";
import { FileArrowUp, FlowArrow, MagicWand, Plus, TextT, X } from "@phosphor-icons/react";
import type { CanvasNodePresetDefinition, WorkflowDefinition } from "../../../shared";

interface WorkflowLibraryProps {
  open: boolean;
  workflows: WorkflowDefinition[];
  nodePresets: CanvasNodePresetDefinition[];
  importing: boolean;
  onClose: () => void;
  onAddWorkflow: (workflow: WorkflowDefinition) => void;
  onAddNodePreset: (preset: CanvasNodePresetDefinition) => void;
  onImport: (files: FileList | null) => void;
}

type LibraryTab = "workflows" | "node-presets";

export function WorkflowLibrary({
  open,
  workflows,
  nodePresets,
  importing,
  onClose,
  onAddWorkflow,
  onAddNodePreset,
  onImport,
}: WorkflowLibraryProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>("workflows");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;
  return (
    <div className="workflow-library-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="workflow-library" role="dialog" aria-modal="true" aria-labelledby="workflow-library-title">
        <header>
          <span className="workflow-library-icon"><FlowArrow /></span>
          <span>
            <small>DESKTOP COMPATIBLE</small>
            <strong id="workflow-library-title">模板库</strong>
          </span>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            multiple
            onChange={(event) => {
              onImport(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <button
            className="workflow-library-import"
            type="button"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
          >
            <FileArrowUp />{importing ? "导入中" : "导入 JSON"}
          </button>
          <button type="button" onClick={onClose} aria-label="关闭模板库"><X /></button>
        </header>
        <p className="workflow-library-intro">兼容 Windows 端导出的节点预设、工作流与工作流实例；专属 Agent 配置会安全移除，文字步骤转为通用 LLM 节点。</p>
        <nav className="workflow-library-tabs" aria-label="模板类型">
          <button
            type="button"
            className={activeTab === "workflows" ? "is-active" : ""}
            onClick={() => setActiveTab("workflows")}
          >
            <FlowArrow />工作流 <span>{workflows.length}</span>
          </button>
          <button
            type="button"
            className={activeTab === "node-presets" ? "is-active" : ""}
            onClick={() => setActiveTab("node-presets")}
          >
            <MagicWand />节点预设 <span>{nodePresets.length}</span>
          </button>
        </nav>

        {activeTab === "workflows" ? (
          <div className="workflow-library-list">
            {workflows.map((workflow) => {
              const textCount = workflow.nodes.filter((node) => node.type === "text-llm").length;
              const imageCount = workflow.nodes.length - textCount;
              return (
                <article key={workflow.id}>
                  <div>
                    <strong>{workflow.name}</strong>
                    <p>{workflow.description}</p>
                    <span><TextT />{textCount} 文字 LLM</span>
                    <span><MagicWand />{imageCount} 生图</span>
                  </div>
                  <button type="button" onClick={() => onAddWorkflow(workflow)}><Plus />添加到画布</button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="workflow-library-list node-preset-list">
            {nodePresets.length > 0 ? nodePresets.map((preset) => (
              <article key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <p>{preset.description}</p>
                  <span>{preset.aspectRatio}</span>
                  <span>{preset.resolution.toUpperCase()}</span>
                  <span>{preset.count} 张</span>
                </div>
                <button type="button" onClick={() => onAddNodePreset(preset)}><Plus />添加节点</button>
              </article>
            )) : (
              <div className="workflow-library-empty">
                <MagicWand />
                <strong>还没有导入节点预设</strong>
                <p>点击“导入 JSON”，可直接选择 Windows 端导出的节点预设文件。</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

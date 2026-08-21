import { FlowArrow, MagicWand, Plus, TextT, X } from "@phosphor-icons/react";
import { TABLET_WORKFLOW_PRESETS, type WorkflowDefinition } from "../../../shared";

interface WorkflowLibraryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (workflow: WorkflowDefinition) => void;
}

export function WorkflowLibrary({ open, onClose, onAdd }: WorkflowLibraryProps) {
  if (!open) return null;
  return (
    <div className="workflow-library-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="workflow-library" role="dialog" aria-modal="true" aria-labelledby="workflow-library-title">
        <header>
          <span className="workflow-library-icon"><FlowArrow /></span>
          <span>
            <small>DESKTOP WORKFLOWS</small>
            <strong id="workflow-library-title">工作流模板</strong>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭工作流模板"><X /></button>
        </header>
        <p className="workflow-library-intro">保留桌面端工作流结构；Agent 已排除，策略与分析步骤由可编辑的文字 LLM 节点承担。</p>
        <div className="workflow-library-list">
          {TABLET_WORKFLOW_PRESETS.map((workflow) => {
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
                <button type="button" onClick={() => onAdd(workflow)}><Plus />添加到画布</button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

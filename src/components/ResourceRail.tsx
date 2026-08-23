import {
  Check,
  DownloadSimple,
  Folders,
  ImageSquare,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  Toolbox,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { CanvasAssetView } from "../features/canvas/CanvasStage";
import type { CanvasProject } from "../../shared";

export type ResourceSection = "projects" | "materials" | "tools";

interface ResourceRailProps {
  active: ResourceSection;
  isOpen: boolean;
  assets: CanvasAssetView[];
  projects: CanvasProject[];
  activeProjectId: string;
  onAssetSelect: (assetId: string) => void;
  onAssetSave: (assetId: string) => void;
  onAssetRemove: (assetId: string) => void;
  onProjectCreate: () => void;
  onProjectSelect: (projectId: string) => void;
  onProjectRename: (projectId: string, name: string) => void;
  onProjectRemove: (projectId: string) => void;
  onChange: (section: ResourceSection) => void;
  onOpenChange: (open: boolean) => void;
  onImport: () => void;
}

const sections: Array<{
  id: ResourceSection;
  label: string;
  icon: typeof Folders;
}> = [
  { id: "projects", label: "项目", icon: Folders },
  { id: "materials", label: "素材", icon: ImageSquare },
  { id: "tools", label: "工具", icon: Toolbox },
];

export function ResourceRail({
  active,
  isOpen,
  assets,
  projects,
  activeProjectId,
  onAssetSelect,
  onAssetSave,
  onAssetRemove,
  onProjectCreate,
  onProjectSelect,
  onProjectRename,
  onProjectRemove,
  onChange,
  onOpenChange,
  onImport,
}: ResourceRailProps) {
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const importedAssets = assets.filter((entry) => entry.asset.source === "device");
  const generatedAssets = assets.filter((entry) => entry.asset.source === "generated");

  const selectSection = (section: ResourceSection) => {
    if (isOpen && active === section) {
      onOpenChange(false);
      return;
    }
    onChange(section);
    onOpenChange(true);
  };

  return (
    <aside className={isOpen ? "resource-panel is-open" : "resource-panel"} aria-label="项目与素材">
      <nav className="resource-nav" aria-label="资源导航">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            className={isOpen && active === id ? "resource-nav-item is-active" : "resource-nav-item"}
            key={id}
            type="button"
            aria-pressed={isOpen && active === id}
            onClick={() => selectSection(id)}
          >
            <Icon weight={isOpen && active === id ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="resource-drawer" aria-hidden={!isOpen}>
        <header className="resource-drawer-header">
          <div>
            <span className="eyebrow">LIBRARY</span>
            <h2>{active === "materials" ? "灵感素材" : active === "projects" ? "项目" : "设计工具"}</h2>
          </div>
          <button className="drawer-close" type="button" onClick={() => onOpenChange(false)} aria-label="收起素材面板">
            <X />
          </button>
        </header>

        {active === "materials" ? (
          <>
            <button className="material-import-action" type="button" onClick={onImport}>
              <Plus weight="bold" />
              <span>
                <strong>从设备导入</strong>
                <small>照片、截图与设计参考</small>
              </span>
            </button>
            <label className="material-search">
              <MagnifyingGlass />
              <input type="search" placeholder="搜索素材" aria-label="搜索素材" />
            </label>
            <div className="resource-groups">
              <ResourceGroup label="设备素材" assets={importedAssets} onAssetSelect={onAssetSelect} onAssetRemove={onAssetRemove} onImport={onImport} />
              <ResourceGroup label="生成结果" assets={generatedAssets} onAssetSelect={onAssetSelect} onAssetSave={onAssetSave} onAssetRemove={onAssetRemove} />
            </div>
          </>
        ) : active === "projects" ? (
          <>
            <button className="project-create-action" type="button" onClick={onProjectCreate}>
              <Plus weight="bold" />
              <span><strong>新建项目</strong><small>创建一张独立的无限画布</small></span>
            </button>
            <div className="project-list">
              {projects.map((project) => {
                const isCurrent = project.id === activeProjectId;
                const materialCount = new Set(project.nodes.flatMap((node) => (
                  node.type === "image" ? [node.assetId] : node.type === "generation" ? node.request.inputAssetIds : []
                ))).size;
                const isEditing = project.id === editingProjectId;
                return (
                  <div
                    className={isCurrent ? "project-row is-current" : "project-row"}
                    key={project.id}
                  >
                    {isEditing ? (
                      <form className="project-rename-form" onSubmit={(event) => {
                        event.preventDefault();
                        const nextName = projectNameDraft.trim();
                        if (nextName && nextName !== project.name) onProjectRename(project.id, nextName);
                        setEditingProjectId(undefined);
                      }}>
                        <input
                          autoFocus
                          value={projectNameDraft}
                          maxLength={48}
                          aria-label={`重命名项目 ${project.name}`}
                          onChange={(event) => setProjectNameDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingProjectId(undefined);
                          }}
                        />
                        <button type="submit" disabled={!projectNameDraft.trim()} aria-label="保存项目名称"><Check weight="bold" /></button>
                        <button type="button" aria-label="取消重命名" onClick={() => setEditingProjectId(undefined)}><X /></button>
                      </form>
                    ) : (
                      <>
                        <button className="project-row-select" type="button" onClick={() => onProjectSelect(project.id)}>
                          <span className="project-thumbnail"><ImageSquare /></span>
                          <span>
                            <strong>{project.name}</strong>
                            <small>{materialCount} 个素材{isCurrent ? " · 当前" : ""}</small>
                          </span>
                        </button>
                        <button
                          className="project-rename-action"
                          type="button"
                          aria-label={`重命名项目 ${project.name}`}
                          onClick={() => {
                            setEditingProjectId(project.id);
                            setProjectNameDraft(project.name);
                          }}
                        >
                          <PencilSimple />
                        </button>
                        <button
                          className="project-delete-action"
                          type="button"
                          aria-label={`删除项目 ${project.name}`}
                          onClick={() => onProjectRemove(project.id)}
                        >
                          <Trash />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="compact-empty">
            <Toolbox />
            <strong>画笔工具将在下一阶段接入</strong>
            <span>当前可使用节点、素材导入与触控画布。</span>
          </div>
        )}
      </section>
    </aside>
  );
}

function ResourceGroup({
  label,
  assets,
  onAssetSelect,
  onAssetSave,
  onAssetRemove,
  onImport,
}: {
  label: string;
  assets: CanvasAssetView[];
  onAssetSelect: (assetId: string) => void;
  onAssetSave?: (assetId: string) => void;
  onAssetRemove?: (assetId: string) => void;
  onImport?: () => void;
}) {
  return (
    <section className="resource-group">
      <div className="resource-group-heading">
        <h3>{label}</h3>
        <span>{assets.length}</span>
      </div>
      {assets.length ? (
        <div className="asset-grid">
          {assets.map(({ asset, displayUri }) => (
            <div className="asset-tile" key={asset.id}>
              <button
                className="asset-tile-select"
                type="button"
                title={`${asset.name} · 点击添加到画布`}
                onClick={() => onAssetSelect(asset.id)}
              >
                <img src={displayUri} alt={asset.name} />
                <span>{asset.name}</span>
              </button>
              {onAssetRemove && (
                <button
                  className="asset-remove-action"
                  type="button"
                  title={`移除 ${asset.name}`}
                  aria-label={`移除设备素材 ${asset.name}`}
                  onClick={() => onAssetRemove(asset.id)}
                >
                  <Trash />
                </button>
              )}
              {onAssetSave && (
                <button
                  className="asset-save-action"
                  type="button"
                  title={`保存 ${asset.name} 到相册`}
                  aria-label={`保存生成结果 ${asset.name} 到相册`}
                  onClick={() => onAssetSave(asset.id)}
                >
                  <DownloadSimple />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : onImport ? (
        <button className="resource-placeholder is-action" type="button" onClick={onImport}>
          <Plus />从设备添加图片
        </button>
      ) : (
        <div className="resource-placeholder">暂无生成结果</div>
      )}
    </section>
  );
}

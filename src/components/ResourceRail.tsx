import { Folders, ImageSquare, Toolbox } from "@phosphor-icons/react";

export type ResourceSection = "projects" | "materials" | "tools";

interface ResourceRailProps {
  active: ResourceSection;
  onChange: (section: ResourceSection) => void;
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

export function ResourceRail({ active, onChange }: ResourceRailProps) {
  return (
    <aside className="resource-panel" aria-label="项目与素材">
      <nav className="resource-nav" aria-label="资源导航">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            className={active === id ? "resource-nav-item is-active" : "resource-nav-item"}
            key={id}
            type="button"
            aria-pressed={active === id}
            onClick={() => onChange(id)}
          >
            <Icon weight={active === id ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="resource-content">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LIBRARY</span>
            <h2>{active === "materials" ? "灵感素材" : active === "projects" ? "项目" : "设计工具"}</h2>
          </div>
          <button className="small-action" type="button">新建</button>
        </div>

        {active === "materials" ? (
          <div className="resource-groups">
            <ResourceGroup label="本次导入" count={0} />
            <ResourceGroup label="生成结果" count={0} />
          </div>
        ) : (
          <div className="compact-empty">
            <span>{active === "projects" ? "尚未创建项目" : "工具将在画布接入后显示"}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function ResourceGroup({ label, count }: { label: string; count: number }) {
  return (
    <section className="resource-group">
      <div className="resource-group-heading">
        <h3>{label}</h3>
        <span>{count}</span>
      </div>
      <div className="resource-placeholder">暂无图片</div>
    </section>
  );
}

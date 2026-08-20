import { useState } from "react";
import { AssistantPanel, type AssistantTab } from "../components/AssistantPanel";
import { ResourceRail, type ResourceSection } from "../components/ResourceRail";
import { TopBar } from "../components/TopBar";
import { CanvasStage } from "../features/canvas/CanvasStage";

export function TabletWorkbench() {
  const [resourceSection, setResourceSection] = useState<ResourceSection>("materials");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("prompt");
  const [prompt, setPrompt] = useState("");

  return (
    <main className="tablet-app">
      <TopBar zoom={100} />
      <div className="workbench">
        <ResourceRail active={resourceSection} onChange={setResourceSection} />

        <section className="canvas-shell" aria-label="设计画布">
          <CanvasStage />
        </section>

        <AssistantPanel
          activeTab={assistantTab}
          onTabChange={setAssistantTab}
          prompt={prompt}
          onPromptChange={setPrompt}
        />
      </div>
    </main>
  );
}

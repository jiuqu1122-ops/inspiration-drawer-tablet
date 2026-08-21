import type { WorkflowDefinition, WorkflowImageNodeDefinition, WorkflowTextNodeDefinition } from "./types";

const CREATED_AT = 1_786_972_800_000;

const INDUSTRIAL_LLM_SYSTEM_PROMPT = [
  "你是 Inspiration Drawer 的工业设计文字 LLM 节点。",
  "只根据当前节点指令和上游文字结果工作，不扮演 Agent，不调用工具，不输出思维过程。",
  "输出可直接交给后续生图节点使用的中文 Markdown，明确产品形态、结构、CMF、场景、构图和禁止项。",
].join("\n");

const image = (
  id: string,
  title: string,
  description: string,
  prompt: string,
  x: number,
  y: number,
  inputs: string[] = [],
  aspectRatio: WorkflowImageNodeDefinition["aspectRatio"] = "16:9",
): WorkflowImageNodeDefinition => ({
  id,
  type: "image-generation",
  title,
  description,
  prompt,
  inputs,
  x,
  y,
  aspectRatio,
  resolution: "2k",
  count: 1,
});

const text = (
  id: string,
  title: string,
  description: string,
  prompt: string,
  x: number,
  y: number,
  inputs: string[] = [],
): WorkflowTextNodeDefinition => ({
  id,
  type: "text-llm",
  title,
  description,
  prompt,
  systemPrompt: INDUSTRIAL_LLM_SYSTEM_PROMPT,
  inputs,
  x,
  y,
});

const commonRenderConstraint = [
  "保持同一产品身份、轮廓比例、关键结构、按键接口与 CMF 边界一致。",
  "工业设计渲染，结构可信，材质粗糙度与反射真实，干净受控的产品摄影光线。",
  "不要水印、乱码、虚构品牌、无关装饰或多余零件。",
].join("\n");

export const TABLET_WORKFLOW_PRESETS: WorkflowDefinition[] = [
  {
    id: "cmf-review",
    name: "CMF 评审",
    description: "CMF 方向 → 材质细节特写",
    inputSlots: [{ id: "product-reference", label: "产品参考图", type: "image", required: true, multiple: true }],
    createdAt: CREATED_AT,
    nodes: [
      text("cmf-plan", "CMF 方向规划", "生成适合产品品类的 CMF 方案", "根据产品定位提出 3 个差异清晰但可制造的 CMF 方向，分别说明主辅色、材料、表面工艺、触感、耐久性与适用场景。", 0, 120),
      image("cmf-board", "CMF 方向板", "把方案可视化为统一评审板", `保持产品结构完全不变，将上游 CMF 方向呈现在同一产品的三个方案上。\n${commonRenderConstraint}`, 430, 80, ["cmf-plan"]),
      image("cmf-detail", "CMF 细节特写", "放大代表性材料与工艺细节", `从上游 CMF 方向板中选择最有代表性的材料边界、倒角高光、纹理和表面工艺进行微距展示。\n${commonRenderConstraint}`, 860, 80, ["cmf-board"]),
    ],
  },
  {
    id: "ecommerce-showcase",
    name: "电商展示",
    description: "商品策略 → 主图 → 卖点细节与场景图",
    inputSlots: [{ id: "product-reference", label: "商品参考图", type: "image", required: true, multiple: true }],
    createdAt: CREATED_AT,
    nodes: [
      text("commerce-plan", "商品视觉策略", "定义适合品类的电商视觉语言", "分析商品品类、目标人群、价格带、核心卖点和 CMF，给出背景、光线、构图、道具密度与系列一致性建议。", 0, 120),
      image("commerce-hero", "电商主图", "生成干净高级的商品主视觉", `根据上游商品视觉策略生成产品主图，主体完整清晰，背景和光线服务于品类与价格感。\n${commonRenderConstraint}`, 430, 80, ["commerce-plan"]),
      image("commerce-detail", "卖点细节图", "展示最重要的结构或材质卖点", `从上游主图延续同一视觉系统，聚焦关键结构、交互或材质细节。\n${commonRenderConstraint}`, 860, -120, ["commerce-hero"]),
      image("commerce-scene", "使用场景图", "生成可信的生活方式场景", `把上游同一商品放入真实使用场景，环境克制且符合尺度，不让道具抢主体。\n${commonRenderConstraint}`, 860, 430, ["commerce-hero"]),
    ],
  },
  {
    id: "product-details-five-images",
    name: "详情页五图｜产品一致性高氛围",
    description: "详情页策略 → 氛围主图、场景、材质、结构与使用说明",
    inputSlots: [{ id: "product-reference", label: "产品参考图", type: "image", required: true, multiple: true }],
    createdAt: CREATED_AT,
    nodes: [
      text("details-plan", "详情页策略", "梳理五张图的统一叙事与卖点", "为产品详情页规划五张图：氛围主图、使用场景、材质细节、爆炸结构和使用说明。统一产品身份、镜头语言、背景、光线与信息层级。", 0, 180),
      image("hero-main", "01 超高氛围主图", "建立整套详情页的主视觉", `生成高级产品氛围主图，主体占画面核心，构图和光线体现价格感。\n${commonRenderConstraint}`, 430, -330, ["details-plan"]),
      image("lifestyle", "02 高级场景图", "展示真实使用关系和尺度", `生成符合目标用户与真实尺寸关系的使用场景。\n${commonRenderConstraint}`, 430, 190, ["details-plan"]),
      image("macro", "03 材质细节图", "展示工艺、纹理与装配品质", `生成产品材质和装配细节微距图，突出真实纹理、倒角、分件线和表面工艺。\n${commonRenderConstraint}`, 860, -430, ["hero-main"]),
      image("exploded", "04 爆炸结构图", "展示已有零件的结构关系", `基于同一产品生成克制、可理解的爆炸结构视图，只拆解参考中真实存在的部件。\n${commonRenderConstraint}`, 860, 90, ["hero-main"]),
      image("usage", "05 使用说明图", "展示核心操作步骤", `基于同一产品生成清晰的核心使用步骤画面，动作和人机关系可信，避免乱码标签。\n${commonRenderConstraint}`, 860, 610, ["lifestyle"]),
    ],
  },
  {
    id: "animation-storyboard",
    name: "产品动画分镜｜2×2母版·2K高质量最终版",
    description: "镜头脚本 → 四格一致性分镜母版",
    inputSlots: [{ id: "product-reference", label: "产品参考图", type: "image", required: true, multiple: true }],
    createdAt: CREATED_AT,
    nodes: [
      text("shot-plan", "镜头脚本", "规划四个连贯的产品动画镜头", "生成四镜头产品动画脚本：建立、结构、交互、收束。说明每格景别、机位、运动方向、光线连续性和主体动作。", 0, 120),
      image("storyboard", "2×2 分镜母版", "生成四格高质量一致性分镜", `将上游四镜头脚本可视化为严格 2×2 分镜母版，四格保持同一产品、场景、CMF、光向和镜头连续性。\n${commonRenderConstraint}`, 430, 80, ["shot-plan"]),
      image("keyframe", "关键帧精修", "精修最重要的一格作为动画参考", `从上游分镜中选择信息最完整的关键帧进行高质量精修，保持镜头和主体一致。\n${commonRenderConstraint}`, 860, 80, ["storyboard"]),
    ],
  },
  {
    id: "episode-consistency",
    name: "单元剧｜固定场景与角色一致性增强版",
    description: "视觉圣经 → 建立镜头 → 动作与收束镜头",
    inputSlots: [{ id: "visual-reference", label: "角色或产品参考图", type: "image", required: true, multiple: true }],
    createdAt: CREATED_AT,
    nodes: [
      text("visual-bible", "视觉一致性圣经", "锁定主体、场景和镜头连续性", "整理主体外观、比例、颜色、标志细节、固定场景、时间天气、光线方向、镜头轴线和禁止变化项，形成后续镜头必须遵守的视觉圣经。", 0, 120),
      image("establishing", "建立镜头", "建立固定空间与主体关系", `根据视觉圣经生成建立镜头，清楚交代主体、固定场景和空间方向。\n${commonRenderConstraint}`, 430, 80, ["visual-bible"]),
      image("action", "动作镜头", "推进同一场景中的核心动作", `延续上游建立镜头的主体身份、场景、光线与轴线，生成核心动作镜头。\n${commonRenderConstraint}`, 860, -120, ["establishing"]),
      image("closing", "收束镜头", "完成同一单元的视觉收束", `延续上游镜头完成情绪和信息收束，不改变主体、场景或时间条件。\n${commonRenderConstraint}`, 860, 430, ["establishing"]),
    ],
  },
];

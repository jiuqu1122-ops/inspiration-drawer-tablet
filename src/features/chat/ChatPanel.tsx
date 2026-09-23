import {
  ArrowUp,
  CaretDown,
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  Copy,
  FilmStrip,
  Globe,
  Paperclip,
  Plus,
  SlidersHorizontal,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ServerSession } from "../../services/tauriServerSessionService";
import {
  completeChatWithServer,
  listServerChatModels,
  listServerImageModels,
  listServerVideoModels,
  searchWebWithServer,
  type ServerChatMessage,
  type ServerImageModelCapabilities,
} from "../../services/tauriChatService";
import { TauriImageGenerationService } from "../../services/tauriImageGenerationService";
import { TauriVideoGenerationService } from "../../services/tauriVideoGenerationService";
import {
  IMAGE_MODEL_PRESETS,
  type GeneratedImageResult,
  type GeneratedVideoResult,
  type ImageAsset,
  type ImageAspectRatio,
  type ImageGenerationRequest,
  type ImageResolution,
  type VideoGenerationRequest,
} from "../../../shared";
import { createId } from "../../utils/id";
import {
  createChatConversation,
  createConversationTitle,
  readActiveChatConversationId,
  readChatConversations,
  writeActiveChatConversationId,
  writeChatConversations,
  type ChatConversation,
  type ChatAttachment,
  type ChatMessage,
} from "./chatModel";

const CHAT_TOOL_DEFINITIONS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "联网搜索公开网页、新闻、资料和实时信息，并返回来源链接。用户开启联网或明确要求最新信息时使用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "完整、具体的搜索关键词；涉及相对日期时写成明确日期。" },
          limit: { type: ["number", "null"], minimum: 1, maximum: 8 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "根据用户描述生成图片，并把结果显示在 Chat 中。只有用户明确要求生成、制作或绘制图片时才调用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string", description: "图片生成提示词" },
          model: { type: ["string", "null"] },
          aspectRatio: { type: ["string", "null"] },
          resolution: { type: ["string", "null"] },
          count: { type: ["number", "null"], minimum: 1, maximum: 4 },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_image",
      description: "根据用户指令编辑最近生成的图片。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string" },
          model: { type: ["string", "null"] },
          aspectRatio: { type: ["string", "null"] },
          resolution: { type: ["string", "null"] },
          count: { type: ["number", "null"], minimum: 1, maximum: 4 },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description: "根据用户描述生成视频，并把结果显示在 Chat 中。用户明确要求生成、制作或动画化视频时使用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string", description: "视频生成提示词" },
          model: { type: ["string", "null"] },
          aspectRatio: { type: ["string", "null"] },
          resolution: { type: ["string", "null"] },
          duration: { type: ["number", "null"], minimum: 1, maximum: 60 },
          count: { type: ["number", "null"], minimum: 1, maximum: 4 },
        },
        required: ["prompt"],
      },
    },
  },
];

const SYSTEM_PROMPT = [
  "如果用户开启联网搜索，或明确要求查询最新、实时、网页信息，必须调用 web_search，并在回答中用 Markdown 链接标注来源。",
  "你是 Inspiration Drawer 移动端内置的通用 AI 助手。",
  "自然、准确地回答问题，支持创意讨论、写作、分析和设计建议。",
  "回答默认使用用户当前使用的语言；内容较长时使用清晰的 Markdown 结构。",
  "用户明确要求生成、绘制或制作图片时，必须调用 generate_image 工具，不要只返回提示词。",
  "用户明确要求修改最近生成的图片时，调用 edit_image 工具。",
  "用户明确要求生成、制作、动画化或转成视频时，必须调用 generate_video 工具，不要只返回提示词。",
  "不要声称已经操作画布或修改文件，除非上下文明确说明操作已经完成。",
].join("\n");

const STARTER_PROMPTS = [
  "帮我梳理这个设计方向",
  "给我三个更有差异的创意方案",
  "把这段想法整理成生图提示词",
];

interface ChatPanelProps {
  open: boolean;
  session: ServerSession;
  canvasContext?: string;
  onClose: () => void;
  onLoginRequest: () => void;
  onSessionRefresh: () => void | Promise<ServerSession | void>;
  onGeneratedImages?: (results: GeneratedImageResult[], request: ImageGenerationRequest) => void | Promise<void>;
}

export function ChatPanel({
  open,
  session,
  canvasContext,
  onClose,
  onLoginRequest,
  onSessionRefresh,
  onGeneratedImages,
}: ChatPanelProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>(() => {
    const stored = readChatConversations();
    return stored.length ? stored : [createChatConversation()];
  });
  const [activeConversationId, setActiveConversationId] = useState(() => readActiveChatConversationId());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => (
    window.localStorage.getItem("inspiration-drawer-tablet-chat-web-search") === "true"
  ));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [chatDefaultModel, setChatDefaultModel] = useState("");
  // Keep the default on the server's automatic route.  The first item in the
  // public catalog is not necessarily the channel default (and can be much
  // more expensive), so selecting it implicitly can produce a false
  // insufficient-wallet error for users who do have credits.
  const [selectedModel, setSelectedModel] = useState("default");
  const [imageModels, setImageModels] = useState<string[]>(() => IMAGE_MODEL_PRESETS.map((preset) => preset.id));
  const [imageModelLabels, setImageModelLabels] = useState<Record<string, string>>({});
  const [imageModelCapabilities, setImageModelCapabilities] = useState<Record<string, ServerImageModelCapabilities>>({});
  const [imageModel, setImageModel] = useState("nano-banana-pro");
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [imageResolution, setImageResolution] = useState<ImageResolution>("2k");
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [videoModels, setVideoModels] = useState<string[]>([]);
  const [videoModelLabels, setVideoModelLabels] = useState<Record<string, string>>({});
  const [videoModelCapabilities, setVideoModelCapabilities] = useState<Record<string, ServerImageModelCapabilities>>({});
  const [videoModel, setVideoModel] = useState("seedance-2.0");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("1080p");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ImageAsset[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelPickerRef.current?.contains(target)) setModelMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!open || !session.authenticated) return;
    let cancelled = false;
    void listServerChatModels().then((result) => {
      if (cancelled) return;
      setChatModels(result.models);
      setChatDefaultModel(result.defaultModel && result.models.includes(result.defaultModel) ? result.defaultModel : "");
      setSelectedModel((current) => {
        const normalized = current.trim();
        if (normalized === "default") return normalized;
        if (normalized && result.models.includes(normalized)) return normalized;
        return "default";
      });
    }).catch(() => undefined);
    void listServerImageModels().then((result) => {
      if (cancelled) return;
      const supported = Array.from(new Set(
        result.models
          .map((model) => model.trim())
          .filter(Boolean),
      ));
      if (!supported.length) return;
      const labels = Object.fromEntries(
        (result.catalog ?? [])
          .filter((model) => model.id.trim())
          .map((model) => [model.id, model.displayName?.trim() || model.id]),
      );
      const capabilities = Object.fromEntries(
        (result.catalog ?? [])
          .filter((model) => model.id.trim() && model.capabilities)
          .map((model) => [model.id, normalizeServerImageModelCapabilities(model.capabilities)]),
      );
      setImageModelLabels(labels);
      setImageModelCapabilities(capabilities);
      setImageModels(supported);
      setImageModel((current) => supported.includes(current)
        ? current
        : result.defaultModel && supported.includes(result.defaultModel)
          ? result.defaultModel
          : supported[0]);
    }).catch(() => undefined);
    void listServerVideoModels().then((result) => {
      if (cancelled) return;
      const supported = Array.from(new Set(result.models.map((model) => model.trim()).filter(Boolean)));
      const labels = Object.fromEntries(
        (result.catalog ?? [])
          .filter((model) => model.id.trim())
          .map((model) => [model.id, model.displayName?.trim() || model.id]),
      );
      const capabilities = Object.fromEntries(
        (result.catalog ?? [])
          .filter((model) => model.id.trim() && model.capabilities)
          .map((model) => [model.id, normalizeServerImageModelCapabilities(model.capabilities)]),
      );
      setVideoModelLabels(labels);
      setVideoModelCapabilities(capabilities);
      if (supported.length) {
        setVideoModels(supported);
        setVideoModel((current) => supported.includes(current)
          ? current
          : result.defaultModel && supported.includes(result.defaultModel)
            ? result.defaultModel
            : supported[0]);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, session.authenticated]);

  const addAttachmentFiles = async (files: FileList | File[]) => {
    const remaining = Math.max(0, 6 - pendingAttachments.length);
    if (!remaining) return;
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    const assets = await Promise.all(selected.map(async (file): Promise<ImageAsset> => ({
      id: createId("chat-attachment"),
      kind: "image",
      name: file.name || "Chat 参考图",
      mimeType: file.type || "image/png",
      storageKind: "memory",
      uri: await fileToDataUri(file),
      byteSize: file.size,
      createdAt: Date.now(),
      source: "device",
    })));
    setPendingAttachments((current) => [...current, ...assets].slice(0, 6));
  };

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files?.length) void addAttachmentFiles(files);
    event.currentTarget.value = "";
  };

  const selectedImagePreset = useMemo(
    () => IMAGE_MODEL_PRESETS.find((preset) => preset.id === imageModel) ?? IMAGE_MODEL_PRESETS[0],
    [imageModel],
  );

  const selectedImageCapabilities = imageModelCapabilities[imageModel];
  const imageResolutionOptions = useMemo<ImageResolution[]>(() => {
    const serverResolutions = normalizeImageResolutions(selectedImageCapabilities?.resolutions);
    return serverResolutions.length ? serverResolutions : selectedImagePreset.resolutions;
  }, [selectedImageCapabilities, selectedImagePreset]);
  const imageAspectRatioOptions = useMemo<ImageAspectRatio[]>(() => {
    const byResolution = selectedImageCapabilities?.aspectRatiosByResolution;
    const resolutionKey = imageResolution.toLowerCase();
    const serverRatios = byResolution?.[resolutionKey] ?? selectedImageCapabilities?.aspectRatios;
    const normalized = normalizeImageAspectRatios(serverRatios);
    return normalized.length ? normalized : ["1:1", "3:4", "4:3", "9:16", "16:9"];
  }, [imageResolution, selectedImageCapabilities]);

  const selectedVideoCapabilities = videoModelCapabilities[videoModel];
  const videoAspectRatioOptions = useMemo(() => normalizeVideoOptions(
    selectedVideoCapabilities?.aspectRatios,
    ["16:9", "9:16", "1:1"],
  ), [selectedVideoCapabilities]);
  const videoResolutionOptions = useMemo(() => normalizeVideoOptions(
    selectedVideoCapabilities?.resolutions,
    ["720p", "1080p"],
  ), [selectedVideoCapabilities]);
  const videoDurationOptions = useMemo(() => normalizeVideoDurations(
    selectedVideoCapabilities?.durations,
    [5, 10],
  ), [selectedVideoCapabilities]);

  useEffect(() => {
    if (!imageResolutionOptions.includes(imageResolution)) {
      setImageResolution(imageResolutionOptions.includes(selectedImagePreset.defaultResolution)
        ? selectedImagePreset.defaultResolution
        : imageResolutionOptions[0] ?? "2k");
    }
  }, [imageResolution, imageResolutionOptions, selectedImagePreset]);

  useEffect(() => {
    if (!imageAspectRatioOptions.includes(imageAspectRatio)) {
      setImageAspectRatio(imageAspectRatioOptions[0] ?? "1:1");
    }
  }, [imageAspectRatio, imageAspectRatioOptions]);

  useEffect(() => {
    if (!videoAspectRatioOptions.includes(videoAspectRatio)) setVideoAspectRatio(videoAspectRatioOptions[0] ?? "16:9");
    if (!videoResolutionOptions.includes(videoResolution)) setVideoResolution(videoResolutionOptions[0] ?? "1080p");
    if (!videoDurationOptions.includes(videoDuration)) setVideoDuration(videoDurationOptions[0] ?? 5);
  }, [videoAspectRatio, videoAspectRatioOptions, videoDuration, videoDurationOptions, videoResolution, videoResolutionOptions]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  );

  useEffect(() => {
    if (!activeConversation) return;
    if (activeConversationId !== activeConversation.id) setActiveConversationId(activeConversation.id);
    writeActiveChatConversationId(activeConversation.id);
  }, [activeConversation, activeConversationId]);

  useEffect(() => {
    writeChatConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!open) return;
    setHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [activeConversation?.messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const updateConversation = (
    conversationId: string,
    updater: (conversation: ChatConversation) => ChatConversation,
  ) => {
    setConversations((current) => current
      .map((conversation) => conversation.id === conversationId ? updater(conversation) : conversation)
      .sort((left, right) => right.updatedAt - left.updatedAt));
  };

  const startNewConversation = () => {
    const conversation = createChatConversation();
    setConversations((current) => [conversation, ...current].slice(0, 24));
    setActiveConversationId(conversation.id);
    setInput("");
    setHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const deleteConversation = (conversationId: string) => {
    if (busy && conversationId === activeConversation?.id) return;
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== conversationId);
      const fallback = next[0] ?? createChatConversation();
      if (conversationId === activeConversationId) setActiveConversationId(fallback.id);
      return next.length ? next : [fallback];
    });
  };

  const clearConversation = () => {
    if (!activeConversation || busy) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      title: "新对话",
      messages: [],
      updatedAt: Date.now(),
    }));
  };

  const runImageGeneration = async (
    prompt: string,
    overrides: Record<string, unknown> = {},
    inputAssets: ImageAsset[] = [],
    signal?: AbortSignal,
  ): Promise<GeneratedImageResult[]> => {
    const requestedModel = String(overrides.model || imageModel);
    const request: ImageGenerationRequest = {
      id: createId("chat-image"),
      prompt: String(overrides.prompt || prompt).trim(),
      inputAssetIds: inputAssets.map((asset) => asset.id),
      // Catalog models can be added server-side.  Do not discard a valid
      // dynamic model just because it is newer than the three bundled presets.
      model: {
        provider: "server-gateway",
        model: isValidImageModelId(requestedModel) && imageModels.includes(requestedModel)
          ? requestedModel
          : imageModel,
      },
      aspectRatio: normalizeChatAspectRatio(String(overrides.aspectRatio || imageAspectRatio), imageAspectRatio),
      resolution: normalizeChatResolution(String(overrides.resolution || imageResolution)),
      count: Math.min(4, Math.max(1, Number(overrides.count) || 1)),
      createdAt: Date.now(),
    };
    const results = await new TauriImageGenerationService().generate(request, { inputAssets, signal });
    await onGeneratedImages?.(results, request);
    return results;
  };

  const runVideoGeneration = async (
    prompt: string,
    overrides: Record<string, unknown> = {},
    inputAssets: ImageAsset[] = [],
    signal?: AbortSignal,
  ) => {
    const requestedModel = String(overrides.model || videoModel);
    const model = videoModels.includes(requestedModel) ? requestedModel : (videoModels[0] || requestedModel);
    const request: VideoGenerationRequest = {
      id: createId("chat-video"),
      prompt: String(overrides.prompt || prompt).trim(),
      inputAssetIds: inputAssets.map((asset) => asset.id),
      model: { provider: "server-gateway", model },
      aspectRatio: normalizeVideoValue(String(overrides.aspectRatio || videoAspectRatio), videoAspectRatio),
      resolution: normalizeVideoValue(String(overrides.resolution || videoResolution), videoResolution),
      duration: normalizeVideoDuration(Number(overrides.duration) || videoDuration, videoDuration),
      inputMode: inputAssets.length ? "REF" : undefined,
      count: Math.min(4, Math.max(1, Number(overrides.count) || 1)),
      createdAt: Date.now(),
    };
    return new TauriVideoGenerationService().generate(request, inputAssets, signal);
  };

  const getLatestGeneratedImage = (): ImageAsset[] => {
    const media = activeConversation.messages
      .slice()
      .reverse()
      .flatMap((message) => message.media ?? [])
      .find((item) => item.kind !== "video" && !item.mimeType.startsWith("video/"));
    if (!media) return [];
    return [{
      id: media.id,
      kind: "image",
      name: "Chat 最近生成图片",
      mimeType: media.mimeType,
      storageKind: media.uri.startsWith("http") ? "remote" : "memory",
      uri: media.uri,
      createdAt: Date.now(),
      source: "generated",
    }];
  };

  const completeChatTurn = async (
    requestMessages: ServerChatMessage[],
    fallbackPrompt: string,
    referenceAssets: ImageAsset[] = [],
    signal?: AbortSignal,
  ): Promise<{ text: string; media: Array<GeneratedImageResult | GeneratedVideoResult> }> => {
    throwIfChatAborted(signal);
    const turnTools = getChatTools(fallbackPrompt, webSearchEnabled);
    const first = await completeChatWithServer({
      requestId: createId("tablet-chat"),
      messages: requestMessages,
      model: selectedModel === "default" ? undefined : selectedModel || undefined,
      tools: turnTools,
      toolChoice: "auto",
      usageContext: "chat",
    });
    if (!first.toolCalls.length) {
      return { text: first.text, media: [] };
    }

    const media: Array<GeneratedImageResult | GeneratedVideoResult> = [];
    const toolMessages: ServerChatMessage[] = [];
    for (const call of first.toolCalls) {
      throwIfChatAborted(signal);
      let result: Record<string, unknown>;
      if (call.name === "web_search") {
        try {
          const args = JSON.parse(call.arguments) as Record<string, unknown>;
          const searchResult = await searchWebWithServer(
            String(args.query || fallbackPrompt),
            Number(args.limit) || 6,
          );
          result = { success: true, ...searchResult };
        } catch (error) {
          result = { success: false, error: getErrorMessage(error, "联网搜索失败") };
        }
      } else if (call.name !== "generate_image" && call.name !== "edit_image" && call.name !== "generate_video") {
        result = { success: false, error: `移动端暂不支持工具 ${call.name}` };
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          result = { success: false, error: "工具参数不是有效 JSON" };
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
          continue;
        }
        try {
          const references = call.name === "edit_image"
            ? (getLatestGeneratedImage().length ? getLatestGeneratedImage() : referenceAssets)
            : referenceAssets;
          if (call.name === "edit_image" && !references.length) {
            throw new Error("当前对话中还没有可编辑的生成图片");
          }
          const generated = call.name === "generate_video"
            ? await runVideoGeneration(String(args.prompt || fallbackPrompt), args, references, signal)
            : await runImageGeneration(String(args.prompt || fallbackPrompt), args, references, signal);
          media.push(...generated);
          result = {
            success: true,
            imageCount: generated.length,
            mediaType: call.name === "generate_video" ? "video" : "image",
            mode: call.name === "edit_image" ? "edit" : "generate",
            savedToMaterials: call.name !== "generate_video",
          };
        } catch (error) {
          result = { success: false, error: getErrorMessage(error, call.name === "generate_video" ? "视频生成失败" : "图片生成失败") };
        }
      }
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    throwIfChatAborted(signal);

    const assistantToolMessage: ServerChatMessage = {
      role: "assistant",
      content: first.text || null,
      tool_calls: first.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
    const continuation = await completeChatWithServer({
      requestId: createId("tablet-chat"),
      messages: [...requestMessages, assistantToolMessage, ...toolMessages],
      model: selectedModel === "default" ? undefined : selectedModel || undefined,
      tools: turnTools,
      toolChoice: "none",
      usageContext: "chat",
    });
    throwIfChatAborted(signal);
    return {
      text: continuation.text || first.text || (media.length ? `已生成 ${media.length} 个媒体结果。` : "工具执行完成。"),
      media,
    };
  };

  const sendMessage = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || busy || !activeConversation) return;
    if (!session.authenticated) {
      onLoginRequest();
      return;
    }

    const conversationId = activeConversation.id;
    const now = Date.now();
    const turnAttachments = pendingAttachments;
    const chatAttachments = (await Promise.all(turnAttachments.map(createChatAttachment)))
      .filter((attachment) => attachment.uri);
    const requestMessages = buildServerMessages(
      activeConversation.messages,
      content,
      canvasContext,
      chatAttachments.map(toImageAsset),
    );
    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const userMessage: ChatMessage = {
      id: createId("chat-user"),
      role: "user",
      content,
      createdAt: now,
      status: "completed",
      attachments: chatAttachments,
    };
    const responseMessage: ChatMessage = {
      id: createId("chat-assistant"),
      role: "assistant",
      content: "",
      createdAt: now + 1,
      status: "pending",
    };
    setInput("");
    setPendingAttachments([]);
    setBusy(true);
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length ? conversation.title : createConversationTitle(content),
      messages: [...conversation.messages, userMessage, responseMessage],
      updatedAt: now,
    }));

    try {
      const { text, media } = await completeChatTurn(requestMessages, content, turnAttachments, controller.signal);
      if (requestSequence !== requestSequenceRef.current) return;
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === responseMessage.id
          ? {
            ...message,
            content: text,
            media: media.map((result) => ({
              id: result.id,
              uri: result.uri,
              mimeType: result.mimeType,
              kind: result.mimeType.startsWith("video/") ? "video" : "image",
            })),
            status: "completed",
            error: undefined,
          }
          : message),
        updatedAt: Date.now(),
      }));
      onSessionRefresh();
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      // The server is authoritative for wallet state. Refresh it after a
      // failed request so a stale local balance cannot mask the real status.
      let refreshedSession: ServerSession | void;
      try {
        refreshedSession = await onSessionRefresh();
      } catch {
        refreshedSession = undefined;
      }
      const errorText = formatChatError(error, refreshedSession || undefined);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === responseMessage.id
          ? {
            ...message,
            status: "error",
            error: errorText,
          }
          : message),
        updatedAt: Date.now(),
      }));
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        requestAbortRef.current = null;
        setBusy(false);
      }
    }
  };

  const cancelCurrentRequest = () => {
    if (!busy) return;
    requestSequenceRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    if (activeConversation) {
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.status === "pending"
          ? { ...message, status: "error", error: "已取消本次回复" }
          : message),
        updatedAt: Date.now(),
      }));
    }
    setBusy(false);
  };

  const retryMessage = async (messageId: string) => {
    if (!activeConversation || busy) return;
    const index = activeConversation.messages.findIndex((message) => message.id === messageId);
    let previousUserIndex = index - 1;
    while (
      previousUserIndex >= 0
      && activeConversation.messages[previousUserIndex]?.role !== "user"
    ) {
      previousUserIndex -= 1;
    }
    const previousUserMessage = activeConversation.messages[previousUserIndex];
    if (!previousUserMessage || previousUserMessage.role !== "user") return;
    if (!session.authenticated) {
      onLoginRequest();
      return;
    }

    const conversationId = activeConversation.id;
    const requestMessages = buildServerMessages(
      activeConversation.messages.slice(0, previousUserIndex),
      previousUserMessage.content,
      canvasContext,
      previousUserMessage.attachments?.map(toImageAsset) ?? [],
    );
    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setBusy(true);
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => message.id === messageId
        ? { ...message, content: "", status: "pending", error: undefined }
        : message),
      updatedAt: Date.now(),
    }));

    try {
      const { text, media } = await completeChatTurn(
        requestMessages,
        previousUserMessage.content,
        previousUserMessage.attachments?.map(toImageAsset) ?? [],
        controller.signal,
      );
      if (requestSequence !== requestSequenceRef.current) return;
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === messageId
          ? {
            ...message,
            content: text,
            media: media.map((result) => ({
              id: result.id,
              uri: result.uri,
              mimeType: result.mimeType,
              kind: result.mimeType.startsWith("video/") ? "video" as const : "image" as const,
            })),
            status: "completed",
            error: undefined,
          }
          : message),
        updatedAt: Date.now(),
      }));
      onSessionRefresh();
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      let refreshedSession: ServerSession | void;
      try {
        refreshedSession = await onSessionRefresh();
      } catch {
        refreshedSession = undefined;
      }
      const errorText = formatChatError(error, refreshedSession || undefined);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === messageId
          ? {
            ...message,
            status: "error",
            error: errorText,
          }
          : message),
        updatedAt: Date.now(),
      }));
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        requestAbortRef.current = null;
        setBusy(false);
      }
    }
  };

  const copyMessage = async (message: ChatMessage) => {
    if (!message.content) return;
    await navigator.clipboard.writeText(message.content).catch(() => undefined);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? "" : current), 1200);
  };

  if (!open || !activeConversation) return null;

  return (
    <div className="chat-layer" role="presentation">
      <button className="chat-backdrop" type="button" onClick={onClose} aria-label="关闭 Chat" />
      <aside className="chat-panel" aria-label="AI Chat" aria-modal="true" role="dialog">
        <header className="chat-header">
          <span className="chat-header-icon" aria-hidden="true"><ChatCircleDots weight="fill" /></span>
          <div className="chat-header-copy">
            <strong>{activeConversation.title}</strong>
            <span>{busy ? "正在思考" : "通用 AI 助手"}</span>
          </div>
          <div className="chat-header-actions">
            <button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="会话历史" title="会话历史">
              <ClockCounterClockwise />
            </button>
            <button type="button" onClick={startNewConversation} aria-label="新对话" title="新对话">
              <Plus />
            </button>
            <button type="button" onClick={clearConversation} disabled={busy || !activeConversation.messages.length} aria-label="清空当前对话" title="清空当前对话">
              <Trash />
            </button>
            <button type="button" onClick={onClose} aria-label="关闭 Chat" title="关闭 Chat">
              <X />
            </button>
          </div>
        </header>

        {historyOpen && (
          <section className="chat-history" aria-label="会话历史记录">
            <div className="chat-history-heading">
              <strong>最近对话</strong>
              <button type="button" onClick={() => setHistoryOpen(false)}><X /></button>
            </div>
            <div className="chat-history-list">
              {conversations.map((conversation) => (
                <div className={conversation.id === activeConversation.id ? "chat-history-row is-active" : "chat-history-row"} key={conversation.id}>
                  <button
                    className="chat-history-select"
                    type="button"
                    onClick={() => {
                      setActiveConversationId(conversation.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <strong>{conversation.title}</strong>
                    <span>{formatConversationTime(conversation.updatedAt)} · {conversation.messages.length} 条消息</span>
                  </button>
                  <button
                    className="chat-history-delete"
                    type="button"
                    onClick={() => deleteConversation(conversation.id)}
                    disabled={busy && conversation.id === activeConversation.id}
                    aria-label={`删除对话 ${conversation.title}`}
                  >
                    <Trash />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="chat-messages" aria-live="polite">
          {!activeConversation.messages.length && (
            <div className="chat-empty">
              <span><ChatCircleDots weight="duotone" /></span>
              <h2>从一个想法开始</h2>
              <p>和桌面端使用同一个账号与积分。可以讨论创意、分析方案，或整理成可直接使用的提示词。</p>
              <div className="chat-starters">
                {STARTER_PROMPTS.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => void sendMessage(prompt)}>{prompt}</button>
                ))}
              </div>
            </div>
          )}
          {activeConversation.messages.map((message) => (
            <article className={`chat-message is-${message.role}`} key={message.id}>
              {message.role === "assistant" && <span className="chat-message-avatar"><ChatCircleDots weight="fill" /></span>}
              <div className="chat-message-body">
                {message.status === "pending" ? (
                  <div className="chat-thinking"><SpinnerGap className="chat-spinner" />正在组织回答…</div>
                ) : message.role === "assistant" ? (
                  <div className="chat-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="chat-user-copy">{message.content}</div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="chat-message-attachments" aria-label="已发送的参考图片">
                    {message.attachments.map((attachment) => (
                      <img key={attachment.id} src={attachment.uri} alt={attachment.name} loading="lazy" />
                    ))}
                  </div>
                )}
                {message.media && message.media.length > 0 && (
                  <div className="chat-media-grid">
                    {message.media.map((media) => (
                      media.kind === "video" || media.mimeType.startsWith("video/")
                        ? <video key={media.id} src={media.uri} controls playsInline preload="metadata" />
                        : <img key={media.id} src={media.uri} alt="Chat 生成图片" loading="lazy" />
                    ))}
                  </div>
                )}
                {message.error && (
                  <div className="chat-message-error">
                    <span>{message.error}</span>
                    <button type="button" onClick={() => void retryMessage(message.id)} disabled={busy}>重试</button>
                  </div>
                )}
                {message.role === "assistant" && message.status === "completed" && message.content && (
                  <button className="chat-copy-action" type="button" onClick={() => void copyMessage(message)}>
                    {copiedMessageId === message.id ? <Check /> : <Copy />}
                    {copiedMessageId === message.id ? "已复制" : "复制"}
                  </button>
                )}
              </div>
            </article>
          ))}
          <div ref={endRef} />
        </div>

        <footer className="chat-composer-shell">
          {canvasContext && <div className="chat-context-chip">已带入当前画布节点上下文</div>}
          {!session.authenticated ? (
            <button className="chat-login-action" type="button" onClick={onLoginRequest}>登录后开始 Chat</button>
          ) : (
            <div className="chat-composer-stack">
              <div className={`chat-composer chat-composer-reference ${imageSettingsOpen ? "has-image-settings" : ""}`}>
                {pendingAttachments.length > 0 && (
                  <div className="chat-attachment-list" aria-label={"\u5df2\u6dfb\u52a0\u7684\u53c2\u8003\u56fe\u7247"}>
                    {pendingAttachments.map((attachment) => (
                      <div className="chat-attachment-chip" key={attachment.id}>
                        <img src={attachment.uri} alt={attachment.name} />
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                          aria-label={`${"\u79fb\u9664"} ${attachment.name}`}
                        >
                          <X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  rows={2}
                  maxLength={20_000}
                  placeholder={"\u53d1\u6d88\u606f\uff0c\u6216\u8ba9 AI \u4f7f\u7528\u7075\u611f\u62bd\u5c49\u5de5\u5177"}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                {imageSettingsOpen && (
                  <div className="chat-image-settings-panel" id="chat-image-settings-panel">
                    <div className="chat-model-controls">
                      <label>{"\u751f\u56fe\u6a21\u578b"}
                        <select value={imageModel} onChange={(event) => setImageModel(event.currentTarget.value)} disabled={busy}>
                          {imageModels.map((model) => {
                            const preset = IMAGE_MODEL_PRESETS.find((candidate) => candidate.id === model);
                            return <option key={model} value={model}>{imageModelLabels[model] ?? preset?.name ?? model}</option>;
                          })}
                        </select>
                      </label>
                      <label>{"\u6bd4\u4f8b"}
                        <select value={imageAspectRatio} onChange={(event) => setImageAspectRatio(event.currentTarget.value as ImageAspectRatio)} disabled={busy}>
                          {imageAspectRatioOptions.map((ratio) => <option key={ratio} value={ratio}>{formatImageAspectRatio(ratio)}</option>)}
                        </select>
                      </label>
                      <label>{"\u6e05\u6670\u5ea6"}
                        <select value={imageResolution} onChange={(event) => setImageResolution(event.currentTarget.value as ImageResolution)} disabled={busy}>
                          {imageResolutionOptions.map((resolution) => <option key={resolution} value={resolution}>{resolution.toUpperCase()}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}
                {videoSettingsOpen && (
                  <div className="chat-image-settings-panel chat-video-settings-panel" id="chat-video-settings-panel">
                    <div className="chat-model-controls">
                      <label>视频模型
                        <select value={videoModel} onChange={(event) => setVideoModel(event.currentTarget.value)} disabled={busy || !videoModels.length}>
                          {(videoModels.length ? videoModels : [videoModel]).map((model) => (
                            <option key={model} value={model}>{videoModelLabels[model] ?? model}</option>
                          ))}
                        </select>
                      </label>
                      <label>比例
                        <select value={videoAspectRatio} onChange={(event) => setVideoAspectRatio(event.currentTarget.value)} disabled={busy}>
                          {videoAspectRatioOptions.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                        </select>
                      </label>
                      <label>清晰度
                        <select value={videoResolution} onChange={(event) => setVideoResolution(event.currentTarget.value)} disabled={busy}>
                          {videoResolutionOptions.map((resolution) => <option key={resolution} value={resolution}>{resolution.toUpperCase()}</option>)}
                        </select>
                      </label>
                      <label>时长
                        <select value={videoDuration} onChange={(event) => setVideoDuration(Number(event.currentTarget.value))} disabled={busy}>
                          {videoDurationOptions.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}
                <div className="chat-composer-footer">
                  <div className="chat-composer-tools">
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={busy || pendingAttachments.length >= 6}
                      aria-label={"\u4e0a\u4f20\u53c2\u8003\u56fe\u7247"}
                      title={"\u4e0a\u4f20\u53c2\u8003\u56fe\u7247"}
                    >
                      <Paperclip />
                    </button>
                    <button
                      type="button"
                      className={webSearchEnabled ? "chat-capability-toggle is-active" : "chat-capability-toggle"}
                      disabled={busy}
                      onClick={() => {
                        setWebSearchEnabled((current) => {
                          const next = !current;
                          window.localStorage.setItem("inspiration-drawer-tablet-chat-web-search", String(next));
                          return next;
                        });
                      }}
                      aria-pressed={webSearchEnabled}
                      aria-label={webSearchEnabled ? "\u5173\u95ed\u8054\u7f51\u641c\u7d22" : "\u5f00\u542f\u8054\u7f51\u641c\u7d22"}
                      title={webSearchEnabled ? "\u8054\u7f51\u641c\u7d22\u5df2\u5f00\u542f" : "\u5f00\u542f\u8054\u7f51\u641c\u7d22"}
                    >
                      <Globe />
                    </button>
                    <button
                      type="button"
                      className="chat-image-settings-toggle"
                      disabled={busy}
                      onClick={() => setImageSettingsOpen((current) => !current)}
                      aria-expanded={imageSettingsOpen}
                      aria-controls="chat-image-settings-panel"
                      title={"\u56fe\u7247\u751f\u6210\u8bbe\u7f6e"}
                    >
                      <SlidersHorizontal />
                      <span>{"\u56fe\u7247"}</span>
                    </button>
                    <button
                      type="button"
                      className={videoSettingsOpen ? "chat-image-settings-toggle is-active" : "chat-image-settings-toggle"}
                      disabled={busy}
                      onClick={() => setVideoSettingsOpen((current) => !current)}
                      aria-expanded={videoSettingsOpen}
                      aria-controls="chat-video-settings-panel"
                      title="视频生成设置"
                    >
                      <FilmStrip />
                      <span>视频</span>
                    </button>
                    <div className="chat-model-picker" ref={modelPickerRef}>
                      <button
                        type="button"
                        className="chat-model-trigger"
                        disabled={busy}
                        onClick={() => setModelMenuOpen((current) => !current)}
                        aria-haspopup="menu"
                        aria-expanded={modelMenuOpen}
                        title={`${"\u6a21\u578b"}\uff1a${selectedModel === "default" ? "\u81ea\u52a8\u8def\u7531\uff08\u63a8\u8350\uff09" : selectedModel}`}
                      >
                        <span>{formatChatModelLabel(selectedModel === "default" ? chatDefaultModel : selectedModel)}</span>
                        <CaretDown className={modelMenuOpen ? "is-open" : ""} />
                      </button>
                      {modelMenuOpen && (
                        <div className="chat-model-menu" role="menu" aria-label={"\u9009\u62e9\u6a21\u578b"}>
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selectedModel === "default"}
                            className={selectedModel === "default" ? "is-selected" : ""}
                            onClick={() => { setSelectedModel("default"); setModelMenuOpen(false); }}
                          >
                            <span>{"\u81ea\u52a8\u8def\u7531\uff08\u63a8\u8350\uff09"}</span>
                            {selectedModel === "default" && <Check />}
                          </button>
                          {chatModels.map((model) => (
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={model === selectedModel}
                              className={model === selectedModel ? "is-selected" : ""}
                              key={model}
                              onClick={() => { setSelectedModel(model); setModelMenuOpen(false); }}
                            >
                              <span>{formatChatModelLabel(model)}</span>
                              {model === selectedModel && <Check />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="chat-composer-send"
                    type="button"
                    onClick={() => busy ? cancelCurrentRequest() : void sendMessage()}
                    disabled={!busy && !input.trim()}
                    aria-label={busy ? "取消回复" : "发送消息"}
                    title={busy ? "取消当前回复" : "发送消息"}
                  >
                    {busy ? <X weight="bold" /> : <ArrowUp weight="bold" />}
                  </button>
                </div>
                <input
                  ref={attachmentInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAttachmentChange}
                />
              </div>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}

function buildServerMessages(
  history: ChatMessage[],
  content: string,
  canvasContext?: string,
  attachments: ImageAsset[] = [],
): ServerChatMessage[] {
  const systemContent = canvasContext
    ? `${SYSTEM_PROMPT}\n\n用户当前画布上下文（只作为参考，不代表已经执行操作）：\n${canvasContext}`
    : SYSTEM_PROMPT;
  const currentContent = buildServerMessageContent(content, attachments);
  const historyBudget = Math.max(30_000, 150_000 - estimateServerContentSize(systemContent) - estimateServerContentSize(currentContent));
  const conversationHistory = selectChatHistory(history, historyBudget)
    .map((message): ServerChatMessage => ({
      role: message.role,
      content: buildServerMessageContent(
        message.content,
        message.attachments?.map(toImageAsset) ?? [],
      ),
    }));
  return [
    { role: "system", content: systemContent },
    ...conversationHistory,
    { role: "user", content: currentContent },
  ];
}

function selectChatHistory(history: ChatMessage[], budget: number): ChatMessage[] {
  const completed = history.filter((message) => message.status === "completed" && message.content.trim()).slice(-40);
  const selected: ChatMessage[] = [];
  let used = 0;
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const message = completed[index];
    const content = buildServerMessageContent(message.content, message.attachments?.map(toImageAsset) ?? []);
    const size = estimateServerContentSize(content);
    if (selected.length && used + size > budget) break;
    if (size > 49_000) continue;
    selected.unshift(message);
    used += size;
    if (selected.length >= 30) break;
  }
  return selected;
}

function estimateServerContentSize(content: ServerChatMessage["content"]): number {
  return typeof content === "string" ? content.length : JSON.stringify(content).length;
}

function buildServerMessageContent(content: string, attachments: ImageAsset[] = []): ServerChatMessage["content"] {
  const candidates = attachments
    .filter((asset) => asset.kind === "image" && asset.uri.trim())
    // The native bridge caps each message at 50 KB. Three compact previews
    // keep vision input under that limit while all originals remain available
    // to image/video generation tools for the current turn.
    .slice(0, 3);
  const safeAttachments: ImageAsset[] = [];
  let remaining = Math.max(0, 46_000 - content.length);
  for (const asset of candidates) {
    const cost = asset.uri.length + 80;
    if (cost > remaining) continue;
    safeAttachments.push(asset);
    remaining -= cost;
  }
  if (!safeAttachments.length) return content;
  return [
    { type: "text", text: content },
    ...safeAttachments.map((asset) => ({
      type: "image_url",
      image_url: { url: asset.uri },
    })),
  ];
}

async function createChatAttachment(asset: ImageAsset): Promise<ChatAttachment> {
  return {
    id: asset.id,
    name: asset.name,
    uri: await compactChatImage(asset.uri),
    mimeType: "image/jpeg",
    kind: "image",
  };
}

function toImageAsset(attachment: ChatAttachment): ImageAsset {
  return {
    id: attachment.id,
    kind: "image",
    name: attachment.name,
    mimeType: attachment.mimeType,
    storageKind: attachment.uri.startsWith("http") ? "remote" : "memory",
    uri: attachment.uri,
    createdAt: Date.now(),
    source: "device",
  };
}

async function compactChatImage(source: string): Promise<string> {
  try {
    const image = await loadChatImage(source);
    let maxEdge = 256;
    let quality = 0.7;
    let dataUri = source;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
      const context = canvas.getContext("2d");
      if (!context) return source;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUri = canvas.toDataURL("image/jpeg", quality);
      if (dataUri.length <= 14_000) return dataUri;
      maxEdge = Math.max(96, Math.round(maxEdge * 0.76));
      quality = Math.max(0.42, quality - 0.08);
    }
    return dataUri.length <= 20_000 ? dataUri : "";
  } catch {
    return source.length <= 14_000 ? source : "";
  }
}

function loadChatImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("读取 Chat 图片失败"));
    image.src = source;
  });
}

function formatConversationTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

function formatChatModelLabel(value: string): string {
  if (!value || value === "default") return "自动选择";
  return value
    .replace(/^gpt-/i, "gpt ")
    .replace(/-mini$/i, " Mini")
    .replace(/-codex-spark$/i, " Spark")
    .replace(/-sol$/i, " Sol")
    .replace(/-terra$/i, " Terra")
    .replace(/-luna$/i, " Luna");
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function getChatTools(prompt: string, enabled: boolean): Array<Record<string, unknown>> {
  return enabled || shouldExposeWebSearch(prompt)
    ? CHAT_TOOL_DEFINITIONS
    : CHAT_TOOL_DEFINITIONS.filter((tool) => (
      (tool.function as Record<string, unknown>)?.name !== "web_search"
    ));
}

function shouldExposeWebSearch(prompt: string): boolean {
  return /联网|上网|网页|网络|最新|实时|今天|当前|新闻|资料|行情|价格|天气|政策|法规|版本|发布/i.test(prompt);
}

function formatChatError(error: unknown, refreshedSession?: ServerSession): string {
  const message = getErrorMessage(error, "回复生成失败");
  const availableCredits = refreshedSession?.availableCredits?.trim();
  if (!availableCredits || !/insufficient[_ -]?credits|wallet|钱包|余额不足|额度不足|credit/i.test(message)) {
    return message;
  }
  const numeric = Number(availableCredits);
  const display = Number.isFinite(numeric)
    ? numeric.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : availableCredits;
  return `${message}（当前可用额度：${display}）`;
}

function isValidImageModelId(value: string): boolean {
  const model = value.trim();
  return model.length > 0 && model.length <= 200 && /^[a-zA-Z0-9._:/-]+$/.test(model);
}

function normalizeChatAspectRatio(value: string, fallback: ImageAspectRatio = "1:1"): ImageAspectRatio {
  const normalized = normalizeImageAspectRatios([value])[0];
  if (normalized) return normalized;
  return normalizeImageAspectRatios([fallback])[0] ?? "1:1";
}

function normalizeChatResolution(value: string): ImageResolution {
  return (["1k", "2k", "4k"] as const).includes(value as ImageResolution)
    ? value as ImageResolution
    : "2k";
}

function normalizeImageResolutions(value: unknown): ImageResolution[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ImageResolution>();
  for (const item of value) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if ((["1k", "2k", "4k"] as const).includes(normalized as ImageResolution)) {
      seen.add(normalized as ImageResolution);
    }
  }
  const ordered: ImageResolution[] = ["1k", "2k", "4k"];
  return ordered.filter((resolution) => seen.has(resolution));
}

function normalizeImageAspectRatios(value: unknown): ImageAspectRatio[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: ImageAspectRatio[] = [];
  for (const item of value) {
    const candidate = String(item ?? "")
      .trim()
      .replace(/[×X]/g, "x");
    if (!isValidImageAspectRatio(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(candidate as ImageAspectRatio);
  }
  return normalized;
}

function normalizeServerImageModelCapabilities(value: unknown): ServerImageModelCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const capabilities: ServerImageModelCapabilities = {};
  const resolutions = normalizeImageResolutions(source.resolutions);
  const aspectRatios = normalizeImageAspectRatios(source.aspectRatios);
  const byResolution: Record<string, string[]> = {};
  if (source.aspectRatiosByResolution && typeof source.aspectRatiosByResolution === "object") {
    for (const [key, options] of Object.entries(source.aspectRatiosByResolution as Record<string, unknown>)) {
      const normalized = normalizeImageAspectRatios(options).map((ratio) => String(ratio));
      if (normalized.length) byResolution[key.trim().toLowerCase()] = normalized;
    }
  }
  if (resolutions.length) capabilities.resolutions = resolutions;
  if (aspectRatios.length) capabilities.aspectRatios = aspectRatios;
  if (Object.keys(byResolution).length) capabilities.aspectRatiosByResolution = byResolution;
  for (const key of [
    "defaultResolution",
    "defaultAspectRatio",
    "maxReferenceImages",
    "maxOutputs",
    "durations",
    "defaultDuration",
    "supportsReferenceImages",
    "maxReferenceVideos",
  ]) {
    const candidate = source[key];
    if (candidate !== undefined && candidate !== null) capabilities[key as keyof ServerImageModelCapabilities] = candidate as never;
  }
  return capabilities;
}

function isValidImageAspectRatio(value: string): boolean {
  if ((["1:1", "3:4", "4:3", "9:16", "16:9"] as const).includes(value as never)) return true;
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isInteger(width) && Number.isInteger(height)
    && width >= 64 && height >= 64 && width <= 16384 && height <= 16384;
}

function formatImageAspectRatio(value: ImageAspectRatio): string {
  return value.includes("x") ? value.replace("x", "×") : value;
}

function throwIfChatAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("回复已取消", "AbortError");
}

function normalizeVideoOptions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
  return result.length ? result : fallback;
}

function normalizeVideoDurations(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const result = Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 1 && item <= 60)
    .map((item) => Math.round(item))))
    .sort((left, right) => left - right);
  return result.length ? result : fallback;
}

function normalizeVideoValue(value: string, fallback: string): string {
  const clean = value.trim();
  return clean && clean.length <= 80 ? clean : fallback;
}

function normalizeVideoDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 && value <= 60 ? Math.round(value) : fallback;
}

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{header::CONTENT_TYPE, Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::Manager;
use tokio::time::sleep;
use uuid::Uuid;

mod tablet_keep_alive;
mod tablet_media;
mod tablet_update;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_SERVER_URL: &str = "https://api.unmind.art";
const MAX_REFERENCE_BYTES: usize = 10 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const AUTH_STORE_FILENAME: &str = "server-auth.json";
// Keep the Android release binary rebuildable when the embedded frontend changes.
// Tablet-only UI updates are packaged into this same native asset bundle.

static AUTH_TOKENS: OnceLock<Mutex<Option<AuthTokens>>> = OnceLock::new();

#[derive(Clone)]
struct AuthTokens {
    access_token: String,
    refresh_token: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStore {
    machine_id: String,
    license: Option<String>,
    email: Option<String>,
    display_name: Option<String>,
    available_credits: Option<String>,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestEmailCodeInput {
    email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailCodeChallenge {
    challenge_id: String,
    expires_in: u64,
    resend_after: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyEmailCodeInput {
    email: String,
    challenge_id: String,
    code: String,
    display_name: Option<String>,
    invite_code: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerSession {
    authenticated: bool,
    email: Option<String>,
    display_name: Option<String>,
    available_credits: Option<String>,
    expires_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditRedemptionResult {
    redeemed_credits: String,
    session: ServerSession,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerImageReference {
    name: String,
    mime_type: String,
    data_uri: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateServerImagesInput {
    request_id: String,
    model: String,
    prompt: String,
    aspect_ratio: String,
    resolution: String,
    count: u8,
    references: Vec<ServerImageReference>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateServerVideosInput {
    request_id: String,
    model: String,
    prompt: String,
    aspect_ratio: Option<String>,
    resolution: Option<String>,
    duration: Option<u32>,
    input_mode: Option<String>,
    count: u8,
    references: Vec<ServerImageReference>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoverServerImagesInput {
    request_id: String,
    count: u8,
    #[serde(default)]
    max_wait_seconds: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeServerPromptInput {
    prompt: String,
    media_type: String,
    locale: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateServerTextInput {
    request_id: String,
    prompt: String,
    system_prompt: Option<String>,
    context: Vec<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct ServerChatMessage {
    role: String,
    #[serde(default)]
    content: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteServerChatInput {
    request_id: String,
    messages: Vec<ServerChatMessage>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    tools: Vec<Value>,
    #[serde(default)]
    tool_choice: Option<Value>,
    #[serde(default)]
    usage_context: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeneratedImage {
    data_uri: String,
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeneratedVideo {
    uri: String,
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePromptOptimization {
    optimized_prompt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeneratedText {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeChatCompletion {
    text: String,
    #[serde(default)]
    tool_calls: Vec<NativeChatToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    usage: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeChatToolCall {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWebSearchResult {
    query: String,
    provider: String,
    results: Vec<NativeWebSearchItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWebSearchItem {
    title: String,
    url: String,
    snippet: String,
    published_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeChatModels {
    models: Vec<String>,
    default_model: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    catalog: Vec<NativeImageModel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeImageModel {
    id: String,
    display_name: Option<String>,
    modality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    capabilities: Option<Value>,
}

#[tauri::command]
async fn request_server_email_code(
    input: RequestEmailCodeInput,
) -> Result<EmailCodeChallenge, String> {
    let email = normalize_email(&input.email)?;
    let client = create_http_client()?;
    let (status, payload) = public_json_request(
        &client,
        Method::POST,
        "v1/auth/email/send-code",
        Some(json!({ "email": email })),
    )
    .await?;
    ensure_success(status, &payload, "验证码发送失败")?;
    Ok(EmailCodeChallenge {
        challenge_id: required_string(&payload, "/challengeId", "服务端没有返回验证码会话")?,
        expires_in: payload
            .pointer("/expiresIn")
            .and_then(Value::as_u64)
            .unwrap_or(600),
        resend_after: payload
            .pointer("/resendAfter")
            .and_then(Value::as_u64)
            .unwrap_or(60),
    })
}

#[tauri::command]
async fn verify_server_email_code(
    app: tauri::AppHandle,
    input: VerifyEmailCodeInput,
) -> Result<ServerSession, String> {
    let email = normalize_email(&input.email)?;
    let code = input.code.trim();
    if code.len() != 6 || !code.chars().all(|character| character.is_ascii_digit()) {
        return Err("请输入邮件中的 6 位验证码".to_string());
    }
    let mut store = load_or_create_auth_store(&app)?;
    let client = create_http_client()?;
    let mut body = json!({
        "email": email,
        "challengeId": input.challenge_id.trim(),
        "code": code,
        "machineId": store.machine_id,
        "appVersion": APP_VERSION,
    });
    if let Some(display_name) = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["displayName"] = Value::String(display_name.to_string());
    }
    if let Some(invite_code) = input
        .invite_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if invite_code.len() < 6 || invite_code.len() > 32 {
            return Err("邀请码长度应为 6 到 32 位".to_string());
        }
        body["inviteCode"] = Value::String(invite_code.to_ascii_uppercase());
    }
    let (status, payload) =
        public_json_request(&client, Method::POST, "v1/auth/email/verify", Some(body)).await?;
    ensure_success(status, &payload, "邮箱登录失败")?;
    persist_authentication(&app, &mut store, &payload)
}

#[tauri::command]
async fn get_server_session(app: tauri::AppHandle) -> Result<ServerSession, String> {
    let store = load_or_create_auth_store(&app)?;
    if store.license.is_none() {
        return Ok(session_from_store(&store));
    }
    let client = create_http_client()?;
    match refresh_account_session(&app, &client).await {
        Ok(session) => Ok(session),
        Err(_) => Ok(session_from_store(&store)),
    }
}

#[tauri::command]
async fn logout_server_session(app: tauri::AppHandle) -> Result<(), String> {
    let tokens = token_store()
        .lock()
        .map_err(|_| "账号状态锁定失败".to_string())?
        .clone();
    if let Some(tokens) = tokens {
        if let Ok(client) = create_http_client() {
            let _ = public_json_request(
                &client,
                Method::POST,
                "v1/auth/logout",
                Some(json!({ "refreshToken": tokens.refresh_token })),
            )
            .await;
        }
    }
    clear_auth_tokens()?;
    let mut store = load_or_create_auth_store(&app)?;
    store.license = None;
    store.email = None;
    store.display_name = None;
    store.available_credits = None;
    store.expires_at = None;
    save_auth_store(&app, &store)
}

#[tauri::command]
async fn redeem_server_credit_code(
    app: tauri::AppHandle,
    code: String,
) -> Result<CreditRedemptionResult, String> {
    let code = code.trim().to_uppercase();
    if code.len() < 10 || code.len() > 64 {
        return Err("invalid_code: 兑换码格式不正确".to_string());
    }

    let client = create_http_client()?;
    let (status, payload) = authenticated_json_request(
        &app,
        &client,
        Method::POST,
        "v1/wallet/redeem",
        Some(json!({ "code": code })),
    )
    .await?;
    ensure_success(status, &payload, "兑换码兑换失败")?;

    let redeemed_credits = required_string(&payload, "/redeemedCredits", "服务端没有返回兑换额度")?;
    let available_credits = required_string(
        &payload,
        "/wallet/availableCredits",
        "服务端没有返回最新额度",
    )?;
    let mut store = load_or_create_auth_store(&app)?;
    store.available_credits = Some(available_credits);
    save_auth_store(&app, &store)?;

    Ok(CreditRedemptionResult {
        redeemed_credits,
        session: session_from_store(&store),
    })
}

#[tauri::command]
async fn generate_server_images(
    app: tauri::AppHandle,
    input: GenerateServerImagesInput,
) -> Result<Vec<NativeGeneratedImage>, String> {
    validate_generation_input(&input)?;
    let client = create_http_client()?;
    let mut share_ids = Vec::new();
    let mut input_images = Vec::new();

    for reference in &input.references {
        match upload_reference(&app, &client, reference).await {
            Ok((share_id, url)) => {
                share_ids.push(share_id);
                input_images.push(url);
            }
            Err(error) => {
                cleanup_reference_shares(&app, &client, &share_ids).await;
                return Err(error);
            }
        }
    }

    let generation = submit_image_generation(&app, &client, &input, input_images).await;
    cleanup_reference_shares(&app, &client, &share_ids).await;
    let payload = generation?;
    let sources = collect_image_sources(&payload);
    if sources.is_empty() {
        return Err("应用服务端没有返回图片数据".to_string());
    }
    let mut images = Vec::with_capacity(sources.len());
    for source in sources.into_iter().take(input.count.clamp(1, 4) as usize) {
        images.push(resolve_image_source_with_retry(&client, &source).await?);
    }
    Ok(images)
}

#[tauri::command]
async fn generate_server_videos(
    app: tauri::AppHandle,
    input: GenerateServerVideosInput,
) -> Result<Vec<NativeGeneratedVideo>, String> {
    validate_video_generation_input(&input)?;
    let client = create_http_client()?;
    let mut share_ids = Vec::new();
    let mut input_images = Vec::new();
    for reference in &input.references {
        match upload_reference(&app, &client, reference).await {
            Ok((share_id, url)) => {
                share_ids.push(share_id);
                input_images.push(url);
            }
            Err(error) => {
                cleanup_reference_shares(&app, &client, &share_ids).await;
                return Err(error);
            }
        }
    }
    let body = json!({
        "clientRequestId": input.request_id,
        "model": input.model,
        "prompt": input.prompt,
        "inputImages": input_images,
        "aspectRatio": input.aspect_ratio,
        "resolution": input.resolution,
        "duration": input.duration,
        "inputMode": input.input_mode.unwrap_or_else(|| "REF".to_string()),
        "count": input.count,
    });
    let result =
        authenticated_json_request(&app, &client, Method::POST, "v1/ai/videos", Some(body)).await;
    cleanup_reference_shares(&app, &client, &share_ids).await;
    let (status, payload) = result?;
    ensure_success(status, &payload, "瑙嗛鐢熸垚浠诲姟鍒涘缓澶辫触")?;
    let mut sources = collect_video_sources(&payload);
    let task_ids = collect_video_task_ids(&payload);
    for task_id in task_ids {
        if sources.len() >= input.count as usize {
            break;
        }
        let task = poll_video_task(&app, &client, &task_id, &input.request_id).await?;
        sources.extend(collect_video_sources(&task));
    }
    sources.dedup();
    if sources.is_empty() {
        return Err("Server did not return a generated video".to_string());
    }
    Ok(sources
        .into_iter()
        .take(input.count as usize)
        .map(|uri| NativeGeneratedVideo {
            mime_type: if uri.to_ascii_lowercase().contains("webm") {
                "video/webm".to_string()
            } else {
                "video/mp4".to_string()
            },
            uri,
        })
        .collect())
}

#[tauri::command]
async fn recover_server_images(
    app: tauri::AppHandle,
    input: RecoverServerImagesInput,
) -> Result<Vec<NativeGeneratedImage>, String> {
    if input.request_id.trim().len() < 8 || !(1..=4).contains(&input.count) {
        return Err("鐢熷浘鎭㈠璇锋眰鏃犳晥".to_string());
    }
    let client = create_http_client()?;
    let max_wait_seconds = input.max_wait_seconds.unwrap_or(60).clamp(5, 900);
    let attempts = (max_wait_seconds / 2).max(1) as usize;
    let payload = recover_image_generation(&app, &client, &input.request_id, attempts).await?;
    let sources = collect_image_sources(&payload);
    if sources.is_empty() {
        return Err("鏈嶅姟绔湁浠诲姟鐘舵€佷絾娌℃湁杩斿洖鍥剧墖".to_string());
    }
    let mut images = Vec::new();
    for source in sources.into_iter().take(input.count as usize) {
        images.push(resolve_image_source_with_retry(&client, &source).await?);
    }
    Ok(images)
}

#[tauri::command]
async fn optimize_server_prompt(
    app: tauri::AppHandle,
    input: OptimizeServerPromptInput,
) -> Result<NativePromptOptimization, String> {
    let clean_prompt = input.prompt.trim();
    if clean_prompt.is_empty() {
        return Err("请先输入需要优化的提示词".to_string());
    }
    let client = create_http_client()?;
    let client_request_id = format!("tablet-prompt-{}", Uuid::new_v4());
    let system_prompt = "你是 Inspiration Drawer 的通用图片生成提示词优化器。用户可以生成任何题材的图片，包括人物、动物、场景、建筑、产品、插画、海报和抽象视觉等。保留用户原意，不要把题材改成产品设计；根据用户实际内容补充合适的主体、环境、风格、构图、镜头、光线、色彩、材质和细节。只返回一段可直接用于图片生成的中文提示词，不要解释。";
    let body = json!({
        "clientRequestId": client_request_id,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": clean_prompt }
        ]
    });
    let (status, payload) = authenticated_json_request(
        &app,
        &client,
        Method::POST,
        "v1/ai/chat/completions",
        Some(body),
    )
    .await?;
    ensure_success(status, &payload, "提示词优化任务创建失败")?;
    let task_id = required_string(&payload, "/taskId", "服务端没有返回提示词优化任务")?;
    let result = poll_agent_task(&app, &client, &task_id).await?;
    let optimized_prompt = extract_completion_content(&result)
        .ok_or_else(|| "提示词优化服务没有返回有效内容".to_string())?;
    Ok(NativePromptOptimization { optimized_prompt })
}

#[tauri::command]
async fn generate_server_text(
    app: tauri::AppHandle,
    input: GenerateServerTextInput,
) -> Result<NativeGeneratedText, String> {
    if input.request_id.trim().len() < 8 || input.request_id.len() > 128 {
        return Err("文字 LLM 请求 ID 无效".to_string());
    }
    let prompt = input.prompt.trim();
    if prompt.is_empty() || prompt.len() > 50_000 {
        return Err("文字 LLM 节点提示词无效".to_string());
    }
    let context = input
        .context
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .take(12)
        .collect::<Vec<_>>();
    let user_content = if context.is_empty() {
        prompt.to_string()
    } else {
        format!(
            "上游节点结果：\n\n{}\n\n当前节点指令：\n{}",
            context.join("\n\n---\n\n"),
            prompt,
        )
    };
    let mut messages = Vec::new();
    if let Some(system_prompt) = input
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }
    messages.push(json!({ "role": "user", "content": user_content }));
    let client = create_http_client()?;
    let body = json!({
        "clientRequestId": input.request_id,
        "messages": messages,
    });
    let (status, payload) = authenticated_json_request(
        &app,
        &client,
        Method::POST,
        "v1/ai/chat/completions",
        Some(body),
    )
    .await?;
    ensure_success(status, &payload, "文字 LLM 任务创建失败")?;
    let task_id = required_string(&payload, "/taskId", "服务端没有返回文字 LLM 任务")?;
    let result = poll_agent_task(&app, &client, &task_id).await?;
    let text = extract_completion_content(&result)
        .ok_or_else(|| "文字 LLM 节点没有返回有效内容".to_string())?;
    Ok(NativeGeneratedText { text })
}

#[tauri::command]
async fn complete_server_chat(
    app: tauri::AppHandle,
    input: CompleteServerChatInput,
) -> Result<NativeChatCompletion, String> {
    validate_chat_input(&input)?;
    let client = create_http_client()?;
    let mut body = json!({
        "clientRequestId": input.request_id,
        "messages": input.messages,
    });
    if let Some(model) = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["model"] = json!(model);
    }
    if !input.tools.is_empty() {
        body["tools"] = json!(input.tools);
    }
    if let Some(tool_choice) = input.tool_choice {
        body["toolChoice"] = tool_choice;
    }
    if let Some(usage_context) = input
        .usage_context
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["usageContext"] = json!(usage_context);
    }
    let (status, payload) = authenticated_json_request(
        &app,
        &client,
        Method::POST,
        "v1/ai/chat/completions",
        Some(body),
    )
    .await?;
    ensure_success(status, &payload, "Chat 任务创建失败")?;
    let task_id = required_string(&payload, "/taskId", "服务端没有返回 Chat 任务")?;
    let result = poll_agent_task(&app, &client, &task_id).await?;
    let text = extract_completion_content(&result).unwrap_or_default();
    let tool_calls = extract_completion_tool_calls(&result);
    let text = text.trim().to_string();
    if text.is_empty() && tool_calls.is_empty() {
        return Err("Chat 没有返回有效内容".to_string());
    }
    return Ok(NativeChatCompletion {
        text,
        tool_calls,
        usage: result.pointer("/usage").cloned(),
    });
}

#[tauri::command]
async fn list_server_chat_models(app: tauri::AppHandle) -> Result<NativeChatModels, String> {
    let client = create_http_client()?;
    let (status, payload) =
        authenticated_json_request(&app, &client, Method::GET, "v1/ai/models", None).await?;
    ensure_success(status, &payload, "Chat 模型列表获取失败")?;
    let models = payload
        .pointer("/models")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let default_model = payload
        .pointer("/defaultModel")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(NativeChatModels {
        models,
        default_model,
        catalog: Vec::new(),
    })
}

#[tauri::command]
async fn list_server_image_models(app: tauri::AppHandle) -> Result<NativeChatModels, String> {
    let client = create_http_client()?;
    let (status, payload) =
        authenticated_json_request(&app, &client, Method::GET, "v1/ai/images/models", None).await?;
    ensure_success(status, &payload, "生图模型列表获取失败")?;
    let mut models: Vec<String> = payload
        .pointer("/models")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut catalog = payload
        .pointer("/catalog")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                // This endpoint is image-only. Accept an omitted modality for
                // transitional servers, while still excluding explicit chat/video entries.
                .filter(|value| {
                    value
                        .pointer("/modality")
                        .and_then(Value::as_str)
                        .map(|modality| modality.eq_ignore_ascii_case("image"))
                        .unwrap_or(true)
                })
                .filter_map(|value| {
                    let id = value.pointer("/id").and_then(Value::as_str)?.trim();
                    if id.is_empty() {
                        return None;
                    }
                    Some(NativeImageModel {
                        id: id.to_string(),
                        display_name: value
                            .pointer("/displayName")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        modality: Some("image".to_string()),
                        capabilities: value.pointer("/capabilities").cloned(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let has_explicit_catalog = !catalog.is_empty();

    // Older transitional responses expose the same public promises in a
    // top-level capabilities map instead of an explicit catalog. Rehydrate
    // those entries so the mobile UI never falls back to a bundled preset.
    let capability_map = payload.pointer("/capabilities").and_then(Value::as_object);
    if let Some(values) = capability_map {
        for (id, capabilities) in values {
            let clean_id = id.trim();
            if clean_id.is_empty() {
                continue;
            }
            if !models.iter().any(|value| value == clean_id) {
                models.push(clean_id.to_string());
            }
            if !catalog.iter().any(|model| model.id == clean_id) {
                catalog.push(NativeImageModel {
                    id: clean_id.to_string(),
                    display_name: Some(clean_id.to_string()),
                    modality: Some("image".to_string()),
                    capabilities: Some(capabilities.clone()),
                });
            }
        }
    }
    for model in &catalog {
        if !models.iter().any(|value| value == &model.id) {
            models.push(model.id.clone());
        }
    }
    let model_ids = models.clone();
    for model_id in model_ids {
        if catalog.iter().any(|model| model.id == model_id) {
            continue;
        }
        catalog.push(NativeImageModel {
            display_name: Some(model_id.clone()),
            capabilities: capability_map.and_then(|values| values.get(&model_id).cloned()),
            id: model_id,
            modality: Some("image".to_string()),
        });
    }
    if has_explicit_catalog {
        // When the server provides a canonical catalog, it is authoritative.
        // Do not surface legacy aliases from the transitional `models` list as
        // separate selectable SKUs.
        models = catalog
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>();
    }
    let default_model = payload
        .pointer("/defaultImageModel")
        .or_else(|| payload.pointer("/defaultModel"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(NativeChatModels {
        models,
        default_model,
        catalog,
    })
}

#[tauri::command]
async fn list_server_video_models(app: tauri::AppHandle) -> Result<NativeChatModels, String> {
    let client = create_http_client()?;
    let (status, payload) =
        authenticated_json_request(&app, &client, Method::GET, "v1/ai/catalog", None).await?;
    ensure_success(status, &payload, "瑙嗛妯″瀷鍒楄〃鑾峰彇澶辫触")?;
    let mut catalog = Vec::new();
    if let Some(values) = payload.pointer("/catalog").and_then(Value::as_array) {
        for value in values {
            if value
                .pointer("/modality")
                .and_then(Value::as_str)
                .map(|item| !item.eq_ignore_ascii_case("video"))
                .unwrap_or(true)
            {
                continue;
            }
            let Some(id) = value
                .pointer("/id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
            else {
                continue;
            };
            catalog.push(NativeImageModel {
                id: id.to_string(),
                display_name: value
                    .pointer("/displayName")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                modality: Some("video".to_string()),
                capabilities: value.pointer("/capabilities").cloned(),
            });
        }
    }
    if catalog.is_empty() {
        if let Some(channels) = payload.pointer("/videoChannels").and_then(Value::as_array) {
            for channel in channels {
                let channel_caps = channel
                    .pointer("/modelCapabilities")
                    .and_then(Value::as_object);
                if let Some(models) = channel.pointer("/models").and_then(Value::as_array) {
                    for model in models
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                    {
                        catalog.push(NativeImageModel {
                            id: model.to_string(),
                            display_name: Some(model.to_string()),
                            modality: Some("video".to_string()),
                            capabilities: channel_caps.and_then(|caps| caps.get(model).cloned()),
                        });
                    }
                }
            }
        }
    }
    let models = catalog.iter().map(|model| model.id.clone()).collect();
    let default_model = payload
        .pointer("/defaultVideoModel")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(NativeChatModels {
        models,
        default_model,
        catalog,
    })
}

#[tauri::command]
async fn chat_web_search(
    _app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<NativeWebSearchResult, String> {
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 500 {
        return Err("联网搜索词不能为空或超过 500 个字符".to_string());
    }
    let result_limit = limit.unwrap_or(6).clamp(1, 8);
    let client = create_http_client()?;
    let response = client
        .get("https://www.bing.com/search")
        .query(&[
            ("format", "rss"),
            ("q", query.as_str()),
            ("setlang", "zh-hans"),
            ("cc", "CN"),
        ])
        .header("accept", "application/rss+xml, application/xml, text/xml")
        .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|error| format!("联网搜索失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取联网搜索结果失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("联网搜索服务返回 HTTP {}", status.as_u16()));
    }
    let results = parse_bing_rss_results(&body, result_limit);
    if results.is_empty() {
        return Err("联网搜索没有返回可用结果，请更换关键词重试".to_string());
    }
    Ok(NativeWebSearchResult {
        query,
        provider: "Bing RSS".to_string(),
        results,
    })
}

fn parse_bing_rss_results(body: &str, limit: usize) -> Vec<NativeWebSearchItem> {
    body.split("<item>")
        .skip(1)
        .filter_map(|item| {
            let title = xml_tag_text(item, "title")?;
            let url = xml_tag_text(item, "link")?;
            if !matches!(url.split(':').next(), Some("http" | "https")) {
                return None;
            }
            Some(NativeWebSearchItem {
                title,
                url,
                snippet: xml_tag_text(item, "description").unwrap_or_default(),
                published_at: xml_tag_text(item, "pubDate"),
            })
        })
        .take(limit)
        .collect()
}

fn xml_tag_text(source: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = source.find(&open)? + open.len();
    let end = source[start..].find(&close)? + start;
    let value = source[start..end]
        .trim()
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .trim();
    let decoded = decode_html_entities(value);
    (!decoded.is_empty()).then_some(decoded)
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

async fn upload_reference(
    app: &tauri::AppHandle,
    client: &Client,
    reference: &ServerImageReference,
) -> Result<(String, String), String> {
    let mime = normalize_reference_mime(&reference.mime_type)?;
    let encoded = reference
        .data_uri
        .split_once(',')
        .map(|(_, value)| value.replace(char::is_whitespace, ""))
        .ok_or_else(|| format!("参考素材格式无效：{}", reference.name))?;
    let decoded = BASE64
        .decode(&encoded)
        .map_err(|_| format!("参考素材编码无效：{}", reference.name))?;
    if decoded.is_empty() || decoded.len() > MAX_REFERENCE_BYTES {
        return Err(format!("参考素材超过 10 MB：{}", reference.name));
    }
    let body = json!({
        "images": [{
            "filename": safe_reference_filename(&reference.name, mime),
            "mime": mime,
            "data": encoded,
        }]
    });
    let (status, payload) = authenticated_json_request(
        app,
        client,
        Method::POST,
        "v1/ai/reference-images",
        Some(body),
    )
    .await?;
    ensure_success(status, &payload, "参考素材上传失败")?;
    let share_id = required_string(&payload, "/shareId", "服务端没有返回素材上传 ID")?;
    let url = required_string(&payload, "/urls/0", "服务端没有返回参考素材地址")?;
    Ok((share_id, url))
}

async fn cleanup_reference_shares(app: &tauri::AppHandle, client: &Client, share_ids: &[String]) {
    for share_id in share_ids {
        let path = format!("v1/ai/reference-images/{}", share_id);
        let _ = authenticated_json_request(app, client, Method::DELETE, &path, None).await;
    }
}

async fn submit_image_generation(
    app: &tauri::AppHandle,
    client: &Client,
    input: &GenerateServerImagesInput,
    input_images: Vec<String>,
) -> Result<Value, String> {
    let body = json!({
        "clientRequestId": input.request_id,
        "clientPlatform": "tablet",
        "model": input.model,
        "prompt": input.prompt,
        "inputImages": input_images,
        "aspectRatio": input.aspect_ratio,
        "resolution": input.resolution,
        // PNG is treated by the gateway as a transparent/chroma-key request for
        // GPT Image 2. The tablet generator has no transparency control, so use
        // JPEG for ordinary image generation instead.
        "outputFormat": "jpg",
        "count": input.count,
    });
    match authenticated_json_request(
        app,
        client,
        Method::POST,
        "v1/ai/images/generations",
        Some(body),
    )
    .await
    {
        Ok((status, payload)) if status.is_success() => Ok(payload),
        Ok((StatusCode::CONFLICT, _)) => {
            recover_image_generation(app, client, &input.request_id, 15).await
        }
        Ok((status, payload)) => Err(server_error_message(
            &payload,
            status.as_u16(),
            "生图服务返回错误",
        )),
        Err(original_error) => recover_image_generation(app, client, &input.request_id, 5)
            .await
            .map_err(|_| original_error),
    }
}

async fn recover_image_generation(
    app: &tauri::AppHandle,
    client: &Client,
    request_id: &str,
    attempts: usize,
) -> Result<Value, String> {
    let path = format!("v1/ai/images/generations/by-request/{}", request_id.trim());
    for attempt in 0..attempts {
        if attempt > 0 {
            sleep(Duration::from_secs(2)).await;
        }
        let (status, payload) =
            authenticated_json_request(app, client, Method::GET, &path, None).await?;
        if status == StatusCode::NOT_FOUND {
            continue;
        }
        ensure_success(status, &payload, "生图任务恢复失败")?;
        match payload
            .pointer("/status")
            .and_then(Value::as_str)
            .unwrap_or("")
        {
            "succeeded" | "completed" => return Ok(payload),
            "failed" | "cancelled" | "released" => {
                return Err(server_error_message(&payload, 502, "生图任务执行失败"));
            }
            _ => {}
        }
    }
    Err("IMAGE_RECOVERY_PENDING".to_string())
}

async fn poll_agent_task(
    app: &tauri::AppHandle,
    client: &Client,
    task_id: &str,
) -> Result<Value, String> {
    let path = format!("v1/ai/tasks/{task_id}");
    for attempt in 0..120 {
        if attempt > 0 {
            sleep(Duration::from_secs(1)).await;
        }
        let (status, payload) =
            authenticated_json_request(app, client, Method::GET, &path, None).await?;
        ensure_success(status, &payload, "提示词优化任务查询失败")?;
        match payload
            .pointer("/status")
            .and_then(Value::as_str)
            .unwrap_or("")
        {
            "succeeded" => return Ok(payload.pointer("/result").cloned().unwrap_or(payload)),
            "failed" | "cancelled" => {
                return Err(server_error_message(&payload, 502, "提示词优化失败"));
            }
            _ => {}
        }
    }
    Err("提示词优化超时，请稍后重试".to_string())
}

async fn refresh_account_session(
    app: &tauri::AppHandle,
    client: &Client,
) -> Result<ServerSession, String> {
    let (status, account) =
        authenticated_json_request(app, client, Method::GET, "v1/account", None).await?;
    ensure_success(status, &account, "账号额度刷新失败")?;
    let mut store = load_or_create_auth_store(app)?;
    update_store_from_account(&mut store, &account);
    save_auth_store(app, &store)?;
    Ok(session_from_store(&store))
}

async fn authenticated_json_request(
    app: &tauri::AppHandle,
    client: &Client,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<(StatusCode, Value), String> {
    for attempt in 0..2 {
        let access_token = ensure_access_token(app, client, attempt > 0).await?;
        let endpoint = server_endpoint(path)?;
        let mut request = client
            .request(method.clone(), endpoint)
            .bearer_auth(access_token);
        if let Some(value) = body.clone() {
            request = request.json(&value);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("连接 Inspiration Drawer 服务端失败：{error}"))?;
        let status = response.status();
        let payload = response_json(response).await?;
        if status != StatusCode::UNAUTHORIZED || attempt > 0 {
            return Ok((status, payload));
        }
        clear_auth_tokens()?;
    }
    Err("账号登录状态已失效，请重新登录".to_string())
}

async fn ensure_access_token(
    app: &tauri::AppHandle,
    client: &Client,
    force_sync: bool,
) -> Result<String, String> {
    if !force_sync {
        if let Some(tokens) = token_store()
            .lock()
            .map_err(|_| "账号状态锁定失败".to_string())?
            .clone()
        {
            return Ok(tokens.access_token);
        }
    }
    let mut store = load_or_create_auth_store(app)?;
    let license = store
        .license
        .clone()
        .ok_or_else(|| "请先使用已绑定额度的邮箱登录".to_string())?;
    let (status, payload) = public_json_request_with_client(
        client,
        Method::POST,
        "v1/auth/email/sync",
        Some(json!({
            "license": license,
            "machineId": store.machine_id,
            "appVersion": APP_VERSION,
        })),
    )
    .await?;
    ensure_success(status, &payload, "账号同步失败")?;
    let session = persist_authentication(app, &mut store, &payload)?;
    if !session.authenticated {
        return Err("账号登录状态已失效，请重新登录".to_string());
    }
    token_store()
        .lock()
        .map_err(|_| "账号状态锁定失败".to_string())?
        .as_ref()
        .map(|tokens| tokens.access_token.clone())
        .ok_or_else(|| "服务端没有返回访问凭证".to_string())
}

fn persist_authentication(
    app: &tauri::AppHandle,
    store: &mut AuthStore,
    payload: &Value,
) -> Result<ServerSession, String> {
    let access_token = required_string(payload, "/accessToken", "服务端没有返回访问凭证")?;
    let refresh_token = required_string(payload, "/refreshToken", "服务端没有返回刷新凭证")?;
    let license = required_string(payload, "/license", "服务端没有返回设备授权")?;
    *token_store()
        .lock()
        .map_err(|_| "账号状态锁定失败".to_string())? = Some(AuthTokens {
        access_token,
        refresh_token,
    });
    store.license = Some(license);
    if let Some(account) = payload.pointer("/account") {
        update_store_from_account(store, account);
    }
    if store.email.is_none() {
        store.email = optional_string(payload, "/registration/email");
    }
    if store.display_name.is_none() {
        store.display_name = optional_string(payload, "/registration/displayName");
    }
    if store.expires_at.is_none() {
        store.expires_at = optional_string(payload, "/registration/expiresAt");
    }
    save_auth_store(app, store)?;
    Ok(session_from_store(store))
}

fn update_store_from_account(store: &mut AuthStore, account: &Value) {
    store.email = optional_string(account, "/user/email").or_else(|| store.email.clone());
    store.display_name =
        optional_string(account, "/user/displayName").or_else(|| store.display_name.clone());
    store.available_credits = optional_string(account, "/wallet/availableCredits");
    store.expires_at =
        optional_string(account, "/license/expiresAt").or_else(|| store.expires_at.clone());
}

fn session_from_store(store: &AuthStore) -> ServerSession {
    ServerSession {
        authenticated: store.license.is_some(),
        email: store.email.clone(),
        display_name: store.display_name.clone(),
        available_credits: store.available_credits.clone(),
        expires_at: store.expires_at.clone(),
    }
}

fn load_or_create_auth_store(app: &tauri::AppHandle) -> Result<AuthStore, String> {
    let path = auth_store_path(app)?;
    let mut store = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<AuthStore>(&content).ok())
        .unwrap_or_default();
    if !is_valid_machine_id(&store.machine_id) {
        store.machine_id = create_machine_id();
        save_auth_store(app, &store)?;
    }
    Ok(store)
}

fn save_auth_store(app: &tauri::AppHandle, store: &AuthStore) -> Result<(), String> {
    let path = auth_store_path(app)?;
    let content =
        serde_json::to_vec_pretty(store).map_err(|error| format!("账号信息编码失败：{error}"))?;
    fs::write(path, content).map_err(|error| format!("账号信息保存失败：{error}"))
}

fn auth_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用沙盒：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用沙盒目录：{error}"))?;
    Ok(directory.join(AUTH_STORE_FILENAME))
}

fn create_machine_id() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn is_valid_machine_id(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn token_store() -> &'static Mutex<Option<AuthTokens>> {
    AUTH_TOKENS.get_or_init(|| Mutex::new(None))
}

fn clear_auth_tokens() -> Result<(), String> {
    *token_store()
        .lock()
        .map_err(|_| "账号状态锁定失败".to_string())? = None;
    Ok(())
}

async fn public_json_request(
    client: &Client,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<(StatusCode, Value), String> {
    public_json_request_with_client(client, method, path, body).await
}

async fn public_json_request_with_client(
    client: &Client,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<(StatusCode, Value), String> {
    let endpoint = server_endpoint(path)?;
    let mut request = client.request(method, endpoint);
    if let Some(value) = body {
        request = request.json(&value);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("连接 Inspiration Drawer 服务端失败：{error}"))?;
    let status = response.status();
    let payload = response_json(response).await?;
    Ok((status, payload))
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取服务端响应失败：{error}"))?;
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body)
        .map_err(|_| format!("服务端返回了无法识别的数据：HTTP {}", status.as_u16()))
}

fn create_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(900))
        .user_agent(format!("InspirationDrawerMobile/{APP_VERSION}"))
        .build()
        .map_err(|error| format!("无法创建网络客户端：{error}"))
}

fn server_base_url() -> Result<Url, String> {
    let base = std::env::var("INSPIRATION_DRAWER_SERVER_URL")
        .ok()
        .or_else(|| option_env!("INSPIRATION_DRAWER_SERVER_URL").map(str::to_string))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_string());
    normalize_server_base_url(&base)
}

fn normalize_server_base_url(input: &str) -> Result<Url, String> {
    let normalized = format!("{}/", input.trim().trim_end_matches('/'));
    let url = Url::parse(&normalized).map_err(|_| "应用服务端地址格式不正确".to_string())?;
    let local_development = is_local_host(&url);
    if url.scheme() != "https" && !(url.scheme() == "http" && local_development) {
        return Err("应用服务端必须使用 HTTPS；本机开发地址除外".to_string());
    }
    Ok(url)
}

fn server_endpoint(path: &str) -> Result<Url, String> {
    server_base_url()?
        .join(path.trim_start_matches('/'))
        .map_err(|_| "无法组合应用服务端接口地址".to_string())
}

fn is_local_host(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "10.0.2.2")
    )
}

fn ensure_success(status: StatusCode, payload: &Value, fallback: &str) -> Result<(), String> {
    if status.is_success() {
        Ok(())
    } else {
        Err(server_error_message(payload, status.as_u16(), fallback))
    }
}

fn server_error_message(payload: &Value, status: u16, fallback: &str) -> String {
    let message = payload
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .or_else(|| payload.get("error").and_then(Value::as_str))
        .unwrap_or(fallback);
    format!("{message}：HTTP {status}")
}

fn required_string(payload: &Value, path: &str, message: &str) -> Result<String, String> {
    optional_string(payload, path).ok_or_else(|| message.to_string())
}

fn optional_string(payload: &Value, path: &str) -> Option<String> {
    payload
        .pointer(path)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_email(input: &str) -> Result<String, String> {
    let email = input.trim().to_lowercase();
    if email.len() > 254 || !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err("请输入有效的邮箱地址".to_string());
    }
    Ok(email)
}

fn validate_generation_input(input: &GenerateServerImagesInput) -> Result<(), String> {
    if input.request_id.trim().len() < 8 {
        return Err("生图请求 ID 无效".to_string());
    }
    if input.prompt.trim().is_empty() {
        return Err("请输入生图描述".to_string());
    }
    let model = input.model.trim();
    if model.is_empty()
        || model.len() > 200
        || !model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
    {
        return Err("图片模型标识无效".to_string());
    }
    if !is_valid_aspect_ratio(&input.model, &input.resolution, &input.aspect_ratio) {
        return Err("请选择有效的图片比例".to_string());
    }
    if !matches!(
        input.resolution.to_ascii_lowercase().as_str(),
        "1k" | "2k" | "4k"
    ) {
        return Err("请选择有效的清晰度".to_string());
    }
    if !(1..=4).contains(&input.count) {
        return Err("单次生成张数必须为 1 到 4".to_string());
    }
    if input.references.len() > 8 {
        return Err("单个生图节点最多连接 8 张参考图".to_string());
    }
    for reference in &input.references {
        if !reference.data_uri.starts_with("data:image/") {
            return Err(format!("参考素材格式无效：{}", reference.name));
        }
    }
    Ok(())
}

fn validate_video_generation_input(input: &GenerateServerVideosInput) -> Result<(), String> {
    if input.request_id.trim().len() < 8 || input.prompt.trim().is_empty() {
        return Err("瑙嗛鐢熸垚璇锋眰鏃犳晥".to_string());
    }
    if input.model.trim().is_empty()
        || input.model.len() > 200
        || !input.model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
    {
        return Err("瑙嗛妯″瀷鏍囪瘑鏃犳晥".to_string());
    }
    if !(1..=4).contains(&input.count) {
        return Err("瑙嗛鍗曟鐢熸垚寮犳暟蹇呴』涓?1 鍒?4".to_string());
    }
    if input.references.len() > 9
        || input
            .references
            .iter()
            .any(|reference| !reference.data_uri.starts_with("data:image/"))
    {
        return Err("瑙嗛鍙傝€冨浘鏍煎紡鏃犳晥".to_string());
    }
    Ok(())
}

fn collect_video_sources(value: &Value) -> Vec<String> {
    let mut output = Vec::new();
    collect_video_sources_inner(value, &mut output, 0, false);
    output
}

fn collect_video_sources_inner(
    value: &Value,
    output: &mut Vec<String>,
    depth: usize,
    trusted: bool,
) {
    if depth > 10 {
        return;
    }
    match value {
        Value::String(text) => {
            if text.starts_with("data:video/")
                || (trusted && (text.starts_with("https://") || text.starts_with("http://")))
            {
                output.push(
                    text.trim_matches(|character: char| " \"'\\n\\r,]})".contains(character))
                        .to_string(),
                );
            }
        }
        Value::Array(values) => values
            .iter()
            .for_each(|item| collect_video_sources_inner(item, output, depth + 1, trusted)),
        Value::Object(values) => {
            for (key, item) in values {
                let is_result = matches!(
                    key.as_str(),
                    "video_url"
                        | "videoUrl"
                        | "url"
                        | "urls"
                        | "uri"
                        | "uris"
                        | "result"
                        | "results"
                        | "output"
                        | "outputs"
                        | "walletVideoResults"
                );
                collect_video_sources_inner(item, output, depth + 1, trusted || is_result);
            }
        }
        _ => {}
    }
}

fn collect_video_task_ids(value: &Value) -> Vec<String> {
    let mut output = Vec::new();
    if let Some(results) = value.pointer("/results").and_then(Value::as_array) {
        for result in results {
            if let Some(task_id) = result
                .pointer("/taskId")
                .and_then(Value::as_str)
                .or_else(|| result.pointer("/id").and_then(Value::as_str))
            {
                output.push(task_id.to_string());
            }
        }
    }
    if let Some(task_id) = value.pointer("/taskId").and_then(Value::as_str) {
        output.push(task_id.to_string());
    }
    output
}

async fn poll_video_task(
    app: &tauri::AppHandle,
    client: &Client,
    task_id: &str,
    request_id: &str,
) -> Result<Value, String> {
    for _ in 0..180 {
        let path = format!("v1/ai/videos/{task_id}?clientRequestId={request_id}");
        let (status, payload) =
            authenticated_json_request(app, client, Method::GET, &path, None).await?;
        ensure_success(status, &payload, "瑙嗛浠诲姟鏌ヨ澶辫触")?;
        let state = payload
            .pointer("/status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(
            state.as_str(),
            "completed" | "succeeded" | "success" | "failed" | "cancelled"
        ) {
            if matches!(state.as_str(), "failed" | "cancelled") {
                return Err(server_error_message(&payload, 502, "瑙嗛浠诲姟鎵ц澶辫触"));
            }
            return Ok(payload);
        }
        let delay = payload
            .pointer("/pollAfterMs")
            .and_then(Value::as_u64)
            .unwrap_or(2500)
            .clamp(1000, 15000);
        sleep(Duration::from_millis(delay)).await;
    }
    Err("VIDEO_RECOVERY_PENDING: 瑙嗛浠诲姟浠嶅湪鍚庡彴澶勭悊".to_string())
}

fn validate_chat_input(input: &CompleteServerChatInput) -> Result<(), String> {
    if input.request_id.trim().len() < 8 || input.request_id.len() > 128 {
        return Err("Chat 请求 ID 无效".to_string());
    }
    if input.messages.is_empty() || input.messages.len() > 48 {
        return Err("Chat 消息数量无效".to_string());
    }

    let mut total_bytes = 0_usize;
    for message in &input.messages {
        if !matches!(
            message.role.as_str(),
            "system" | "user" | "assistant" | "tool"
        ) {
            return Err("Chat 消息角色无效".to_string());
        }
        let content_bytes = match &message.content {
            Value::String(content) => content.trim().len(),
            Value::Null => 0,
            content => content.to_string().len(),
        };
        let has_tool_calls = message
            .tool_calls
            .as_ref()
            .is_some_and(|calls| !calls.is_empty() && calls.len() <= 16);
        let has_tool_call_id = message
            .tool_call_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty() && value.len() <= 256);
        let valid_shape = match message.role.as_str() {
            "system" | "user" => content_bytes > 0,
            "assistant" => content_bytes > 0 || has_tool_calls,
            "tool" => content_bytes > 0 && has_tool_call_id,
            _ => false,
        };
        if !valid_shape || content_bytes > 50_000 {
            return Err("Chat 消息内容无效".to_string());
        }
        if message.role != "assistant" && message.tool_calls.is_some() {
            return Err("Chat 工具调用消息无效".to_string());
        }
        if message.role != "tool" && message.tool_call_id.is_some() {
            return Err("Chat 工具结果消息无效".to_string());
        }
        total_bytes = total_bytes.saturating_add(content_bytes);
        if total_bytes > 180_000 {
            return Err("Chat 对话内容过长，请新建一个对话".to_string());
        }
    }

    if input
        .messages
        .last()
        .map(|message| !matches!(message.role.as_str(), "user" | "tool"))
        .unwrap_or(true)
    {
        return Err("Chat 最后一条消息必须来自用户或工具".to_string());
    }
    Ok(())
}

fn is_valid_aspect_ratio(_model: &str, _resolution: &str, value: &str) -> bool {
    if matches!(value, "1:1" | "3:4" | "4:3" | "9:16" | "16:9") {
        return true;
    }
    // Exact dimensions are part of the public server catalog. Validate the
    // shape and bounds here, but do not hard-code model IDs: canonical IDs can
    // change while the server continues to advertise the same capability.
    let Some((raw_width, raw_height)) = value.split_once('x') else {
        return false;
    };
    let Ok(width) = raw_width.parse::<u32>() else {
        return false;
    };
    let Ok(height) = raw_height.parse::<u32>() else {
        return false;
    };
    (64..=8_192).contains(&width) && (64..=8_192).contains(&height)
}

fn normalize_reference_mime(input: &str) -> Result<&'static str, String> {
    match input.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("image/png"),
        "image/jpeg" | "image/jpg" => Ok("image/jpeg"),
        "image/webp" => Ok("image/webp"),
        "image/gif" => Ok("image/gif"),
        _ => Err("参考素材仅支持 PNG、JPEG、WebP 或 GIF".to_string()),
    }
}

fn safe_reference_filename(name: &str, mime: &str) -> String {
    let stem: String = name
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | '.'))
        .take(180)
        .collect();
    if !stem.is_empty() && stem.contains('.') {
        return stem;
    }
    let extension = match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    };
    format!(
        "{}.{extension}",
        if stem.is_empty() { "reference" } else { &stem }
    )
}

fn collect_image_sources(payload: &Value) -> Vec<String> {
    let mut sources = Vec::new();
    for path in [
        "/images",
        "/data",
        "/output",
        "/data/images",
        "/data/output",
    ] {
        let Some(items) = payload.pointer(path).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if let Some(value) = item.as_str() {
                sources.push(value.to_string());
                continue;
            }
            for key in ["dataUri", "b64Json", "b64_json", "url"] {
                if let Some(value) = item.get(key).and_then(Value::as_str) {
                    sources.push(value.to_string());
                    break;
                }
            }
        }
    }
    sources
}

fn extract_completion_content(payload: &Value) -> Option<String> {
    let content = payload.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return non_empty_string(text);
    }
    let parts = content.as_array()?;
    non_empty_string(
        &parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn extract_completion_tool_calls(payload: &Value) -> Vec<NativeChatToolCall> {
    payload
        .pointer("/choices/0/message/tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let id = call
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    let function = call.get("function")?;
                    let name = function
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    if name.is_empty() {
                        return None;
                    }
                    let arguments = match function.get("arguments") {
                        Some(Value::String(value)) => value.clone(),
                        Some(value) => value.to_string(),
                        None => "{}".to_string(),
                    };
                    Some(NativeChatToolCall {
                        id: if id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            id.to_string()
                        },
                        name: name.to_string(),
                        arguments,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn non_empty_string(input: &str) -> Option<String> {
    let value = input.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

async fn resolve_image_source(
    client: &Client,
    source: &str,
) -> Result<NativeGeneratedImage, String> {
    if source.starts_with("data:image/") {
        let mime_type = source
            .strip_prefix("data:")
            .and_then(|value| value.split(';').next())
            .unwrap_or("image/png")
            .to_string();
        return Ok(NativeGeneratedImage {
            data_uri: source.to_string(),
            mime_type,
        });
    }
    if source.starts_with("https://") || source.starts_with("http://") {
        return download_image(client, source).await;
    }
    Ok(NativeGeneratedImage {
        data_uri: format!("data:image/png;base64,{source}"),
        mime_type: "image/png".to_string(),
    })
}

async fn resolve_image_source_with_retry(
    client: &Client,
    source: &str,
) -> Result<NativeGeneratedImage, String> {
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            sleep(Duration::from_secs(1)).await;
        }
        match resolve_image_source(client, source).await {
            Ok(image) => return Ok(image),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

async fn download_image(client: &Client, source: &str) -> Result<NativeGeneratedImage, String> {
    let url = Url::parse(source).map_err(|_| "生成图片地址格式不正确".to_string())?;
    if url.scheme() != "https" && !(url.scheme() == "http" && is_local_host(&url)) {
        return Err("生成图片下载地址必须使用 HTTPS".to_string());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载生成图片失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载生成图片失败：HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_GENERATED_IMAGE_BYTES)
    {
        return Err("生成图片超过 64 MB 限制".to_string());
    }
    let mime_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取生成图片失败：{error}"))?;
    if bytes.len() > MAX_GENERATED_IMAGE_BYTES {
        return Err("生成图片超过 64 MB 限制".to_string());
    }
    Ok(NativeGeneratedImage {
        data_uri: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
        mime_type,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tablet_update::init_android_installer());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tablet_media::init_android_media());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tablet_keep_alive::init_android_keep_alive());
    builder
        .invoke_handler(tauri::generate_handler![
            request_server_email_code,
            verify_server_email_code,
            get_server_session,
            logout_server_session,
            redeem_server_credit_code,
            generate_server_images,
            generate_server_videos,
            recover_server_images,
            tablet_media::save_image_to_gallery,
            tablet_media::share_image,
            tablet_keep_alive::set_generation_keep_alive,
            optimize_server_prompt,
            generate_server_text,
            complete_server_chat,
            list_server_chat_models,
            list_server_image_models,
            list_server_video_models,
            chat_web_search,
            tablet_update::check_tablet_update,
            tablet_update::prepare_tablet_update,
            tablet_update::install_tablet_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_existing_unmind_server() {
        let endpoint = normalize_server_base_url(DEFAULT_SERVER_URL)
            .unwrap()
            .join("v1/ai/images/generations")
            .unwrap();
        assert_eq!(
            endpoint.as_str(),
            "https://api.unmind.art/v1/ai/images/generations"
        );
    }

    #[test]
    fn accepts_android_emulator_development_host() {
        assert!(normalize_server_base_url("http://10.0.2.2:8787").is_ok());
    }

    #[test]
    fn rejects_insecure_remote_endpoint() {
        assert!(normalize_server_base_url("http://api.example.com").is_err());
    }

    #[test]
    fn creates_a_server_compatible_machine_id() {
        let machine_id = create_machine_id();
        assert!(is_valid_machine_id(&machine_id));
    }

    #[test]
    fn reads_wallet_image_shapes() {
        let payload = json!({
            "status": "succeeded",
            "images": [
                "data:image/png;base64,AA==",
                "https://cdn.example.com/image.png"
            ]
        });
        assert_eq!(collect_image_sources(&payload).len(), 2);
    }

    #[test]
    fn reads_agent_completion_text() {
        let payload = json!({ "choices": [{ "message": { "content": "优化后的提示词" } }] });
        assert_eq!(
            extract_completion_content(&payload).as_deref(),
            Some("优化后的提示词")
        );
    }

    #[test]
    fn accepts_valid_chat_input() {
        let input = CompleteServerChatInput {
            request_id: "tablet-chat-request".to_string(),
            messages: vec![
                ServerChatMessage {
                    role: "system".to_string(),
                    content: Value::String("You are helpful.".to_string()),
                    ..Default::default()
                },
                ServerChatMessage {
                    role: "user".to_string(),
                    content: Value::String("帮我整理这个设计方向".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert!(validate_chat_input(&input).is_ok());
    }

    #[test]
    fn rejects_chat_input_without_a_final_user_message() {
        let input = CompleteServerChatInput {
            request_id: "tablet-chat-request".to_string(),
            messages: vec![ServerChatMessage {
                role: "assistant".to_string(),
                content: Value::String("上一条回复".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert_eq!(
            validate_chat_input(&input).unwrap_err(),
            "Chat 最后一条消息必须来自用户或工具"
        );
    }

    #[test]
    fn accepts_chat_tool_continuation_messages() {
        let input = CompleteServerChatInput {
            request_id: "tablet-chat-tool-request".to_string(),
            messages: vec![
                ServerChatMessage {
                    role: "user".to_string(),
                    content: Value::String("生成一张产品图".to_string()),
                    ..Default::default()
                },
                ServerChatMessage {
                    role: "assistant".to_string(),
                    content: Value::Null,
                    tool_calls: Some(vec![json!({
                        "id": "call-1",
                        "type": "function",
                        "function": { "name": "generate_image", "arguments": "{}" }
                    })]),
                    ..Default::default()
                },
                ServerChatMessage {
                    role: "tool".to_string(),
                    content: json!({ "success": true, "imageCount": 1 }),
                    tool_call_id: Some("call-1".to_string()),
                    name: Some("generate_image".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert!(validate_chat_input(&input).is_ok());
    }

    #[test]
    fn accepts_dynamic_server_image_model_ids() {
        let input = GenerateServerImagesInput {
            request_id: "tablet-image-dynamic-model".to_string(),
            model: "gpt-image-2.5-high".to_string(),
            prompt: "a clean industrial design sketch".to_string(),
            aspect_ratio: "16:9".to_string(),
            resolution: "2k".to_string(),
            count: 1,
            references: Vec::new(),
        };
        assert!(validate_generation_input(&input).is_ok());
    }

    #[test]
    fn rejects_unsafe_server_image_model_ids() {
        let input = GenerateServerImagesInput {
            request_id: "tablet-image-unsafe-model".to_string(),
            model: "gpt image 2".to_string(),
            prompt: "a clean industrial design sketch".to_string(),
            aspect_ratio: "16:9".to_string(),
            resolution: "2k".to_string(),
            count: 1,
            references: Vec::new(),
        };
        assert_eq!(
            validate_generation_input(&input).unwrap_err(),
            "图片模型标识无效"
        );
    }
}

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{header::CONTENT_TYPE, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const IMAGE_GENERATION_PATH: &str = "api/tablet/v1/images/generations";
const PROMPT_OPTIMIZATION_PATH: &str = "api/tablet/v1/prompts/optimize";

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
    rule_keys: Vec<String>,
    references: Vec<ServerImageReference>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeServerPromptInput {
    prompt: String,
    media_type: String,
    locale: String,
}

struct ServerGatewayConfig {
    base_url: Url,
    bearer_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeneratedImage {
    data_uri: String,
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePromptOptimization {
    optimized_prompt: String,
}

#[tauri::command]
async fn generate_server_images(
    input: GenerateServerImagesInput,
) -> Result<Vec<NativeGeneratedImage>, String> {
    validate_generation_input(&input)?;
    let config = load_server_gateway_config()?;
    let client = create_http_client()?;
    let endpoint = gateway_endpoint(&config.base_url, IMAGE_GENERATION_PATH)?;
    let response = apply_gateway_auth(client.post(endpoint), &config)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("连接应用服务端失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取生图响应失败：{error}"))?;
    let payload: Value = serde_json::from_str(&body)
        .map_err(|_| format!("应用服务端返回了无法识别的数据：HTTP {status}"))?;

    if !status.is_success() {
        return Err(server_error_message(
            &payload,
            status.as_u16(),
            "生图服务返回错误",
        ));
    }

    let sources = collect_image_sources(&payload);
    if sources.is_empty() {
        return Err("应用服务端没有返回图片数据".to_string());
    }

    let mut images = Vec::with_capacity(sources.len());
    for source in sources.into_iter().take(input.count.clamp(1, 4) as usize) {
        images.push(resolve_image_source(&client, &source).await?);
    }
    Ok(images)
}

#[tauri::command]
async fn optimize_server_prompt(
    input: OptimizeServerPromptInput,
) -> Result<NativePromptOptimization, String> {
    if input.prompt.trim().is_empty() {
        return Err("请先输入需要优化的提示词".to_string());
    }
    let config = load_server_gateway_config()?;
    let client = create_http_client()?;
    let endpoint = gateway_endpoint(&config.base_url, PROMPT_OPTIMIZATION_PATH)?;
    let response = apply_gateway_auth(client.post(endpoint), &config)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("连接提示词优化服务失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取提示词优化响应失败：{error}"))?;
    let payload: Value = serde_json::from_str(&body)
        .map_err(|_| format!("提示词优化服务返回了无法识别的数据：HTTP {status}"))?;

    if !status.is_success() {
        return Err(server_error_message(
            &payload,
            status.as_u16(),
            "提示词优化服务返回错误",
        ));
    }

    let optimized_prompt = [
        "/optimizedPrompt",
        "/data/optimizedPrompt",
        "/content",
        "/data/content",
        "/choices/0/message/content",
    ]
    .iter()
    .find_map(|path| payload.pointer(path).and_then(Value::as_str))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .ok_or_else(|| "提示词优化服务没有返回 optimizedPrompt".to_string())?;

    Ok(NativePromptOptimization {
        optimized_prompt: optimized_prompt.to_string(),
    })
}

fn validate_generation_input(input: &GenerateServerImagesInput) -> Result<(), String> {
    if input.prompt.trim().is_empty() {
        return Err("请输入生图描述".to_string());
    }
    if !matches!(
        input.model.as_str(),
        "nano-banana-pro" | "nano-banana-2" | "gpt-image-2"
    ) {
        return Err("服务端网关不接受该模型".to_string());
    }
    if input.references.len() > 8 {
        return Err("单个生图节点最多连接 8 张参考图".to_string());
    }
    for reference in &input.references {
        if !reference.data_uri.starts_with("data:image/") {
            return Err(format!("参考素材格式无效：{}", reference.name));
        }
        if reference.data_uri.len() > MAX_IMAGE_BYTES * 4 / 3 + 1024 {
            return Err(format!("参考素材超过 25 MB：{}", reference.name));
        }
    }
    Ok(())
}

fn create_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(900))
        .user_agent("InspirationDrawerTablet/0.1")
        .build()
        .map_err(|error| format!("无法创建网络客户端：{error}"))
}

fn apply_gateway_auth(
    request: reqwest::RequestBuilder,
    config: &ServerGatewayConfig,
) -> reqwest::RequestBuilder {
    match &config.bearer_token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

fn load_server_gateway_config() -> Result<ServerGatewayConfig, String> {
    let base_url = std::env::var("INSPIRATION_DRAWER_SERVER_URL")
        .ok()
        .or_else(|| option_env!("INSPIRATION_DRAWER_SERVER_URL").map(str::to_string))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "当前 APK 尚未配置 Inspiration Drawer 应用服务端".to_string())?;
    let bearer_token = std::env::var("INSPIRATION_DRAWER_SERVER_TOKEN")
        .ok()
        .or_else(|| option_env!("INSPIRATION_DRAWER_SERVER_TOKEN").map(str::to_string))
        .filter(|value| !value.trim().is_empty());

    Ok(ServerGatewayConfig {
        base_url: normalize_server_base_url(&base_url)?,
        bearer_token,
    })
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

fn gateway_endpoint(base_url: &Url, path: &str) -> Result<Url, String> {
    base_url
        .join(path)
        .map_err(|_| "无法组合应用服务端接口地址".to_string())
}

fn is_local_host(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "10.0.2.2")
    )
}

fn server_error_message(payload: &Value, status: u16, fallback: &str) -> String {
    let message = payload
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .unwrap_or(fallback);
    format!("{message}：HTTP {status}")
}

fn collect_image_sources(payload: &Value) -> Vec<String> {
    let mut sources = Vec::new();
    for path in [
        "/data",
        "/images",
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
        .is_some_and(|length| length as usize > MAX_IMAGE_BYTES)
    {
        return Err("生成图片超过 25 MB 限制".to_string());
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
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("生成图片超过 25 MB 限制".to_string());
    }

    Ok(NativeGeneratedImage {
        data_uri: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
        mime_type,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            generate_server_images,
            optimize_server_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appends_tablet_gateway_path() {
        let base = normalize_server_base_url("https://api.example.com/gateway").unwrap();
        let endpoint = gateway_endpoint(&base, IMAGE_GENERATION_PATH).unwrap();
        assert_eq!(
            endpoint.as_str(),
            "https://api.example.com/gateway/api/tablet/v1/images/generations"
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
    fn reads_gateway_image_shapes() {
        let payload = json!({
            "images": [
                { "dataUri": "data:image/png;base64,AA==" },
                { "url": "https://cdn.example.com/image.png" }
            ]
        });
        assert_eq!(collect_image_sources(&payload).len(), 2);
    }
}

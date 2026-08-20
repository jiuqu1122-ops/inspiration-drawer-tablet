use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{header::CONTENT_TYPE, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateOpenAiImagesInput {
    endpoint: Option<String>,
    api_key: String,
    model: String,
    prompt: String,
    size: String,
    count: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeneratedImage {
    data_uri: String,
    mime_type: String,
}

#[tauri::command]
async fn generate_openai_images(
    input: GenerateOpenAiImagesInput,
) -> Result<Vec<NativeGeneratedImage>, String> {
    let api_key = input.api_key.trim();
    let model = input.model.trim();
    let prompt = input.prompt.trim();
    if api_key.is_empty() {
        return Err("请先填写 API Key".to_string());
    }
    if model.is_empty() {
        return Err("请先填写图片模型名称".to_string());
    }
    if prompt.is_empty() {
        return Err("请输入生图描述".to_string());
    }

    let endpoint = normalize_generation_endpoint(input.endpoint.as_deref().unwrap_or(""))?;
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("无法创建网络客户端：{error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "prompt": prompt,
            "n": input.count.clamp(1, 4),
            "size": input.size,
            "response_format": "b64_json"
        }))
        .send()
        .await
        .map_err(|error| format!("生图请求失败：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取生图响应失败：{error}"))?;
    let payload: Value = serde_json::from_str(&body)
        .map_err(|_| format!("生图接口返回了无法识别的数据，HTTP {status}"))?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| payload.get("message").and_then(Value::as_str))
            .unwrap_or("生图接口返回错误");
        return Err(format!("{message}，HTTP {status}"));
    }

    let sources = collect_image_sources(&payload);
    if sources.is_empty() {
        return Err("生图接口没有返回图片数据".to_string());
    }

    let mut images = Vec::with_capacity(sources.len());
    for source in sources.into_iter().take(input.count.clamp(1, 4) as usize) {
        images.push(resolve_image_source(&client, source).await?);
    }
    Ok(images)
}

fn normalize_generation_endpoint(input: &str) -> Result<Url, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("请填写 API Base URL，例如 https://api.openai.com/v1".to_string());
    }
    let endpoint = if trimmed.ends_with("/images/generations") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/images/generations")
    };
    let url = Url::parse(&endpoint).map_err(|_| "API Base URL 格式不正确".to_string())?;
    let local_development = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local_development) {
        return Err("API Base URL 必须使用 HTTPS".to_string());
    }
    Ok(url)
}

fn collect_image_sources(payload: &Value) -> Vec<&str> {
    let mut sources = Vec::new();
    for key in ["data", "images", "output"] {
        let Some(items) = payload.get(key).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if let Some(value) = item.as_str() {
                sources.push(value);
                continue;
            }
            if let Some(value) = item.get("b64_json").and_then(Value::as_str) {
                sources.push(value);
            } else if let Some(value) = item.get("url").and_then(Value::as_str) {
                sources.push(value);
            }
        }
    }
    sources
}

async fn resolve_image_source(client: &Client, source: &str) -> Result<NativeGeneratedImage, String> {
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
    if url.scheme() != "https" {
        return Err("生成图片下载地址必须使用 HTTPS".to_string());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载生成图片失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载生成图片失败，HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|length| length as usize > MAX_IMAGE_BYTES) {
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
        .invoke_handler(tauri::generate_handler![generate_openai_images])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_openai_generation_path() {
        let endpoint = normalize_generation_endpoint("https://api.example.com/v1/").unwrap();
        assert_eq!(endpoint.as_str(), "https://api.example.com/v1/images/generations");
    }

    #[test]
    fn keeps_complete_generation_path() {
        let endpoint = normalize_generation_endpoint(
            "https://api.example.com/v1/images/generations",
        )
        .unwrap();
        assert_eq!(endpoint.as_str(), "https://api.example.com/v1/images/generations");
    }

    #[test]
    fn rejects_insecure_remote_endpoint() {
        assert!(normalize_generation_endpoint("http://api.example.com/v1").is_err());
    }
}

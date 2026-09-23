use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Runtime;
use tauri::{AppHandle, Manager};

#[allow(dead_code)]
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageActionInput {
    pub data_uri: String,
    pub file_name: String,
    pub mime_type: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageActionResult {
    pub uri: Option<String>,
    pub file_name: Option<String>,
}

#[cfg(target_os = "android")]
pub struct AndroidMediaPlugin<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub fn init_android_media<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("tablet-media")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.inspirationdrawer.tablet", "TabletMediaPlugin")?;
            app.manage(AndroidMediaPlugin { handle });
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn save_image_to_gallery(
    app: AppHandle,
    input: ImageActionInput,
) -> Result<ImageActionResult, String> {
    validate_input(&input)?;
    let plugin = app.state::<AndroidMediaPlugin<tauri::Wry>>();
    plugin
        .handle
        .run_mobile_plugin::<ImageActionResult>(
            "saveImage",
            serde_json::json!({
                "dataUri": input.data_uri,
                "fileName": input.file_name,
                "mimeType": input.mime_type,
            }),
        )
        .map_err(|error| format!("保存图片到相册失败：{error}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_image_to_gallery(
    _app: AppHandle,
    _input: ImageActionInput,
) -> Result<ImageActionResult, String> {
    Err("保存到系统相册仅支持 Android 设备".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn share_image(
    app: AppHandle,
    input: ImageActionInput,
) -> Result<ImageActionResult, String> {
    validate_input(&input)?;
    let plugin = app.state::<AndroidMediaPlugin<tauri::Wry>>();
    plugin
        .handle
        .run_mobile_plugin::<ImageActionResult>(
            "shareImage",
            serde_json::json!({
                "dataUri": input.data_uri,
                "fileName": input.file_name,
                "mimeType": input.mime_type,
            }),
        )
        .map_err(|error| format!("分享图片失败：{error}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn share_image(
    _app: AppHandle,
    _input: ImageActionInput,
) -> Result<ImageActionResult, String> {
    Err("系统分享仅支持 Android 设备".to_string())
}

#[allow(dead_code)]
fn validate_input(input: &ImageActionInput) -> Result<(), String> {
    if !input.data_uri.trim().starts_with("data:image/") {
        return Err("图片数据格式无效".to_string());
    }
    if input.data_uri.len() > 90 * 1024 * 1024 {
        return Err("图片文件过大，无法导出".to_string());
    }
    if input.file_name.trim().is_empty() {
        return Err("图片文件名不能为空".to_string());
    }
    Ok(())
}

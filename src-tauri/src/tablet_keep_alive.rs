use serde::Deserialize;
use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::{Manager, Runtime};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAliveInput {
    pub active: bool,
}

#[cfg(target_os = "android")]
pub struct AndroidKeepAlivePlugin<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub fn init_android_keep_alive<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("tablet-keep-alive")
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "com.inspirationdrawer.tablet",
                "TabletKeepAlivePlugin",
            )?;
            app.manage(AndroidKeepAlivePlugin { handle });
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn set_generation_keep_alive(
    app: AppHandle,
    input: KeepAliveInput,
) -> Result<(), String> {
    let plugin = app.state::<AndroidKeepAlivePlugin<tauri::Wry>>();
    plugin
        .handle
        .run_mobile_plugin::<serde_json::Value>(
            "setKeepAlive",
            serde_json::json!({ "active": input.active }),
        )
        .map(|_| ())
        .map_err(|error| format!("无法设置后台生成保活：{error}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn set_generation_keep_alive(
    _app: AppHandle,
    _input: KeepAliveInput,
) -> Result<(), String> {
    Ok(())
}

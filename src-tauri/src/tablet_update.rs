use reqwest::{Client, StatusCode, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const UPDATE_MANIFEST_ENDPOINTS: &[(&str, &str)] = &[
    (
        "API",
        "https://api.unmind.art/v1/mobile/latest",
    ),
    (
        "Gitee",
        "https://gitee.com/zibinyou/inspiration-drawer/releases/download/mobile-latest/latest-mobile.json",
    ),
    (
        "GitHub",
        "https://github.com/jiuqu1122-ops/inspiration-drawer/releases/download/mobile-latest/latest-mobile.json",
    ),
];
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_APK_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabletUpdateManifest {
    schema_version: u8,
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    mandatory: Option<bool>,
    apk: TabletUpdateAsset,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabletUpdateAsset {
    url: String,
    sha256: String,
    size: u64,
    architecture: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabletUpdateInfo {
    available: bool,
    current_version: String,
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    mandatory: bool,
    size: u64,
    architecture: String,
    source_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabletUpdateInstallResult {
    version: String,
    downloaded: bool,
    installer_launched: bool,
    permission_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabletUpdateProgress {
    stage: &'static str,
    version: String,
    loaded: u64,
    total: u64,
    progress: u8,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidInstallResult {
    installer_launched: bool,
    permission_required: bool,
}

#[cfg(target_os = "android")]
struct AndroidUpdateInstaller<R: tauri::Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub fn init_android_installer<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("tablet-update-installer")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.inspirationdrawer.tablet", "AndroidUpdatePlugin")?;
            app.manage(AndroidUpdateInstaller { handle });
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn check_tablet_update() -> Result<TabletUpdateInfo, String> {
    let (manifest, source_name) = fetch_update_manifest().await?;
    let current =
        Version::parse(CURRENT_VERSION).map_err(|error| format!("当前版本号无效：{error}"))?;
    let latest = Version::parse(manifest.version.trim_start_matches('v'))
        .map_err(|error| format!("更新版本号无效：{error}"))?;
    Ok(update_info(manifest, source_name, latest > current))
}

#[tauri::command]
pub async fn install_tablet_update(
    app: AppHandle,
    version: String,
) -> Result<TabletUpdateInstallResult, String> {
    let (manifest, _) = fetch_update_manifest().await?;
    let requested_version = version.trim_start_matches('v');
    let manifest_version = manifest.version.trim_start_matches('v');
    if requested_version != manifest_version {
        return Err("更新版本已经变化，请重新检查更新".to_string());
    }
    let current =
        Version::parse(CURRENT_VERSION).map_err(|error| format!("当前版本号无效：{error}"))?;
    let latest =
        Version::parse(manifest_version).map_err(|error| format!("更新版本号无效：{error}"))?;
    if latest <= current {
        return Err("当前已经是最新版本".to_string());
    }

    let update_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位更新缓存目录：{error}"))?
        .join("tablet-updates");
    fs::create_dir_all(&update_directory)
        .await
        .map_err(|error| format!("无法创建更新缓存目录：{error}"))?;
    let apk_path = update_directory.join(format!(
        "inspiration-drawer-tablet-{}.apk",
        manifest_version
    ));

    let cached = verify_apk_file(&apk_path, &manifest.apk)
        .await
        .unwrap_or(false);
    if !cached {
        download_apk(&app, &manifest, &apk_path).await?;
    } else {
        emit_progress(
            &app,
            "verified",
            manifest_version,
            manifest.apk.size,
            manifest.apk.size,
        );
    }

    let install = launch_android_installer(&app, &apk_path).await?;
    Ok(TabletUpdateInstallResult {
        version: manifest_version.to_string(),
        downloaded: true,
        installer_launched: install.0,
        permission_required: install.1,
    })
}

async fn fetch_update_manifest() -> Result<(TabletUpdateManifest, String), String> {
    let client = update_http_client()?;
    let mut failures = Vec::new();
    for (source_name, endpoint) in UPDATE_MANIFEST_ENDPOINTS {
        match fetch_manifest_from(&client, endpoint).await {
            Ok(manifest) => return Ok((manifest, (*source_name).to_string())),
            Err(error) => failures.push(format!("{source_name}: {error}")),
        }
    }
    Err(format!("暂时无法连接移动端更新源：{}", failures.join("；")))
}

async fn fetch_manifest_from(
    client: &Client,
    endpoint: &str,
) -> Result<TabletUpdateManifest, String> {
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    if response.status() != StatusCode::OK {
        return Err(format!("HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MANIFEST_BYTES)
    {
        return Err("更新清单过大".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取更新清单失败：{error}"))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("更新清单过大".to_string());
    }
    let manifest: TabletUpdateManifest =
        serde_json::from_slice(&bytes).map_err(|error| format!("更新清单格式无效：{error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &TabletUpdateManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("不支持的更新清单版本".to_string());
    }
    Version::parse(manifest.version.trim_start_matches('v'))
        .map_err(|error| format!("更新版本号无效：{error}"))?;
    let url =
        Url::parse(&manifest.apk.url).map_err(|error| format!("APK 下载地址无效：{error}"))?;
    if url.scheme() != "https" {
        return Err("APK 必须通过 HTTPS 下载".to_string());
    }
    if manifest.apk.size == 0 || manifest.apk.size > MAX_APK_BYTES {
        return Err("APK 文件大小无效".to_string());
    }
    if manifest.apk.sha256.len() != 64
        || !manifest
            .apk
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("APK SHA256 无效".to_string());
    }
    if !matches!(
        manifest.apk.architecture.as_str(),
        "arm64-v8a" | "universal"
    ) {
        return Err("更新包架构不受支持".to_string());
    }
    Ok(())
}

fn update_info(
    manifest: TabletUpdateManifest,
    source_name: String,
    available: bool,
) -> TabletUpdateInfo {
    TabletUpdateInfo {
        available,
        current_version: CURRENT_VERSION.to_string(),
        version: manifest.version.trim_start_matches('v').to_string(),
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        mandatory: manifest.mandatory.unwrap_or(false),
        size: manifest.apk.size,
        architecture: manifest.apk.architecture,
        source_name,
    }
}

async fn download_apk(
    app: &AppHandle,
    manifest: &TabletUpdateManifest,
    destination: &Path,
) -> Result<(), String> {
    let partial_path = destination.with_extension("apk.part");
    let _ = fs::remove_file(&partial_path).await;
    emit_progress(app, "downloading", &manifest.version, 0, manifest.apk.size);
    let result = download_apk_inner(app, manifest, destination, &partial_path).await;
    if result.is_err() {
        let _ = fs::remove_file(&partial_path).await;
    }
    result
}

async fn download_apk_inner(
    app: &AppHandle,
    manifest: &TabletUpdateManifest,
    destination: &Path,
    partial_path: &Path,
) -> Result<(), String> {
    let client = update_http_client()?;
    let mut response = client
        .get(&manifest.apk.url)
        .send()
        .await
        .map_err(|error| format!("更新包下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("更新包下载失败：HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length != manifest.apk.size)
    {
        return Err("更新包大小与清单不一致".to_string());
    }

    let mut file = fs::File::create(partial_path)
        .await
        .map_err(|error| format!("无法创建更新缓存文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取更新包失败：{error}"))?
    {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > manifest.apk.size || downloaded > MAX_APK_BYTES {
            return Err("更新包超过清单声明大小".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("写入更新缓存失败：{error}"))?;
        hasher.update(&chunk);
        emit_progress(
            app,
            "downloading",
            &manifest.version,
            downloaded,
            manifest.apk.size,
        );
    }
    file.flush()
        .await
        .map_err(|error| format!("更新缓存写入失败：{error}"))?;
    drop(file);

    if downloaded != manifest.apk.size {
        return Err("更新包下载不完整".to_string());
    }
    let digest = format!("{:x}", hasher.finalize());
    if !digest.eq_ignore_ascii_case(&manifest.apk.sha256) {
        return Err("更新包 SHA256 校验失败".to_string());
    }
    let _ = fs::remove_file(destination).await;
    fs::rename(partial_path, destination)
        .await
        .map_err(|error| format!("无法保存已校验更新包：{error}"))?;
    emit_progress(
        app,
        "verified",
        &manifest.version,
        downloaded,
        manifest.apk.size,
    );
    Ok(())
}

async fn verify_apk_file(path: &Path, asset: &TabletUpdateAsset) -> Result<bool, String> {
    let metadata = match fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(_) => return Ok(false),
    };
    if metadata.len() != asset.size {
        return Ok(false);
    }
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("无法读取更新缓存：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("无法校验更新缓存：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(&asset.sha256))
}

fn emit_progress(app: &AppHandle, stage: &'static str, version: &str, loaded: u64, total: u64) {
    let progress = if total == 0 {
        0
    } else {
        ((loaded.saturating_mul(100) / total).min(100)) as u8
    };
    let _ = app.emit(
        "tablet-update-progress",
        TabletUpdateProgress {
            stage,
            version: version.trim_start_matches('v').to_string(),
            loaded,
            total,
            progress,
        },
    );
}

fn update_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(15 * 60))
        .user_agent(format!("InspirationDrawerMobile/{CURRENT_VERSION}"))
        .build()
        .map_err(|error| format!("无法创建更新客户端：{error}"))
}

#[cfg(target_os = "android")]
async fn launch_android_installer(app: &AppHandle, path: &Path) -> Result<(bool, bool), String> {
    let installer = app.state::<AndroidUpdateInstaller<tauri::Wry>>();
    let result = installer
        .handle
        .run_mobile_plugin::<AndroidInstallResult>(
            "installApk",
            serde_json::json!({ "path": path.to_string_lossy() }),
        )
        .map_err(|error| format!("无法启动 Android 安装器：{error}"))?;
    Ok((result.installer_launched, result.permission_required))
}

#[cfg(not(target_os = "android"))]
async fn launch_android_installer(_app: &AppHandle, _path: &Path) -> Result<(bool, bool), String> {
    Err("自动安装仅支持 Android 应用".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_manifest() -> TabletUpdateManifest {
        TabletUpdateManifest {
            schema_version: 1,
            version: "0.2.0".to_string(),
            notes: Some("更新说明".to_string()),
            pub_date: None,
            mandatory: Some(false),
            apk: TabletUpdateAsset {
                url: "https://downloads.example.com/tablet.apk".to_string(),
                sha256: "a".repeat(64),
                size: 123,
                architecture: "arm64-v8a".to_string(),
            },
        }
    }

    #[test]
    fn accepts_valid_android_update_manifest() {
        assert!(validate_manifest(&valid_manifest()).is_ok());
    }

    #[test]
    fn rejects_insecure_android_update_downloads() {
        let mut manifest = valid_manifest();
        manifest.apk.url = "http://downloads.example.com/tablet.apk".to_string();
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn rejects_invalid_android_update_hash() {
        let mut manifest = valid_manifest();
        manifest.apk.sha256 = "not-a-hash".to_string();
        assert!(validate_manifest(&manifest).is_err());
    }
}

# Inspiration Drawer Tablet

独立的 Android 平板 AI 工业设计工作台。此仓库与 Windows 桌面端完全分离。

## 当前能力

- 横屏三栏工作台，竖屏 Canvas 优先并使用底部 AI 面板
- 通过系统图片选择器批量导入设备图片
- 图片与项目数据写入 WebView 的应用沙盒，不保存 Windows 路径
- Pointer Events 画布：手指或手写笔拖动、画布平移、双指缩放、长按菜单
- OpenAI-compatible 生图配置、原生 Rust 网络请求、生成任务节点与结果沙盒缓存

API Key 仅保留在当前应用运行内存中，不写入项目或本地数据库。

## Web 与桌面预览

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
```

浏览器预览可以测试 UI、导入和画布手势；真实生图请求需要在 Tauri 运行环境中执行。

## Android 初始化

先安装 Android Studio，并在 SDK Manager 中安装 Android SDK Platform、Platform Tools、Build Tools、Command-line Tools 和 NDK。使用 Android Studio 自带的 JDK。

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\<installed-version>"

rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init
npm run tauri android dev
npm run tauri android build
```

本项目当前使用 Tauri 2；第一次执行 `android init` 后，Android 原生工程会生成在 `src-tauri/gen/android`。

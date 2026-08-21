# Inspiration Drawer Mobile

独立的 Android 手机/平板 AI 工业设计工作台。此仓库与 Windows 桌面端完全分离。

## 当前能力

- 与 Windows 端统一的浅色点阵无限画布，横竖屏均以 Canvas 为主界面
- 左侧窄工具轨与点击展开的素材管理抽屉，右侧节点工具条在竖屏自动转为底部工具条
- 通过系统图片选择器批量导入设备图片
- 图片与项目数据写入 WebView 的应用沙盒，不保存 Windows 路径
- Pointer Events 画布：手指或手写笔拖动、画布平移、双指缩放、长按菜单
- 节点式生图：预设 Nano Banana Pro、Nano Banana 2、GPT Image 2
- 图片节点、规则节点可通过拖拽或点按连接到生图节点
- 16 项桌面端同源图像规则、规则预设与服务端提示词优化
- 生成结果自动保存到素材库，应用使用沉浸式全屏并支持临时滑出系统栏
- 原生 Rust 服务端网关请求与结果沙盒缓存

应用界面不提供渠道 API 地址或密钥输入。APK 只调用 Inspiration Drawer 应用服务端，
由服务端持有并路由 Windows 端同源的 XAIS、New API 与 Bigmodel 渠道。接口契约、三模型
路由表和构建配置见 [docs/server-gateway.md](docs/server-gateway.md)。

## Web 与桌面预览

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
```

浏览器预览可以测试 UI、导入和画布手势；真实生图请求需要在 Tauri 运行环境中执行。

## Android 开发

开发工具统一安装在 E 盘：Android Studio 位于 `E:\Android\Android Studio`，SDK 位于 `E:\Android\Sdk`，Gradle 及其构建缓存位于 `E:\Android\Gradle`。当前已安装 Android 36、Build Tools 36.1.0、Platform Tools 37.0.1、NDK 29.0.14206865 和 Gradle 8.14.3。

```powershell
$env:JAVA_HOME = "E:\Android\Android Studio\jbr"
$env:ANDROID_HOME = "E:\Android\Sdk"
$env:ANDROID_SDK_ROOT = "E:\Android\Sdk"
$env:NDK_HOME = "E:\Android\Sdk\ndk\29.0.14206865"
$env:GRADLE_HOME = "E:\Android\Gradle\gradle-8.14.3"
$env:GRADLE_USER_HOME = "E:\Android\Gradle\user-home"

rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android dev
npm run tauri android build -- --apk
```

本项目当前使用 Tauri 2，Android 原生工程已生成在 `src-tauri/gen/android`。上述环境变量也已写入当前 Windows 用户环境；新开的终端会自动读取。

Windows 上运行标准 Tauri Android 构建前，需要在“设置 → 系统 → 高级 → 开发者选项”中开启开发者模式，以允许 Tauri 创建原生库符号链接。

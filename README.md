# Inspiration Drawer Tablet

Independent Android tablet application for AI-assisted industrial design.

The first product milestone focuses on a touch-first image-generation canvas and importing images from the Android device. This repository is intentionally separate from the Windows desktop application.

## Development

```powershell
npm install
npm run build
npm run tauri android init
npm run tauri android dev
```

Android builds require Android Studio, its bundled JDK, the Android SDK/NDK and the Rust Android targets.

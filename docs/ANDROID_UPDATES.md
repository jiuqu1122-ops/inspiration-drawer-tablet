# Android mobile updates

The Android mobile app uses a dedicated release channel. It does not read or replace the Windows `latest.json` manifest.

## One-time signing setup

1. Create and back up a production Android keystore. Never change this key after the first public APK is installed.
2. Copy `src-tauri/gen/android/keystore.properties.example` to `src-tauri/gen/android/keystore.properties` and enter the private values.
3. Keep both the keystore and `keystore.properties` outside Git. The build rejects unsigned release tasks.

Debug APKs and production APKs normally have different signatures. Uninstall the debug build before the first production installation. Later production updates retain projects and account data when the package identifier and signing key remain unchanged.

## Publish an update

1. Increase the same semantic version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Build the signed arm64 APK:

   `npm run tauri android build -- --apk --target aarch64`

3. Upload the APK to the stable OSS object `mobile/Inspiration-Drawer-Mobile-arm64.apk`. The object can remain private; the API serves it through `https://api.unmind.art/v1/mobile/apk`.
4. Generate the mobile manifest using the final HTTPS APK URL:

   `npm run android:update:manifest -- --apk <signed-apk-path> --url <https-apk-url> --notes-file <release-notes-file>`

5. Upload `release/latest-mobile.json` to `mobile/latest-mobile.json` on OSS. Gitee and GitHub may mirror the same two files under the `mobile-latest` tag. The mobile app checks `https://api.unmind.art/v1/mobile/latest` first, which rewrites the APK URL to the server proxy.

The application checks OSS first, then Gitee and GitHub as fallback mirrors. It validates the declared size and SHA-256 while downloading. Android then verifies the package name and the signing certificate before showing the system installer. The user must approve the final system installation; Android does not allow a normal sideloaded app to silently replace itself.

The tablet app performs an automatic update check once every 24 hours and also checks again when it returns to the foreground if the previous check is older than one day.

package com.inspirationdrawer.tablet

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.MessageDigest

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

@TauriPlugin
class AndroidUpdatePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallApkArgs::class.java)
      val apkFile = File(args.path).canonicalFile
      val cacheRoot = activity.cacheDir.canonicalFile
      if (!apkFile.path.startsWith(cacheRoot.path + File.separator) || !apkFile.name.endsWith(".apk")) {
        invoke.reject("更新包不在应用缓存目录内")
        return
      }
      if (!apkFile.isFile) {
        invoke.reject("更新包不存在")
        return
      }
      verifyPackageIdentity(apkFile)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !activity.packageManager.canRequestPackageInstalls()
      ) {
        val settingsIntent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${activity.packageName}"),
        )
        activity.startActivity(settingsIntent)
        invoke.resolve(result(installerLaunched = false, permissionRequired = true))
        return
      }

      val apkUri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        apkFile,
      )
      val installIntent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
        data = apkUri
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
        putExtra(Intent.EXTRA_RETURN_RESULT, false)
      }
      activity.startActivity(installIntent)
      invoke.resolve(result(installerLaunched = true, permissionRequired = false))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "无法启动 Android 安装器")
    }
  }

  private fun verifyPackageIdentity(apkFile: File) {
    val archive = packageInfo(apkFile.path)
      ?: throw IllegalArgumentException("无法读取更新包信息")
    if (archive.packageName != activity.packageName) {
      throw IllegalArgumentException("更新包应用标识不匹配")
    }
    val installed = installedPackageInfo(activity.packageName)
    val archiveSigners = signerDigests(archive)
    val installedSigners = signerDigests(installed)
    if (archiveSigners.isEmpty() || installedSigners.isEmpty() || archiveSigners.intersect(installedSigners).isEmpty()) {
      throw SecurityException("更新包签名与当前应用不一致")
    }
  }

  @Suppress("DEPRECATION")
  private fun packageInfo(path: String): PackageInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      activity.packageManager.getPackageArchiveInfo(
        path,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
      )
    } else {
      activity.packageManager.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES)
    }

  @Suppress("DEPRECATION")
  private fun installedPackageInfo(packageName: String): PackageInfo =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      activity.packageManager.getPackageInfo(
        packageName,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
      )
    } else {
      activity.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    }

  @Suppress("DEPRECATION")
  private fun signerDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = info.signingInfo ?: return emptySet()
      if (signingInfo.hasMultipleSigners()) {
        signingInfo.apkContentsSigners
      } else {
        signingInfo.signingCertificateHistory
      }
    } else {
      info.signatures ?: emptyArray()
    }
    return signatures.map { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString("") { byte -> "%02x".format(byte) }
    }.toSet()
  }

  private fun result(installerLaunched: Boolean, permissionRequired: Boolean) = JSObject().apply {
    put("installerLaunched", installerLaunched)
    put("permissionRequired", permissionRequired)
  }
}

package com.inspirationdrawer.tablet

import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ImageActionArgs {
  lateinit var dataUri: String
  lateinit var fileName: String
  var mimeType: String? = null
}

@TauriPlugin
class TabletMediaPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun saveImage(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ImageActionArgs::class.java)
      val payload = decode(args)
      val safeName = safeFileName(args.fileName, payload.mimeType)
      val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveWithMediaStore(safeName, payload.mimeType, payload.bytes)
      } else {
        saveLegacy(safeName, payload.mimeType, payload.bytes)
      }
      invoke.resolve(result(uri, safeName))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "保存图片到相册失败")
    }
  }

  @Command
  fun shareImage(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ImageActionArgs::class.java)
      val payload = decode(args)
      val safeName = safeFileName(args.fileName, payload.mimeType)
      val shareDirectory = File(activity.cacheDir, "shared-images").apply { mkdirs() }
      val file = File(shareDirectory, safeName)
      file.outputStream().use { it.write(payload.bytes) }
      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        file,
      )
      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        // Use the wildcard image MIME so WeChat and other image receivers are
        // eligible even when the generated file is JPEG/WebP on a tablet.
        type = "image/*"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("Inspiration Drawer image", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(shareIntent, "分享图片"))
      invoke.resolve(result(uri, safeName))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "分享图片失败")
    }
  }

  private fun saveWithMediaStore(name: String, mimeType: String, bytes: ByteArray): Uri {
    val resolver = activity.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, name)
      put(MediaStore.Images.Media.MIME_TYPE, mimeType)
      put(
        MediaStore.Images.Media.RELATIVE_PATH,
        Environment.DIRECTORY_PICTURES + File.separator + "Inspiration Drawer",
      )
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("系统相册拒绝创建图片")
    try {
      resolver.openOutputStream(uri)?.use { it.write(bytes) }
        ?: throw IllegalStateException("无法写入系统相册")
      resolver.update(
        uri,
        ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
        null,
        null,
      )
      return uri
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      throw error
    }
  }

  @Suppress("DEPRECATION")
  private fun saveLegacy(name: String, mimeType: String, bytes: ByteArray): Uri {
    val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
      .resolve("Inspiration Drawer")
      .apply { mkdirs() }
    val file = File(directory, name)
    file.outputStream().use { it.write(bytes) }
    MediaScannerConnection.scanFile(activity, arrayOf(file.path), arrayOf(mimeType), null)
    return Uri.fromFile(file)
  }

  private data class DecodedPayload(val bytes: ByteArray, val mimeType: String)

  private fun decode(args: ImageActionArgs): DecodedPayload {
    val comma = args.dataUri.indexOf(',')
    require(comma > 5) { "图片数据格式无效" }
    val metadata = args.dataUri.substring(5, comma)
    val mimeType = args.mimeType?.takeIf { it.startsWith("image/") }
      ?: metadata.substringBefore(';').takeIf { it.startsWith("image/") }
      ?: "image/png"
    val encoded = args.dataUri.substring(comma + 1)
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    require(bytes.isNotEmpty()) { "图片数据为空" }
    return DecodedPayload(bytes, mimeType)
  }

  private fun safeFileName(name: String, mimeType: String): String {
    val clean = name.trim().replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
    if (clean.isNotEmpty() && clean.contains('.')) return clean
    val extension = when (mimeType) {
      "image/jpeg" -> "jpg"
      "image/webp" -> "webp"
      "image/gif" -> "gif"
      else -> "png"
    }
    return (if (clean.isEmpty()) "inspiration-drawer" else clean) + "." + extension
  }

  private fun result(uri: Uri?, fileName: String) = JSObject().apply {
    put("uri", uri?.toString())
    put("fileName", fileName)
  }
}

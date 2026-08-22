package com.inspirationdrawer.tablet

import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class KeepAliveArgs {
  var active: Boolean = false
}

@TauriPlugin
class TabletKeepAlivePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setKeepAlive(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(KeepAliveArgs::class.java)
      val serviceIntent = Intent(activity, TabletGenerationKeepAliveService::class.java)
      if (args.active) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          activity.startForegroundService(serviceIntent)
        } else {
          activity.startService(serviceIntent)
        }
      } else {
        activity.stopService(serviceIntent)
      }
      invoke.resolve(JSObject())
    } catch (error: Exception) {
      invoke.reject(error.message ?: "无法设置生成保活")
    }
  }
}

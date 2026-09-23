package com.inspirationdrawer.tablet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class TabletGenerationKeepAliveService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    try {
    createNotificationChannel()
    val notificationIntent = Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      notificationIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("灵感画布")
      .setContentText("正在后台处理生成或更新任务")
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "InspirationDrawer:BackgroundTask",
    ).apply {
      setReferenceCounted(false)
      // Keep the process alive for long-running server tasks while the app is
      // backgrounded. The foreground service is stopped by JS when all tasks
      // finish; this timeout is only a final battery-safety guard.
      acquire(30 * 60 * 1000L)
    }
    } catch (_: SecurityException) {
      // Some device policies reject wake locks or foreground-service startup.
      // Generation itself is server-side, so this optional optimization must
      // never crash the host activity.
      stopSelf()
    } catch (_: RuntimeException) {
      // Keep the optional optimization best-effort on vendor Android builds.
      stopSelf()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // If Android reclaims the service process, restart the foreground service
    // so the persisted canvas task can be recovered when the app resumes.
    return START_STICKY
  }

  override fun onDestroy() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "后台任务", NotificationManager.IMPORTANCE_LOW),
    )
  }

  companion object {
    private const val CHANNEL_ID = "tablet-image-generation"
    private const val NOTIFICATION_ID = 41021
  }
}

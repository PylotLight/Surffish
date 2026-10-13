package expo.modules.geckoview

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.mozilla.geckoview.GeckoResult

private const val FILE_PICKER_REQUEST = 47_201

class GeckoViewModule : Module(), GeckoHost {
  private var filePickerCallback: ((Array<Uri>?) -> Unit)? = null
  private var pendingIntent: Map<String, Any?>? = null

  // ---------------------------------------------------------------- GeckoHost

  override fun emit(event: String, payload: Map<String, Any?>) {
    try { sendEvent(event, payload) } catch (_: Exception) { /* JS not ready */ }
  }

  override fun currentActivity(): Activity? = appContext.currentActivity

  override fun requestAndroidPermissions(permissions: Array<String>, callback: (Boolean) -> Unit) {
    val manager = appContext.permissions
    if (manager == null) { callback(false); return }
    manager.askForPermissions({ result ->
      callback(result.values.all { it.status == PermissionsStatus.GRANTED })
    }, *permissions)
  }

  override fun pickFiles(intent: Intent, callback: (Array<Uri>?) -> Unit) {
    val activity = appContext.currentActivity
    if (activity == null) { callback(null); return }
    filePickerCallback?.invoke(null)
    filePickerCallback = callback
    try {
      activity.startActivityForResult(intent, FILE_PICKER_REQUEST)
    } catch (e: Exception) {
      filePickerCallback = null
      callback(null)
    }
  }

  // ---------------------------------------------------------------- intents

  private fun parseIntent(intent: Intent?): Map<String, Any?>? {
    if (intent == null) return null
    return when (intent.action) {
      Intent.ACTION_VIEW -> {
        val data = intent.dataString ?: return null
        if (data.startsWith("http://") || data.startsWith("https://")) mapOf("url" to data) else null
      }
      Intent.ACTION_SEND -> {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
        mapOf("text" to text, "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT))
      }
      Intent.ACTION_WEB_SEARCH, Intent.ACTION_SEARCH -> {
        val q = intent.getStringExtra("query") ?: return null
        mapOf("text" to q)
      }
      else -> null
    }
  }

  private fun consume(intent: Intent?): Map<String, Any?>? {
    val parsed = parseIntent(intent) ?: return null
    // Don't replay the same intent when the activity is recreated.
    intent?.action = Intent.ACTION_MAIN
    intent?.data = null
    return parsed
  }

  // ---------------------------------------------------------------- definition

  override fun definition() = ModuleDefinition {
    Name("SurffishGecko")

    Constants(
      "geckoVersion" to "${org.mozilla.geckoview.BuildConfig.MOZ_APP_VERSION} (${org.mozilla.geckoview.BuildConfig.MOZ_APP_BUILDID})"
    )

    Events(
      "onLocationChange", "onTitleChange", "onProgress", "onPageStart", "onPageStop", "onNavState",
      "onSecurity", "onFullScreen", "onContextMenu", "onNewTabRequest", "onCloseTabRequest", "onSelectTabRequest",
      "onPermissionRequest", "onDownload", "onExtensionsChanged", "onExtensionPopup", "onExtensionAction",
      "onExtensionInstallPrompt", "onCrash", "onIntent", "onOpenUrl"
    )

    OnCreate {
      GeckoEngine.host = this@GeckoViewModule
    }

    OnDestroy {
      if (GeckoEngine.host === this@GeckoViewModule) GeckoEngine.host = null
    }

    OnNewIntent { intent ->
      consume(intent)?.let { emit("onIntent", it) }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != FILE_PICKER_REQUEST) return@OnActivityResult
      val cb = filePickerCallback ?: return@OnActivityResult
      filePickerCallback = null
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) { cb(null); return@OnActivityResult }
      val clip = data.clipData
      val uris = if (clip != null && clip.itemCount > 0) {
        Array(clip.itemCount) { clip.getItemAt(it).uri }
      } else data.data?.let { arrayOf(it) }
      cb(uris)
    }

    AsyncFunction("init") {
      GeckoEngine.host = this@GeckoViewModule
      val ctx = appContext.reactContext ?: throw IllegalStateException("no context")
      GeckoEngine.runtime(ctx)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("consumeLaunchIntent") {
      val pending = pendingIntent
      pendingIntent = null
      pending ?: consume(appContext.currentActivity?.intent)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("createTab") { tabId: String, isPrivate: Boolean, desktop: Boolean, url: String?, state: String? ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("no context")
      GeckoEngine.host = this@GeckoViewModule
      GeckoEngine.createTab(ctx, tabId, isPrivate, desktop, url, state)
      GeckoEngine.views.filterIsInstance<GeckoHostView>().filter { it.tabId == tabId }.forEach { it.refresh() }
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hasTab") { tabId: String -> GeckoEngine.tab(tabId) != null }.runOnQueue(Queues.MAIN)
    AsyncFunction("closeTab") { tabId: String -> GeckoEngine.closeTab(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("load") { tabId: String, url: String -> GeckoEngine.load(tabId, url) }.runOnQueue(Queues.MAIN)
    AsyncFunction("goBack") { tabId: String -> GeckoEngine.goBack(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("goForward") { tabId: String -> GeckoEngine.goForward(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("reload") { tabId: String -> GeckoEngine.reload(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { tabId: String -> GeckoEngine.stop(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("exitFullScreen") { tabId: String -> GeckoEngine.exitFullScreen(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("setDesktopMode") { tabId: String, desktop: Boolean -> GeckoEngine.setDesktopMode(tabId, desktop) }.runOnQueue(Queues.MAIN)
    AsyncFunction("clearFind") { tabId: String -> GeckoEngine.clearFind(tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("getSessionStates") { GeckoEngine.sessionStates() }.runOnQueue(Queues.MAIN)

    AsyncFunction("find") { tabId: String, query: String, backwards: Boolean, promise: Promise ->
      GeckoEngine.find(tabId, query, backwards).bridge(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("captureThumbnail") { tabId: String, promise: Promise ->
      GeckoEngine.capture(tabId).bridge(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearBrowsingData") { promise: Promise ->
      GeckoEngine.clearBrowsingData().map { true }.bridge(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("resolvePermission") { requestId: String, allow: Boolean ->
      GeckoEngine.resolvePermission(requestId, allow)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("download") { url: String, filename: String?, mime: String? ->
      GeckoEngine.download(url, filename, mime)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openExternal") { url: String -> GeckoEngine.openInApp(url) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setImmersive") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction
      val window = activity.window
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      if (enabled) {
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
    }.runOnQueue(Queues.MAIN)

    // ---- extensions
    AsyncFunction("listExtensions") { promise: Promise -> GeckoEngine.listExtensions().bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("installExtension") { url: String, promise: Promise -> GeckoEngine.installExtension(url, false).bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("ensureUblock") { promise: Promise -> GeckoEngine.ensureUblock().bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("setExtensionEnabled") { id: String, enabled: Boolean, promise: Promise -> GeckoEngine.setExtensionEnabled(id, enabled).bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("setExtensionPrivate") { id: String, allowed: Boolean, promise: Promise -> GeckoEngine.setExtensionPrivate(id, allowed).bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("uninstallExtension") { id: String, promise: Promise -> GeckoEngine.uninstallExtension(id).bridge(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("clickExtensionAction") { id: String, tabId: String? -> GeckoEngine.clickAction(id, tabId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("resolveInstallPrompt") { requestId: String, allow: Boolean, allowPrivate: Boolean ->
      GeckoEngine.resolveInstallPrompt(requestId, allow, allowPrivate)
    }.runOnQueue(Queues.MAIN)

    View(GeckoHostView::class) {
      Prop("tabId") { view: GeckoHostView, tabId: String? -> view.attach(tabId) }
      OnViewDestroys { view: GeckoHostView -> view.dispose() }
    }
  }
}

private fun <T> GeckoResult<T>.bridge(promise: Promise) {
  accept({ value -> promise.resolve(value) }, { e -> promise.reject("E_GECKO", e?.message ?: "gecko error", e) })
}

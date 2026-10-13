package expo.modules.geckoview

import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.ContentDelegate
import org.mozilla.geckoview.GeckoSession.NavigationDelegate
import org.mozilla.geckoview.GeckoSession.PermissionDelegate
import org.mozilla.geckoview.GeckoSession.ProgressDelegate
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.StorageController
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebExtensionController
import org.mozilla.geckoview.WebResponse
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Host hooks the Expo module provides. The engine itself only knows Android + GeckoView, so it can
 * be compiled and reasoned about without React Native.
 */
interface GeckoHost {
  fun emit(event: String, payload: Map<String, Any?>)
  fun currentActivity(): Activity?
  fun requestAndroidPermissions(permissions: Array<String>, callback: (Boolean) -> Unit)
  fun pickFiles(intent: Intent, callback: (Array<Uri>?) -> Unit)
}

/** A native view that can show one tab's session. */
interface GeckoSurface {
  val tabId: String?
  fun detach()
  fun capture(): GeckoResult<Bitmap>
}

class TabRecord(
  val id: String,
  val session: GeckoSession,
  val isPrivate: Boolean,
  /** popup sessions belong to an extension action popup, not the tab strip */
  val isPopup: Boolean = false
) {
  var url: String = ""
  var title: String = ""
  var canGoBack = false
  var canGoForward = false
  var desktop = false
  var state: String? = null
}

/** One GeckoRuntime per process, one GeckoSession per tab. Everything runs on the main thread. */
object GeckoEngine {
  private const val TAG = "SurffishGecko"
  const val UBLOCK_ID = "uBlock0@raymondhill.net"
  private const val UBLOCK_XPI = "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi"

  var host: GeckoHost? = null
  private var runtime: GeckoRuntime? = null
  private lateinit var appContext: Context
  val tabs = ConcurrentHashMap<String, TabRecord>()
  private val main = Handler(Looper.getMainLooper())

  private val pendingContentPermissions = HashMap<String, GeckoResult<Int>>()
  private val pendingMediaPermissions = HashMap<String, Pair<PermissionDelegate.MediaCallback, Pair<PermissionDelegate.MediaSource?, PermissionDelegate.MediaSource?>>>()
  private val pendingInstallPrompts = HashMap<String, GeckoResult<WebExtension.PermissionPromptResponse>>()
  /** Extension ids we install ourselves without asking (bundled defaults). */
  private val autoAcceptInstalls = HashSet<String>()
  private var autoAcceptNextInstall = false
  private val extensions = ConcurrentHashMap<String, WebExtension>()
  private val actions = ConcurrentHashMap<String, WebExtension.Action>()

  /** Views register here so commands like capture can find the GeckoView showing a tab. */
  val views = HashSet<GeckoSurface>()

  private fun emit(event: String, payload: Map<String, Any?>) {
    main.post { host?.emit(event, payload) }
  }

  fun runtime(context: Context): GeckoRuntime {
    runtime?.let { return it }
    appContext = context.applicationContext
    val settings = GeckoRuntimeSettings.Builder()
      .aboutConfigEnabled(true)
      .consoleOutput(false)
      .remoteDebuggingEnabled(false)
      .preferredColorScheme(GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM)
      .extensionsProcessEnabled(true)
      .extensionsWebAPIEnabled(true)
      .loginAutofillEnabled(false)
      .build()
    val rt = GeckoRuntime.create(appContext, settings)
    runtime = rt
    setupExtensionController(rt)
    return rt
  }

  fun hasRuntime() = runtime != null

  // ---------------------------------------------------------------- tabs

  fun createTab(context: Context, tabId: String, isPrivate: Boolean, desktop: Boolean, url: String?, state: String?): TabRecord {
    tabs[tabId]?.let { existing ->
      if (!url.isNullOrBlank()) existing.session.loadUri(url)
      return existing
    }
    val rt = runtime(context)
    val record = buildSession(tabId, isPrivate, desktop, isPopup = false)
    record.session.open(rt)
    attachExtensionDelegates(record.session)
    val restored = state?.let { GeckoSession.SessionState.fromString(it) }
    when {
      restored != null -> record.session.restoreState(restored)
      !url.isNullOrBlank() -> record.session.loadUri(url)
    }
    return record
  }

  /** Builds an unopened session with every delegate wired to [tabId]. */
  private fun buildSession(tabId: String, isPrivate: Boolean, desktop: Boolean, isPopup: Boolean): TabRecord {
    val settings = GeckoSessionSettings.Builder()
      .usePrivateMode(isPrivate)
      .useTrackingProtection(true)
      .userAgentMode(if (desktop) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP else GeckoSessionSettings.USER_AGENT_MODE_MOBILE)
      .viewportMode(if (desktop) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP else GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
      .suspendMediaWhenInactive(false)
      .build()
    val session = GeckoSession(settings)
    val record = TabRecord(tabId, session, isPrivate, isPopup)
    record.desktop = desktop
    tabs[tabId] = record
    session.navigationDelegate = navigationDelegate(record)
    session.progressDelegate = progressDelegate(record)
    session.contentDelegate = contentDelegate(record)
    session.permissionDelegate = permissionDelegate(record)
    session.promptDelegate = GeckoPrompts(record)
    host?.currentActivity()?.let { activity ->
      session.selectionActionDelegate = org.mozilla.geckoview.BasicSelectionActionDelegate(activity)
    }
    return record
  }

  fun closeTab(tabId: String) {
    val record = tabs.remove(tabId) ?: return
    views.filter { it.tabId == tabId }.forEach { it.detach() }
    try {
      record.session.close()
    } catch (e: Exception) {
      Log.w(TAG, "close failed", e)
    }
  }

  fun tab(tabId: String): TabRecord? = tabs[tabId]

  fun load(tabId: String, url: String) { tabs[tabId]?.session?.loadUri(url) }
  fun goBack(tabId: String) { tabs[tabId]?.session?.goBack() }
  fun goForward(tabId: String) { tabs[tabId]?.session?.goForward() }
  fun reload(tabId: String) { tabs[tabId]?.session?.reload() }
  fun stop(tabId: String) { tabs[tabId]?.session?.stop() }
  fun exitFullScreen(tabId: String) { tabs[tabId]?.session?.exitFullScreen() }

  fun setActive(tabId: String, active: Boolean) {
    val record = tabs[tabId] ?: return
    record.session.setActive(active)
    runtime?.webExtensionController?.setTabActive(record.session, active)
  }

  fun setDesktopMode(tabId: String, desktop: Boolean) {
    val record = tabs[tabId] ?: return
    record.desktop = desktop
    record.session.settings.userAgentMode = if (desktop) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
    record.session.settings.viewportMode = if (desktop) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
    record.session.reload()
  }

  fun find(tabId: String, query: String, backwards: Boolean): GeckoResult<Map<String, Any?>> {
    val record = tabs[tabId] ?: return GeckoResult.fromValue(mapOf("found" to false, "current" to 0, "total" to 0))
    val flags = if (backwards) GeckoSession.FINDER_FIND_BACKWARDS else GeckoSession.FINDER_FIND_FORWARD
    return record.session.finder.find(query, flags).map { r ->
      mapOf("found" to (r?.found ?: false), "current" to (r?.current ?: 0), "total" to (r?.total ?: 0))
    }
  }

  fun clearFind(tabId: String) { tabs[tabId]?.session?.finder?.clear() }

  fun sessionStates(): Map<String, String> =
    tabs.values.filter { !it.isPrivate && !it.isPopup && it.state != null }.associate { it.id to it.state!! }

  fun clearBrowsingData(): GeckoResult<Void> =
    runtime?.storageController?.clearData(StorageController.ClearFlags.ALL) ?: GeckoResult.fromValue(null)

  fun capture(tabId: String): GeckoResult<String?> {
    val view = views.firstOrNull { it.tabId == tabId } ?: return GeckoResult.fromValue(null)
    return view.capture().map { bitmap ->
      if (bitmap == null) return@map null
      val dir = File(appContext.cacheDir, "thumbs").apply { mkdirs() }
      val file = File(dir, "${tabId.replace(Regex("[^A-Za-z0-9_-]"), "_")}.jpg")
      val w = 360
      val h = (bitmap.height * (w.toFloat() / bitmap.width.coerceAtLeast(1))).toInt().coerceIn(1, 800)
      val scaled = Bitmap.createScaledBitmap(bitmap, w, h, true)
      FileOutputStream(file).use { scaled.compress(Bitmap.CompressFormat.JPEG, 70, it) }
      "file://${file.absolutePath}?t=${System.currentTimeMillis()}"
    }
  }

  // ---------------------------------------------------------------- delegates

  private fun navigationDelegate(record: TabRecord) = object : NavigationDelegate {
    override fun onLocationChange(session: GeckoSession, url: String?, perms: MutableList<PermissionDelegate.ContentPermission>, hasUserGesture: Boolean) {
      record.url = url ?: ""
      emit("onLocationChange", mapOf("tabId" to record.id, "url" to (url ?: "")))
    }

    override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
      record.canGoBack = canGoBack
      emit("onNavState", mapOf("tabId" to record.id, "canGoBack" to canGoBack, "canGoForward" to record.canGoForward))
    }

    override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {
      record.canGoForward = canGoForward
      emit("onNavState", mapOf("tabId" to record.id, "canGoBack" to record.canGoBack, "canGoForward" to canGoForward))
    }

    override fun onLoadRequest(session: GeckoSession, request: NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny>? {
      val uri = request.uri
      val scheme = Uri.parse(uri).scheme?.lowercase() ?: return null
      if (scheme in setOf("http", "https", "about", "data", "blob", "file", "moz-extension", "resource", "javascript", "view-source")) return null
      // tel:, mailto:, intent:, market:, app deep links -> hand to Android
      openExternal(uri)
      return GeckoResult.fromValue(AllowOrDeny.DENY)
    }

    override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
      val newId = "t-" + UUID.randomUUID().toString()
      val child = buildSession(newId, record.isPrivate, record.desktop, isPopup = false)
      child.url = uri
      attachExtensionDelegatesLater(child)
      emit("onNewTabRequest", mapOf("tabId" to newId, "openerTabId" to record.id, "url" to uri, "private" to record.isPrivate, "source" to "window"))
      return GeckoResult.fromValue(child.session)
    }
  }

  private fun progressDelegate(record: TabRecord) = object : ProgressDelegate {
    override fun onPageStart(session: GeckoSession, url: String) {
      emit("onPageStart", mapOf("tabId" to record.id, "url" to url))
    }

    override fun onPageStop(session: GeckoSession, success: Boolean) {
      emit("onPageStop", mapOf("tabId" to record.id, "success" to success))
    }

    override fun onProgressChange(session: GeckoSession, progress: Int) {
      emit("onProgress", mapOf("tabId" to record.id, "progress" to progress))
    }

    override fun onSecurityChange(session: GeckoSession, securityInfo: ProgressDelegate.SecurityInformation) {
      val issuer = try {
        securityInfo.certificate?.issuerX500Principal?.name?.split(",")?.firstOrNull { it.trim().startsWith("O=") }?.substringAfter("O=")
      } catch (e: Exception) { null }
      emit("onSecurity", mapOf(
        "tabId" to record.id,
        "secure" to securityInfo.isSecure,
        "host" to securityInfo.host,
        "issuer" to issuer,
        "mixed" to (securityInfo.mixedModeActive == ProgressDelegate.SecurityInformation.CONTENT_LOADED || securityInfo.mixedModePassive == ProgressDelegate.SecurityInformation.CONTENT_LOADED)
      ))
    }

    override fun onSessionStateChange(session: GeckoSession, sessionState: GeckoSession.SessionState) {
      record.state = sessionState.toString()
    }
  }

  private fun contentDelegate(record: TabRecord) = object : ContentDelegate {
    override fun onTitleChange(session: GeckoSession, title: String?) {
      record.title = title ?: ""
      emit("onTitleChange", mapOf("tabId" to record.id, "title" to (title ?: "")))
    }

    override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) {
      emit("onFullScreen", mapOf("tabId" to record.id, "fullScreen" to fullScreen))
    }

    override fun onCloseRequest(session: GeckoSession) {
      emit("onCloseTabRequest", mapOf("tabId" to record.id))
    }

    override fun onContextMenu(session: GeckoSession, screenX: Int, screenY: Int, element: ContentDelegate.ContextElement) {
      val type = when (element.type) {
        ContentDelegate.ContextElement.TYPE_IMAGE -> "image"
        ContentDelegate.ContextElement.TYPE_VIDEO -> "video"
        ContentDelegate.ContextElement.TYPE_AUDIO -> "audio"
        else -> "none"
      }
      if (element.linkUri == null && element.srcUri == null) return
      emit("onContextMenu", mapOf(
        "tabId" to record.id,
        "linkUri" to element.linkUri,
        "srcUri" to element.srcUri,
        "type" to type,
        "title" to element.title,
        "linkText" to element.linkText,
        "altText" to element.altText
      ))
    }

    override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
      handleDownload(response, record.isPrivate)
    }

    override fun onCrash(session: GeckoSession) {
      emit("onCrash", mapOf("tabId" to record.id))
      try {
        if (!session.isOpen) runtime?.let { session.open(it) }
        if (record.url.isNotBlank()) session.loadUri(record.url)
      } catch (e: Exception) { Log.w(TAG, "recover failed", e) }
    }

    override fun onKill(session: GeckoSession) {
      onCrash(session)
    }
  }

  private fun permissionDelegate(record: TabRecord) = object : PermissionDelegate {
    override fun onAndroidPermissionsRequest(session: GeckoSession, permissions: Array<out String>?, callback: PermissionDelegate.Callback) {
      val perms = permissions?.map { it }?.toTypedArray() ?: emptyArray()
      if (perms.isEmpty()) { callback.grant(); return }
      val h = host
      if (h == null) { callback.reject(); return }
      h.requestAndroidPermissions(perms) { granted -> if (granted) callback.grant() else callback.reject() }
    }

    override fun onContentPermissionRequest(session: GeckoSession, perm: PermissionDelegate.ContentPermission): GeckoResult<Int>? {
      val kind = when (perm.permission) {
        PermissionDelegate.PERMISSION_GEOLOCATION -> "location"
        PermissionDelegate.PERMISSION_DESKTOP_NOTIFICATION -> "notifications"
        PermissionDelegate.PERMISSION_PERSISTENT_STORAGE -> "storage"
        PermissionDelegate.PERMISSION_XR -> "xr"
        PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS -> "drm"
        PermissionDelegate.PERMISSION_LOCAL_DEVICE_ACCESS -> "local-device"
        PermissionDelegate.PERMISSION_LOCAL_NETWORK_ACCESS -> "local-network"
        PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE -> return GeckoResult.fromValue(PermissionDelegate.ContentPermission.VALUE_ALLOW)
        PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE -> return GeckoResult.fromValue(PermissionDelegate.ContentPermission.VALUE_DENY)
        // storage access / tracking: let Gecko's defaults decide
        else -> return null
      }
      val requestId = UUID.randomUUID().toString()
      val result = GeckoResult<Int>()
      pendingContentPermissions[requestId] = result
      emit("onPermissionRequest", mapOf("requestId" to requestId, "tabId" to record.id, "kind" to kind, "uri" to perm.uri, "media" to false))
      return result
    }

    override fun onMediaPermissionRequest(
      session: GeckoSession,
      uri: String,
      video: Array<out PermissionDelegate.MediaSource>?,
      audio: Array<out PermissionDelegate.MediaSource>?,
      callback: PermissionDelegate.MediaCallback
    ) {
      val requestId = UUID.randomUUID().toString()
      val v = video?.firstOrNull()
      val a = audio?.firstOrNull()
      pendingMediaPermissions[requestId] = callback to (v to a)
      val kind = when {
        v != null && a != null -> "camera+microphone"
        v != null -> if (v.source == PermissionDelegate.MediaSource.SOURCE_SCREEN) "screen" else "camera"
        else -> "microphone"
      }
      emit("onPermissionRequest", mapOf("requestId" to requestId, "tabId" to record.id, "kind" to kind, "uri" to uri, "media" to true))
    }
  }

  fun resolvePermission(requestId: String, allow: Boolean) {
    pendingContentPermissions.remove(requestId)?.let {
      it.complete(if (allow) PermissionDelegate.ContentPermission.VALUE_ALLOW else PermissionDelegate.ContentPermission.VALUE_DENY)
      return
    }
    pendingMediaPermissions.remove(requestId)?.let { (callback, sources) ->
      if (allow) callback.grant(sources.first, sources.second) else callback.reject()
    }
  }

  // ---------------------------------------------------------------- downloads / external

  fun openExternal(uri: String): Boolean {
    val activity = host?.currentActivity() ?: return false
    return try {
      val intent = if (uri.startsWith("intent:")) {
        Intent.parseUri(uri, Intent.URI_INTENT_SCHEME).apply {
          addCategory(Intent.CATEGORY_BROWSABLE)
          component = null
          selector = null
        }
      } else {
        Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addCategory(Intent.CATEGORY_BROWSABLE)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      true
    } catch (e: Exception) {
      // intent: with a fallback url
      if (uri.startsWith("intent:")) {
        val fallback = Regex("S\\.browser_fallback_url=([^;]+)").find(uri)?.groupValues?.get(1)
        if (fallback != null) emit("onOpenUrl", mapOf("url" to Uri.decode(fallback)))
      }
      false
    }
  }

  /** Opens the url in another app, letting the user pick one (excludes us when possible). */
  fun openInApp(url: String) {
    val activity = host?.currentActivity() ?: return
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      val chooser = Intent.createChooser(intent, "Open with")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, arrayOf(activity.componentName))
      }
      activity.startActivity(chooser)
    } catch (e: Exception) { Log.w(TAG, "openInApp", e) }
  }

  private fun handleDownload(response: WebResponse, isPrivate: Boolean) {
    val headers = response.headers.mapKeys { it.key.lowercase() }
    val disposition = headers["content-disposition"]
    val mime = headers["content-type"]?.substringBefore(";")?.trim()
    val uri = response.uri
    val filename = URLUtil.guessFileName(uri, disposition, mime)
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      try { response.body?.close() } catch (_: Exception) {}
      download(uri, filename, mime, response.headers["Cookie"])
      return
    }
    // blob:/data: and other in-memory responses: stream the body ourselves.
    val body = response.body ?: return
    Thread {
      try {
        val resolver = appContext.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, filename)
            put(MediaStore.Downloads.MIME_TYPE, mime ?: "application/octet-stream")
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
          val item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("no media store")
          resolver.openOutputStream(item)?.use { out -> body.copyTo(out) }
          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(item, values, null, null)
        } else {
          val dir = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
          FileOutputStream(File(dir, filename)).use { out -> body.copyTo(out) }
        }
        emit("onDownload", mapOf("url" to uri, "filename" to filename, "status" to "done"))
      } catch (e: Exception) {
        Log.w(TAG, "download failed", e)
        emit("onDownload", mapOf("url" to uri, "filename" to filename, "status" to "failed", "error" to (e.message ?: "")))
      } finally {
        try { body.close() } catch (_: Exception) {}
      }
    }.start()
  }

  fun download(url: String, filename: String?, mime: String?, cookie: String? = null) {
    val name = filename ?: URLUtil.guessFileName(url, null, mime)
    try {
      val type = mime ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(url))
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
      if (type != null) request.setMimeType(type)
      if (!cookie.isNullOrBlank()) request.addRequestHeader("Cookie", cookie)
      val dm = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      dm.enqueue(request)
      emit("onDownload", mapOf("url" to url, "filename" to name, "status" to "started"))
    } catch (e: Exception) {
      Log.w(TAG, "DownloadManager failed", e)
      emit("onDownload", mapOf("url" to url, "filename" to name, "status" to "failed", "error" to (e.message ?: "")))
    }
  }

  // ---------------------------------------------------------------- extensions

  private fun setupExtensionController(rt: GeckoRuntime) {
    val controller = rt.webExtensionController
    controller.promptDelegate = object : WebExtensionController.PromptDelegate {
      override fun onInstallPromptRequest(
        extension: WebExtension,
        permissions: Array<out String>,
        origins: Array<out String>,
        dataCollectionPermissions: Array<out String>
      ): GeckoResult<WebExtension.PermissionPromptResponse>? {
        if (autoAcceptNextInstall || autoAcceptInstalls.contains(extension.id)) {
          autoAcceptNextInstall = false
          return GeckoResult.fromValue(WebExtension.PermissionPromptResponse(true, true, false))
        }
        val requestId = UUID.randomUUID().toString()
        val result = GeckoResult<WebExtension.PermissionPromptResponse>()
        pendingInstallPrompts[requestId] = result
        emit("onExtensionInstallPrompt", mapOf(
          "requestId" to requestId,
          "id" to extension.id,
          "name" to (extension.metaData.name ?: extension.id),
          "permissions" to permissions.toList(),
          "origins" to origins.toList(),
          "dataCollection" to dataCollectionPermissions.toList()
        ))
        return result
      }

      override fun onUpdatePrompt(
        extension: WebExtension,
        newPermissions: Array<out String>,
        newOrigins: Array<out String>,
        newDataCollectionPermissions: Array<out String>
      ): GeckoResult<AllowOrDeny>? = GeckoResult.fromValue(AllowOrDeny.ALLOW)

      override fun onOptionalPrompt(
        extension: WebExtension,
        permissions: Array<out String>,
        origins: Array<out String>,
        dataCollectionPermissions: Array<out String>
      ): GeckoResult<AllowOrDeny>? {
        val requestId = UUID.randomUUID().toString()
        val result = GeckoResult<WebExtension.PermissionPromptResponse>()
        pendingInstallPrompts[requestId] = result
        emit("onExtensionInstallPrompt", mapOf(
          "requestId" to requestId,
          "id" to extension.id,
          "name" to (extension.metaData.name ?: extension.id),
          "permissions" to permissions.toList(),
          "origins" to origins.toList(),
          "dataCollection" to dataCollectionPermissions.toList(),
          "optional" to true
        ))
        return result.map { if (it?.isPermissionsGranted == true) AllowOrDeny.ALLOW else AllowOrDeny.DENY }
      }
    }
    controller.setAddonManagerDelegate(object : WebExtensionController.AddonManagerDelegate {
      override fun onInstalled(extension: WebExtension) { registerExtension(extension); emit("onExtensionsChanged", emptyMap()) }
      override fun onUninstalled(extension: WebExtension) { extensions.remove(extension.id); emit("onExtensionsChanged", emptyMap()) }
      override fun onEnabled(extension: WebExtension) { registerExtension(extension); emit("onExtensionsChanged", emptyMap()) }
      override fun onDisabled(extension: WebExtension) { registerExtension(extension); emit("onExtensionsChanged", emptyMap()) }
      override fun onReady(extension: WebExtension) { registerExtension(extension) }
    })
    // Pick up everything already installed in the profile so actions/tab delegates work after relaunch.
    controller.list().accept({ list -> list?.forEach { registerExtension(it) } }, { e -> Log.w(TAG, "list failed", e) })
  }

  fun resolveInstallPrompt(requestId: String, allow: Boolean, allowPrivate: Boolean) {
    pendingInstallPrompts.remove(requestId)?.complete(WebExtension.PermissionPromptResponse(allow, allowPrivate, false))
  }

  private fun registerExtension(extension: WebExtension) {
    extensions[extension.id] = extension
    extension.setActionDelegate(actionDelegate)
    extension.tabDelegate = tabDelegate
    tabs.values.forEach { attachExtensionDelegates(it.session, extension) }
  }

  private fun attachExtensionDelegates(session: GeckoSession) {
    extensions.values.forEach { attachExtensionDelegates(session, it) }
  }

  private fun attachExtensionDelegates(session: GeckoSession, extension: WebExtension) {
    try {
      session.webExtensionController.setActionDelegate(extension, actionDelegate)
      session.webExtensionController.setTabDelegate(extension, sessionTabDelegate)
    } catch (e: Exception) { Log.w(TAG, "session delegates", e) }
  }

  /** Window/extension-opened sessions are opened by Gecko itself; attach once that happened. */
  private fun attachExtensionDelegatesLater(record: TabRecord) {
    main.post { if (record.session.isOpen) attachExtensionDelegates(record.session) }
  }

  private val sessionTabDelegate = object : WebExtension.SessionTabDelegate {
    override fun onCloseTab(source: WebExtension?, session: GeckoSession): GeckoResult<AllowOrDeny> {
      val record = tabs.values.firstOrNull { it.session == session } ?: return GeckoResult.fromValue(AllowOrDeny.DENY)
      emit("onCloseTabRequest", mapOf("tabId" to record.id))
      return GeckoResult.fromValue(AllowOrDeny.ALLOW)
    }

    override fun onUpdateTab(extension: WebExtension, session: GeckoSession, details: WebExtension.UpdateTabDetails): GeckoResult<AllowOrDeny> {
      val record = tabs.values.firstOrNull { it.session == session } ?: return GeckoResult.fromValue(AllowOrDeny.DENY)
      if (details.active == true) emit("onSelectTabRequest", mapOf("tabId" to record.id))
      return GeckoResult.fromValue(AllowOrDeny.ALLOW)
    }
  }

  private val tabDelegate = object : WebExtension.TabDelegate {
    override fun onNewTab(source: WebExtension, createDetails: WebExtension.CreateTabDetails): GeckoResult<GeckoSession>? {
      val newId = "t-" + UUID.randomUUID().toString()
      val child = buildSession(newId, isPrivate = false, desktop = false, isPopup = false)
      child.url = createDetails.url ?: ""
      attachExtensionDelegatesLater(child)
      emit("onNewTabRequest", mapOf("tabId" to newId, "openerTabId" to null, "url" to (createDetails.url ?: ""), "private" to false, "source" to "extension", "active" to (createDetails.active != false)))
      return GeckoResult.fromValue(child.session)
    }

    override fun onOpenOptionsPage(source: WebExtension) {
      val url = source.metaData.optionsPageUrl ?: return
      emit("onOpenUrl", mapOf("url" to url))
    }
  }

  private val actionDelegate = object : WebExtension.ActionDelegate {
    override fun onBrowserAction(extension: WebExtension, session: GeckoSession?, action: WebExtension.Action) {
      if (session == null) actions[extension.id] = action
      emit("onExtensionAction", mapOf(
        "id" to extension.id,
        "tabId" to session?.let { s -> tabs.values.firstOrNull { it.session == s }?.id },
        "title" to action.title,
        "badgeText" to action.badgeText,
        "enabled" to (action.enabled != false)
      ))
    }

    override fun onTogglePopup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? = openPopup(extension, action)
    override fun onOpenPopup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? = openPopup(extension, action)
  }

  private fun openPopup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? {
    val rt = runtime ?: return null
    val popupId = "popup-" + extension.id
    tabs[popupId]?.let { closeTab(popupId) }
    val record = buildSession(popupId, isPrivate = false, desktop = false, isPopup = true)
    record.session.open(rt)
    emit("onExtensionPopup", mapOf("tabId" to popupId, "extensionId" to extension.id, "title" to (action.title ?: extension.metaData.name ?: "")))
    return GeckoResult.fromValue(record.session)
  }

  fun clickAction(extensionId: String, tabId: String?): Boolean {
    val ext = extensions[extensionId] ?: return false
    // Prefer the per-tab override when the tab has one; fall back to the default action.
    val action = actions[ext.id] ?: return false
    if (tabId != null) tabs[tabId]?.let { setActive(it.id, true) }
    action.click()
    return true
  }

  fun extensionToMap(ext: WebExtension, iconCallback: ((String?) -> Unit)? = null): Map<String, Any?> = mapOf(
    "id" to ext.id,
    "name" to (ext.metaData.name ?: ext.id),
    "description" to ext.metaData.description,
    "version" to ext.metaData.version,
    "enabled" to ext.metaData.enabled,
    "builtIn" to ext.isBuiltIn,
    "creator" to ext.metaData.creatorName,
    "homepageUrl" to ext.metaData.homepageUrl,
    "optionsPageUrl" to ext.metaData.optionsPageUrl,
    "amoListingUrl" to ext.metaData.amoListingUrl,
    "allowedInPrivate" to ext.metaData.allowedInPrivateBrowsing,
    "hasAction" to actions.containsKey(ext.id),
    "permissions" to ext.metaData.requiredPermissions.toList(),
    "origins" to ext.metaData.requiredOrigins.toList()
  )

  fun listExtensions(): GeckoResult<List<Map<String, Any?>>> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromValue(emptyList())
    return controller.list().then { list ->
      val exts = list ?: emptyList()
      exts.forEach { registerExtension(it) }
      // Resolve icons (as data: urls) in parallel; a missing icon is fine.
      val results = exts.map { ext ->
        ext.metaData.icon.getBitmap(64).then<Map<String, Any?>>(
          { bmp -> GeckoResult.fromValue(extensionToMap(ext) + ("icon" to bitmapToDataUrl(bmp))) },
          { _ -> GeckoResult.fromValue(extensionToMap(ext) + ("icon" to null)) }
        )
      }
      GeckoResult.allOf(results).map { it ?: emptyList() }
    }
  }

  private fun bitmapToDataUrl(bmp: Bitmap?): String? {
    if (bmp == null) return null
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
    return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  fun installExtension(url: String, auto: Boolean): GeckoResult<Map<String, Any?>> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromException(IllegalStateException("runtime not ready"))
    if (auto) autoAcceptNextInstall = true
    return controller.install(url).map { ext ->
      autoAcceptNextInstall = false
      registerExtension(ext!!)
      extensionToMap(ext)
    }
  }

  /** First run: install uBlock Origin from AMO (signed), auto-accepting its permissions. */
  fun ensureUblock(): GeckoResult<Boolean> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromValue(false)
    return controller.list().then { list ->
      if (list?.any { it.id == UBLOCK_ID } == true) return@then GeckoResult.fromValue(false)
      autoAcceptInstalls.add(UBLOCK_ID)
      controller.install(UBLOCK_XPI).then { ext ->
        if (ext != null) {
          registerExtension(ext)
          controller.setAllowedInPrivateBrowsing(ext, true).map { true }
        } else GeckoResult.fromValue(true)
      }
    }
  }

  fun setExtensionEnabled(id: String, enabled: Boolean): GeckoResult<Boolean> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromValue(false)
    val ext = extensions[id] ?: return GeckoResult.fromValue(false)
    val r = if (enabled) controller.enable(ext, WebExtensionController.EnableSource.USER) else controller.disable(ext, WebExtensionController.EnableSource.USER)
    return r.map { e -> if (e != null) registerExtension(e); true }
  }

  fun setExtensionPrivate(id: String, allowed: Boolean): GeckoResult<Boolean> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromValue(false)
    val ext = extensions[id] ?: return GeckoResult.fromValue(false)
    return controller.setAllowedInPrivateBrowsing(ext, allowed).map { e -> if (e != null) registerExtension(e); true }
  }

  fun uninstallExtension(id: String): GeckoResult<Boolean> {
    val controller = runtime?.webExtensionController ?: return GeckoResult.fromValue(false)
    val ext = extensions[id] ?: return GeckoResult.fromValue(false)
    return controller.uninstall(ext).map { extensions.remove(id); actions.remove(id); true }
  }
}

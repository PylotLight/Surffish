package expo.modules.geckoview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoView

/** Hosts a GeckoView and swaps whichever tab's GeckoSession the `tabId` prop names into it. */
@SuppressLint("ViewConstructor")
class GeckoHostView(context: Context, appContext: AppContext) : ExpoView(context, appContext), GeckoSurface {
  override val shouldUseAndroidLayout = true

  private val geckoView = GeckoView(context)
  override var tabId: String? = null
    private set

  init {
    geckoView.coverUntilFirstPaint(Color.TRANSPARENT)
    addView(geckoView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    GeckoEngine.views.add(this)
  }

  fun attach(id: String?) {
    if (id == tabId && geckoView.session != null) return
    val previous = tabId
    geckoView.releaseSession()
    previous?.let { if (it != id) GeckoEngine.setActive(it, false) }
    tabId = id
    if (id.isNullOrBlank()) return
    val record = GeckoEngine.tab(id) ?: return
    // Another host may still hold this session (e.g. a popup sheet); take it over.
    GeckoEngine.views.filter { it !== this && it.tabId == id }.forEach { it.detach() }
    geckoView.setSession(record.session)
    GeckoEngine.setActive(id, true)
  }

  /** Re-attach after the tab's session was created (createTab can land after the prop). */
  fun refresh() {
    val id = tabId ?: return
    if (geckoView.session == null && GeckoEngine.tab(id) != null) {
      tabId = null
      attach(id)
    }
  }

  override fun detach() {
    geckoView.releaseSession()
    tabId = null
  }

  override fun capture(): GeckoResult<Bitmap> = geckoView.capturePixels()

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
  }

  fun dispose() {
    GeckoEngine.views.remove(this)
    geckoView.releaseSession()
  }
}

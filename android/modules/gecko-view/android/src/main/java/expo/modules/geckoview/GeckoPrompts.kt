package expo.modules.geckoview

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.GeckoSession.PromptDelegate.PromptResponse
import java.util.Calendar
import java.util.Locale

/**
 * Native dialogs for page prompts: alert/confirm/prompt, <select>, date/time inputs, file uploads,
 * HTTP auth, popups, beforeunload. Without these, a lot of the web silently breaks.
 */
class GeckoPrompts(private val record: TabRecord) : PromptDelegate {

  private fun activity(): Activity? = GeckoEngine.host?.currentActivity()

  private fun hostOf(uri: String?): String = try { Uri.parse(uri ?: "").host ?: "" } catch (_: Exception) { "" }

  private fun pageHost(): String = hostOf(record.url).ifBlank { "This page" }

  private fun <T : PromptDelegate.BasePrompt> withDialog(
    prompt: T,
    build: (Activity, GeckoResult<PromptResponse>) -> AlertDialog?
  ): GeckoResult<PromptResponse> {
    val result = GeckoResult<PromptResponse>()
    val act = activity()
    if (act == null || act.isFinishing) {
      result.complete(prompt.dismiss())
      return result
    }
    val dialog = build(act, result)
    if (dialog != null) {
      prompt.setDelegate(object : PromptDelegate.PromptInstanceDelegate {
        override fun onPromptDismiss(p: PromptDelegate.BasePrompt) {
          try { dialog.dismiss() } catch (_: Exception) {}
        }
      })
      dialog.show()
    }
    return result
  }

  private fun GeckoResult<PromptResponse>.finish(response: () -> PromptResponse) {
    try { complete(response()) } catch (_: Exception) { /* already completed */ }
  }

  override fun onAlertPrompt(session: GeckoSession, prompt: PromptDelegate.AlertPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      AlertDialog.Builder(act)
        .setTitle(prompt.title ?: pageHost())
        .setMessage(prompt.message ?: "")
        .setPositiveButton(android.R.string.ok) { _, _ -> result.finish { prompt.dismiss() } }
        .setOnCancelListener { result.finish { prompt.dismiss() } }
        .create()
    }

  override fun onButtonPrompt(session: GeckoSession, prompt: PromptDelegate.ButtonPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      AlertDialog.Builder(act)
        .setTitle(prompt.title ?: pageHost())
        .setMessage(prompt.message ?: "")
        .setPositiveButton(android.R.string.ok) { _, _ -> result.finish { prompt.confirm(PromptDelegate.ButtonPrompt.Type.POSITIVE) } }
        .setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.confirm(PromptDelegate.ButtonPrompt.Type.NEGATIVE) } }
        .setOnCancelListener { result.finish { prompt.dismiss() } }
        .create()
    }

  override fun onTextPrompt(session: GeckoSession, prompt: PromptDelegate.TextPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      val input = EditText(act).apply { setText(prompt.defaultValue ?: ""); setSingleLine() }
      AlertDialog.Builder(act)
        .setTitle(prompt.title ?: pageHost())
        .setMessage(prompt.message ?: "")
        .setView(padded(act, input))
        .setPositiveButton(android.R.string.ok) { _, _ -> result.finish { prompt.confirm(input.text.toString()) } }
        .setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.dismiss() } }
        .setOnCancelListener { result.finish { prompt.dismiss() } }
        .create()
    }

  override fun onAuthPrompt(session: GeckoSession, prompt: PromptDelegate.AuthPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      val onlyPassword = (prompt.authOptions.flags and PromptDelegate.AuthPrompt.AuthOptions.Flags.ONLY_PASSWORD) != 0
      val user = EditText(act).apply { hint = "Username"; setText(prompt.authOptions.username ?: ""); setSingleLine() }
      val pass = EditText(act).apply {
        hint = "Password"
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        setText(prompt.authOptions.password ?: "")
      }
      val box = LinearLayout(act).apply {
        orientation = LinearLayout.VERTICAL
        if (!onlyPassword) addView(user)
        addView(pass)
      }
      AlertDialog.Builder(act)
        .setTitle(prompt.title ?: "Sign in to ${hostOf(prompt.authOptions.uri)}")
        .setMessage(prompt.message ?: "")
        .setView(padded(act, box))
        .setPositiveButton("Sign in") { _, _ ->
          result.finish {
            if (onlyPassword) prompt.confirm(pass.text.toString()) else prompt.confirm(user.text.toString(), pass.text.toString())
          }
        }
        .setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.dismiss() } }
        .setOnCancelListener { result.finish { prompt.dismiss() } }
        .create()
    }

  private fun flatten(choices: Array<PromptDelegate.ChoicePrompt.Choice>, depth: Int = 0): List<Pair<PromptDelegate.ChoicePrompt.Choice, Int>> {
    val out = ArrayList<Pair<PromptDelegate.ChoicePrompt.Choice, Int>>()
    for (c in choices) {
      if (c.separator) continue
      val items = c.items
      if (items != null) {
        out.add(c to depth)
        out.addAll(flatten(items, depth + 1))
      } else out.add(c to depth)
    }
    return out
  }

  override fun onChoicePrompt(session: GeckoSession, prompt: PromptDelegate.ChoicePrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      val flat = flatten(prompt.choices)
      // group headers (choices with children) and disabled items are shown but not selectable
      val labels = flat.map { (c, depth) -> "\u2003".repeat(depth) + c.label }.toTypedArray()
      val selectable = flat.map { (c, _) -> c.items == null && !c.disabled }
      val builder = AlertDialog.Builder(act).setTitle(prompt.title ?: prompt.message)
      when (prompt.type) {
        PromptDelegate.ChoicePrompt.Type.MULTIPLE -> {
          val checked = flat.map { it.first.selected }.toBooleanArray()
          builder.setMultiChoiceItems(labels, checked) { dlg, which, isChecked ->
            if (!selectable[which]) {
              (dlg as AlertDialog).listView.setItemChecked(which, checked[which])
            } else checked[which] = isChecked
          }
          builder.setPositiveButton(android.R.string.ok) { _, _ ->
            val ids = flat.filterIndexed { i, _ -> checked[i] && selectable[i] }.map { it.first.id }.toTypedArray()
            result.finish { prompt.confirm(ids) }
          }
          builder.setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.dismiss() } }
        }
        PromptDelegate.ChoicePrompt.Type.SINGLE -> {
          val current = flat.indexOfFirst { it.first.selected }
          builder.setSingleChoiceItems(labels, current) { dlg, which ->
            if (selectable[which]) {
              result.finish { prompt.confirm(flat[which].first.id) }
              dlg.dismiss()
            }
          }
        }
        else -> {
          builder.setItems(labels) { _, which ->
            if (selectable[which]) result.finish { prompt.confirm(flat[which].first.id) } else result.finish { prompt.dismiss() }
          }
        }
      }
      builder.setOnCancelListener { result.finish { prompt.dismiss() } }
      builder.setOnDismissListener { result.finish { prompt.dismiss() } }
      builder.create()
    }

  override fun onColorPrompt(session: GeckoSession, prompt: PromptDelegate.ColorPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      val input = EditText(act).apply { setText(prompt.defaultValue ?: "#000000"); setSingleLine() }
      AlertDialog.Builder(act)
        .setTitle(prompt.title ?: "Pick a colour (#rrggbb)")
        .setView(padded(act, input))
        .setPositiveButton(android.R.string.ok) { _, _ ->
          val v = input.text.toString().trim()
          result.finish { if (Regex("^#[0-9a-fA-F]{6}$").matches(v)) prompt.confirm(v.lowercase()) else prompt.dismiss() }
        }
        .setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.dismiss() } }
        .setOnCancelListener { result.finish { prompt.dismiss() } }
        .create()
    }

  override fun onDateTimePrompt(session: GeckoSession, prompt: PromptDelegate.DateTimePrompt): GeckoResult<PromptResponse> {
    val result = GeckoResult<PromptResponse>()
    val act = activity()
    if (act == null) { result.complete(prompt.dismiss()); return result }
    val cal = Calendar.getInstance()
    val def = prompt.defaultValue ?: ""
    Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(def)?.let { m ->
      cal.set(m.groupValues[1].toInt(), m.groupValues[2].toInt() - 1, m.groupValues[3].toInt())
    }
    Regex("(\\d{2}):(\\d{2})").find(def)?.let { m ->
      cal.set(Calendar.HOUR_OF_DAY, m.groupValues[1].toInt()); cal.set(Calendar.MINUTE, m.groupValues[2].toInt())
    }
    fun date(y: Int, mo: Int, d: Int) = String.format(Locale.US, "%04d-%02d-%02d", y, mo + 1, d)
    fun time(h: Int, mi: Int) = String.format(Locale.US, "%02d:%02d", h, mi)
    val timePicker = { onTime: (String) -> Unit ->
      TimePickerDialog(act, { _, h, mi -> onTime(time(h, mi)) }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).apply {
        setOnCancelListener { result.finish { prompt.dismiss() } }
      }.show()
    }
    val datePicker = { onDate: (Int, Int, Int) -> Unit ->
      DatePickerDialog(act, { _, y, mo, d -> onDate(y, mo, d) }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).apply {
        setOnCancelListener { result.finish { prompt.dismiss() } }
      }.show()
    }
    when (prompt.type) {
      PromptDelegate.DateTimePrompt.Type.TIME -> timePicker { t -> result.finish { prompt.confirm(t) } }
      PromptDelegate.DateTimePrompt.Type.DATETIME_LOCAL -> datePicker { y, mo, d -> timePicker { t -> result.finish { prompt.confirm("${date(y, mo, d)}T$t") } } }
      PromptDelegate.DateTimePrompt.Type.MONTH -> datePicker { y, mo, _ -> result.finish { prompt.confirm(String.format(Locale.US, "%04d-%02d", y, mo + 1)) } }
      PromptDelegate.DateTimePrompt.Type.WEEK -> datePicker { y, mo, d ->
        val c = Calendar.getInstance().apply { minimalDaysInFirstWeek = 4; firstDayOfWeek = Calendar.MONDAY; set(y, mo, d) }
        result.finish { prompt.confirm(String.format(Locale.US, "%04d-W%02d", c.getWeekYear(), c.get(Calendar.WEEK_OF_YEAR))) }
      }
      else -> datePicker { y, mo, d -> result.finish { prompt.confirm(date(y, mo, d)) } }
    }
    return result
  }

  override fun onFilePrompt(session: GeckoSession, prompt: PromptDelegate.FilePrompt): GeckoResult<PromptResponse> {
    val result = GeckoResult<PromptResponse>()
    val act = activity()
    val host = GeckoEngine.host
    if (act == null || host == null) { result.complete(prompt.dismiss()); return result }
    val mimes = prompt.mimeTypes?.filter { it.contains("/") }?.toTypedArray() ?: emptyArray()
    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = if (mimes.size == 1) mimes[0] else "*/*"
      if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes)
      if (prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }
    host.pickFiles(Intent.createChooser(intent, "Choose file")) { uris ->
      result.finish {
        when {
          uris.isNullOrEmpty() -> prompt.dismiss()
          prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE -> prompt.confirm(act, uris)
          else -> prompt.confirm(act, uris[0])
        }
      }
    }
    return result
  }

  override fun onPopupPrompt(session: GeckoSession, prompt: PromptDelegate.PopupPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      AlertDialog.Builder(act)
        .setTitle("Pop-up blocked")
        .setMessage("${pageHost()} wants to open ${prompt.targetUri ?: "a pop-up"}")
        .setPositiveButton("Allow") { _, _ -> result.finish { prompt.confirm(AllowOrDeny.ALLOW) } }
        .setNegativeButton("Block") { _, _ -> result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .setOnCancelListener { result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .create()
    }

  override fun onBeforeUnloadPrompt(session: GeckoSession, prompt: PromptDelegate.BeforeUnloadPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      AlertDialog.Builder(act)
        .setTitle("Leave page?")
        .setMessage("Changes you made may not be saved.")
        .setPositiveButton("Leave") { _, _ -> result.finish { prompt.confirm(AllowOrDeny.ALLOW) } }
        .setNegativeButton("Stay") { _, _ -> result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .setOnCancelListener { result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .create()
    }

  override fun onRepostConfirmPrompt(session: GeckoSession, prompt: PromptDelegate.RepostConfirmPrompt): GeckoResult<PromptResponse> =
    withDialog(prompt) { act, result ->
      AlertDialog.Builder(act)
        .setTitle("Resend data?")
        .setMessage("This page needs to resend form data, which may repeat an action (like a purchase).")
        .setPositiveButton("Resend") { _, _ -> result.finish { prompt.confirm(AllowOrDeny.ALLOW) } }
        .setNegativeButton(android.R.string.cancel) { _, _ -> result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .setOnCancelListener { result.finish { prompt.confirm(AllowOrDeny.DENY) } }
        .create()
    }

  override fun onSharePrompt(session: GeckoSession, prompt: PromptDelegate.SharePrompt): GeckoResult<PromptResponse> {
    val act = activity() ?: return GeckoResult.fromValue(prompt.dismiss())
    return try {
      val text = listOfNotNull(prompt.text, prompt.uri).joinToString(" ")
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
        prompt.title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
      }
      act.startActivity(Intent.createChooser(send, prompt.title ?: "Share"))
      GeckoResult.fromValue(prompt.confirm(PromptDelegate.SharePrompt.Result.SUCCESS))
    } catch (e: Exception) {
      GeckoResult.fromValue(prompt.confirm(PromptDelegate.SharePrompt.Result.FAILURE))
    }
  }

  private fun padded(act: Activity, view: android.view.View): android.view.View {
    val pad = (20 * act.resources.displayMetrics.density).toInt()
    return LinearLayout(act).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad, pad / 2, pad, 0)
      addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }
  }
}

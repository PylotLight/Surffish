import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import {
  ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronUp, Copy, Download, ExternalLink, EyeOff, History, Link, Monitor,
  MoreHorizontal, Plus, Puzzle, RotateCw, Search, Settings, Share2, Shield, ShieldCheck, Star, X
} from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Image, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gecko, GeckoView } from '../../modules/gecko-view'
import {
  activeTab, answerInstall, answerPermission, closeContextMenu, closePopup, dismissToast, goBack, goForward, hostOf, newTab,
  reload, showToast, toggleDesktop, useBrowser
} from '../lib/browser'
import * as db from '../lib/db'
import { cleanLinkUrl } from '../lib/shared'
import { useTheme } from '../lib/theme'
import { Sheet, SheetRow } from './Sheet'

const PERMISSION_LABEL: Record<string, string> = {
  location: 'know your location',
  notifications: 'show notifications',
  storage: 'store data persistently',
  xr: 'use VR/AR devices',
  drm: 'play DRM-protected content',
  'local-device': 'access devices on your network',
  'local-network': 'access your local network',
  camera: 'use your camera',
  microphone: 'use your microphone',
  'camera+microphone': 'use your camera and microphone',
  screen: 'share your screen'
}

export function permissionLabel(kind: string) {
  return PERMISSION_LABEL[kind] ?? kind
}

// ------------------------------------------------------------------ main menu

export function MenuSheet({ visible, onClose, onFind }: { visible: boolean; onClose: () => void; onFind: () => void }) {
  const t = useTheme()
  const router = useRouter()
  const tab = useBrowser((s) => activeTab(s))
  const actions = useBrowser((s) => s.extensionActions)
  const [bookmarked, setBookmarked] = useState(false)

  useEffect(() => {
    if (visible && tab?.url) setBookmarked(!!db.findBookmark(tab.url))
  }, [visible, tab?.url])

  const go = (path: '/bookmarks' | '/history' | '/extensions' | '/settings') => {
    onClose()
    router.push(path)
  }

  const toggleBookmark = () => {
    if (!tab?.url) return
    const existing = db.findBookmark(tab.url)
    if (existing) {
      db.removeBookmark(existing.id)
      setBookmarked(false)
      showToast('Bookmark removed')
    } else {
      db.addBookmark(tab.url, tab.title)
      setBookmarked(true)
      showToast('Bookmarked')
    }
  }

  const icon = (C: typeof Star, color = t.text) => <C size={20} color={color} />
  const actionList = Object.values(actions)

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.iconRow}>
        <IconButton disabled={!tab?.canGoBack} onPress={() => { goBack(); onClose() }}>{icon(ArrowLeft, tab?.canGoBack ? t.text : t.muted)}</IconButton>
        <IconButton disabled={!tab?.canGoForward} onPress={() => { goForward(); onClose() }}>{icon(ArrowRight, tab?.canGoForward ? t.text : t.muted)}</IconButton>
        <IconButton onPress={() => { reload(); onClose() }}>{tab?.loading ? icon(X) : icon(RotateCw)}</IconButton>
        <IconButton disabled={!tab?.url} onPress={toggleBookmark}><Star size={20} color={bookmarked ? t.accent : t.text} fill={bookmarked ? t.accent : 'transparent'} /></IconButton>
        <IconButton disabled={!tab?.url} onPress={() => { onClose(); if (tab?.url) void Share.share({ message: tab.url, title: tab.title }) }}>{icon(Share2)}</IconButton>
      </View>
      <ScrollView>
        <SheetRow icon={icon(Plus)} label="New tab" onPress={() => { onClose(); newTab(null) }} />
        <SheetRow icon={icon(EyeOff, t.private)} label="New private tab" onPress={() => { onClose(); newTab(null, { private: true }) }} />
        {actionList.map((a) => (
          <SheetRow key={a.id} icon={icon(Puzzle)} label={a.title || a.id} detail={a.badgeText ? `Badge: ${a.badgeText}` : null}
            onPress={() => { onClose(); void Gecko.clickExtensionAction(a.id, tab?.id ?? null) }} />
        ))}
        <SheetRow icon={icon(Search)} label="Find in page" onPress={() => { onClose(); onFind() }} />
        <SheetRow icon={icon(Monitor)} label="Desktop site" onPress={() => { toggleDesktop() }} right={<Switch value={tab?.desktop ?? false} onValueChange={() => toggleDesktop()} />} />
        <SheetRow icon={icon(BookOpen)} label="Bookmarks" onPress={() => go('/bookmarks')} />
        <SheetRow icon={icon(History)} label="History" onPress={() => go('/history')} />
        <SheetRow icon={icon(Download)} label="Downloads" onPress={() => { onClose(); void Linking.sendIntent('android.intent.action.VIEW_DOWNLOADS').catch(() => showToast('No downloads app')) }} />
        <SheetRow icon={icon(Puzzle)} label="Extensions" onPress={() => go('/extensions')} />
        {tab?.url ? <SheetRow icon={icon(ExternalLink)} label="Open in app" onPress={() => { onClose(); void Gecko.openExternal(tab.url) }} /> : null}
        {tab?.url ? <SheetRow icon={icon(Link)} label="Copy clean link" onPress={() => { onClose(); void Clipboard.setStringAsync(cleanLinkUrl(tab.url)).then(() => showToast('Link copied')) }} /> : null}
        <SheetRow icon={icon(Settings)} label="Settings" onPress={() => go('/settings')} />
      </ScrollView>
    </Sheet>
  )
}

function IconButton({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  const t = useTheme()
  return (
    <Pressable disabled={disabled} onPress={onPress} android_ripple={{ color: t.surface2, borderless: true }} style={styles.iconButton}>
      {children}
    </Pressable>
  )
}

// ------------------------------------------------------------------ site info (lock icon)

export function SiteInfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme()
  const tab = useBrowser((s) => activeTab(s))
  const granted = useBrowser((s) => s.granted)
  if (!tab) return null
  const host = hostOf(tab.url)
  const perms = granted[host] ?? []
  const secure = tab.secure && !tab.mixed
  return (
    <Sheet visible={visible} onClose={onClose} title={host || tab.url || 'New tab'}>
      <SheetRow
        icon={secure ? <ShieldCheck size={20} color={t.accent} /> : <Shield size={20} color={t.danger} />}
        label={secure ? 'Connection is secure' : tab.url.startsWith('https:') ? 'Parts of this page are not secure' : 'Connection is not secure'}
        detail={secure && tab.issuer ? `Verified by ${tab.issuer}` : null}
      />
      {tab.private ? <SheetRow icon={<EyeOff size={20} color={t.private} />} label="Private tab" detail="No history, cookies cleared when you close all private tabs" /> : null}
      <Text style={[styles.section, { color: t.muted }]}>Permissions allowed this session</Text>
      {perms.length === 0 ? <SheetRow label="None" /> : perms.map((p) => <SheetRow key={p} label={permissionLabel(p)} />)}
      <SheetRow label="Clear cookies and site data (all sites)" danger onPress={() => { onClose(); void Gecko.clearBrowsingData().then(() => showToast('Site data cleared')) }} />
    </Sheet>
  )
}

// ------------------------------------------------------------------ permission prompts (never silently denied)

export function PermissionSheet() {
  const t = useTheme()
  const req = useBrowser((s) => s.permissions[0] ?? null)
  if (!req) return null
  const host = hostOf(req.uri) || 'This site'
  return (
    <Sheet visible onClose={() => answerPermission(req.requestId, false)} title={`${host} wants to ${permissionLabel(req.kind)}`}>
      <View style={styles.buttons}>
        <Button label="Block" onPress={() => answerPermission(req.requestId, false)} />
        <Button label="Allow" primary onPress={() => answerPermission(req.requestId, true)} />
      </View>
      <Text style={[styles.note, { color: t.muted }]}>Android may ask too. You can clear site permissions from the lock icon.</Text>
    </Sheet>
  )
}

// ------------------------------------------------------------------ extension install prompt

export function InstallSheet() {
  const t = useTheme()
  const p = useBrowser((s) => s.installPrompt)
  const [privateOk, setPrivateOk] = useState(false)
  if (!p) return null
  const items = [...p.permissions, ...p.origins]
  return (
    <Sheet visible onClose={() => answerInstall(false, false)} title={p.optional ? `${p.name} wants more permissions` : `Add ${p.name}?`}>
      <ScrollView style={{ maxHeight: 260 }}>
        {items.length === 0 ? <SheetRow label="No special permissions" /> : items.map((x) => <SheetRow key={x} label={x} />)}
        {p.dataCollection.length > 0 ? <SheetRow label="Data collection" detail={p.dataCollection.join(', ')} /> : null}
      </ScrollView>
      {!p.optional ? (
        <SheetRow label="Allow in private tabs" right={<Switch value={privateOk} onValueChange={setPrivateOk} />} onPress={() => setPrivateOk(!privateOk)} />
      ) : null}
      <View style={styles.buttons}>
        <Button label="Cancel" onPress={() => answerInstall(false, false)} />
        <Button label={p.optional ? 'Allow' : 'Add'} primary onPress={() => answerInstall(true, privateOk)} />
      </View>
      <Text style={[styles.note, { color: t.muted }]}>Only add extensions you trust.</Text>
    </Sheet>
  )
}

// ------------------------------------------------------------------ long-press context menu

export function ContextMenuSheet() {
  const t = useTheme()
  const menu = useBrowser((s) => s.contextMenu)
  const tab = useBrowser((s) => activeTab(s))
  if (!menu) return null
  const link = menu.linkUri
  const src = menu.srcUri
  const close = closeContextMenu
  const icon = (C: typeof Star) => <C size={20} color={t.text} />
  return (
    <Sheet visible onClose={close} title={link ?? src ?? ''}>
      <ScrollView>
        {link ? (
          <>
            <SheetRow icon={icon(Plus)} label="Open in new tab" onPress={() => { close(); newTab(link, { activate: false, openerId: tab?.id, private: tab?.private }); showToast('Opened in background') }} />
            <SheetRow icon={<EyeOff size={20} color={t.private} />} label="Open in private tab" onPress={() => { close(); newTab(link, { private: true }) }} />
            <SheetRow icon={icon(Copy)} label="Copy link" onPress={() => { close(); void Clipboard.setStringAsync(cleanLinkUrl(link)).then(() => showToast('Link copied')) }} />
            <SheetRow icon={icon(Share2)} label="Share link" onPress={() => { close(); void Share.share({ message: link }) }} />
            <SheetRow icon={icon(Download)} label="Download link" onPress={() => { close(); void Gecko.download(link, null, null) }} />
          </>
        ) : null}
        {src && menu.type === 'image' ? (
          <>
            <SheetRow icon={icon(ExternalLink)} label="Open image in new tab" onPress={() => { close(); newTab(src, { openerId: tab?.id, private: tab?.private }) }} />
            <SheetRow icon={icon(Download)} label="Save image" onPress={() => { close(); void Gecko.download(src, null, null) }} />
            <SheetRow icon={icon(Copy)} label="Copy image address" onPress={() => { close(); void Clipboard.setStringAsync(src).then(() => showToast('Copied')) }} />
          </>
        ) : null}
        {src && (menu.type === 'video' || menu.type === 'audio') ? (
          <SheetRow icon={icon(Download)} label={`Save ${menu.type}`} onPress={() => { close(); void Gecko.download(src, null, null) }} />
        ) : null}
      </ScrollView>
    </Sheet>
  )
}

// ------------------------------------------------------------------ extension action popup

export function PopupSheet() {
  const t = useTheme()
  const popup = useBrowser((s) => s.popup)
  if (!popup) return null
  return (
    <Sheet visible onClose={closePopup} title={popup.title} style={{ height: '75%' }}>
      <View style={{ flex: 1, backgroundColor: t.surface }}>
        <GeckoView tabId={popup.tabId} style={{ flex: 1 }} />
      </View>
    </Sheet>
  )
}

// ------------------------------------------------------------------ find in page

export function FindBar({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const tab = useBrowser((s) => activeTab(s))
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ current: number; total: number } | null>(null)
  const input = useRef<TextInput>(null)

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 60)
    return () => { if (tab?.native) void Gecko.clearFind(tab.id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const find = async (q: string, backwards = false) => {
    if (!tab?.native) return
    if (!q) { setResult(null); void Gecko.clearFind(tab.id); return }
    const r = await Gecko.find(tab.id, q, backwards)
    setResult({ current: r.current, total: r.total })
  }

  return (
    <View style={[styles.findBar, { backgroundColor: t.surface, borderTopColor: t.border }]}>
      <TextInput
        ref={input}
        value={query}
        onChangeText={(q) => { setQuery(q); void find(q) }}
        onSubmitEditing={() => void find(query)}
        placeholder="Find in page"
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        style={[styles.findInput, { color: t.text, backgroundColor: t.surface2 }]}
      />
      <Text style={{ color: t.muted, minWidth: 48, textAlign: 'center' }}>{result ? `${result.total ? result.current : 0}/${result.total}` : ''}</Text>
      <Pressable hitSlop={8} onPress={() => void find(query, true)}><ChevronUp size={22} color={t.text} /></Pressable>
      <Pressable hitSlop={8} onPress={() => void find(query)}><ChevronDown size={22} color={t.text} /></Pressable>
      <Pressable hitSlop={8} onPress={onClose}><X size={22} color={t.text} /></Pressable>
    </View>
  )
}

// ------------------------------------------------------------------ toast

export function ToastView({ bottom }: { bottom: number }) {
  const t = useTheme()
  const toast = useBrowser((s) => s.toast)
  if (!toast) return null
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom }]}>
      <View style={[styles.toast, { backgroundColor: t.dark ? '#2a2f38' : '#1f2329' }]}>
        <Text style={styles.toastText} numberOfLines={2}>{toast.text}</Text>
        {toast.action ? (
          <Pressable hitSlop={8} onPress={() => { toast.action!.run(); dismissToast() }}>
            <Text style={[styles.toastAction, { color: t.accent }]}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

// ------------------------------------------------------------------ bits

export function Button({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} style={[styles.button, { backgroundColor: primary ? t.accent : t.surface2 }]}>
      <Text style={{ color: primary ? t.accentText : t.text, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  )
}

export function Favicon({ url, size = 20 }: { url: string; size?: number }) {
  const t = useTheme()
  const host = hostOf(url)
  const [failed, setFailed] = useState(false)
  if (!host || failed) return <MoreHorizontal size={size} color={t.muted} />
  return <Image source={{ uri: `https://${host}/favicon.ico` }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: 4 }} />
}

export function useBottomInset() {
  return useSafeAreaInsets().bottom
}

const styles = StyleSheet.create({
  iconRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 8 },
  iconButton: { padding: 12 },
  section: { fontSize: 12, fontWeight: '600', paddingHorizontal: 20, paddingTop: 12, textTransform: 'uppercase' },
  buttons: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  button: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, paddingHorizontal: 20, paddingTop: 10 },
  findBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  findInput: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, fontSize: 15 },
  toastWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, maxWidth: 520, width: '100%' },
  toastText: { color: '#fff', flex: 1, fontSize: 14 },
  toastAction: { fontWeight: '700', fontSize: 14 }
})

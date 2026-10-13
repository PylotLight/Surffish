import { Globe, History, Lock, LockOpen, Menu, RotateCw, Search, Star, X, ArrowUpLeft, Layers } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { activeTab, getState, navigate, reload, useBrowser } from '../lib/browser'
import * as db from '../lib/db'
import { buildAddressSuggestions, type AddressSuggestion } from '../lib/shared'
import { fetchSuggestions } from '../lib/suggest'
import { useTheme } from '../lib/theme'

interface Row {
  key: string
  kind: 'url' | 'search'
  title: string
  url?: string
  source?: AddressSuggestion['source'] | 'Search'
}

function displayUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    /* fallthrough */
  }
  return url
}

export type AddressEditor = ReturnType<typeof useAddressEditor>

/** Address-bar edit state, shared by the bottom bar and the suggestion list above it. */
export function useAddressEditor() {
  const tab = useBrowser((s) => activeTab(s))
  const focusSignal = useBrowser((s) => s.focusAddressBar)
  const engine = useBrowser((s) => s.settings.searchEngine)
  const remote = useBrowser((s) => s.settings.remoteSuggestions)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [remoteRows, setRemoteRows] = useState<string[]>([])
  const input = useRef<TextInput>(null)
  const isPrivate = tab?.private ?? false

  function start(initial?: string) {
    setText(initial ?? getState().tabs.find((x) => x.id === getState().activeId)?.url ?? '')
    setEditing(true)
    setTimeout(() => input.current?.focus(), 60)
  }

  function stop() {
    setEditing(false)
    setRemoteRows([])
    Keyboard.dismiss()
  }

  function go(value: string) {
    const v = value.trim()
    if (!v) return
    stop()
    void navigate(v)
  }

  useEffect(() => {
    if (focusSignal > 0) start('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal])

  // Local data for autocomplete: loaded once per edit session.
  const local = useMemo(() => {
    if (!editing) return { history: [] as ReturnType<typeof db.historyForSuggestions>, bookmarks: [] as ReturnType<typeof db.listBookmarks> }
    return { history: db.historyForSuggestions(), bookmarks: db.listBookmarks() }
  }, [editing])

  useEffect(() => {
    if (!editing || !remote || isPrivate) {
      setRemoteRows([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void fetchSuggestions(engine, text).then((rows) => { if (live) setRemoteRows(rows) })
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [text, editing, engine, remote, isPrivate])

  const rows = useMemo<Row[]>(() => {
    if (!editing) return []
    const q = text.trim()
    const openTabs = getState().tabs
      .filter((x) => x.url && x.id !== tab?.id)
      .map((x) => ({ id: x.id, url: x.url, title: x.title, faviconUrl: null, loading: false, active: false, pinned: false, sleeping: false }))
    const localRows: Row[] = q
      ? buildAddressSuggestions(q, [], openTabs as never, local.history, 6, local.bookmarks).map((s) => ({ key: `u:${s.url}`, kind: 'url' as const, title: s.title || s.url, url: s.url, source: s.source }))
      : local.history.slice(0, 8).map((h) => ({ key: `u:${h.url}`, kind: 'url' as const, title: h.title || h.url, url: h.url, source: 'History' as const }))
    const searchRows: Row[] = q ? [{ key: `s:${q}`, kind: 'search', title: q, source: 'Search' }] : []
    const remoteMapped: Row[] = remoteRows
      .filter((r) => r.toLowerCase() !== q.toLowerCase())
      .map((r) => ({ key: `s:${r}`, kind: 'search', title: r, source: 'Search' }))
    const seen = new Set<string>()
    return [...searchRows, ...localRows, ...remoteMapped].filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)))
  }, [editing, text, local, remoteRows, tab?.id])

  return { editing, text, setText, rows, start, stop, go, input, isPrivate }
}

/** Suggestions fill the page area while editing; nearest match sits right above the bar. */
export function Suggestions({ editor }: { editor: AddressEditor }) {
  const t = useTheme()
  if (!editor.editing) return null
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
      <FlatList
        data={editor.rows}
        keyboardShouldPersistTaps="handled"
        inverted
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => (
          <Pressable android_ripple={{ color: t.surface2 }} style={styles.suggestion} onPress={() => editor.go(item.kind === 'url' ? item.url! : item.title)}>
            {item.kind === 'search' ? <Search size={18} color={t.muted} /> : item.source === 'Bookmark' ? <Star size={18} color={t.muted} /> : item.source === 'Open tab' ? <Layers size={18} color={t.muted} /> : <History size={18} color={t.muted} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.sTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
              {item.url ? <Text style={[styles.sUrl, { color: t.muted }]} numberOfLines={1}>{displayUrl(item.url)}</Text> : null}
            </View>
            <Pressable hitSlop={10} onPress={() => { editor.setText(item.kind === 'url' ? item.url! : item.title); editor.input.current?.focus() }}>
              <ArrowUpLeft size={18} color={t.muted} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  )
}

/** Bottom address bar (Brave/Firefox-mobile style). */
export function Toolbar({ editor, onOpenTabs, onOpenMenu, onOpenSiteInfo }: {
  editor: AddressEditor
  onOpenTabs: () => void
  onOpenMenu: () => void
  onOpenSiteInfo: () => void
}) {
  const t = useTheme()
  const tab = useBrowser((s) => activeTab(s))
  const tabCount = useBrowser((s) => s.tabs.length)
  const { editing, text, setText, input, isPrivate } = editor
  const bg = isPrivate ? t.privateBg : t.surface
  const pill = isPrivate ? (t.dark ? '#33285a' : '#e2d8ff') : t.surface2

  return (
    <View style={[styles.bar, { backgroundColor: bg, borderTopColor: t.border }]}>
      {editing ? (
        <View style={[styles.pill, { backgroundColor: pill }]}>
          <Search size={16} color={t.muted} />
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => editor.go(text)}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            placeholder={isPrivate ? 'Search privately or enter address' : 'Search or enter address'}
            placeholderTextColor={t.muted}
            style={[styles.input, { color: t.text }]}
          />
          {text ? (
            <Pressable hitSlop={10} onPress={() => setText('')}><X size={16} color={t.muted} /></Pressable>
          ) : null}
        </View>
      ) : (
        <Pressable style={[styles.pill, { backgroundColor: pill }]} onPress={() => editor.start()}>
          <Pressable hitSlop={8} onPress={onOpenSiteInfo}>
            {!tab?.url ? <Globe size={15} color={t.muted} /> : tab.secure && !tab.mixed ? <Lock size={15} color={t.muted} /> : <LockOpen size={15} color={tab.url.startsWith('https:') ? t.muted : t.danger} />}
          </Pressable>
          <Text style={[styles.urlText, { color: tab?.url ? t.text : t.muted }]} numberOfLines={1}>
            {tab?.url ? displayUrl(tab.url) : isPrivate ? 'Private tab' : 'Search or enter address'}
          </Text>
          {tab?.url ? (
            <Pressable hitSlop={10} onPress={reload}>
              {tab.loading ? <X size={17} color={t.muted} /> : <RotateCw size={16} color={t.muted} />}
            </Pressable>
          ) : null}
        </Pressable>
      )}
      {editing ? (
        <Pressable hitSlop={8} onPress={editor.stop} style={styles.cancel}><Text style={{ color: t.accent, fontWeight: '600' }}>Cancel</Text></Pressable>
      ) : (
        <>
          <Pressable hitSlop={8} onPress={onOpenTabs} style={[styles.tabs, { borderColor: isPrivate ? t.private : t.text }]}>
            <Text style={{ color: isPrivate ? t.private : t.text, fontWeight: '700', fontSize: 12 }}>{tabCount > 99 ? ':D' : tabCount}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={onOpenMenu} style={styles.icon}><Menu size={22} color={t.text} /></Pressable>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 42, borderRadius: 21, paddingHorizontal: 14, gap: 8 },
  urlText: { flex: 1, fontSize: 15 },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  tabs: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  icon: { padding: 4 },
  cancel: { paddingHorizontal: 4 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 11 },
  sTitle: { fontSize: 15 },
  sUrl: { fontSize: 12, marginTop: 1 }
})

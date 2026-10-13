import { useFocusEffect, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { RotateCw } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { BackHandler, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gecko, GeckoView } from '../modules/gecko-view'
import { ContextMenuSheet, FindBar, InstallSheet, MenuSheet, PermissionSheet, PopupSheet, SiteInfoSheet, ToastView } from '../src/components/Overlays'
import { StartPage } from '../src/components/StartPage'
import { Suggestions, Toolbar, useAddressEditor } from '../src/components/Toolbar'
import { activeTab, captureThumbnail, closeTab, getState, goBack, reload, setFullScreen, useBrowser } from '../src/lib/browser'
import { useTheme } from '../src/lib/theme'

export default function BrowserScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const tab = useBrowser((s) => activeTab(s))
  const ready = useBrowser((s) => s.ready)
  const fullScreen = useBrowser((s) => s.fullScreen)
  const editor = useAddressEditor()
  const [menu, setMenu] = useState(false)
  const [siteInfo, setSiteInfo] = useState(false)
  const [finding, setFinding] = useState(false)

  const openTabs = () => {
    const current = activeTab()
    const go = () => router.push('/tabs')
    if (current?.native) void captureThumbnail(current.id).finally(go)
    else go()
  }

  // Hardware back: close UI first, then page history, then a tab opened from another tab.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const s = getState()
        const current = activeTab(s)
        if (editor.editing) { editor.stop(); return true }
        if (finding) { setFinding(false); return true }
        if (s.fullScreen && current) { void Gecko.exitFullScreen(current.id); setFullScreen(false); return true }
        if (current?.canGoBack) { goBack(); return true }
        if (current?.openerId && s.tabs.some((x) => x.id === current.openerId)) { closeTab(current.id, { silent: true }); return true }
        return false
      })
      return () => sub.remove()
    }, [editor, finding])
  )

  const showStart = !!tab && !tab.native && !tab.url && !tab.restoreState
  const chromeHidden = fullScreen

  return (
    <View style={[styles.root, { backgroundColor: tab?.private ? t.privateBg : t.surface }]}>
      <StatusBar style={t.dark || tab?.private ? 'light' : 'dark'} hidden={chromeHidden} />
      {!chromeHidden ? <View style={{ height: insets.top }} /> : null}
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <View style={styles.content}>
          <GeckoView style={styles.gecko} tabId={ready && tab?.native ? tab.id : null} />
          {showStart && tab ? <View style={StyleSheet.absoluteFill}><StartPage isPrivate={tab.private} tabId={tab.id} /></View> : null}
          {tab?.crashed ? (
            <View style={[StyleSheet.absoluteFill, styles.crash, { backgroundColor: t.bg }]}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>This tab crashed</Text>
              <Pressable onPress={reload} style={[styles.retry, { backgroundColor: t.accent }]}>
                <RotateCw size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '600' }}>Reload</Text>
              </Pressable>
            </View>
          ) : null}
          <Suggestions editor={editor} />
          <ToastView bottom={12} />
        </View>
        {!chromeHidden ? (
          <View>
            {tab?.loading ? (
              <View style={[styles.progressTrack, { backgroundColor: 'transparent' }]}>
                <View style={[styles.progress, { width: `${Math.max(5, tab.progress)}%`, backgroundColor: tab.private ? t.private : t.accent }]} />
              </View>
            ) : null}
            {finding ? (
              <FindBar onClose={() => setFinding(false)} />
            ) : (
              <Toolbar editor={editor} onOpenTabs={openTabs} onOpenMenu={() => setMenu(true)} onOpenSiteInfo={() => setSiteInfo(true)} />
            )}
            <View style={{ height: editor.editing || finding ? 0 : insets.bottom, backgroundColor: tab?.private ? t.privateBg : t.surface }} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <MenuSheet visible={menu} onClose={() => setMenu(false)} onFind={() => setFinding(true)} />
      <SiteInfoSheet visible={siteInfo} onClose={() => setSiteInfo(false)} />
      <PermissionSheet />
      <InstallSheet />
      <ContextMenuSheet />
      <PopupSheet />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, overflow: 'hidden' },
  gecko: { flex: 1 },
  progressTrack: { height: 2, width: '100%' },
  progress: { height: 2 },
  crash: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  retry: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 }
})

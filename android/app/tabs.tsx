import { useRouter } from 'expo-router'
import { EyeOff, Layers, Plus, RotateCcw, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Favicon } from '../src/components/Overlays'
import { closeAllTabs, closeTab, hostOf, newTab, restoreClosedTab, selectTab, useBrowser, type Tab } from '../src/lib/browser'
import { useTheme } from '../src/lib/theme'

/** Tab switcher grid. Private tabs live on their own page, like Firefox/Brave. */
export default function TabsScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const tabs = useBrowser((s) => s.tabs)
  const activeId = useBrowser((s) => s.activeId)
  const closedCount = useBrowser((s) => s.closed.length)
  const activePrivate = useBrowser((s) => s.tabs.find((x) => x.id === s.activeId)?.private ?? false)
  const [privateMode, setPrivateMode] = useState(activePrivate)
  const list = tabs.filter((x) => x.private === privateMode)
  const columns = width > 700 ? 3 : 2
  const cardWidth = (width - 16 * 2 - 12 * (columns - 1)) / columns

  const open = (tab: Tab) => {
    void selectTab(tab.id)
    router.back()
  }

  const add = () => {
    newTab(null, { private: privateMode })
    router.back()
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={[styles.segment, { backgroundColor: t.surface2 }]}>
          <Pressable onPress={() => setPrivateMode(false)} style={[styles.segItem, !privateMode && { backgroundColor: t.surface }]}>
            <Layers size={16} color={t.text} />
            <Text style={{ color: t.text, fontWeight: '600' }}>{tabs.filter((x) => !x.private).length}</Text>
          </Pressable>
          <Pressable onPress={() => setPrivateMode(true)} style={[styles.segItem, privateMode && { backgroundColor: t.privateBg }]}>
            <EyeOff size={16} color={t.private} />
            <Text style={{ color: t.private, fontWeight: '600' }}>{tabs.filter((x) => x.private).length}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        {closedCount > 0 && !privateMode ? (
          <Pressable hitSlop={8} onPress={() => { restoreClosedTab(); router.back() }} style={styles.headerBtn}><RotateCcw size={20} color={t.text} /></Pressable>
        ) : null}
        {list.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => closeAllTabs(privateMode)} style={styles.headerBtn}><Trash2 size={20} color={t.text} /></Pressable>
        ) : null}
        <Pressable hitSlop={8} onPress={() => router.back()} style={styles.headerBtn}><X size={22} color={t.text} /></Pressable>
      </View>
      <FlatList
        key={columns}
        data={list}
        numColumns={columns}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        columnWrapperStyle={{ gap: 12 }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.muted }]}>{privateMode ? 'No private tabs. Private tabs leave no history.' : 'No tabs'}</Text>
        }
        renderItem={({ item }) => {
          const active = item.id === activeId
          return (
            <Pressable onPress={() => open(item)} style={[styles.card, { width: cardWidth, backgroundColor: t.surface, borderColor: active ? (item.private ? t.private : t.accent) : t.border }]}>
              <View style={styles.cardHead}>
                <Favicon url={item.url} size={14} />
                <Text style={[styles.cardTitle, { color: t.text }]} numberOfLines={1}>{item.title || hostOf(item.url) || 'New tab'}</Text>
                <Pressable hitSlop={10} onPress={() => closeTab(item.id)}><X size={16} color={t.muted} /></Pressable>
              </View>
              <View style={[styles.thumb, { backgroundColor: item.private ? t.privateBg : t.surface2 }]}>
                {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
                  <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={2}>{hostOf(item.url) || 'New tab'}</Text>
                )}
              </View>
            </Pressable>
          )
        }}
      />
      <Pressable onPress={add} style={[styles.fab, { backgroundColor: privateMode ? t.private : t.accent, bottom: insets.bottom + 24 }]}>
        <Plus size={22} color="#fff" />
        <Text style={styles.fabText}>{privateMode ? 'Private tab' : 'New tab'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  segment: { flexDirection: 'row', borderRadius: 20, padding: 3 },
  segItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 17 },
  headerBtn: { padding: 8 },
  card: { borderRadius: 14, borderWidth: 2, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: '500' },
  thumb: { height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  empty: { textAlign: 'center', marginTop: 80, fontSize: 14 },
  fab: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, height: 50, borderRadius: 25, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 }
})

import { Stack, useRouter } from 'expo-router'
import { Trash2, X } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { Favicon } from '../src/components/Overlays'
import { hostOf, navigate, showToast } from '../src/lib/browser'
import * as db from '../src/lib/db'
import { useTheme } from '../src/lib/theme'

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ms >= start) return 'Today'
  if (ms >= start - 86_400_000) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function HistoryScreen() {
  const t = useTheme()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<db.HistoryVisit[]>([])
  const refresh = useCallback(() => setItems(db.listHistory(query, 500)), [query])
  useEffect(refresh, [refresh])

  const sections = useMemo(() => {
    const map = new Map<string, db.HistoryVisit[]>()
    for (const v of items) {
      const k = dayLabel(v.visitedAt)
      map.set(k, [...(map.get(k) ?? []), v])
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }))
  }, [items])

  const clearAll = () => Alert.alert('Clear all history?', 'This removes every visit from this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => { db.clearHistory(); refresh(); showToast('History cleared') } }
  ])

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: 'History', headerRight: () => <Pressable hitSlop={8} onPress={clearAll}><Trash2 size={20} color={t.text} /></Pressable> }} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search history" placeholderTextColor={t.muted}
        style={[styles.search, { backgroundColor: t.surface2, color: t.text }]} />
      <SectionList
        sections={sections}
        keyExtractor={(v) => v.id}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Text style={[styles.empty, { color: t.muted }]}>Nothing here yet. Private tabs never show up.</Text>}
        renderSectionHeader={({ section }) => <Text style={[styles.header, { color: t.muted }]}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable android_ripple={{ color: t.surface2 }} style={styles.row} onPress={() => { void navigate(item.url); router.back() }}>
            <Favicon url={item.url} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{item.title || item.url}</Text>
              <Text style={[styles.url, { color: t.muted }]} numberOfLines={1}>
                {new Date(item.visitedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {hostOf(item.url)}
              </Text>
            </View>
            <Pressable hitSlop={8} onPress={() => { db.deleteVisit(item.id); refresh() }}><X size={18} color={t.muted} /></Pressable>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  search: { margin: 12, height: 42, borderRadius: 21, paddingHorizontal: 16, fontSize: 15 },
  header: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 15 },
  url: { fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 60, paddingHorizontal: 32 }
})

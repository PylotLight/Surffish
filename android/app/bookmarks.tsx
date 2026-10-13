import { Stack, useRouter } from 'expo-router'
import { Pencil, Trash2 } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Favicon } from '../src/components/Overlays'
import { hostOf, navigate, showToast } from '../src/lib/browser'
import * as db from '../src/lib/db'
import { useTheme } from '../src/lib/theme'

export default function BookmarksScreen() {
  const t = useTheme()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<db.Bookmark[]>([])
  const [editing, setEditing] = useState<db.Bookmark | null>(null)
  const [title, setTitle] = useState('')
  const refresh = useCallback(() => setItems(db.listBookmarks(query)), [query])
  useEffect(refresh, [refresh])

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: 'Bookmarks' }} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search bookmarks" placeholderTextColor={t.muted}
        style={[styles.search, { backgroundColor: t.surface2, color: t.text }]} />
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={<Text style={[styles.empty, { color: t.muted }]}>No bookmarks yet. Tap the star in the menu to add one.</Text>}
        renderItem={({ item }) => editing?.id === item.id ? (
          <View style={styles.row}>
            <TextInput value={title} onChangeText={setTitle} autoFocus style={[styles.edit, { color: t.text, borderColor: t.border }]}
              onSubmitEditing={() => { db.renameBookmark(item.id, title.trim() || item.url); setEditing(null); refresh() }} />
          </View>
        ) : (
          <Pressable android_ripple={{ color: t.surface2 }} style={styles.row} onPress={() => { void navigate(item.url); router.back() }}>
            <Favicon url={item.url} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
              <Text style={[styles.url, { color: t.muted }]} numberOfLines={1}>{hostOf(item.url)}</Text>
            </View>
            <Pressable hitSlop={8} onPress={() => { setEditing(item); setTitle(item.title) }}><Pencil size={18} color={t.muted} /></Pressable>
            <Pressable hitSlop={8} onPress={() => { db.removeBookmark(item.id); refresh(); showToast('Bookmark removed') }}><Trash2 size={18} color={t.muted} /></Pressable>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  search: { margin: 12, height: 42, borderRadius: 21, paddingHorizontal: 16, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 15 },
  url: { fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 60, paddingHorizontal: 32 },
  edit: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, height: 40 }
})


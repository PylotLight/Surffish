import { EyeOff } from 'lucide-react-native'
import { useMemo } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { hostOf, navigate } from '../lib/browser'
import * as db from '../lib/db'
import { useTheme } from '../lib/theme'
import { Favicon } from './Overlays'

/** New tab page: most visited + recent bookmarks. Rendered natively, no Gecko session until you go somewhere. */
export function StartPage({ isPrivate, tabId }: { isPrivate: boolean; tabId: string }) {
  const t = useTheme()
  const { top, bookmarks } = useMemo(() => {
    if (isPrivate) return { top: [], bookmarks: [] }
    const seen = new Set<string>()
    const top = db.historyForSuggestions(60).filter((h) => {
      const host = hostOf(h.url)
      if (!host || seen.has(host)) return false
      seen.add(host)
      return true
    }).slice(0, 8)
    return { top, bookmarks: db.listBookmarks().slice(0, 12) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrivate, tabId])

  if (isPrivate) {
    return (
      <View style={[styles.privateWrap, { backgroundColor: t.privateBg }]}>
        <EyeOff size={44} color={t.private} />
        <Text style={[styles.privateTitle, { color: t.text }]}>Private tab</Text>
        <Text style={[styles.privateBody, { color: t.muted }]}>
          Surffish won’t save history, cookies or site data from private tabs once they’re all closed. Downloads and bookmarks you make are kept.
        </Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Image source={require('../../assets/icon.png')} style={styles.logo} />
      <Text style={[styles.brand, { color: t.text }]}>Surffish</Text>
      {top.length > 0 ? (
        <View style={styles.grid}>
          {top.map((h) => (
            <Pressable key={h.url} style={styles.tile} onPress={() => void navigate(h.url, tabId)}>
              <View style={[styles.tileIcon, { backgroundColor: t.surface2 }]}><Favicon url={h.url} size={24} /></View>
              <Text style={[styles.tileLabel, { color: t.text }]} numberOfLines={1}>{hostOf(h.url).replace(/^www\./, '')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {bookmarks.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.muted }]}>Bookmarks</Text>
          {bookmarks.map((b) => (
            <Pressable key={b.id} style={styles.bookmark} onPress={() => void navigate(b.url, tabId)}>
              <Favicon url={b.url} size={18} />
              <Text style={[styles.bookmarkTitle, { color: t.text }]} numberOfLines={1}>{b.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 56, paddingBottom: 24, paddingHorizontal: 16 },
  logo: { width: 76, height: 76 },
  brand: { fontSize: 22, fontWeight: '700', marginTop: 8, marginBottom: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 420 },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 10 },
  tileIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, marginTop: 6, maxWidth: 80 },
  section: { width: '100%', maxWidth: 420, marginTop: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6, paddingHorizontal: 4 },
  bookmark: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  bookmarkTitle: { flex: 1, fontSize: 15 },
  privateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  privateTitle: { fontSize: 22, fontWeight: '700' },
  privateBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 }
})

import { Stack, useRouter } from 'expo-router'
import { Check, EyeOff, Puzzle, Search, Settings2, Star, Trash2, Users } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { Gecko, type InstalledExtension } from '../modules/gecko-view'
import { searchAmo, type AmoAddon } from '../src/lib/amo'
import { newTab, showToast, useBrowser } from '../src/lib/browser'
import { useTheme } from '../src/lib/theme'

function formatUsers(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** Installed WebExtensions (GeckoView) + addons.mozilla.org search for Android-compatible add-ons. */
export default function ExtensionsScreen() {
  const t = useTheme()
  const router = useRouter()
  const version = useBrowser((s) => s.extensionsVersion)
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AmoAddon[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    Gecko.listExtensions().then(setInstalled).catch(() => setInstalled([]))
  }, [])
  useEffect(refresh, [refresh, version])

  const search = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const r = await searchAmo(q)
      setResults(r.results)
    } catch (e) {
      setError('Couldn\u2019t reach addons.mozilla.org')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void search('') }, [search])

  const install = async (addon: AmoAddon) => {
    if (!addon.xpi) return
    setInstalling(addon.guid)
    try {
      const ext = await Gecko.installExtension(addon.xpi)
      showToast(`${ext.name} added`)
      refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/cancel|abort/i.test(msg)) showToast(`Install failed: ${msg}`)
    } finally {
      setInstalling(null)
    }
  }

  const remove = (ext: InstalledExtension) => Alert.alert(`Remove ${ext.name}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void Gecko.uninstallExtension(ext.id).then(refresh) }
  ])

  const installedIds = new Set(installed.map((e) => e.id))

  const header = (
    <View>
      <Text style={[styles.section, { color: t.muted }]}>Installed</Text>
      {installed.length === 0 ? <Text style={[styles.empty, { color: t.muted }]}>Nothing installed yet</Text> : null}
      {installed.map((ext) => (
        <View key={ext.id} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.cardRow}>
            {ext.icon ? <Image source={{ uri: ext.icon }} style={styles.icon} /> : <Puzzle size={28} color={t.muted} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{ext.name}</Text>
              <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>{ext.version}{ext.creator ? ` · ${ext.creator}` : ''}</Text>
            </View>
            <Switch value={ext.enabled} onValueChange={(v) => void Gecko.setExtensionEnabled(ext.id, v).then(refresh)} />
          </View>
          <View style={styles.actions}>
            {ext.optionsPageUrl ? (
              <Pressable style={styles.action} onPress={() => { newTab(ext.optionsPageUrl!); router.dismissTo('/') }}>
                <Settings2 size={16} color={t.text} /><Text style={{ color: t.text }}>Settings</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.action} onPress={() => void Gecko.setExtensionPrivate(ext.id, !ext.allowedInPrivate).then(refresh)}>
              <EyeOff size={16} color={ext.allowedInPrivate ? t.private : t.muted} />
              <Text style={{ color: ext.allowedInPrivate ? t.private : t.muted }}>{ext.allowedInPrivate ? 'Runs in private' : 'Not in private'}</Text>
            </Pressable>
            {!ext.builtIn ? (
              <Pressable style={styles.action} onPress={() => remove(ext)}>
                <Trash2 size={16} color={t.danger} /><Text style={{ color: t.danger }}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <Text style={[styles.section, { color: t.muted }]}>Get add-ons</Text>
      <View style={[styles.search, { backgroundColor: t.surface2 }]}>
        <Search size={16} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search(query)} returnKeyType="search"
          placeholder="Search addons.mozilla.org" placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: 15 }} />
      </View>
      {!query.trim() ? <Text style={[styles.hint, { color: t.muted }]}>Recommended for Firefox on Android</Text> : null}
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} color={t.accent} /> : null}
      {error ? <Text style={[styles.empty, { color: t.danger }]}>{error}</Text> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: 'Extensions' }} />
      <FlatList
        data={loading ? [] : results}
        keyExtractor={(a) => a.guid}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const has = installedIds.has(item.guid)
          return (
            <View style={styles.amoRow}>
              {item.icon ? <Image source={{ uri: item.icon }} style={styles.icon} /> : <Puzzle size={28} color={t.muted} />}
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.summary, { color: t.muted }]} numberOfLines={2}>{item.summary}</Text>
                <View style={styles.stats}>
                  <Users size={12} color={t.muted} /><Text style={[styles.meta, { color: t.muted }]}>{formatUsers(item.users)}</Text>
                  <Star size={12} color={t.muted} /><Text style={[styles.meta, { color: t.muted }]}>{item.rating.toFixed(1)}</Text>
                </View>
              </View>
              {has ? <Check size={22} color={t.accent} /> : installing === item.guid ? <ActivityIndicator color={t.accent} /> : (
                <Pressable disabled={!item.xpi || !!installing} onPress={() => void install(item)} style={[styles.add, { backgroundColor: t.accent, opacity: item.xpi ? 1 : 0.4 }]}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Add</Text>
                </Pressable>
              )}
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  empty: { paddingHorizontal: 16, paddingVertical: 8 },
  hint: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 12 },
  card: { marginHorizontal: 12, marginBottom: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10, paddingLeft: 44 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 32, height: 32, borderRadius: 6 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  summary: { fontSize: 13, marginTop: 2 },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, height: 42, borderRadius: 21, paddingHorizontal: 14 },
  amoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  add: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 }
})

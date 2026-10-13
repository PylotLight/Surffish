import Constants from 'expo-constants'
import { Stack } from 'expo-router'
import { Check } from 'lucide-react-native'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Gecko } from '../modules/gecko-view'
import { closeAllTabs, showToast, updateSettings, useBrowser } from '../src/lib/browser'
import * as db from '../src/lib/db'
import { SEARCH_ENGINES } from '../src/lib/shared'
import { useTheme } from '../src/lib/theme'

export default function SettingsScreen() {
  const t = useTheme()
  const settings = useBrowser((s) => s.settings)

  const clearData = () => Alert.alert('Clear browsing data?', 'Cookies, cache, site data and history on this phone. Bookmarks and open tabs stay.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Clear',
      style: 'destructive',
      onPress: () => {
        db.clearHistory()
        void Gecko.clearBrowsingData().then(() => showToast('Browsing data cleared'))
      }
    }
  ])

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <Text style={[styles.section, { color: t.muted }]}>Search engine</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        {SEARCH_ENGINES.map((e) => (
          <Pressable key={e.id} style={styles.row} onPress={() => updateSettings({ searchEngine: e.id })}>
            <Text style={[styles.label, { color: t.text }]}>{e.label}</Text>
            {settings.searchEngine === e.id ? <Check size={18} color={t.accent} /> : null}
          </Pressable>
        ))}
      </View>
      <Text style={[styles.foot, { color: t.muted }]}>Keywords work too: “g cats”, “yt lofi”, “w otters”, or !bangs like “!gh surffish”.</Text>

      <Text style={[styles.section, { color: t.muted }]}>Address bar</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: t.text }]}>Search suggestions</Text>
            <Text style={[styles.detail, { color: t.muted }]}>Sends what you type to your search engine. Never in private tabs.</Text>
          </View>
          <Switch value={settings.remoteSuggestions} onValueChange={(v) => updateSettings({ remoteSuggestions: v })} />
        </View>
      </View>

      <Text style={[styles.section, { color: t.muted }]}>General</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        <Pressable style={styles.row} onPress={() => void Linking.sendIntent('android.settings.MANAGE_DEFAULT_APPS_SETTINGS').catch(() => Linking.openSettings())}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: t.text }]}>Set as default browser</Text>
            <Text style={[styles.detail, { color: t.muted }]}>Opens Android’s default apps settings. Pick Surffish under Browser app.</Text>
          </View>
        </Pressable>
        <Pressable style={styles.row} onPress={() => { closeAllTabs(true); showToast('Private tabs closed') }}>
          <Text style={[styles.label, { color: t.text }]}>Close all private tabs</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={clearData}>
          <Text style={[styles.label, { color: t.danger }]}>Clear browsing data</Text>
        </Pressable>
      </View>

      <Text style={[styles.section, { color: t.muted }]}>Proxy</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: t.text }]}>SOCKS5 proxy</Text>
            <Text style={[styles.detail, { color: t.muted }]}>Not in this build yet (planned: small built-in extension using browser.proxy).</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: t.muted }]}>Sync</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: t.text }]}>Pair with Surffish on your Mac</Text>
            <Text style={[styles.detail, { color: t.muted }]}>Coming later: direct LAN sync with QR pairing, no server.</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: t.muted }]}>About</Text>
      <View style={[styles.group, { backgroundColor: t.surface }]}>
        <View style={styles.row}><Text style={[styles.label, { color: t.text }]}>Surffish</Text><Text style={{ color: t.muted }}>{Constants.expoConfig?.version ?? '0.1.0'}</Text></View>
        <View style={styles.row}><Text style={[styles.label, { color: t.text }]}>GeckoView</Text><Text style={{ color: t.muted }}>{Gecko.geckoVersion}</Text></View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8 },
  group: { marginHorizontal: 12, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 50 },
  label: { fontSize: 15, flex: 1 },
  detail: { fontSize: 12, marginTop: 2 },
  foot: { fontSize: 12, paddingHorizontal: 20, paddingTop: 8 }
})

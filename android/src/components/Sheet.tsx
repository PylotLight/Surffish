import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../lib/theme'

/** Bottom sheet: dim backdrop, tap outside or back to close. */
export function Sheet({ visible, onClose, title, children, style }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + 8, borderColor: t.border }, style]}>
        <View style={[styles.grabber, { backgroundColor: t.border }]} />
        {title ? <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>{title}</Text> : null}
        {children}
      </View>
    </Modal>
  )
}

export function SheetRow({ icon, label, detail, onPress, danger, right }: { icon?: ReactNode; label: string; detail?: string | null; onPress?: () => void; danger?: boolean; right?: ReactNode }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} android_ripple={{ color: t.surface2 }} style={styles.row}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: danger ? t.danger : t.text }]} numberOfLines={1}>{label}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: t.muted }]} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {right}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, maxHeight: '88%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '600', paddingHorizontal: 20, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 16 },
  rowIcon: { width: 24, alignItems: 'center' },
  rowLabel: { fontSize: 15 },
  rowDetail: { fontSize: 12, marginTop: 2 }
})

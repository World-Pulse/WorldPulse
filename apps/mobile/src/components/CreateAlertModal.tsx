import { useState } from 'react'
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '@/lib/api'

const COLORS = {
  bg:      '#06070d',
  surface: '#0d0f18',
  s2:      '#141722',
  border:  'rgba(255,255,255,0.07)',
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  red:     '#ff3b5c',
  cyan:    '#00d4ff',
  green:   '#00e676',
}

const CATEGORIES = [
  'conflict', 'climate', 'disaster', 'health', 'economy',
  'geopolitics', 'technology', 'military', 'cyber', 'sanctions',
]

const SEVERITY_OPTIONS = ['info', 'low', 'medium', 'high', 'critical'] as const
type Severity = typeof SEVERITY_OPTIONS[number]

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: COLORS.red,
  high:     COLORS.amber,
  medium:   COLORS.cyan,
  low:      COLORS.green,
  info:     COLORS.text3,
}

type Props = {
  visible: boolean
  onClose: () => void
}

export function CreateAlertModal({ visible, onClose }: Props) {
  const queryClient = useQueryClient()

  const [name, setName]                   = useState('')
  const [keywordsText, setKeywordsText]   = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [minSeverity, setMinSeverity]     = useState<Severity>('medium')
  const [nameError, setNameError]         = useState('')

  const createMutation = useMutation({
    mutationFn: () => alertsApi.create({
      name:           name.trim(),
      keywords:       keywordsText.split(',').map(k => k.trim()).filter(Boolean),
      categories:     selectedCategories,
      countries:      [],
      minSeverity,
      active:         true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      handleClose()
    },
  })

  function handleClose() {
    setName('')
    setKeywordsText('')
    setSelectedCategories([])
    setMinSeverity('medium')
    setNameError('')
    onClose()
  }

  function handleSubmit() {
    if (!name.trim()) {
      setNameError('Alert name is required')
      return
    }
    setNameError('')
    createMutation.mutate()
  }

  function toggleCategory(cat: string) {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Alert</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <ActivityIndicator size="small" color={COLORS.amber} />
            ) : (
              <Text style={styles.saveText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.label}>ALERT NAME *</Text>
            <TextInput
              style={[styles.input, nameError ? styles.inputError : null]}
              placeholder="e.g. Middle East Conflict Tracker"
              placeholderTextColor={COLORS.text3}
              value={name}
              onChangeText={t => { setName(t); setNameError('') }}
              autoCorrect={false}
            />
            {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
          </View>

          {/* Keywords */}
          <View style={styles.field}>
            <Text style={styles.label}>KEYWORDS</Text>
            <Text style={styles.hint}>Comma-separated. e.g. Gaza, ceasefire, airstrike</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="keyword1, keyword2, keyword3"
              placeholderTextColor={COLORS.text3}
              value={keywordsText}
              onChangeText={setKeywordsText}
              multiline
              numberOfLines={3}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Min Severity */}
          <View style={styles.field}>
            <Text style={styles.label}>MINIMUM SEVERITY</Text>
            <View style={styles.severityRow}>
              {SEVERITY_OPTIONS.map(sev => {
                const active = minSeverity === sev
                const color  = SEVERITY_COLORS[sev]
                return (
                  <TouchableOpacity
                    key={sev}
                    style={[
                      styles.severityBtn,
                      { borderColor: active ? color : COLORS.border },
                      active && { backgroundColor: `${color}14` },
                    ]}
                    onPress={() => setMinSeverity(sev)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.severityText, { color: active ? color : COLORS.text3 }]}>
                      {sev.charAt(0).toUpperCase() + sev.slice(1)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Categories */}
          <View style={styles.field}>
            <Text style={styles.label}>CATEGORIES (OPTIONAL)</Text>
            <View style={styles.categoriesGrid}>
              {CATEGORIES.map(cat => {
                const selected = selectedCategories.includes(cat)
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryBtn,
                      selected && styles.categoryBtnActive,
                    ]}
                    onPress={() => toggleCategory(cat)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.categoryBtnText, selected && styles.categoryBtnTextActive]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Error state */}
          {createMutation.isError && (
            <View style={styles.apiError}>
              <Text style={styles.apiErrorText}>
                Failed to create alert. Please try again.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  cancelText:  { fontSize: 15, color: COLORS.text2 },
  saveText:    { fontSize: 15, fontWeight: '700', color: COLORS.amber },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 20, paddingBottom: 40 },

  field: { gap: 7 },
  label: {
    fontSize: 10, color: COLORS.text3, fontFamily: 'monospace',
    letterSpacing: 1.5, fontWeight: '700',
  },
  hint: { fontSize: 12, color: COLORS.text3, marginTop: -4 },

  input: {
    backgroundColor: COLORS.s2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: COLORS.text,
  },
  inputError: { borderColor: COLORS.red },
  textArea: { height: 80, textAlignVertical: 'top' },
  errorText: { fontSize: 12, color: COLORS.red },

  severityRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  severityBtn: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  severityText: { fontSize: 12, fontWeight: '700' },

  categoriesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  categoryBtnActive: {
    backgroundColor: 'rgba(0,212,255,0.1)', borderColor: COLORS.cyan,
  },
  categoryBtnText: { fontSize: 13, color: COLORS.text3 },
  categoryBtnTextActive: { color: COLORS.cyan, fontWeight: '600' },

  apiError: {
    backgroundColor: 'rgba(255,59,92,0.1)', borderWidth: 1, borderColor: COLORS.red,
    borderRadius: 8, padding: 12,
  },
  apiErrorText: { fontSize: 13, color: COLORS.red },
})

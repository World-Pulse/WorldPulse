import { useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Switch, ActivityIndicator, Alert,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { alertsApi, type AlertSubscription } from '@/lib/api'
import { CreateAlertModal } from '@/components/CreateAlertModal'

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

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     '#8892a4',
}

function AlertItem({
  alert,
  onToggle,
  onDelete,
}: {
  alert: AlertSubscription
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <View style={styles.alertCard}>
      <View style={styles.alertHeader}>
        <View style={styles.alertTitleRow}>
          <Text style={styles.alertName} numberOfLines={1}>{alert.name}</Text>
          <Switch
            value={alert.active}
            onValueChange={(val) => onToggle(alert.id, val)}
            trackColor={{ false: COLORS.s2, true: 'rgba(245,166,35,0.4)' }}
            thumbColor={alert.active ? COLORS.amber : COLORS.text3}
          />
        </View>

        {alert.keywords.length > 0 && (
          <View style={styles.keywordRow}>
            {alert.keywords.slice(0, 4).map(kw => (
              <View key={kw} style={styles.keyword}>
                <Text style={styles.keywordText}>{kw}</Text>
              </View>
            ))}
            {alert.keywords.length > 4 && (
              <Text style={styles.moreKeywords}>+{alert.keywords.length - 4} more</Text>
            )}
          </View>
        )}

        <View style={styles.alertMeta}>
          {alert.categories.length > 0 && (
            <Text style={styles.metaText}>
              {alert.categories.join(', ')}
            </Text>
          )}
          <Text style={[
            styles.severityBadge,
            { color: SEVERITY_COLORS[alert.minSeverity] ?? COLORS.text2 }
          ]}>
            Min: {alert.minSeverity}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => {
          Alert.alert(
            'Delete Alert',
            `Delete "${alert.name}"?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => onDelete(alert.id) },
            ]
          )
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function AlertsScreen() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsApi.getAll(),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      alertsApi.toggle(id, active),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] })
      const prev = queryClient.getQueryData(['alerts'])
      queryClient.setQueryData(['alerts'], (old: { success: boolean; data: AlertSubscription[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map(a => a.id === id ? { ...a, active } : a),
        }
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['alerts'], ctx?.prev)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => alertsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  const alerts = data?.data ?? []

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.amber} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alert Subscriptions</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.createButtonText}>+ New Alert</Text>
        </TouchableOpacity>
      </View>

      {/* Alert list */}
      <FlatList
        data={alerts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <AlertItem
            alert={item}
            onToggle={(id, active) => toggleMutation.mutate({ id, active })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>No alerts configured</Text>
            <Text style={styles.emptySubtitle}>
              Create alerts to get notified about specific topics, regions, or event types.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setShowCreateModal(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyButtonText}>Create your first alert</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <CreateAlertModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  createButton: {
    backgroundColor: COLORS.amber,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  createButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
    gap: 8,
  },
  alertCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
  },
  alertHeader: {
    gap: 8,
    marginBottom: 10,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  alertName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  keywordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  keyword: {
    backgroundColor: 'rgba(0,212,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.2)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  keywordText: {
    fontSize: 11,
    color: COLORS.cyan,
    fontFamily: 'monospace',
  },
  moreKeywords: {
    fontSize: 11,
    color: COLORS.text3,
  },
  alertMeta: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    color: COLORS.text2,
  },
  severityBadge: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  deleteButton: {
    paddingVertical: 7,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 4,
  },
  deleteButtonText: {
    fontSize: 13,
    color: COLORS.red,
    fontWeight: '600',
  },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 8,
    backgroundColor: COLORS.amber,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  emptyButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
})

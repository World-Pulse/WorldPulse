import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useAuthStore } from '@/lib/auth'
import { usersApi } from '@/lib/api'

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

const SETTINGS_ITEMS = [
  { icon: '🔔', label: 'Notifications',    sublabel: 'Alert preferences' },
  { icon: '🌐', label: 'Language',         sublabel: 'English (EN)' },
  { icon: '🔒', label: 'Privacy',          sublabel: 'Account visibility' },
  { icon: '🔑', label: 'Security',         sublabel: 'Password & authentication' },
  { icon: '📤', label: 'Export Data',      sublabel: 'Download your data' },
  { icon: '❓', label: 'Help & Support',   sublabel: 'FAQ and contact' },
  { icon: '📋', label: 'Terms & Privacy',  sublabel: 'Legal documents' },
]

function StatBadge({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, logout } = useAuthStore()

  const { data } = useQuery({
    queryKey: ['profile', user?.handle],
    queryFn: () => usersApi.getProfile(user!.handle),
    enabled: !!user?.handle,
  })

  const profile = data?.data ?? user

  async function handleLogout() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout()
            router.replace('/auth/login')
          },
        },
      ]
    )
  }

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return String(n)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* Profile header */}
      <View style={styles.profileHeader}>
        {profile?.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>
              {profile?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
            </Text>
          </View>
        )}

        <Text style={styles.displayName}>
          {profile?.displayName ?? '—'}
          {profile?.verified && (
            <Text style={styles.verifiedBadge}> ✓</Text>
          )}
        </Text>

        <Text style={styles.handle}>@{profile?.handle ?? '—'}</Text>

        {profile?.bio && (
          <Text style={styles.bio}>{profile.bio}</Text>
        )}

        {/* Stats */}
        <View style={styles.stats}>
          <StatBadge
            value={formatCount(profile?.followerCount ?? 0)}
            label="Followers"
          />
          <View style={styles.statDivider} />
          <StatBadge
            value={formatCount(profile?.followingCount ?? 0)}
            label="Following"
          />
          <View style={styles.statDivider} />
          <StatBadge
            value={formatCount(profile?.signalCount ?? 0)}
            label="Signals"
          />
          <View style={styles.statDivider} />
          <StatBadge
            value={profile?.trustScore != null ? `${Math.round(profile.trustScore * 100)}%` : '—'}
            label="Trust"
          />
        </View>

        {/* Account type badge */}
        <View style={styles.accountTypeBadge}>
          <Text style={styles.accountTypeText}>
            {(profile?.accountType ?? 'community').toUpperCase()}
          </Text>
        </View>

        {/* Edit profile button */}
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => Alert.alert('Edit Profile', 'Profile editing coming soon.')}
          activeOpacity={0.7}
        >
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Settings items */}
      <Text style={styles.sectionLabel}>SETTINGS</Text>
      <View style={styles.settingsCard}>
        {SETTINGS_ITEMS.map((item, index) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.settingItem, index < SETTINGS_ITEMS.length - 1 && styles.settingItemBorder]}
            onPress={() => Alert.alert(item.label, `${item.label} settings coming soon.`)}
            activeOpacity={0.7}
          >
            <Text style={styles.settingIcon}>{item.icon}</Text>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>{item.label}</Text>
              <Text style={styles.settingSublabel}>{item.sublabel}</Text>
            </View>
            <Text style={styles.settingArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleLogout} activeOpacity={0.7}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>WorldPulse v0.1.0 · Open Source</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: COLORS.amber,
    marginBottom: 4,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.amber,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedBadge: {
    color: COLORS.cyan,
    fontSize: 16,
  },
  handle: {
    fontSize: 14,
    color: COLORS.text2,
  },
  bio: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
    marginTop: 4,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.border,
  },
  accountTypeBadge: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  accountTypeText: {
    fontSize: 10,
    color: COLORS.amber,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'monospace',
  },
  editButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editButtonText: {
    color: COLORS.text2,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text3,
    letterSpacing: 2,
    fontFamily: 'monospace',
    marginBottom: 8,
    marginTop: 8,
  },
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  settingItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  settingText: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  settingSublabel: {
    fontSize: 12,
    color: COLORS.text3,
  },
  settingArrow: {
    fontSize: 18,
    color: COLORS.text3,
  },
  signOutButton: {
    marginTop: 16,
    backgroundColor: 'rgba(255,59,92,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,92,0.2)',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signOutText: {
    color: COLORS.red,
    fontWeight: '700',
    fontSize: 14,
  },
  version: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
  },
})

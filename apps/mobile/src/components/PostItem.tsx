import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native'
import { type Post } from '@/lib/api'

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

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

type Props = {
  post: Post
  onReply?: (id: string) => void
  onLike?: (id: string) => void
  onBoost?: (id: string) => void
}

export function PostItem({ post, onReply, onLike, onBoost }: Props) {
  return (
    <View style={styles.container}>
      {/* Avatar + author */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          {post.author.avatarUrl ? (
            <Image source={{ uri: post.author.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>
                {post.author.displayName?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.authorInfo}>
          <View style={styles.authorRow}>
            <Text style={styles.authorName}>{post.author.displayName}</Text>
            {post.author.verified && (
              <Text style={styles.verifiedIcon}> ✓</Text>
            )}
          </View>
          <Text style={styles.authorHandle}>@{post.author.handle}</Text>
        </View>

        <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
      </View>

      {/* Content */}
      <Text style={styles.content}>{post.content}</Text>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onLike?.(post.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>❤️</Text>
          <Text style={styles.actionCount}>{formatCount(post.likeCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onReply?.(post.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionCount}>{formatCount(post.replyCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onBoost?.(post.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>🔁</Text>
          <Text style={styles.actionCount}>{formatCount(post.boostCount)}</Text>
        </TouchableOpacity>

        {post.reliabilityScore != null && (
          <View style={styles.reliabilityDots}>
            {Array(5).fill(0).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i < Math.floor(post.reliabilityScore! * 5)
                        ? COLORS.green
                        : i < Math.ceil(post.reliabilityScore! * 5)
                          ? COLORS.amber
                          : COLORS.s2,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 10,
  },
  avatarContainer: {},
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.s2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.amber,
  },
  authorInfo: {
    flex: 1,
    gap: 1,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedIcon: {
    fontSize: 13,
    color: COLORS.cyan,
  },
  authorHandle: {
    fontSize: 12,
    color: COLORS.text3,
  },
  time: {
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  content: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  actionIcon: {
    fontSize: 13,
  },
  actionCount: {
    fontSize: 12,
    color: COLORS.text3,
  },
  reliabilityDots: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    marginLeft: 'auto',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
})

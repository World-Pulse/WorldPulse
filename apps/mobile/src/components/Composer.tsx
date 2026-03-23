import { useState, useRef } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert,
} from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'

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
}

const MAX_CHARS = 500

type Props = {
  visible: boolean
  onClose: () => void
  signalId?: string
  placeholder?: string
}

export function Composer({ visible, onClose, signalId, placeholder }: Props) {
  const [content, setContent] = useState('')
  const inputRef = useRef<TextInput>(null)
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const mutation = useMutation({
    mutationFn: () =>
      postsApi.create({ content: content.trim(), signalId, postType: signalId ? 'thread' : 'thread' }),
    onSuccess: () => {
      setContent('')
      onClose()
      if (signalId) {
        queryClient.invalidateQueries({ queryKey: ['signal-posts', signalId] })
      }
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message || 'Failed to post')
    },
  })

  const remaining = MAX_CHARS - content.length
  const isOverLimit = remaining < 0
  const canPost = content.trim().length > 0 && !isOverLimit && !mutation.isPending

  function handleClose() {
    if (content.trim().length > 0) {
      Alert.alert(
        'Discard post?',
        'Your draft will be lost.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => { setContent(''); onClose() } },
        ],
      )
    } else {
      onClose()
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          <TouchableOpacity
            style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
            onPress={() => mutation.mutate()}
            disabled={!canPost}
          >
            {mutation.isPending ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={[styles.postBtnText, !canPost && styles.postBtnTextDisabled]}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Author row */}
        <View style={styles.authorRow}>
          <View style={styles.authorAvatar}>
            <Text style={styles.authorAvatarText}>
              {(user?.displayName ?? 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.authorName}>{user?.displayName ?? 'You'}</Text>
        </View>

        {/* Text input */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={content}
          onChangeText={setContent}
          placeholder={placeholder ?? "What's happening in the world?"}
          placeholderTextColor={COLORS.text3}
          multiline
          autoFocus
          maxLength={MAX_CHARS + 50}
          scrollEnabled
        />

        {/* Footer */}
        <View style={styles.footer}>
          {signalId && (
            <View style={styles.signalTag}>
              <Text style={styles.signalTagText}>📡 Replying to signal</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text style={[styles.charCount, isOverLimit && styles.charCountOver]}>
            {remaining}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cancelBtn: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  cancelText: {
    fontSize: 15,
    color: COLORS.text2,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  postBtn: {
    backgroundColor: COLORS.amber,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  postBtnDisabled: {
    opacity: 0.4,
  },
  postBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  postBtnTextDisabled: {
    color: '#000',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  authorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.s2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  signalTag: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  signalTagText: {
    fontSize: 12,
    color: '#00d4ff',
    fontWeight: '600',
  },
  charCount: {
    fontSize: 13,
    color: COLORS.text3,
    fontVariant: ['tabular-nums'],
  },
  charCountOver: {
    color: COLORS.red,
  },
})

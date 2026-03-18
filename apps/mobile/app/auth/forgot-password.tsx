import { useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'

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
  green:   '#00e676',
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit() {
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      // Always show success to prevent email enumeration
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>📧</Text>
        <Text style={styles.successTitle}>Check your email</Text>
        <Text style={styles.successText}>
          If an account exists for {email}, we've sent a password reset link.
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>← Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>
          Enter your email and we'll send you a link to reset your password.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={[styles.input, !!error && styles.inputError]}
            value={email}
            onChangeText={text => { setEmail(text); setError('') }}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
          />
          {!!error && <Text style={styles.fieldError}>{error}</Text>}
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.submitButtonText}>Send Reset Link</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content:   { flex: 1, padding: 24, paddingTop: 40 },

  backLink: { marginBottom: 32 },
  backLinkText: { fontSize: 15, color: COLORS.text2 },

  title: { fontSize: 26, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.text2, lineHeight: 20, marginBottom: 28 },

  fieldGroup: { marginBottom: 20 },
  label: { fontSize: 10, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.s2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 15,
  },
  inputError: { borderColor: COLORS.red },
  fieldError: { color: COLORS.red, fontSize: 12, marginTop: 4 },

  submitButton: {
    backgroundColor: COLORS.amber, borderRadius: 10, paddingVertical: 14, alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#000', fontWeight: '700', fontSize: 15 },

  successContainer: {
    flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center',
    padding: 32, gap: 16,
  },
  successIcon: { fontSize: 48 },
  successTitle: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  successText: { fontSize: 14, color: COLORS.text2, textAlign: 'center', lineHeight: 21 },
  backButton: {
    marginTop: 16, paddingHorizontal: 24, paddingVertical: 11,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  backButtonText: { color: COLORS.amber, fontWeight: '600', fontSize: 14 },
})

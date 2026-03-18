import { useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native'
import { Link, useRouter } from 'expo-router'
import { useAuthStore } from '@/lib/auth'

const COLORS = {
  bg:      '#06070d',
  surface: '#0d0f18',
  s2:      '#141722',
  border:  'rgba(255,255,255,0.07)',
  borderBright: 'rgba(255,255,255,0.15)',
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  red:     '#ff3b5c',
  cyan:    '#00d4ff',
}

export default function LoginScreen() {
  const router = useRouter()
  const { login, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' })

  function validate(): boolean {
    const errors = { email: '', password: '' }
    if (!email.trim()) errors.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email'
    if (!password) errors.password = 'Password is required'
    setFieldErrors(errors)
    return !errors.email && !errors.password
  }

  async function handleLogin() {
    clearError()
    if (!validate()) return
    try {
      await login(email.trim().toLowerCase(), password)
      router.replace('/(tabs)/')
    } catch { /* error handled in store */ }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoDot} />
          <Text style={styles.logoText}>
            WORLD<Text style={styles.logoAccent}>PULSE</Text>
          </Text>
          <Text style={styles.logoTagline}>The world in real time</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardSubtitle}>Track global events in real time</Text>

          {/* Global error */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.email && styles.inputError]}
              value={email}
              onChangeText={text => { setEmail(text); setFieldErrors(p => ({ ...p, email: '' })) }}
              placeholder="you@example.com"
              placeholderTextColor={COLORS.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
            />
            {!!fieldErrors.email && <Text style={styles.fieldError}>{fieldErrors.email}</Text>}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>PASSWORD</Text>
              <Link href="/auth/forgot-password" asChild>
                <TouchableOpacity activeOpacity={0.7}>
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </TouchableOpacity>
              </Link>
            </View>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, !!fieldErrors.password && styles.inputError]}
                value={password}
                onChangeText={text => { setPassword(text); setFieldErrors(p => ({ ...p, password: '' })) }}
                placeholder="Your password"
                placeholderTextColor={COLORS.text3}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
            {!!fieldErrors.password && <Text style={styles.fieldError}>{fieldErrors.password}</Text>}
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Register link */}
        <View style={styles.registerRow}>
          <Text style={styles.registerText}>Don't have an account? </Text>
          <Link href="/auth/register" asChild>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.registerLink}>Join free →</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content:   { flexGrow: 1, padding: 24, justifyContent: 'center', minHeight: '100%' },

  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logoDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.red,
    marginBottom: 10,
    shadowColor: COLORS.red, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 10,
  },
  logoText: {
    fontSize: 36, fontWeight: '900', letterSpacing: 4, color: COLORS.text,
  },
  logoAccent: { color: COLORS.amber },
  logoTagline: { fontSize: 13, color: COLORS.text2, marginTop: 6, letterSpacing: 1 },

  card: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 16, padding: 24,
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  cardSubtitle: { fontSize: 14, color: COLORS.text2, marginBottom: 20 },

  errorBanner: {
    backgroundColor: 'rgba(255,59,92,0.1)', borderWidth: 1, borderColor: 'rgba(255,59,92,0.3)',
    borderRadius: 8, padding: 12, marginBottom: 14,
  },
  errorBannerText: { color: COLORS.red, fontSize: 13 },

  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 10, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  forgotLink: { fontSize: 12, color: COLORS.amber },
  input: {
    backgroundColor: COLORS.s2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 15,
  },
  inputError: { borderColor: COLORS.red },
  passwordWrapper: { position: 'relative' },
  passwordInput: { paddingRight: 44 },
  eyeButton: { position: 'absolute', right: 12, top: 12 },
  eyeIcon: { fontSize: 16 },
  fieldError: { color: COLORS.red, fontSize: 12, marginTop: 4 },

  submitButton: {
    backgroundColor: COLORS.amber, borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 6,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#000', fontWeight: '700', fontSize: 15 },

  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  registerText: { fontSize: 14, color: COLORS.text2 },
  registerLink: { fontSize: 14, color: COLORS.amber, fontWeight: '600' },
})

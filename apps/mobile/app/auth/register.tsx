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
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  red:     '#ff3b5c',
  green:   '#00e676',
}

export default function RegisterScreen() {
  const router = useRouter()
  const { register, isLoading, error, clearError } = useAuthStore()

  const [form, setForm] = useState({
    handle: '',
    displayName: '',
    email: '',
    password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleChange(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (fieldErrors[key]) setFieldErrors(prev => ({ ...prev, [key]: '' }))
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!form.handle.trim() || form.handle.length < 3) {
      errors.handle = 'Username must be at least 3 characters'
    } else if (!/^[a-zA-Z0-9_]+$/.test(form.handle)) {
      errors.handle = 'Only letters, numbers, and underscores'
    }
    if (!form.displayName.trim()) errors.displayName = 'Display name is required'
    if (!form.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email address'
    }
    if (!form.password) {
      errors.password = 'Password is required'
    } else if (form.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleRegister() {
    clearError()
    if (!validate()) return
    try {
      await register(
        form.handle.toLowerCase().trim(),
        form.displayName.trim(),
        form.email.trim().toLowerCase(),
        form.password,
      )
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
          <Text style={styles.logoTagline}>Join the open intelligence network</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create account</Text>
          <Text style={styles.cardSubtitle}>Free forever. No ads. Open source.</Text>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          {/* Handle */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>USERNAME</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.handle && styles.inputError]}
              value={form.handle}
              onChangeText={text => handleChange('handle', text)}
              placeholder="yourhandle"
              placeholderTextColor={COLORS.text3}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            {!!fieldErrors.handle && <Text style={styles.fieldError}>{fieldErrors.handle}</Text>}
          </View>

          {/* Display name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>DISPLAY NAME</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.displayName && styles.inputError]}
              value={form.displayName}
              onChangeText={text => handleChange('displayName', text)}
              placeholder="Your Name"
              placeholderTextColor={COLORS.text3}
              returnKeyType="next"
            />
            {!!fieldErrors.displayName && <Text style={styles.fieldError}>{fieldErrors.displayName}</Text>}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.email && styles.inputError]}
              value={form.email}
              onChangeText={text => handleChange('email', text)}
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
            <Text style={styles.label}>PASSWORD</Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, !!fieldErrors.password && styles.inputError]}
                value={form.password}
                onChangeText={text => handleChange('password', text)}
                placeholder="Choose a strong password"
                placeholderTextColor={COLORS.text3}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
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

          {/* Terms notice */}
          <Text style={styles.termsNotice}>
            By joining, you agree to our Terms of Service and Privacy Policy.
          </Text>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.submitButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login link */}
        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <Link href="/auth/login" asChild>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.loginLink}>Sign in →</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content:   { flexGrow: 1, padding: 24, justifyContent: 'center', paddingBottom: 40 },

  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.red, marginBottom: 10,
    shadowColor: COLORS.red, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 10,
  },
  logoText: { fontSize: 32, fontWeight: '900', letterSpacing: 4, color: COLORS.text },
  logoAccent: { color: COLORS.amber },
  logoTagline: { fontSize: 13, color: COLORS.text2, marginTop: 6, letterSpacing: 0.5 },

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

  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 10, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 6 },
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

  termsNotice: { fontSize: 12, color: COLORS.text3, textAlign: 'center', marginBottom: 16, lineHeight: 17 },

  submitButton: {
    backgroundColor: COLORS.amber, borderRadius: 10, paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#000', fontWeight: '700', fontSize: 15 },

  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  loginText: { fontSize: 14, color: COLORS.text2 },
  loginLink: { fontSize: 14, color: COLORS.amber, fontWeight: '600' },
})

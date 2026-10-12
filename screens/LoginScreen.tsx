import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton } from '../components/UI';

// notice: a message from App.tsx shown above the form — e.g. after a
// deactivated account was signed out (Add_user_deactivation.sql).
export default function LoginScreen({
  notice,
  onLoginAttempt,
}: {
  notice?: string | null;
  onLoginAttempt?: () => void;
} = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    onLoginAttempt?.();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase reports a blocked (deactivated) login as "User is banned".
      setError(
        /banned/i.test(error.message)
          ? 'This account has been deactivated. Contact your administrator if you think this is a mistake.'
          : error.message
      );
    }
    setLoading(false);
  };

  return (
    <View style={styles.center}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>DW</Text>
        </View>
        <Text style={styles.title}>DocWire</Text>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <View style={styles.passwordWrap}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Password"
          placeholderTextColor={colors.textFaint}
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword((s) => !s)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name={showPassword ? 'eye-off' : 'eye'} size={17} color={colors.textFaint} />
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={colors.orange} /> : <PrimaryButton title="Log in" onPress={handleLogin} fullWidth />}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  brandMark: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    width: '100%',
    maxWidth: 360,
    marginBottom: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  passwordWrap: { width: '100%', maxWidth: 360, marginBottom: 12, position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 40, marginBottom: 0 },
  eyeButton: { position: 'absolute', right: 12, height: '100%', justifyContent: 'center' },
  error: { color: colors.danger, marginBottom: 8, maxWidth: 360, textAlign: 'center' },
  notice: { color: colors.danger, marginBottom: 14, maxWidth: 360, textAlign: 'center', fontSize: 13 },
});
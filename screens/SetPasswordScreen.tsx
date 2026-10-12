// LOCATION: docwire-app/screens/SetPasswordScreen.tsx (NEW FILE)
//
// Shown instead of the app when users.must_change_password is true
// (Add_password_change.sql) — every account created after that file was
// run, until the person sets their own password. App.tsx decides when.
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { ChangePasswordForm } from '../components/ChangePasswordForm';

export default function SetPasswordScreen({
  name,
  onDone,
  onLogout,
}: {
  name: string | null;
  onDone: () => void;
  onLogout: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.outer} keyboardShouldPersistTaps="handled">
      <View style={styles.box}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>DW</Text>
          </View>
          <Text style={styles.brand}>DocWire</Text>
        </View>
        <Text style={styles.title}>Set your password</Text>
        <Text style={styles.text}>
          {name ? `Welcome, ${name}. ` : 'Welcome. '}
          You signed in with a temporary password. Please choose your own password to continue.
        </Text>
        <ChangePasswordForm mode="forced" onDone={onDone} />
        <TouchableOpacity onPress={onLogout} style={styles.logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
  box: { width: '100%', maxWidth: 360 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 24 },
  brandMark: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  brand: { fontSize: 24, fontWeight: '700', color: colors.text },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 },
  text: { fontSize: 13, color: colors.textDim, marginBottom: 18, lineHeight: 19 },
  logout: { alignSelf: 'center', marginTop: 22, padding: 6 },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
});
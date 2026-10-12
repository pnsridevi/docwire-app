// LOCATION: docwire-app/components/ChangePasswordForm.tsx (NEW FILE)
//
// One form, two uses (Add_password_change.sql):
//   mode 'forced' — first login with a temporary password
//                   (screens/SetPasswordScreen.tsx). New + confirm only.
//   mode 'normal' — "Change password" from the avatar menu, any role
//                   (ChangePasswordModal below, opened from App.tsx).
//                   Current + new + confirm.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Modal, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { PrimaryButton } from './UI';
import { changePassword, checkNewPassword, MIN_PASSWORD_LENGTH } from '../lib/password';

function PasswordField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.textFaint}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShow((s) => !s)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name={show ? 'eye-off' : 'eye'} size={17} color={colors.textFaint} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ChangePasswordForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: 'forced' | 'normal';
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const problem = checkNewPassword(next, confirm, mode === 'normal' ? current : undefined);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    const message = await changePassword(next, mode === 'normal' ? current : undefined);
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    if (mode === 'forced') {
      onDone();
    } else {
      setDone(true);
    }
  };

  if (done) {
    return (
      <View>
        <Text style={styles.success}>Your password has been changed.</Text>
        <Text style={styles.hint}>You stay signed in here. Any other device signed in to this account has been signed out.</Text>
        <View style={styles.buttonRow}>
          <PrimaryButton title="Close" onPress={onDone} />
        </View>
      </View>
    );
  }

  return (
    <View>
      {mode === 'normal' && <PasswordField label="Current password" value={current} onChangeText={setCurrent} />}
      <PasswordField label="New password" value={next} onChangeText={setNext} />
      <PasswordField label="Confirm new password" value={confirm} onChangeText={setConfirm} />
      <Text style={styles.hint}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttonRow}>
        {saving ? (
          <ActivityIndicator color={colors.orange} />
        ) : (
          <>
            <PrimaryButton title={mode === 'forced' ? 'Save and continue' : 'Change password'} onPress={submit} />
            {onCancel && (
              <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// The dialog behind the avatar menu's "Change password". A new form each
// time it opens (unmounted while closed), so old typing never lingers.
export function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.backdropContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Change password</Text>
            {visible && <ChangePasswordForm mode="normal" onDone={onClose} onCancel={onClose} />}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12, width: '100%' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textDim, marginBottom: 6 },
  inputWrap: { position: 'relative', justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    paddingRight: 40,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  eyeButton: { position: 'absolute', right: 12, height: '100%', justifyContent: 'center' },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 10 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 10 },
  success: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  cancelBtn: { paddingVertical: 8 },
  cancelText: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  backdropContent: { flexGrow: 1, alignItems: 'center', paddingTop: 70, paddingBottom: 40, paddingHorizontal: 16 },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
});
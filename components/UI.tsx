import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, statusStyle } from '../theme/colors';

export function Pill({ status }: { status: string }) {
  const s = statusStyle(status);
  return (
    <View style={[styles.pill, { backgroundColor: s.background }]}>
      <Text style={[styles.pillText, { color: s.color }]}>{status}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.btn, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.btnText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function OutlineButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.btnOutline} onPress={onPress}>
      <Text style={styles.btnOutlineText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 9 },
  pillText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  btn: {
    backgroundColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnOutline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  btnOutlineText: { color: colors.text, fontWeight: '600', fontSize: 12 },
});

import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, statusStyle } from '../theme/colors';

// Wide breakpoint: above this, we're being viewed on a desktop browser
// (via `npx expo start` -> press w, or the deployed Vercel build) rather
// than a phone. Constrains content to a comfortable reading width and
// centers it, instead of letting mobile-style full-bleed rows stretch
// edge-to-edge across a wide window.
const WIDE_BREAKPOINT = 768;
const CONTENT_MAX_WIDTH = 720;

export function useIsWide() {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

export function ScreenContainer({ children }: { children: React.ReactNode }) {
  const isWide = useIsWide();
  return (
    <View style={[styles.outer, isWide && styles.outerWide]}>
      <View style={[styles.inner, isWide && { maxWidth: CONTENT_MAX_WIDTH, width: '100%' }]}>
        {children}
      </View>
    </View>
  );
}

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

// Small destructive-leaning outline button — used for "Send to Rework".
export function DangerOutlineButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.btnDangerOutline} onPress={onPress}>
      <Text style={styles.btnDangerOutlineText}>{title}</Text>
    </TouchableOpacity>
  );
}

// Inline comment box used when a Manager sends a document to Rework.
export function CommentBox({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <TextInput
      style={styles.commentInput}
      placeholder={placeholder ?? 'Add a comment...'}
      placeholderTextColor={colors.textFaint}
      value={value}
      onChangeText={onChangeText}
      multiline
    />
  );
}

// Top-level section switcher (Documents / Tasks / Team). Deliberately not
// a routing library — just local state in App.tsx — so switching sections
// never requires a native rebuild, only `eas update`.
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => onChange(tab)}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Tap-to-select chip group — used for priority and assignee pickers so we
// avoid pulling in a native <Picker> dependency (which would force a full
// `eas build` instead of a JS-only `eas update`).
export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.chip, isActive && styles.chipActive]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.bg },
  outerWide: { alignItems: 'center' },
  inner: { flex: 1 },
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
  btnDangerOutline: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  btnDangerOutlineText: { color: colors.danger, fontWeight: '600', fontSize: 12 },
  commentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
  },
  tabItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: colors.orange },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textFaint },
  tabTextActive: { color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  chipTextActive: { color: '#fff' },
});
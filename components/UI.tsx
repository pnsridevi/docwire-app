import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, statusStyle } from '../theme/colors';

// Wide breakpoint: above this, we're being viewed on a desktop browser
// (via `npx expo start` -> press w, or the deployed Vercel build) rather
// than a phone. Constrains content to a comfortable reading width and
// centers it, instead of letting mobile-style full-bleed rows stretch
// edge-to-edge across a wide window.
const WIDE_BREAKPOINT = 768;
export const CONTENT_MAX_WIDTH = 1080; // enough room for a real 2-column grid on desktop, not just a wider single column
const GRID_BREAKPOINT = 1024; // below this, even on "wide", stack to a single column

export function useIsWide() {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

// Cards/lists use this to decide 1 vs 2 columns on desktop, so extra
// horizontal space gets used for content instead of sitting empty as margin.
export function useGridColumns(): 1 | 2 {
  const { width } = useWindowDimensions();
  return width >= GRID_BREAKPOINT ? 2 : 1;
}

// When a grid has an odd number of items, the last row's single card gets
// pushed to one side by `columnWrapperStyle: { justifyContent: 'space-between' }`,
// leaving a visible dead gap on the other side — the same empty-space
// problem this whole layout pass was meant to fix, just relocated to the
// last row. Padding the data with an invisible spacer keeps the grid
// visually balanced. Returns null for spacer slots — render them as an
// empty, borderless View matching the card width.
export function padForGrid<T>(data: T[], columns: number): (T | null)[] {
  if (columns < 2) return data;
  const remainder = data.length % columns;
  if (remainder === 0) return data;
  return [...data, ...Array(columns - remainder).fill(null)];
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
// Navigation chrome. Same tabs, same onChange contract, same screens behind
// it — only WHERE the nav sits changes by platform:
//   - Desktop/web (isWide): SideNav, a left rail. Carries brand + role +
//     logout too, since on a wide layout there's no separate top header.
//   - Mobile (narrow): BottomTabBar, a fixed row at the bottom. The brand/
//     role/logout stays in App.tsx's top Header on mobile — a bottom bar
//     is for section switching, not account actions.
// App.tsx picks which one to render; the actual screens never know or care
// which nav rendered them — same content, same logic, chrome only differs.
export function SideNav({
  tabs,
  active,
  onChange,
  role,
  onLogout,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
  role: string;
  onLogout: () => void;
}) {
  return (
    <View style={styles.sideNav}>
      <View style={styles.sideBrandRow}>
        <View style={styles.brandMarkSmall}>
          <Text style={styles.brandMarkTextSmall}>DW</Text>
        </View>
        <Text style={styles.sideBrandText}>DocWire</Text>
      </View>
      <View style={styles.sideItems}>
        {tabs.map((tab) => {
          const isActive = tab === active;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.sideItem, isActive && styles.sideItemActive]}
              onPress={() => onChange(tab)}
            >
              <Text style={[styles.sideItemText, isActive && styles.sideItemTextActive]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.sideFooter}>
        <Text style={styles.roleLabel}>Signed in as {role}</Text>
        <OutlineButton title="Log out" onPress={onLogout} />
      </View>
    </View>
  );
}

export function BottomTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <View style={styles.bottomBar}>
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <TouchableOpacity key={tab} style={styles.bottomItem} onPress={() => onChange(tab)}>
            <Text style={[styles.bottomItemText, isActive && styles.bottomItemTextActive]}>{tab}</Text>
            {isActive && <View style={styles.bottomItemDot} />}
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
  // SideNav — desktop/web left rail
  sideNav: {
    width: 220,
    height: '100%',
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 20,
  },
  sideBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 24 },
  sideBrandText: { fontSize: 16, fontWeight: '700', color: colors.text },
  brandMarkSmall: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkTextSmall: { color: '#fff', fontWeight: '700', fontSize: 9 },
  sideItems: { gap: 2 },
  sideItem: {
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  sideItemActive: { borderLeftColor: colors.orange, backgroundColor: colors.surface2 },
  sideItemText: { fontSize: 14, fontWeight: '500', color: colors.textFaint },
  sideItemTextActive: { color: colors.text, fontWeight: '700' },
  sideFooter: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  roleLabel: { color: colors.textDim, fontSize: 13, textTransform: 'capitalize' },
  // BottomTabBar — mobile fixed bottom row
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 8,
  },
  bottomItem: { flex: 1, alignItems: 'center', paddingVertical: 6, gap: 4 },
  bottomItemText: { fontSize: 12, fontWeight: '600', color: colors.textFaint },
  bottomItemTextActive: { color: colors.orange },
  bottomItemDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.orange },
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
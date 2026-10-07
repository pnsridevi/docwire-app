// LOCATION: docwire-app/components/UI.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons'; // ships with Expo — no extra install
import { colors, statusStyle } from '../theme/colors';
import { useIsWide, CONTENT_MAX_WIDTH } from './useBreakpoint';
import { tabIcon } from './navIcons';
import { Role } from '../lib/types';

// SideNav itself now lives in its own file (SideNav.tsx / SideNav.web.tsx)
// so Metro's platform-extension resolution can pick a real-CSS web version
// over the RN one — see SideNav.web.tsx for why. Re-exported here so
// nothing importing SideNav from '../components/UI' needs to change.
export { SideNav } from './SideNav';

// "SJ", "Priya Nair" -> "PN", null -> "?" — same derivation the demo uses
// for its ROLE_USER initials, since Profile has no separate initials field.
function initials(name: string | null): string {
  if (!name || !name.trim()) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// useIsWide, useGridColumns, padForGrid, and CONTENT_MAX_WIDTH used to be
// defined here directly — as two separately-tuned width thresholds, which
// is what created the tablet dead zone (see useBreakpoint.ts for the full
// story). They now live in useBreakpoint.ts as one source of truth and are
// re-exported below unchanged, so nothing importing them from '../components/UI'
// needs to change. New code should import from '../components/useBreakpoint'
// directly, or better, use <ResponsiveGrid> and skip these entirely.
export { useIsWide, useGridColumns, padForGrid, CONTENT_MAX_WIDTH } from './useBreakpoint';

export function ScreenContainer({
  children,
  scroll,
}: {
  children: React.ReactNode;
  // Opt-in: when true, ScreenContainer itself becomes the scrolling
  // element — a full-width ScrollView with the maxWidth-capped content
  // centered inside its content area. This keeps the scrollbar at the
  // true window edge (like any normal web page) while the content
  // column stays readable-width-capped, instead of the scrollbar
  // inheriting the capped box's edge as its boundary. Screens that
  // already own their own ScrollView internally should NOT pass this —
  // it's meant to replace that inner ScrollView, not stack with it.
  // Default (omitted) leaves every existing screen's layout untouched.
  scroll?: boolean;
}) {
  const isWide = useIsWide();
  if (scroll) {
    return (
      <ScrollView
        style={styles.outer}
        contentContainerStyle={[styles.scrollOuterContent, isWide && styles.outerWide]}
      >
        <View style={[styles.inner, isWide && { maxWidth: CONTENT_MAX_WIDTH, width: '100%' }]}>
          {children}
        </View>
      </ScrollView>
    );
  }
  return (
    <View style={[styles.outer, isWide && styles.outerWide]}>
      <View style={[styles.inner, isWide && { maxWidth: CONTENT_MAX_WIDTH, width: '100%' }]}>
        {children}
      </View>
    </View>
  );
}

// Summary counts strip at the top of Documents/Tasks — matches the demo's
// statRow() helper (DocWire_demo_V1.html), which every list screen there
// opens with (Total/Pending/Accounted/Reviewed, Total/In Progress/
// Completed/Overdue, etc). Wraps on narrow screens rather than shrinking
// illegibly.
// Demo's stat cards (DocWire_demo_V1.html, .stat-card .icon-badge) carry a
// small icon badge in the top-right corner — a 30x30 tinted square with a
// role/metric-appropriate icon. `icon` is optional per item so a StatRow
// can still be used without one, but every current call site supplies it.
export function StatRow({ items }: { items: { num: string; label: string; danger?: boolean; icon?: React.ComponentProps<typeof Feather>['name'] }[] }) {
  return (
    <View style={styles.statRow}>
      {items.map((it, i) => (
        <View key={i} style={[styles.statCard, it.icon && styles.statCardWithIcon]}>
          {it.icon && (
            <View style={styles.statIconBadge}>
              <Feather name={it.icon} size={16} color={colors.orangeDeep} />
            </View>
          )}
          <Text style={[styles.statNum, it.danger && styles.statNumDanger]}>{it.num}</Text>
          <Text style={styles.statLabel}>{it.label}</Text>
        </View>
      ))}
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
  fullWidth,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  // Demo's base .btn is `display:inline-flex` — content-sized, not full
  // width. Only .login-card .btn explicitly overrides that to width:100%.
  // Without an explicit width here, React Native's default cross-axis
  // stretch behavior was making every PrimaryButton fill its parent
  // ("Upload document", "Create task") — this prop lets LoginScreen opt
  // into the one case that's actually supposed to be full width.
  fullWidth?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, !fullWidth && styles.btnAuto, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
    >
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

// Human-readable label per role, for the Topbar identity chip.
function roleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    client: 'Client',
    accountant: 'Accountant',
    manager: 'Manager',
    client_admin: 'Client Admin',
    super_admin: 'Super Admin',
  };
  return labels[role] ?? role;
}

// Shared top bar — brand (left) + identity chip (right). Rendered on BOTH
// platforms, identical content either way; only the chrome below it
// differs (SideNav rail on wide, BottomTabBar on narrow).
//
// Previously the avatar doubled as an instant, no-confirm logout control,
// and showed only initials with no indication of which role was signed
// in — both flagged as judgment calls at the time and never actually
// confirmed. Now: the chip shows initials + role label (so it's always
// clear who/what you're logged in as at a glance), and tapping it opens
// an explicit menu with the account identity and a separate "Log out"
// button — tapping the chip itself no longer logs anyone out. This also
// gives mobile a real logout path independent of SideNav's "Log out" item
// (which only renders on wide/tablet+desktop layouts).
export function Topbar({ name, role, orgLabel, onLogout }: { name: string | null; role: Role; orgLabel?: string | null; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View style={styles.topbar}>
      <View style={styles.topbarBrand}>
        <View style={styles.brandMarkSmall}>
          <Text style={styles.brandMarkTextSmall}>DW</Text>
        </View>
        <Text style={styles.topbarBrandText}>DocWire</Text>
        {orgLabel && (
          <>
            <Text style={styles.topbarOrgDivider}>|</Text>
            <Text style={styles.topbarOrgLabel} numberOfLines={1}>{orgLabel}</Text>
          </>
        )}
      </View>
      <TouchableOpacity style={styles.identityChip} onPress={() => setMenuOpen(true)}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <Text style={styles.roleChipText}>{roleLabel(role)}</Text>
      </TouchableOpacity>

      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuName}>{name ?? 'Unnamed'}</Text>
            <Text style={styles.menuRole}>{roleLabel(role)}</Text>
            <TouchableOpacity
              style={styles.menuLogoutBtn}
              onPress={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              <Feather name="log-out" size={14} color={colors.danger} />
              <Text style={styles.menuLogoutText}>Log out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Top-level section switcher (Documents / Tasks / Team). Deliberately not
// identity chrome — brand and the user avatar live in Topbar above, on
// both platforms now. SideNav and BottomTabBar only decide WHICH tab is
// active and WHERE that control sits:
//   - Desktop/web (isWide): SideNav (see SideNav.tsx / SideNav.web.tsx), a
//     left rail — nav items only, plus a "Log out" item at the bottom
//     under its own "Session" section, matching DocWire_demo_V1.html's
//     sidebar exactly (nav-only, no brand, no user identity — that's the
//     topbar's job there too).
//   - Mobile (narrow): BottomTabBar, a fixed row at the bottom.
// App.tsx picks which one to render; the actual screens never know or care
// which nav rendered them — same content, same logic, chrome only differs.
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
            <Feather name={tabIcon(tab)} size={18} color={isActive ? colors.orange : colors.textFaint} />
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
  // contentContainerStyle for ScreenContainer's scroll mode — flexGrow so
  // short content still fills the viewport height, paddingBottom so the
  // last item has breathing room (matches the 40px the old per-screen
  // ScrollViews used).
  scrollOuterContent: { flexGrow: 1, paddingBottom: 40 },
  inner: { flex: 1 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: {
    flexGrow: 1,
    minWidth: 120,
    maxWidth: 240,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    position: 'relative',
  },
  // Extra right padding only when an icon badge is present, so a wide
  // number (e.g. "5 of 5") doesn't run underneath it — the demo's fixed
  // 4-column grid never had this problem, but our flex-wrap cards can be
  // narrower.
  statCardWithIcon: { paddingRight: 44 },
  statIconBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNum: { fontSize: 20, fontWeight: '700', color: colors.text },
  statNumDanger: { color: colors.danger },
  statLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  pill: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 9 },
  pillText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  btn: {
    backgroundColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  btnAuto: { alignSelf: 'flex-start' },
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
  // Topbar — shared brand + avatar strip, both platforms. Sizes match
  // DocWire_demo_V1.html's .topbar/.brand/.user-chip .avatar exactly
  // (58px tall, 28px brand mark and avatar).
  topbar: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topbarBrand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  topbarBrandText: { fontSize: 17, fontWeight: '700', color: colors.text },
  topbarOrgDivider: { fontSize: 16, color: colors.border, marginHorizontal: -2 },
  // Bold, but visually secondary to the DocWire wordmark itself (slightly
  // smaller, uses the theme's accent color instead of primary text) —
  // this is the firm/org identity, not the product's own brand.
  topbarOrgLabel: { fontSize: 15, fontWeight: '700', color: colors.orangeDeep, maxWidth: 260 },
  brandMarkSmall: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkTextSmall: { color: '#fff', fontWeight: '700', fontSize: 12 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  identityChip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleChipText: { fontSize: 12.5, fontWeight: '600', color: colors.textDim },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'flex-end' },
  menuCard: {
    marginTop: 66, // clears the 58px topbar plus a small gap
    marginRight: 20,
    minWidth: 160,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    // subtle elevation so it reads as a floating menu, not part of the page
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  menuName: { fontSize: 14, fontWeight: '700', color: colors.text },
  menuRole: { fontSize: 12, color: colors.textFaint, marginTop: 2, marginBottom: 10 },
  menuLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuLogoutText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
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
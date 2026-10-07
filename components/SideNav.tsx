import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { tabIcon } from './navIcons';
import { NavTab, makeActiveTab, splitActiveTab } from './navTypes';

// Native rendering of SideNav (iOS/Android — used when a native device is
// wide enough, e.g. a tablet). Metro resolves any `import ... from
// './SideNav'` to THIS file on native and to SideNav.web.tsx on web
// automatically, based on file extension — same import path everywhere,
// UI.tsx just re-exports whichever one got picked. See SideNav.web.tsx for
// why a separate web version exists (real CSS :hover, which RN can't do).
//
// `tabs` is now NavTab[] rather than string[] (this session's change) —
// a tab with `children` renders as a small section header plus an
// indented, always-expanded list of its children, rather than a flat
// item. Only Super Admin's 'Users' tab uses this today (its three
// subtabs), but any future tab can opt in the same way. `active` is a
// plain label for a childless tab ('Documents') or a composite
// 'Parent::Child' key for a selected child ('Users::Assignments') — see
// navTypes.ts.
export function SideNav({
  tabs,
  active,
  onChange,
}: {
  tabs: NavTab[];
  active: string;
  onChange: (tab: string) => void;
}) {
  const { parent: activeParent, child: activeChild } = splitActiveTab(active);

  return (
    <View style={styles.sideNav}>
      <Text style={styles.sideLabel}>Workspace</Text>
      <View style={styles.sideItems}>
        {tabs.map((tab) => {
          if (!tab.children || tab.children.length === 0) {
            const isActive = tab.label === activeParent && !activeChild;
            return (
              <TouchableOpacity
                key={tab.label}
                style={[styles.sideItem, isActive && styles.sideItemActive]}
                onPress={() => onChange(tab.label)}
              >
                <Feather name={tabIcon(tab.label)} size={16} color={isActive ? colors.sidebarTextActive : colors.sidebarText} />
                <Text style={[styles.sideItemText, isActive && styles.sideItemTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          }

          // Section header — clicking it shows the parent's own default
          // view (no child selected), same as any other top-level tab.
          // Previously this jumped straight to the first child instead,
          // which made sense when a group's children fully replaced its
          // content — it broke once Users got a real default view
          // (the overview) plus just one child ('Add'): clicking "Users"
          // always landed on Add and the overview was unreachable except
          // via Add's own "back" button.
          const isParentActive = tab.label === activeParent;
          return (
            <View key={tab.label}>
              <TouchableOpacity
                style={[styles.sideItem, isParentActive && !activeChild && styles.sideItemActive]}
                onPress={() => onChange(tab.label)}
              >
                <Feather name={tabIcon(tab.label)} size={16} color={isParentActive ? colors.sidebarTextActive : colors.sidebarText} />
                <Text style={[styles.sideItemText, isParentActive && styles.sideItemTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
              {tab.children.map((child) => {
                const key = makeActiveTab(tab.label, child);
                const isActive = isParentActive && activeChild === child;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.sideItem, styles.sideItemNested, isActive && styles.sideItemActive]}
                    onPress={() => onChange(key)}
                  >
                    <Feather name={tabIcon(child)} size={13} color={isActive ? colors.sidebarTextActive : colors.sidebarText} />
                    <Text style={[styles.sideItemNestedText, isActive && styles.sideItemTextActive]}>{child}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>
      {/* Session/Log out used to live here, pinned to the bottom via a
          flex:1 spacer. Removed for consistency with the web version —
          logout lives in the Topbar avatar menu (top-right, both
          platforms) now, so there's one working path instead of two. */}
    </View>
  );
}

// Colors and spacing match the demo's .sidebar/.side-label/.nav-item rules
// exactly — orange fill, brown text, dark-brown active state.
const styles = StyleSheet.create({
  sideNav: {
    width: 212,
    height: '100%',
    backgroundColor: colors.sidebar,
    paddingVertical: 18,
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.sidebarLabel,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  sideItems: { gap: 2 },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  sideItemActive: { borderLeftColor: colors.sidebarTextActive, backgroundColor: colors.sidebarActiveOverlay },
  sideItemText: { fontSize: 13.5, fontWeight: '500', color: colors.sidebarText },
  sideItemTextActive: { color: colors.sidebarTextActive, fontWeight: '700' },
  // Nested child row — indented past the parent's icon column (16px icon
  // + 10px gap + 20px padding ≈ 46px) so it reads as "inside" Users
  // rather than a sibling of it.
  sideItemNested: { paddingLeft: 46, paddingVertical: 7 },
  sideItemNestedText: { fontSize: 12.5, fontWeight: '500', color: colors.sidebarText },
  sideSession: { marginTop: 18 },
});
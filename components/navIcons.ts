// LOCATION: docwire-app/components/navIcons.ts
import { ComponentProps } from 'react';
import { Feather } from '@expo/vector-icons';

export type FeatherIconName = ComponentProps<typeof Feather>['name'];

// Icon per nav tab, keyed by the exact tab label used throughout the app
// (see TABS_BY_ROLE in App.tsx). Mirrors the demo's NAV/icon() assignments
// in DocWire_demo_V1.html, mapped onto the closest Feather glyph. One
// source of truth so SideNav.tsx, SideNav.web.tsx, and BottomTabBar (in
// UI.tsx) can't drift into showing different icons per platform.
const TAB_ICONS: Record<string, FeatherIconName> = {
  Documents: 'file-text',
  Tasks: 'check-square',
  Team: 'users',
  Users: 'user-plus',
  // Master Documents — 'archive' reads as "permanent records", distinct
  // from Documents' day-to-day 'file-text'.
  'Master Docs': 'archive',
  // Chat (Add_chat.sql).
  Chat: 'message-circle',
  // Nested child under 'Users' (see SideNav.tsx) — its own icon so a
  // single-item nested list doesn't just read as unlabeled indented text.
  Add: 'plus-circle',
};

export function tabIcon(tab: string): FeatherIconName {
  return TAB_ICONS[tab] ?? 'circle';
}
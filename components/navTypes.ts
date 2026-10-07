// LOCATION: docwire-app/components/navTypes.ts (NEW FILE)

// A top-level nav item. `children`, when present, renders as a nested
// list under this item in SideNav (desktop/tablet) — added this session
// so Super Admin's Users tab can show its three subtabs (Client Orgs &
// Admins / Managers & Accountants / Assignments) directly in the left
// pane instead of as a switcher inside the content area.
//
// BottomTabBar (mobile) intentionally does NOT understand `children` —
// there's no room for a nested list in a bottom bar, and mobile keeps the
// in-content switcher (SuperAdminUsersScreen's own ChipSelect, rendered
// only when it isn't being driven by a nested SideNav selection). See
// App.tsx for how the two are reconciled.
export type NavTab = {
  label: string;
  children?: string[];
};

// A composite active-tab key used for a nested selection, e.g.
// 'Users::Assignments'. Plain top-level tabs (no children) just use their
// own label with no separator, e.g. 'Documents'.
export function splitActiveTab(active: string): { parent: string; child?: string } {
  const sepIndex = active.indexOf('::');
  if (sepIndex === -1) return { parent: active };
  return { parent: active.slice(0, sepIndex), child: active.slice(sepIndex + 2) };
}

export function makeActiveTab(parent: string, child?: string): string {
  return child ? `${parent}::${child}` : parent;
}
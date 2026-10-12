// LOCATION: docwire-app/App.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase, supabaseConfigError } from './lib/supabase';
import { colors } from './theme/colors';
import { useIsWide, Topbar, SideNav, BottomTabBar } from './components/UI';
import { NavTab, splitActiveTab } from './components/navTypes';
import { ensureGlobalWebStyles } from './components/webGlobalStyles';
import { Profile } from './lib/types';
import LoginScreen from './screens/LoginScreen';
import ClientHomeScreen from './screens/ClientHomeScreen';
import AccountantHomeScreen from './screens/AccountantHomeScreen';
import ManagerHomeScreen from './screens/ManagerHomeScreen';
import TasksScreen from './screens/TasksScreen';
import AccountantAssignmentScreen from './screens/AccountantAssignmentScreen';
import ManagerAssignmentScreen from './screens/ManagerAssignmentScreen';
import SuperAdminUsersScreen from './screens/SuperAdminUsersScreen';
import SuperAdminDocumentsScreen from './screens/SuperAdminDocumentsScreen';
import SuperAdminTasksScreen from './screens/SuperAdminTasksScreen';
import ClientAdminUsersScreen from './screens/ClientAdminUsersScreen';
import ClientAdminDocumentsScreen from './screens/ClientAdminDocumentsScreen';
import ClientAdminTasksScreen from './screens/ClientAdminTasksScreen';
import MasterDocsScreen from './screens/MasterDocsScreen';
import SetPasswordScreen from './screens/SetPasswordScreen';
import { ChangePasswordModal } from './components/ChangePasswordForm';

const TABS_BY_ROLE: Record<string, NavTab[]> = {
  // 'Master Docs' (Add_master_documents.sql) — every role gets it, placed
  // right after Tasks. Short label on purpose: Manager/Accountant's mobile
  // BottomTabBar now holds four items, and "Master Documents" doesn't fit
  // a quarter of a phone's width.
  client: [{ label: 'Documents' }, { label: 'Tasks' }, { label: 'Master Docs' }],
  // Accountant's own symmetric Team tab (ManagerAssignmentScreen.tsx) —
  // added this session alongside Manager's, same read-only shape, other
  // column (Client | Organisation | Manager instead of Accountant).
  accountant: [{ label: 'Documents' }, { label: 'Tasks' }, { label: 'Master Docs' }, { label: 'Team' }],
  manager: [{ label: 'Documents' }, { label: 'Tasks' }, { label: 'Master Docs' }, { label: 'Team' }],
  // Read-only Documents/Tasks views (their own screens, not the
  // Client/Manager/Accountant ones — different scope and no actions) plus
  // a single Users tab. Originally had three nested subtabs (Client Orgs
  // & Admins / Managers & Accountants / Assignments) — collapsed this
  // session to a collective overview (the default, no child selected)
  // plus one 'Add' subtab for creation, per direct feedback that three
  // was overcomplicating it. See SuperAdminUsersScreen.tsx.
  super_admin: [
    { label: 'Documents' },
    { label: 'Tasks' },
    { label: 'Master Docs' },
    { label: 'Users', children: ['Add'] },
  ],
  client_admin: [{ label: 'Documents' }, { label: 'Tasks' }, { label: 'Master Docs' }, { label: 'Users' }],
};

// Roles whose identity is the FIRM itself (tenants.firm_name) rather than
// a specific client organization — they have no client_org_id at all.
const FIRM_STAFF_ROLES = new Set(['super_admin', 'manager', 'accountant']);

function AppContent() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Bold header label next to the DocWire brand mark — the firm's name
  // for staff (Super Admin/Manager/Accountant), or the Client's own
  // organization name for client-side users (Client Admin/Client).
  // Nothing in the app surfaced this anywhere before; Topbar is the one
  // place guaranteed to render on every screen regardless of role, so
  // resolving it once here (rather than per-screen) is the only way to
  // avoid duplicating this fetch across 13 files.
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  // Plain label ('Documents') for a childless tab, or a composite
  // 'Parent::Child' key ('Users::Assignments') once a nested SideNav
  // child has been picked — see navTypes.ts.
  const [activeTab, setActiveTab] = useState('Documents');
  const isWide = useIsWide();
  // Shown on the login screen after a deactivated account is signed out
  // (Add_user_deactivation.sql).
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const DEACTIVATED_NOTICE = 'This account has been deactivated. Contact your administrator if you think this is a mistake.';
  // "Change password" dialog, opened from the Topbar's avatar menu
  // (Add_password_change.sql).
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // No-op on native; on web this injects the font-family/height CSS reset
  // once (see webGlobalStyles.ts) — belongs here rather than per-screen
  // since it's an app-wide concern, not a per-component style.
  useEffect(() => {
    ensureGlobalWebStyles();
  }, []);

  const loadProfile = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
    // A deactivated person can still read their own row — exactly so this
    // check can sign them out with a clear message instead of showing
    // empty screens (the database refuses them everything else).
    if ((data as Profile | null)?.deactivated_at) {
      setSignedOutNotice(DEACTIVATED_NOTICE);
      setProfile(null);
      setLoading(false);
      await supabase.auth.signOut();
      return;
    }
    setProfile(data as Profile);
    setLoading(false);
  };

  useEffect(() => {
    loadProfile();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadProfile();
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Resolves the Topbar's org label whenever the signed-in profile
  // changes. Two different tables depending on role (see FIRM_STAFF_ROLES
  // above) — a firm-staff account has no client_org_id to look up, and a
  // client-side account's own org is what actually matters to them, not
  // the tenant's overall firm_name.
  useEffect(() => {
    let cancelled = false;
    const resolveOrgLabel = async () => {
      if (!profile) {
        setOrgLabel(null);
        return;
      }
      if (FIRM_STAFF_ROLES.has(profile.role)) {
        const { data, error } = await supabase.from('tenants').select('firm_name').eq('id', profile.tenant_id).single();
        if (!cancelled) setOrgLabel(error ? null : (data?.firm_name ?? null));
        return;
      }
      if (!profile.client_org_id) {
        if (!cancelled) setOrgLabel(null);
        return;
      }
      const { data, error } = await supabase.from('client_organizations').select('name').eq('id', profile.client_org_id).single();
      if (!cancelled) setOrgLabel(error ? null : (data?.name ?? null));
    };
    resolveOrgLabel();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.role, profile?.tenant_id, profile?.client_org_id]);

  // Reset to the Documents tab whenever the signed-in role changes, so
  // logging out of a Manager account and into a Client one doesn't leave
  // the UI stuck on a tab (like "Team") that role doesn't have.
  useEffect(() => {
    setActiveTab('Documents');
  }, [profile?.role]);

  // Someone deactivated while already signed in: re-check on every tab
  // switch, so they're signed out with the message at their next tap
  // rather than whenever their session next refreshes.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('users').select('deactivated_at').eq('id', profile.id).maybeSingle();
      if (!cancelled && data?.deactivated_at) {
        setSignedOutNotice(DEACTIVATED_NOTICE);
        setProfile(null);
        await supabase.auth.signOut();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (supabaseConfigError) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 8 }}>Setup issue</Text>
        <Text style={{ color: colors.textDim, textAlign: 'center' }}>{supabaseConfigError}</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.orange} />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <LoginScreen notice={signedOutNotice} onLoginAttempt={() => setSignedOutNotice(null)} />
      </SafeAreaView>
    );
  }

  // New account still on its temporary password: nothing else opens until
  // they set their own (Add_password_change.sql). The database clears the
  // flag once the password really changes; loadProfile then lets them in.
  if (profile.must_change_password) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <SetPasswordScreen name={profile.name} onDone={loadProfile} onLogout={() => supabase.auth.signOut()} />
      </SafeAreaView>
    );
  }

  const tabs = TABS_BY_ROLE[profile.role];
  // BottomTabBar (mobile) shows only top-level labels — no room for a
  // nested list there, so 'Users' just appears as one flat item; the
  // subtab switch happens inside SuperAdminUsersScreen itself in that
  // case (its own ChipSelect, rendered only when activeSubTabLabel below
  // is undefined).
  const bottomTabLabels = tabs?.map((t) => t.label);
  const { parent: activeParent, child: activeChild } = splitActiveTab(activeTab);

  // Identical regardless of platform or nav style — this is "the same
  // content" the person asked for. SideNav and BottomTabBar only decide
  // WHICH tab is active and WHERE that control sits on screen; neither one
  // touches what gets rendered here.
  const renderContent = () => {
    // Same screen for every role — what each person sees is decided by the
    // database (can_access_master_org), not by separate per-role screens.
    if (activeParent === 'Master Docs') return <MasterDocsScreen profile={profile} />;
    if (profile.role === 'client') {
      return activeParent === 'Tasks' ? <TasksScreen profile={profile} /> : <ClientHomeScreen profile={profile} />;
    }
    if (profile.role === 'accountant') {
      if (activeParent === 'Tasks') return <TasksScreen profile={profile} />;
      if (activeParent === 'Team') return <ManagerAssignmentScreen profile={profile} />;
      return <AccountantHomeScreen profile={profile} />;
    }
    if (profile.role === 'manager') {
      if (activeParent === 'Tasks') return <TasksScreen profile={profile} />;
      if (activeParent === 'Team') return <AccountantAssignmentScreen profile={profile} />;
      return <ManagerHomeScreen profile={profile} />;
    }
    if (profile.role === 'super_admin') {
      if (activeParent === 'Tasks') return <SuperAdminTasksScreen profile={profile} />;
      if (activeParent === 'Users') {
        return (
          <SuperAdminUsersScreen
            profile={profile}
            // activeChild is the 'Add' child once SideNav's nested item (or
            // this screen's own header button, on mobile) has set it — see
            // splitActiveTab above. Undefined means the overview.
            activeSubTabLabel={activeChild}
            onSubTabLabelChange={(label) => setActiveTab(label ? `Users::${label}` : 'Users')}
          />
        );
      }
      return <SuperAdminDocumentsScreen profile={profile} />;
    }
    if (profile.role === 'client_admin') {
      if (activeParent === 'Tasks') return <ClientAdminTasksScreen profile={profile} />;
      if (activeParent === 'Users') return <ClientAdminUsersScreen profile={profile} />;
      return <ClientAdminDocumentsScreen profile={profile} />;
    }
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textDim }}>This role's screens aren't built yet — Phase 2.</Text>
      </View>
    );
  };

  const handleLogout = () => supabase.auth.signOut();
  const openChangePassword = () => setChangePasswordOpen(true);
  const changePasswordModal = (
    <ChangePasswordModal visible={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
  );

  // Desktop/web: Topbar spans the full width on top (brand + avatar), then
  // sidebar + content fill the row below it. Matches the demo's
  // topbar-above / sidebar-and-main-below split.
  if (isWide && tabs) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Topbar
          name={profile.name}
          role={profile.role}
          orgLabel={orgLabel}
          onLogout={handleLogout}
          onChangePassword={openChangePassword}
        />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SideNav tabs={tabs} active={activeTab} onChange={setActiveTab} />
          <View style={{ flex: 1 }}>{renderContent()}</View>
        </View>
        {changePasswordModal}
      </SafeAreaView>
    );
  }

  // Mobile/narrow: same Topbar on top, content in the middle, bottom tab
  // bar for section switching. Topbar is now identical content to the
  // desktop layout above — only the nav chrome below it differs.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Topbar
        name={profile.name}
        role={profile.role}
        orgLabel={orgLabel}
        onLogout={handleLogout}
        onChangePassword={openChangePassword}
      />
      <View style={{ flex: 1 }}>{renderContent()}</View>
      {bottomTabLabels && <BottomTabBar tabs={bottomTabLabels} active={activeParent} onChange={setActiveTab} />}
      {changePasswordModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
});


// SafeAreaProvider must wrap the app once, above everything — it's what
// lets SafeAreaView (and useSafeAreaInsets, if a screen ever needs raw
// inset numbers instead) actually know the device's safe area. Missing
// this is a common cause of insets silently resolving to zero.
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
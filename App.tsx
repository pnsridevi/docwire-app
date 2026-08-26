import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase, supabaseConfigError } from './lib/supabase';
import { colors } from './theme/colors';
import { OutlineButton, useIsWide, SideNav, BottomTabBar } from './components/UI';
import { Profile } from './lib/types';
import LoginScreen from './screens/LoginScreen';
import ClientHomeScreen from './screens/ClientHomeScreen';
import AccountantHomeScreen from './screens/AccountantHomeScreen';
import ManagerHomeScreen from './screens/ManagerHomeScreen';
import TasksScreen from './screens/TasksScreen';
import AccountantAssignmentScreen from './screens/AccountantAssignmentScreen';

// Mobile-only top bar: brand + role + logout. On desktop this same
// information lives in SideNav instead (see components/UI.tsx), since a
// wide layout has no separate header — the rail carries it. This
// component is never rendered when isWide is true.
function MobileHeader({ role, onLogout }: { role: string; onLogout: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerInner}>
        <View style={styles.brandRowSmall}>
          <View style={styles.brandMarkSmall}>
            <Text style={styles.brandMarkTextSmall}>DW</Text>
          </View>
          <Text style={styles.roleLabel}>Signed in as {role}</Text>
        </View>
        <OutlineButton title="Log out" onPress={onLogout} />
      </View>
    </View>
  );
}

const TABS_BY_ROLE: Record<string, string[]> = {
  client: ['Documents', 'Tasks'],
  accountant: ['Documents', 'Tasks'],
  manager: ['Documents', 'Tasks', 'Team'],
};

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Documents');
  const isWide = useIsWide();

  const loadProfile = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
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

  // Reset to the Documents tab whenever the signed-in role changes, so
  // logging out of a Manager account and into a Client one doesn't leave
  // the UI stuck on a tab (like "Team") that role doesn't have.
  useEffect(() => {
    setActiveTab('Documents');
  }, [profile?.role]);

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
        <LoginScreen />
      </SafeAreaView>
    );
  }

  const tabs = TABS_BY_ROLE[profile.role];

  // Identical regardless of platform or nav style — this is "the same
  // content" the person asked for. SideNav and BottomTabBar only decide
  // WHICH tab is active and WHERE that control sits on screen; neither one
  // touches what gets rendered here.
  const renderContent = () => {
    if (profile.role === 'client') {
      return activeTab === 'Tasks' ? <TasksScreen profile={profile} /> : <ClientHomeScreen profile={profile} />;
    }
    if (profile.role === 'accountant') {
      return activeTab === 'Tasks' ? <TasksScreen profile={profile} /> : <AccountantHomeScreen />;
    }
    if (profile.role === 'manager') {
      if (activeTab === 'Tasks') return <TasksScreen profile={profile} />;
      if (activeTab === 'Team') return <AccountantAssignmentScreen profile={profile} />;
      return <ManagerHomeScreen />;
    }
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textDim }}>This role's screens aren't built yet — Phase 2.</Text>
      </View>
    );
  };

  const handleLogout = () => supabase.auth.signOut();

  // Desktop/web: sidebar on the left, content fills the rest of the row.
  // No top header here — SideNav already carries brand/role/logout.
  if (isWide && tabs) {
    return (
      <SafeAreaView style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
        <SideNav tabs={tabs} active={activeTab} onChange={setActiveTab} role={profile.role} onLogout={handleLogout} />
        <View style={{ flex: 1 }}>{renderContent()}</View>
      </SafeAreaView>
    );
  }

  // Mobile/narrow: top header for brand/role/logout, content in the
  // middle, bottom tab bar for section switching — the standard mobile
  // pattern, and distinct from the desktop chrome above on purpose.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <MobileHeader role={profile.role} onLogout={handleLogout} />
      <View style={{ flex: 1 }}>{renderContent()}</View>
      {tabs && <BottomTabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  brandRowSmall: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMarkSmall: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkTextSmall: { color: '#fff', fontWeight: '700', fontSize: 9 },
  roleLabel: { color: colors.textDim, fontSize: 13, textTransform: 'capitalize' },
});
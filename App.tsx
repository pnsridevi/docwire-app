import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from './lib/supabase';
import { colors } from './theme/colors';
import { OutlineButton } from './components/UI';
import { Profile } from './lib/types';
import LoginScreen from './screens/LoginScreen';
import ClientHomeScreen from './screens/ClientHomeScreen';
import AccountantHomeScreen from './screens/AccountantHomeScreen';
import ManagerHomeScreen from './screens/ManagerHomeScreen';

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <View style={styles.brandRowSmall}>
          <View style={styles.brandMarkSmall}>
            <Text style={styles.brandMarkTextSmall}>DW</Text>
          </View>
          <Text style={styles.roleLabel}>Signed in as {profile.role}</Text>
        </View>
        <OutlineButton title="Log out" onPress={() => supabase.auth.signOut()} />
      </View>
      {profile.role === 'client' && <ClientHomeScreen profile={profile} />}
      {profile.role === 'accountant' && <AccountantHomeScreen />}
      {profile.role === 'manager' && <ManagerHomeScreen />}
      {(profile.role === 'client_admin' || profile.role === 'super_admin') && (
        <View style={styles.center}>
          <Text style={{ color: colors.textDim }}>This role's screens aren't built yet — Phase 2.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brandRowSmall: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMarkSmall: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandMarkTextSmall: { color: '#fff', fontWeight: '700', fontSize: 9 },
  roleLabel: { color: colors.textDim, fontSize: 13, textTransform: 'capitalize' },
});

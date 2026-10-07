// LOCATION: docwire-app/screens/ClientAdminUsersScreen.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { supabase, extractFunctionError } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, Pill, StatRow, ScreenContainer } from '../components/UI';
import { DataTable } from '../components/DataTable';
import { ClientOrg, Profile, StaffMember } from '../lib/types';

// Client Admin's Users tab (Roles doc: "Manage the org's users within
// the seat cap Super Admin set (add, invite)"). Scoped to the caller's
// own org only — client-side .eq(client_org_id) filter, on top of RLS
// which is currently broader than this for `users` (see the known-gap
// note in Migration_super_admin_client_admin.sql). Account creation goes
// through the same admin-create-user Edge Function Super Admin uses;
// here the function forces targetRole to 'client' and the org to the
// caller's own regardless of what's sent, and enforces seat_limit.
//
// Previously this screen listed every Client twice — once in a
// dedicated "Your Team" table (Client | Manager | Accountant), then
// again as plain rows in the org-wide users table below (Name | Email |
// Role). Merged into a single table: the org's users table now carries
// Manager/Accountant as two extra columns, populated from
// client_assignments only for rows where role === 'client' (a Client
// Admin or a future non-Client role has no Manager/Accountant, shown as
// a dash rather than an empty cell that could read as a data gap).
export default function ClientAdminUsersScreen({ profile }: { profile: Profile }) {
  const [org, setOrg] = useState<ClientOrg | null>(null);
  const [orgUsers, setOrgUsers] = useState<StaffMember[]>([]);
  // Phase 2 fix: this used to be manager/accountant state sourced from
  // manager_assignments/accountant_assignments (the org-level default) —
  // the same class of bug D.1 fixed in ClientHomeScreen.tsx. A Client
  // Admin's org can now have Clients on DIFFERENT Manager/Accountant
  // pairs (per-Client overrides via Super Admin's Client Assignments
  // screen), so clientTeams holds one row per Client in this org, sourced
  // from client_assignments (the real, currently-effective table) — used
  // below purely as a lookup keyed by client id, joined onto the single
  // Org Users table rather than rendered as its own separate table, so a
  // per-Client divergence is still always visible, just without listing
  // every Client a second time to show it.
  const [clientTeams, setClientTeams] = useState<
    { clientId: string; clientName: string | null; managerId: string; managerName: string | null; accountantId: string; accountantName: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);

  const load = async () => {
    if (!profile.client_org_id) {
      setLoadError('Your account has no client organization set.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: orgData, error: orgError }, { data: usersData, error: usersError }, { data: assignments, error: assignError }] = await Promise.all([
      supabase.from('client_organizations').select('*').eq('id', profile.client_org_id).single(),
      supabase.from('users').select('id,name,email,role,client_org_id,created_at').eq('client_org_id', profile.client_org_id),
      supabase.from('client_assignments').select('client_id,manager_id,accountant_id').eq('client_org_id', profile.client_org_id),
    ]);
    const err = orgError ?? usersError ?? assignError;
    if (err) {
      console.error('[ClientAdminUsersScreen] load failed:', err);
      setLoadError(err.message);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setOrg((orgData as ClientOrg) ?? null);
    setOrgUsers((usersData as StaffMember[]) ?? []);

    const rows = assignments ?? [];
    if (rows.length === 0) {
      setClientTeams([]);
      setLoading(false);
      return;
    }
    // One combined lookup for every Client, Manager, and Accountant id
    // that shows up across this org's assignment rows, rather than a
    // separate query per row.
    const peopleIds = Array.from(
      new Set(rows.flatMap((r: any) => [r.client_id, r.manager_id, r.accountant_id]))
    ) as string[];
    const { data: people } = await supabase.from('users').select('id,name').in('id', peopleIds);
    const nameById: Record<string, string | null> = {};
    (people ?? []).forEach((p: any) => (nameById[p.id] = p.name));

    setClientTeams(
      rows.map((r: any) => ({
        clientId: r.client_id,
        clientName: nameById[r.client_id] ?? null,
        managerId: r.manager_id,
        managerName: nameById[r.manager_id] ?? null,
        accountantId: r.accountant_id,
        accountantName: nameById[r.accountant_id] ?? null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyed by client id so the merged table below can look up each
  // Client's currently-effective Manager/Accountant in O(1) per row,
  // instead of re-scanning clientTeams for every user rendered.
  const teamByClientId = useMemo(() => {
    const m: Record<string, { managerName: string | null; accountantName: string | null }> = {};
    clientTeams.forEach((t) => (m[t.clientId] = { managerName: t.managerName, accountantName: t.accountantName }));
    return m;
  }, [clientTeams]);

  const seatsUsed = orgUsers.length;
  const seatLimit = org?.seat_limit ?? 0;
  const atCap = seatsUsed >= seatLimit;

  const createClient = async () => {
    if (!name.trim() || !email.trim()) return;
    setCreating(true);
    setCreateError(null);
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { targetRole: 'client', name: name.trim(), email: email.trim() },
    });
    if (error || data?.error) {
      const message = await extractFunctionError(error, data);
      console.error('[ClientAdminUsersScreen] createClient failed:', message);
      setCreateError(message ?? 'Could not create the account.');
      setCreating(false);
      return;
    }
    setLastCreated({ email: email.trim(), password: data.tempPassword });
    setName('');
    setEmail('');
    setShowForm(false);
    await load();
    setCreating(false);
  };

  const roleLabel = (r: string) => (r === 'client_admin' ? 'Client Admin' : r === 'client' ? 'Client' : r);

  return (
    <ScreenContainer scroll>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Org Users</Text>
            <Text style={styles.subheading}>Manage users within your seat allowance.</Text>
          </View>
          <OutlineButton title={showForm ? 'Cancel' : '+ Add User'} onPress={() => setShowForm((s) => !s)} />
        </View>
        {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

        <StatRow
          items={[
            { num: `${seatsUsed} of ${seatLimit}`, label: 'Seats Used', icon: 'users' },
            { num: String(orgUsers.filter((u) => u.role === 'client').length), label: 'Clients', icon: 'briefcase' },
            { num: String(seatLimit - seatsUsed > 0 ? seatLimit - seatsUsed : 0), label: 'Seats Remaining', icon: 'user-plus' },
          ]}
        />

        {lastCreated && (
          <View style={styles.credentialsBanner}>
            <Text style={styles.credentialsTitle}>Account created — share these credentials now</Text>
            <Text style={styles.credentialsText}>Email: {lastCreated.email}</Text>
            <Text style={styles.credentialsText}>Temporary password: {lastCreated.password}</Text>
            <Text style={styles.credentialsHint}>
              This password won't be shown again. The person should sign in and can change it from there.
            </Text>
            <OutlineButton title="Dismiss" onPress={() => setLastCreated(null)} />
          </View>
        )}

        {showForm && (
          <View style={styles.panel}>
            {atCap ? (
              <Text style={styles.errorText}>
                Seat limit reached ({seatsUsed}/{seatLimit}). Ask Super Admin to raise it before adding more users.
              </Text>
            ) : (
              <>
                {createError && <Text style={styles.errorText}>{createError}</Text>}
                <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textFaint} value={name} onChangeText={setName} />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
                <PrimaryButton title={creating ? 'Creating...' : 'Create user'} onPress={createClient} disabled={creating || !name.trim() || !email.trim()} />
              </>
            )}
          </View>
        )}

        {/* Single merged table — every org user, with Manager/Accountant
            as extra columns rather than a separate "Your Team" table
            repeating the same Clients above it. Non-Client rows (e.g.
            Client Admin) show a dash for both — they genuinely have no
            Manager/Accountant, not a data gap. */}
        <DataTable
          scrollable={false}
          data={loading ? [] : orgUsers}
          keyExtractor={(u) => u.id}
          columns={[
            { key: 'name', header: 'Name', width: 160, render: (u) => <Text style={styles.cellPrimary}>{u.name ?? 'Unnamed'}</Text> },
            { key: 'email', header: 'Email', width: 200, render: (u) => <Text style={styles.cellSub}>{u.email ?? '—'}</Text> },
            { key: 'role', header: 'Role', width: 110, render: (u) => <Text style={styles.cellSub}>{roleLabel(u.role)}</Text> },
            {
              key: 'manager',
              header: 'Manager',
              width: 160,
              render: (u) => <Text style={styles.cellSub}>{u.role === 'client' ? teamByClientId[u.id]?.managerName ?? 'Unnamed' : '—'}</Text>,
            },
            {
              key: 'accountant',
              header: 'Accountant',
              width: 160,
              render: (u) => <Text style={styles.cellSub}>{u.role === 'client' ? teamByClientId[u.id]?.accountantName ?? 'Unnamed' : '—'}</Text>,
            },
          ]}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No users yet.'}</Text>}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subheading: { fontSize: 12, color: colors.textFaint },
  errorBanner: {
    color: colors.danger,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    marginBottom: 4,
    fontSize: 12,
  },
  credentialsBanner: {
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    marginBottom: 8,
  },
  credentialsTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  credentialsText: { fontSize: 13, color: colors.text, fontFamily: 'monospace' as any, marginBottom: 2 },
  credentialsHint: { fontSize: 11, color: colors.textFaint, marginTop: 6, marginBottom: 10, fontStyle: 'italic' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 12, marginBottom: 8 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, marginTop: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: colors.surface2, color: colors.text, maxWidth: 420 },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  cellPrimary: { fontSize: 14, fontWeight: '600', color: colors.text },
  cellSub: { fontSize: 12, color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
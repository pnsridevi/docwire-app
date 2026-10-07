// LOCATION: docwire-app/screens/SuperAdminClientAssignmentsScreen.tsx (NEW FILE)
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { OutlineButton, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { DataTable } from '../components/DataTable';
import { ClientAssignment, ClientOrg, Profile, StaffMember } from '../lib/types';

// Super Admin's Client Assignments screen. Two distinct jobs, both
// Super Admin's sole authority per Architecture V2 §8.1/§8.2 (and Roles
// & Responsibilities V2 §1: "Client Assignments screen — set the
// org-level default Manager and Accountant per client organization, and
// override either for an individual Client"):
//
//   1. Org-level defaults — which Manager/Accountant a NEW Client in this
//      org gets copied onto at creation (manager_assignments /
//      accountant_assignments, unchanged tables, both now Super-Admin-
//      write-only — Accountant assignment moved here from Manager in
//      Revision 3, §8.1). Changing a default does NOT retroactively move
//      any Client already assigned — no bulk reassignment, ever (§8.2).
//
//   2. Per-client overrides — client_assignments, one row per individual
//      Client, auto-seeded from the org defaults above when the Client
//      is created, editable one Client at a time from here. This is
//      what lets a large client org split its workload across several
//      Manager/Accountant pairs.
//
// This screen absorbs the "Client Organizations → Manager" section that
// used to live on SuperAdminUsersScreen — that only ever covered half of
// this (Manager, no Accountant, no per-client override), and the
// Architecture doc is explicit both defaults belong in "the same Client
// Assignments area." Keeping two places that write manager_assignments
// would just invite them to drift.
export default function SuperAdminClientAssignmentsScreen({ profile }: { profile: Profile }) {
  const [clientOrgs, setClientOrgs] = useState<ClientOrg[]>([]);
  const [managers, setManagers] = useState<StaffMember[]>([]);
  const [accountants, setAccountants] = useState<StaffMember[]>([]);
  const [managerDefaults, setManagerDefaults] = useState<{ client_org_id: string; manager_id: string }[]>([]);
  const [accountantDefaults, setAccountantDefaults] = useState<{ client_org_id: string; accountant_id: string }[]>([]);
  const [assignments, setAssignments] = useState<ClientAssignment[]>([]);
  // Individual Client users (role='client') — just enough to label rows
  // in the per-client table; not the full StaffMember shape since Super
  // Admin isn't managing these accounts here, only their assignment.
  const [clientUsers, setClientUsers] = useState<{ id: string; name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Per-client-row edit state — only one row editable at a time, same
  // pattern as ClientAdminUsersScreen's single-form-open convention.
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [draftManagerId, setDraftManagerId] = useState<string | null>(null);
  const [draftAccountantId, setDraftAccountantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [
      { data: orgs, error: orgsError },
      { data: staffData, error: staffError },
      { data: mgrDefaults, error: mgrError },
      { data: accDefaults, error: accError },
      { data: clientAssignmentRows, error: assignError },
      { data: clientUsersData, error: clientUsersError },
    ] = await Promise.all([
      supabase.from('client_organizations').select('*').eq('tenant_id', profile.tenant_id).order('name'),
      supabase
        .from('users')
        .select('id,name,email,role,client_org_id,created_at')
        .eq('tenant_id', profile.tenant_id)
        .in('role', ['manager', 'accountant']),
      supabase.from('manager_assignments').select('client_org_id,manager_id'),
      supabase.from('accountant_assignments').select('client_org_id,accountant_id'),
      supabase.from('client_assignments').select('client_id,client_org_id,manager_id,accountant_id'),
      supabase.from('users').select('id,name').eq('tenant_id', profile.tenant_id).eq('role', 'client'),
    ]);
    const err = orgsError ?? staffError ?? mgrError ?? accError ?? assignError ?? clientUsersError;
    if (err) {
      console.error('[SuperAdminClientAssignmentsScreen] load failed:', err);
      setLoadError(err.message);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setClientOrgs((orgs as ClientOrg[]) ?? []);
    setManagers(((staffData ?? []) as StaffMember[]).filter((s) => s.role === 'manager'));
    setAccountants(((staffData ?? []) as StaffMember[]).filter((s) => s.role === 'accountant'));
    setManagerDefaults(mgrDefaults ?? []);
    setAccountantDefaults(accDefaults ?? []);
    setAssignments((clientAssignmentRows as ClientAssignment[]) ?? []);
    setClientUsers(clientUsersData ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Org-level default assignment ---

  const setDefaultManager = async (orgId: string, managerId: string) => {
    const { error } = await supabase
      .from('manager_assignments')
      .upsert({ client_org_id: orgId, manager_id: managerId }, { onConflict: 'client_org_id' });
    if (error) {
      console.error('[SuperAdminClientAssignmentsScreen] setDefaultManager failed:', error);
      setLoadError(error.message);
      return;
    }
    await load();
  };

  const setDefaultAccountant = async (orgId: string, accountantId: string) => {
    const { error } = await supabase
      .from('accountant_assignments')
      .upsert({ client_org_id: orgId, accountant_id: accountantId }, { onConflict: 'client_org_id' });
    if (error) {
      console.error('[SuperAdminClientAssignmentsScreen] setDefaultAccountant failed:', error);
      setLoadError(error.message);
      return;
    }
    await load();
  };

  // --- Per-client override ---

  const startEdit = (row: ClientAssignment) => {
    setEditingClientId(row.client_id);
    setDraftManagerId(row.manager_id);
    setDraftAccountantId(row.accountant_id);
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingClientId(null);
    setDraftManagerId(null);
    setDraftAccountantId(null);
    setSaveError(null);
  };

  const saveEdit = async (clientId: string) => {
    if (!draftManagerId || !draftAccountantId) return;
    setSaving(true);
    setSaveError(null);
    // Only Manager/Accountant change — client_org_id never moves via this
    // screen (that would mean moving the Client to a different
    // organization entirely, a different action). The history trigger on
    // client_assignments logs this update automatically; updated_at/
    // updated_by on the row itself are set here so the row also reflects
    // who last touched it without a join out to client_assignment_history.
    const { error } = await supabase
      .from('client_assignments')
      .update({
        manager_id: draftManagerId,
        accountant_id: draftAccountantId,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      })
      .eq('client_id', clientId);
    if (error) {
      console.error('[SuperAdminClientAssignmentsScreen] saveEdit failed:', error);
      setSaveError(error.message);
      setSaving(false);
      return;
    }
    setEditingClientId(null);
    setDraftManagerId(null);
    setDraftAccountantId(null);
    await load();
    setSaving(false);
  };

  // --- Lookups ---

  const orgNameById: Record<string, string> = {};
  clientOrgs.forEach((o) => (orgNameById[o.id] = o.name));

  const clientNameById: Record<string, string> = {};
  clientUsers.forEach((c) => (clientNameById[c.id] = c.name ?? 'Unnamed'));

  const staffNameById: Record<string, string> = {};
  [...managers, ...accountants].forEach((s) => (staffNameById[s.id] = s.name ?? 'Unnamed'));

  const defaultManagerByOrg: Record<string, string> = {};
  managerDefaults.forEach((a) => (defaultManagerByOrg[a.client_org_id] = a.manager_id));

  const defaultAccountantByOrg: Record<string, string> = {};
  accountantDefaults.forEach((a) => (defaultAccountantByOrg[a.client_org_id] = a.accountant_id));

  // Architecture §8.3: total current Client count/names per Accountant
  // (and, for parity, per Manager), tenant-wide — resolved from
  // client_assignments, which is comprehensive (every Client has a row),
  // not just the sparse override set.
  const accountantWorkload = (accountantId: string) =>
    assignments.filter((a) => a.accountant_id === accountantId).map((a) => clientNameById[a.client_id] ?? a.client_id);

  const managerWorkload = (managerId: string) =>
    assignments.filter((a) => a.manager_id === managerId).map((a) => clientNameById[a.client_id] ?? a.client_id);

  const managerOptions = managers.map((m) => {
    const count = managerWorkload(m.id).length;
    return { value: m.id, label: `${m.name ?? 'Unnamed'} (${count} client${count === 1 ? '' : 's'})` };
  });
  const accountantOptions = accountants.map((a) => {
    const count = accountantWorkload(a.id).length;
    return { value: a.id, label: `${a.name ?? 'Unnamed'} (${count} client${count === 1 ? '' : 's'})` };
  });

  // Per-client rows for the override table, joined with display names and
  // sorted by org then client so a large org's split clients read
  // together rather than in insertion order.
  const clientRows = assignments
    .map((a) => ({
      ...a,
      client_name: clientNameById[a.client_id] ?? a.client_id,
      client_org_name: orgNameById[a.client_org_id] ?? a.client_org_id,
    }))
    .sort(
      (x, y) => x.client_org_name.localeCompare(y.client_org_name) || x.client_name.localeCompare(y.client_name)
    );

  return (
    <ScreenContainer scroll>
      <View style={styles.screen}>
        <Text style={styles.heading}>Client Assignments</Text>
        <Text style={styles.subheading}>
          Set each client organization's default Manager and Accountant, and override either for an individual
          Client to split a large organization's workload across multiple staff.
        </Text>
        {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

        <StatRow
          items={[
            { num: String(clientOrgs.length), label: 'Client Orgs', icon: 'briefcase' },
            { num: String(clientRows.length), label: 'Individual Clients', icon: 'users' },
          ]}
        />

        {/* Org-level defaults */}
        <Text style={styles.sectionTitle}>Client Organizations → Default Manager / Accountant</Text>
        <Text style={styles.sectionSubtitle}>
          Copied onto every new Client created in that org. Changing a default here does not move any Client
          already assigned — no bulk reassignment (Architecture §8.2). A client org with either default missing
          cannot have new Clients created in it.
        </Text>
        <DataTable
          scrollable={false}
          data={loading ? [] : clientOrgs}
          keyExtractor={(o) => o.id}
          columns={[
            { key: 'org', header: 'Client Organization', width: 180, render: (o) => <Text style={styles.cellPrimary}>{o.name}</Text> },
            {
              key: 'manager',
              header: 'Default Manager',
              width: 240,
              render: (o) => {
                if (managers.length === 0) return <Text style={styles.cellSub}>No managers created yet.</Text>;
                return (
                  <ChipSelect
                    options={managerOptions}
                    value={defaultManagerByOrg[o.id] ?? null}
                    onChange={(v) => setDefaultManager(o.id, v)}
                  />
                );
              },
            },
            {
              key: 'accountant',
              header: 'Default Accountant',
              width: 240,
              render: (o) => {
                if (accountants.length === 0) return <Text style={styles.cellSub}>No accountants created yet.</Text>;
                return (
                  <ChipSelect
                    options={accountantOptions}
                    value={defaultAccountantByOrg[o.id] ?? null}
                    onChange={(v) => setDefaultAccountant(o.id, v)}
                  />
                );
              },
            },
            {
              key: 'status',
              header: '',
              width: 170,
              render: (o) =>
                !defaultManagerByOrg[o.id] || !defaultAccountantByOrg[o.id] ? (
                  <Text style={styles.warningText}>Blocks new Clients until both are set</Text>
                ) : null,
            },
          ]}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No client organizations yet.'}</Text>}
        />

        {/* Per-client overrides */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Per-Client Overrides</Text>
        <Text style={styles.sectionSubtitle}>
          Every individual Client's currently effective Manager and Accountant. Edit one Client at a time to split a
          large organization's workload — reassignment is live: the newly assigned staff member sees this Client's
          existing documents and tasks immediately, and the previous one loses access immediately (Architecture
          §8.2).
        </Text>
        {saveError && <Text style={styles.errorBanner}>Error: {saveError}</Text>}
        <DataTable
          scrollable={false}
          data={loading ? [] : clientRows}
          keyExtractor={(r) => r.client_id}
          columns={[
            { key: 'org', header: 'Client Organization', width: 160, render: (r) => <Text style={styles.cellSub}>{r.client_org_name}</Text> },
            { key: 'client', header: 'Client', width: 160, render: (r) => <Text style={styles.cellPrimary}>{r.client_name}</Text> },
            {
              key: 'manager',
              header: 'Manager',
              width: 240,
              render: (r) =>
                editingClientId === r.client_id ? (
                  <ChipSelect options={managerOptions} value={draftManagerId} onChange={setDraftManagerId} />
                ) : (
                  <Text style={styles.cellSub}>{staffNameById[r.manager_id] ?? 'Unassigned'}</Text>
                ),
            },
            {
              key: 'accountant',
              header: 'Accountant',
              width: 240,
              render: (r) =>
                editingClientId === r.client_id ? (
                  <ChipSelect options={accountantOptions} value={draftAccountantId} onChange={setDraftAccountantId} />
                ) : (
                  <Text style={styles.cellSub}>{staffNameById[r.accountant_id] ?? 'Unassigned'}</Text>
                ),
            },
            {
              key: 'actions',
              header: '',
              width: 160,
              render: (r) =>
                editingClientId === r.client_id ? (
                  <View style={styles.actionRow}>
                    <OutlineButton title={saving ? 'Saving...' : 'Save'} onPress={() => saveEdit(r.client_id)} />
                    <OutlineButton title="Cancel" onPress={cancelEdit} />
                  </View>
                ) : (
                  <OutlineButton title="Edit" onPress={() => startEdit(r)} />
                ),
            },
          ]}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {loading ? 'Loading...' : 'No Clients yet — they appear here automatically once created.'}
            </Text>
          }
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
  errorBanner: {
    color: colors.danger,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    fontSize: 12,
  },
  warningText: { fontSize: 11, color: colors.danger, fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cellPrimary: { fontSize: 14, fontWeight: '600', color: colors.text },
  cellSub: { fontSize: 12, color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 12, marginBottom: 12, textAlign: 'center' },
});
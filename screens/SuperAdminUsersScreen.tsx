// LOCATION: docwire-app/screens/SuperAdminUsersScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase, extractFunctionError } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { Dropdown } from '../components/Dropdown';
import { DataTable } from '../components/DataTable';
import { ClientAssignment, ClientOrg, Profile, Role, StaffMember } from '../lib/types';
import { DeactivateUserPanel, DeactivateTarget } from '../components/DeactivateUserPanel';

type SubTab = 'overview' | 'add';

// Matches the one child label SideNav renders under 'Users'.
const ADD_LABEL = 'Add';

// A row in the combined Clients table — either a real Client (has a
// client_assignments row, so a Manager/Accountant to show and edit) or a
// Client Admin (org-scoped like a Client, but has no individual
// Manager/Accountant assignment of their own — those cells just read
// "—" and there's no Edit for them).
type ClientTableRow = {
  key: string;
  name: string | null;
  roleTag: 'Client' | 'Client Admin';
  orgName: string | null;
  clientId: string | null; // only set for real Clients — needed to edit/save
  managerId: string | null;
  accountantId: string | null;
  userId: string; // the Client's or Client Admin's own user id (Deactivate/Reactivate)
  deactivated: boolean;
};

// Super Admin's Users tab. Two states: overview (default — every client
// org, every Client/Client Admin, every staff member, all listed
// together) and 'Add' (the one remaining subtab, for creating any of
// them). See SideNav.tsx for how the nested 'Add' child gets here.
export default function SuperAdminUsersScreen({
  profile,
  activeSubTabLabel,
  onSubTabLabelChange,
}: {
  profile: Profile;
  activeSubTabLabel?: string; // undefined = overview; ADD_LABEL = the Add view
  onSubTabLabelChange: (label?: string) => void;
}) {
  const subTab: SubTab = activeSubTabLabel === ADD_LABEL ? 'add' : 'overview';
  const goTo = (t: SubTab) => onSubTabLabelChange(t === 'add' ? ADD_LABEL : undefined);

  const [clientOrgs, setClientOrgs] = useState<ClientOrg[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [managerDefaults, setManagerDefaults] = useState<{ client_org_id: string; manager_id: string }[]>([]);
  const [accountantDefaults, setAccountantDefaults] = useState<{ client_org_id: string; accountant_id: string }[]>([]);
  const [assignments, setAssignments] = useState<ClientAssignment[]>([]);
  const [clientUsers, setClientUsers] = useState<{ id: string; name: string | null; deactivated_at: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Shown once, right after any successful create — the Edge Function
  // only ever returns the temp password this one time.
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);

  // --- Add view: onboard org ---
  const [orgName, setOrgName] = useState('');
  const [seatLimit, setSeatLimit] = useState('5');
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  // --- Add view: Client Admin ---
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminOrgId, setAdminOrgId] = useState<string | null>(null);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminCreateError, setAdminCreateError] = useState<string | null>(null);

  // --- Add view: Manager/Accountant ---
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<'manager' | 'accountant'>('accountant');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- Overview: per-client override edit state ---
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [draftManagerId, setDraftManagerId] = useState<string | null>(null);
  const [draftAccountantId, setDraftAccountantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Deactivate / reactivate (Add_user_deactivation.sql) ---
  // Deactivated people are hidden unless this is switched on.
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [panelTarget, setPanelTarget] = useState<DeactivateTarget | null>(null);
  const [panelMode, setPanelMode] = useState<'deactivate' | 'reactivate'>('deactivate');

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
      supabase.from('client_organizations').select('*').eq('tenant_id', profile.tenant_id).order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('id,name,email,role,client_org_id,created_at,firm_wide_staff,deactivated_at')
        .eq('tenant_id', profile.tenant_id)
        .in('role', ['manager', 'accountant', 'client_admin']),
      supabase.from('manager_assignments').select('client_org_id,manager_id'),
      supabase.from('accountant_assignments').select('client_org_id,accountant_id'),
      supabase.from('client_assignments').select('client_id,client_org_id,manager_id,accountant_id'),
      supabase.from('users').select('id,name,deactivated_at').eq('tenant_id', profile.tenant_id).eq('role', 'client'),
    ]);
    const err = orgsError ?? staffError ?? mgrError ?? accError ?? assignError ?? clientUsersError;
    if (err) {
      console.error('[SuperAdminUsersScreen] load failed:', err);
      setLoadError(err.message);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setClientOrgs((orgs as ClientOrg[]) ?? []);
    setStaff((staffData as StaffMember[]) ?? []);
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

  const onboardOrg = async () => {
    if (!orgName.trim()) return;
    const parsedSeatLimit = parseInt(seatLimit, 10);
    if (!Number.isFinite(parsedSeatLimit) || parsedSeatLimit < 1) {
      setOnboardError('Seat limit must be 1 or more.');
      return;
    }
    setOnboarding(true);
    setOnboardError(null);
    const { error } = await supabase.from('client_organizations').insert({
      tenant_id: profile.tenant_id,
      name: orgName.trim(),
      seat_limit: parsedSeatLimit,
    });
    if (error) {
      console.error('[SuperAdminUsersScreen] onboardOrg failed:', error);
      setOnboardError(error.message);
      setOnboarding(false);
      return;
    }
    setOrgName('');
    setSeatLimit('5');
    await load();
    setOnboarding(false);
  };

  // Shared by both create forms — targetRole and the optional org id are
  // the only things that differ between "create a Client Admin" and
  // "create a Manager/Accountant".
  const createAccount = (targetRole: Role, name: string, email: string, clientOrgId?: string) =>
    supabase.functions.invoke('admin-create-user', {
      body: { targetRole, name, email, client_org_id: clientOrgId },
    });

  const createClientAdmin = async () => {
    if (!adminName.trim() || !adminEmail.trim()) return;
    if (!adminOrgId) {
      setAdminCreateError('Pick a client organization first.');
      return;
    }
    setCreatingAdmin(true);
    setAdminCreateError(null);
    const { data, error } = await createAccount('client_admin', adminName.trim(), adminEmail.trim(), adminOrgId);
    if (error || data?.error) {
      const message = await extractFunctionError(error, data);
      console.error('[SuperAdminUsersScreen] createClientAdmin failed:', message);
      setAdminCreateError(message ?? 'Could not create the account.');
      setCreatingAdmin(false);
      return;
    }
    setLastCreated({ email: adminEmail.trim(), password: data.tempPassword });
    setAdminName('');
    setAdminEmail('');
    setAdminOrgId(null);
    await load();
    setCreatingAdmin(false);
  };

  const createStaff = async () => {
    if (!staffName.trim() || !staffEmail.trim()) return;
    setCreatingStaff(true);
    setCreateError(null);
    const { data, error } = await createAccount(staffRole, staffName.trim(), staffEmail.trim());
    if (error || data?.error) {
      const message = await extractFunctionError(error, data);
      console.error('[SuperAdminUsersScreen] createStaff failed:', message);
      setCreateError(message ?? 'Could not create the account.');
      setCreatingStaff(false);
      return;
    }
    setLastCreated({ email: staffEmail.trim(), password: data.tempPassword });
    setStaffName('');
    setStaffEmail('');
    await load();
    setCreatingStaff(false);
  };

  const toggleFirmWide = async (userId: string, next: boolean) => {
    setStaff((prev) => prev.map((s) => (s.id === userId ? { ...s, firm_wide_staff: next } : s)));
    const { error } = await supabase.from('users').update({ firm_wide_staff: next }).eq('id', userId);
    if (error) {
      console.error('[SuperAdminUsersScreen] toggleFirmWide failed:', error);
      setLoadError(error.message);
      setStaff((prev) => prev.map((s) => (s.id === userId ? { ...s, firm_wide_staff: !next } : s)));
    }
  };

  const setDefaultManager = async (orgId: string, managerId: string) => {
    const { error } = await supabase
      .from('manager_assignments')
      .upsert({ client_org_id: orgId, manager_id: managerId }, { onConflict: 'client_org_id' });
    if (error) {
      console.error('[SuperAdminUsersScreen] setDefaultManager failed:', error);
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
      console.error('[SuperAdminUsersScreen] setDefaultAccountant failed:', error);
      setLoadError(error.message);
      return;
    }
    await load();
  };

  const startEdit = (row: ClientTableRow) => {
    if (!row.clientId) return; // Client Admin rows have nothing to edit
    setEditingClientId(row.clientId);
    setDraftManagerId(row.managerId);
    setDraftAccountantId(row.accountantId);
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
      console.error('[SuperAdminUsersScreen] saveEdit failed:', error);
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

  // --- Derived / lookups ---

  const managers = staff.filter((s) => s.role === 'manager');
  const accountants = staff.filter((s) => s.role === 'accountant');
  const clientAdmins = staff.filter((s) => s.role === 'client_admin');
  // Only active people can be picked as a Manager/Accountant (the database
  // refuses a deactivated one too).
  const activeManagers = managers.filter((m) => !m.deactivated_at);
  const activeAccountants = accountants.filter((a) => !a.deactivated_at);
  const deactivatedClientIds = new Set(clientUsers.filter((c) => !!c.deactivated_at).map((c) => c.id));
  const withStatus = (name: string | null, deactivated: boolean) =>
    `${name ?? 'Unnamed'}${deactivated ? ' (deactivated)' : ''}`;

  const openPanel = (target: DeactivateTarget, mode: 'deactivate' | 'reactivate') => {
    setPanelMode(mode);
    setPanelTarget(target);
  };

  const orgNameById: Record<string, string> = {};
  clientOrgs.forEach((o) => (orgNameById[o.id] = o.name));

  const clientNameById: Record<string, string> = {};
  clientUsers.forEach((c) => (clientNameById[c.id] = c.name ?? 'Unnamed'));

  const staffNameById: Record<string, string> = {};
  [...managers, ...accountants].forEach((s) => (staffNameById[s.id] = withStatus(s.name, !!s.deactivated_at)));

  const defaultManagerByOrg: Record<string, string> = {};
  managerDefaults.forEach((a) => (defaultManagerByOrg[a.client_org_id] = a.manager_id));

  const defaultAccountantByOrg: Record<string, string> = {};
  accountantDefaults.forEach((a) => (defaultAccountantByOrg[a.client_org_id] = a.accountant_id));

  const accountantWorkload = (accountantId: string) => assignments.filter((a) => a.accountant_id === accountantId);
  const managerWorkload = (managerId: string) => assignments.filter((a) => a.manager_id === managerId);
  const clientAdminsByOrg = (orgId: string) => clientAdmins.filter((c) => c.client_org_id === orgId);

  const managerOptions = activeManagers.map((m) => {
    const count = managerWorkload(m.id).length;
    return { value: m.id, label: `${m.name ?? 'Unnamed'} (${count})` };
  });
  const accountantOptions = activeAccountants.map((a) => {
    const count = accountantWorkload(a.id).length;
    return { value: a.id, label: `${a.name ?? 'Unnamed'} (${count})` };
  });

  // Combined Clients table — real Clients (from client_assignments, with
  // a Manager/Accountant to show and edit) plus Client Admins (org-scoped
  // like a Client, but no individual assignment of their own).
  const clientTableRows: ClientTableRow[] = [
    ...assignments.map((a) => ({
      key: `client:${a.client_id}`,
      name: clientNameById[a.client_id] ?? a.client_id,
      roleTag: 'Client' as const,
      orgName: orgNameById[a.client_org_id] ?? a.client_org_id,
      clientId: a.client_id,
      managerId: a.manager_id,
      accountantId: a.accountant_id,
      userId: a.client_id,
      deactivated: deactivatedClientIds.has(a.client_id),
    })),
    ...clientAdmins.map((c) => ({
      key: `admin:${c.id}`,
      name: c.name,
      roleTag: 'Client Admin' as const,
      orgName: c.client_org_id ? orgNameById[c.client_org_id] ?? '—' : '—',
      clientId: null,
      managerId: null,
      accountantId: null,
      userId: c.id,
      deactivated: !!c.deactivated_at,
    })),
  ]
    .filter((r) => showDeactivated || !r.deactivated)
    .sort((x, y) => (x.orgName ?? '').localeCompare(y.orgName ?? '') || (x.name ?? '').localeCompare(y.name ?? ''));

  const allStaff = [...managers, ...accountants]
    .filter((s) => showDeactivated || !s.deactivated_at)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const initials = (name: string | null) => {
    if (!name || !name.trim()) return '?';
    return name.trim().split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2);
  };

  const Avatar = ({ name }: { name: string | null }) => (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </View>
  );

  return (
    <ScreenContainer scroll>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>{subTab === 'add' ? 'Add' : 'Users'}</Text>
            <Text style={styles.subheading}>{subTab === 'add' ? 'Create an org, admin, or staff member.' : 'Everyone in your tenant, at a glance.'}</Text>
          </View>
          {subTab === 'overview' ? (
            <OutlineButton title="+ Add" onPress={() => goTo('add')} />
          ) : (
            <OutlineButton title="← Back" onPress={() => goTo('overview')} />
          )}
        </View>
        {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

        {lastCreated && (
          <View style={styles.credentialsBanner}>
            <Text style={styles.credentialsTitle}>Account created — share these credentials now</Text>
            <Text style={styles.credentialsText}>Email: {lastCreated.email}</Text>
            <Text style={styles.credentialsText}>Temporary password: {lastCreated.password}</Text>
            <Text style={styles.credentialsHint}>Won't be shown again.</Text>
            <OutlineButton title="Dismiss" onPress={() => setLastCreated(null)} />
          </View>
        )}

        {subTab === 'overview' && (
          <>
            <StatRow
              items={[
                { num: String(clientOrgs.length), label: 'Client Orgs', icon: 'briefcase' },
                { num: String(assignments.filter((a) => !deactivatedClientIds.has(a.client_id)).length), label: 'Clients', icon: 'users' },
                { num: String(activeManagers.length), label: 'Managers', icon: 'users' },
                { num: String(activeAccountants.length), label: 'Accountants', icon: 'user-plus' },
                { num: String(clientAdmins.filter((c) => !c.deactivated_at).length), label: 'Client Admins', icon: 'user-plus' },
              ]}
            />

            <View style={styles.toggleRow}>
              <Switch
                value={showDeactivated}
                onValueChange={setShowDeactivated}
                trackColor={{ false: colors.border, true: colors.tint }}
                thumbColor={showDeactivated ? colors.orange : '#fff'}
              />
              <Text style={styles.cellSub}>Show deactivated users</Text>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Client Organizations</Text>
              <Text style={styles.sectionSubtitle}>Default Manager/Accountant for new Clients in each org.</Text>
              <DataTable
              scrollable={false}
              data={loading ? [] : clientOrgs}
              keyExtractor={(o) => o.id}
              columns={[
                {
                  key: 'org',
                  header: 'Organization',
                  width: 170,
                  render: (o) => (
                    <View>
                      <Text style={styles.cellPrimary}>{o.name}</Text>
                      <Text style={styles.cellSub}>
                        {clientAdminsByOrg(o.id).filter((a) => !a.deactivated_at).length > 0
                          ? clientAdminsByOrg(o.id)
                              .filter((a) => !a.deactivated_at)
                              .map((a) => a.name ?? 'Unnamed')
                              .join(', ')
                          : 'No active admin'}
                      </Text>
                    </View>
                  ),
                },
                {
                  key: 'manager',
                  header: 'Default Manager',
                  width: 190,
                  render: (o) =>
                    managers.length === 0 ? (
                      <Text style={styles.cellSub}>No managers yet</Text>
                    ) : (
                      <Dropdown options={managerOptions} value={defaultManagerByOrg[o.id] ?? null} onChange={(v) => setDefaultManager(o.id, v)} placeholder="Unassigned" />
                    ),
                },
                {
                  key: 'accountant',
                  header: 'Default Accountant',
                  width: 190,
                  render: (o) =>
                    accountants.length === 0 ? (
                      <Text style={styles.cellSub}>No accountants yet</Text>
                    ) : (
                      <Dropdown options={accountantOptions} value={defaultAccountantByOrg[o.id] ?? null} onChange={(v) => setDefaultAccountant(o.id, v)} placeholder="Unassigned" />
                    ),
                },
                {
                  key: 'status',
                  header: '',
                  width: 130,
                  render: (o) => (!defaultManagerByOrg[o.id] || !defaultAccountantByOrg[o.id] ? <Text style={styles.warningText}>Blocks new Clients</Text> : null),
                },
              ]}
              ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No client organizations yet.'}</Text>}
              />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Clients</Text>
              <Text style={styles.sectionSubtitle}>Every Client and Client Admin, with their current team.</Text>
              {saveError && <Text style={styles.errorBanner}>Error: {saveError}</Text>}
              <DataTable
              scrollable={false}
              data={loading ? [] : clientTableRows}
              keyExtractor={(r) => r.key}
              columns={[
                {
                  key: 'client',
                  header: 'Client',
                  width: 190,
                  render: (r) => (
                    <View>
                      <Text style={[styles.cellPrimary, r.deactivated && styles.deactivatedName]}>{r.name ?? 'Unnamed'}</Text>
                      {r.roleTag === 'Client Admin' && <Text style={styles.cellSub}>Client Admin</Text>}
                      {r.deactivated && <Text style={styles.deactivatedTag}>Deactivated</Text>}
                    </View>
                  ),
                },
                { key: 'org', header: 'Organisation', width: 160, render: (r) => <Text style={styles.cellSub}>{r.orgName ?? '—'}</Text> },
                {
                  key: 'manager',
                  header: 'Manager',
                  width: 190,
                  render: (r) => {
                    if (!r.clientId) return <Text style={styles.cellSub}>—</Text>;
                    if (editingClientId === r.clientId) return <Dropdown options={managerOptions} value={draftManagerId} onChange={setDraftManagerId} placeholder="Unassigned" />;
                    return (
                      <View style={styles.nameCell}>
                        <Avatar name={staffNameById[r.managerId ?? ''] ?? null} />
                        <Text style={styles.cellSub}>{staffNameById[r.managerId ?? ''] ?? 'Unassigned'}</Text>
                      </View>
                    );
                  },
                },
                {
                  key: 'accountant',
                  header: 'Accountant',
                  width: 190,
                  render: (r) => {
                    if (!r.clientId) return <Text style={styles.cellSub}>—</Text>;
                    if (editingClientId === r.clientId) return <Dropdown options={accountantOptions} value={draftAccountantId} onChange={setDraftAccountantId} placeholder="Unassigned" />;
                    return (
                      <View style={styles.nameCell}>
                        <Avatar name={staffNameById[r.accountantId ?? ''] ?? null} />
                        <Text style={styles.cellSub}>{staffNameById[r.accountantId ?? ''] ?? 'Unassigned'}</Text>
                      </View>
                    );
                  },
                },
                {
                  key: 'actions',
                  header: '',
                  width: 230,
                  render: (r) => {
                    if (r.clientId && editingClientId === r.clientId) {
                      return (
                        <View style={styles.actionRow}>
                          <OutlineButton title={saving ? 'Saving...' : 'Save'} onPress={() => saveEdit(r.clientId!)} />
                          <OutlineButton title="Cancel" onPress={cancelEdit} />
                        </View>
                      );
                    }
                    const target = { id: r.userId, name: r.name, role: r.roleTag === 'Client' ? 'client' : 'client_admin' };
                    return (
                      <View style={styles.actionRow}>
                        {/* A deactivated Client keeps their assignment row, and it can still be edited — e.g. when
                            the Manager or Accountant it points at is leaving. */}
                        {r.clientId && <OutlineButton title="Edit" onPress={() => startEdit(r)} />}
                        {r.deactivated ? (
                          <OutlineButton title="Reactivate" onPress={() => openPanel(target, 'reactivate')} />
                        ) : (
                          <TouchableOpacity style={styles.deactivateLink} onPress={() => openPanel(target, 'deactivate')}>
                            <Text style={styles.deactivateLinkText}>Deactivate</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  },
                },
              ]}
              ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No Clients yet.'}</Text>}
              />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Staff</Text>
              <Text style={styles.sectionSubtitle}>Managers and Accountants.</Text>
              <DataTable
              scrollable={false}
              data={loading ? [] : allStaff}
              keyExtractor={(s) => s.id}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  width: 180,
                  render: (s) => (
                    <View style={styles.nameCell}>
                      <Avatar name={s.name} />
                      <View>
                        <Text style={[styles.cellPrimary, !!s.deactivated_at && styles.deactivatedName]}>{s.name ?? 'Unnamed'}</Text>
                        {!!s.deactivated_at && <Text style={styles.deactivatedTag}>Deactivated</Text>}
                      </View>
                    </View>
                  ),
                },
                { key: 'email', header: 'Email', width: 200, render: (s) => <Text style={styles.cellSub}>{s.email ?? '—'}</Text> },
                { key: 'role', header: 'Role', width: 110, render: (s) => <Text style={styles.cellSub}>{s.role === 'manager' ? 'Manager' : 'Accountant'}</Text> },
                {
                  key: 'clients',
                  header: 'Clients',
                  width: 80,
                  render: (s) => <Text style={styles.cellSub}>{(s.role === 'manager' ? managerWorkload(s.id) : accountantWorkload(s.id)).length}</Text>,
                },
                {
                  key: 'firmWide',
                  header: 'Firm-wide',
                  width: 100,
                  render: (s) => (
                    <Switch
                      value={!!s.firm_wide_staff}
                      onValueChange={(v) => toggleFirmWide(s.id, v)}
                      trackColor={{ false: colors.border, true: colors.tint }}
                      thumbColor={s.firm_wide_staff ? colors.orange : '#fff'}
                    />
                  ),
                },
                {
                  key: 'status',
                  header: '',
                  width: 130,
                  render: (s) =>
                    s.deactivated_at ? (
                      <OutlineButton title="Reactivate" onPress={() => openPanel({ id: s.id, name: s.name, role: s.role }, 'reactivate')} />
                    ) : (
                      <TouchableOpacity style={styles.deactivateLink} onPress={() => openPanel({ id: s.id, name: s.name, role: s.role }, 'deactivate')}>
                        <Text style={styles.deactivateLinkText}>Deactivate</Text>
                      </TouchableOpacity>
                    ),
                },
              ]}
              ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No staff created yet.'}</Text>}
              />
            </View>
          </>
        )}

        {subTab === 'add' && (
          <>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Client organization</Text>
              {onboardError && <Text style={styles.errorText}>{onboardError}</Text>}
              <TextInput style={styles.input} placeholder="Organization name" placeholderTextColor={colors.textFaint} value={orgName} onChangeText={setOrgName} />
              <TextInput style={styles.input} placeholder="Seat limit" placeholderTextColor={colors.textFaint} value={seatLimit} onChangeText={setSeatLimit} keyboardType="number-pad" />
              <PrimaryButton title={onboarding ? 'Adding...' : 'Add organization'} onPress={onboardOrg} disabled={onboarding || !orgName.trim()} />
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Client Admin</Text>
              {adminCreateError && <Text style={styles.errorText}>{adminCreateError}</Text>}
              <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textFaint} value={adminName} onChangeText={setAdminName} />
              <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textFaint} autoCapitalize="none" value={adminEmail} onChangeText={setAdminEmail} />
              {clientOrgs.length === 0 ? (
                <Text style={styles.empty}>Add a client organization first.</Text>
              ) : (
                <Dropdown options={clientOrgs.map((o) => ({ value: o.id, label: o.name }))} value={adminOrgId} onChange={setAdminOrgId} placeholder="Client organization" />
              )}
              <View style={{ marginTop: 10 }}>
                <PrimaryButton title={creatingAdmin ? 'Creating...' : 'Create Client Admin'} onPress={createClientAdmin} disabled={creatingAdmin || !adminName.trim() || !adminEmail.trim()} />
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Manager / Accountant</Text>
              {createError && <Text style={styles.errorText}>{createError}</Text>}
              <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textFaint} value={staffName} onChangeText={setStaffName} />
              <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textFaint} autoCapitalize="none" value={staffEmail} onChangeText={setStaffEmail} />
              <ChipSelect
                options={[
                  { value: 'manager', label: 'Manager' },
                  { value: 'accountant', label: 'Accountant' },
                ]}
                value={staffRole}
                onChange={(v) => setStaffRole(v as 'manager' | 'accountant')}
              />
              <View style={{ marginTop: 10 }}>
                <PrimaryButton title={creatingStaff ? 'Creating...' : 'Create staff member'} onPress={createStaff} disabled={creatingStaff || !staffName.trim() || !staffEmail.trim()} />
              </View>
            </View>
          </>
        )}
      </View>
      <DeactivateUserPanel
        profile={profile}
        target={panelTarget}
        mode={panelMode}
        onClose={() => setPanelTarget(null)}
        onDone={async () => {
          setPanelTarget(null);
          await load();
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4, gap: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subheading: { fontSize: 12, color: colors.textFaint },
  // Each of the three tables (Client Organizations / Clients / Staff) now
  // sits in its own bordered card — previously they ran together on one
  // plain background with only a marginTop hack between them, which read
  // as one long undifferentiated page rather than three distinct
  // sections.
  sectionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  // Uppercase to match the table column headers' casing (DataTable's
  // headerText is uppercase) — these section titles were previously the
  // only heading level on this screen not following that convention.
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionSubtitle: { fontSize: 12, color: colors.textFaint, marginTop: 2, marginBottom: 12 },
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
  credentialsBanner: {
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    marginBottom: 16,
  },
  credentialsTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  credentialsText: { fontSize: 13, color: colors.text, fontFamily: 'monospace' as any, marginBottom: 2 },
  credentialsHint: { fontSize: 11, color: colors.textFaint, marginTop: 6, marginBottom: 10, fontStyle: 'italic' },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    marginBottom: 16,
  },
  panelTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 },
  input: {
    borderWidth: 1,
    maxWidth: 420,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 10.5, fontWeight: '700', color: colors.orangeDeep },
  cellPrimary: { fontSize: 14, fontWeight: '600', color: colors.text },
  cellSub: { fontSize: 12, color: colors.textFaint },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  deactivatedName: { color: colors.textFaint },
  deactivatedTag: { fontSize: 10.5, fontWeight: '700', color: colors.danger, marginTop: 1 },
  deactivateLink: { paddingVertical: 8, paddingHorizontal: 4 },
  deactivateLinkText: { fontSize: 12, fontWeight: '600', color: colors.danger },
  empty: { color: colors.textFaint, marginTop: 12, marginBottom: 12, textAlign: 'center' },
});
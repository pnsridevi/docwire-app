// LOCATION: docwire-app/screens/ManagerAssignmentScreen.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { ScreenContainer, StatRow } from '../components/UI';
import { DataTable } from '../components/DataTable';
import { Profile } from '../lib/types';

type Row = {
  key: string;
  clientId: string;
  clientName: string | null;
  clientOrgName: string | null;
  managerId: string;
  managerName: string | null;
};

type ManagerSummary = { id: string; name: string | null; count: number };

// Accountant's "Team" tab — the symmetric counterpart to Manager's
// AccountantAssignmentScreen.tsx (D.6). Same read-only shape, same
// source of truth (client_assignments, filtered to this Accountant),
// just the other column: for each Client this Accountant currently
// covers, their organisation and their Manager. Same follow-up pass as
// AccountantAssignmentScreen.tsx added the workload chips, StatRow, and
// search above the table.
//
// No write path here either — same Revision 3 authority move
// (assignment changes go through Super Admin's Client Assignments)
// applies equally to Accountant, who never had write access to this in
// the first place.
export default function ManagerAssignmentScreen({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [summaries, setSummaries] = useState<ManagerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    const { data: assignments, error } = await supabase
      .from('client_assignments')
      .select('client_id,manager_id,client_org_id')
      .eq('accountant_id', profile.id);
    if (error) {
      console.error('[ManagerAssignmentScreen] load failed:', error);
      setLoadError(error.message);
      setRows([]);
      setSummaries([]);
      setLoading(false);
      return;
    }
    const assignmentRows = assignments ?? [];
    if (assignmentRows.length === 0) {
      setLoadError(null);
      setRows([]);
      setSummaries([]);
      setLoading(false);
      return;
    }

    const clientIds = assignmentRows.map((r: any) => r.client_id);
    const orgIds = Array.from(new Set(assignmentRows.map((r: any) => r.client_org_id))) as string[];
    const managerIds = Array.from(new Set(assignmentRows.map((r: any) => r.manager_id))) as string[];
    const [{ data: clients }, { data: orgs }, { data: managers }] = await Promise.all([
      supabase.from('users').select('id,name,deactivated_at').in('id', clientIds),
      supabase.from('client_organizations').select('id,name').in('id', orgIds),
      supabase.from('users').select('id,name').in('id', managerIds),
    ]);
    const clientNameById: Record<string, string | null> = {};
    // A deactivated Client keeps their assignment row (Add_user_deactivation.sql),
    // so they still appear here — labelled, so it's clear why.
    (clients ?? []).forEach((c: any) => (clientNameById[c.id] = c.deactivated_at ? `${c.name ?? 'Unnamed'} (deactivated)` : c.name));
    const orgNameById: Record<string, string | null> = {};
    (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));
    const managerNameById: Record<string, string | null> = {};
    (managers ?? []).forEach((m: any) => (managerNameById[m.id] = m.name));

    const countByManager: Record<string, number> = {};
    assignmentRows.forEach((r: any) => {
      countByManager[r.manager_id] = (countByManager[r.manager_id] ?? 0) + 1;
    });

    const built: Row[] = assignmentRows.map((r: any) => ({
      key: `${r.client_id}::${r.manager_id}`,
      clientId: r.client_id,
      clientName: clientNameById[r.client_id] ?? null,
      clientOrgName: orgNameById[r.client_org_id] ?? null,
      managerId: r.manager_id,
      managerName: managerNameById[r.manager_id] ?? null,
    }));

    built.sort((a, b) => (a.clientOrgName ?? '').localeCompare(b.clientOrgName ?? '') || (a.clientName ?? '').localeCompare(b.clientName ?? ''));

    const builtSummaries: ManagerSummary[] = managerIds
      .map((id) => ({ id, name: managerNameById[id] ?? null, count: countByManager[id] ?? 0 }))
      .sort((a, b) => b.count - a.count);

    setLoadError(null);
    setRows(built);
    setSummaries(builtSummaries);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.managerName ?? '').toLowerCase().includes(q) ||
        (r.clientOrgName ?? '').toLowerCase().includes(q) ||
        (r.clientName ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <ScreenContainer scroll>
      <View style={styles.screen}>
        <Text style={styles.heading}>Your team</Text>
        <Text style={styles.subheading}>
          The Clients you cover, their organisation, and their Manager. Assignment changes happen through Super Admin's
          Client Assignments — this view is read-only.
        </Text>
        {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

        {!loading && rows.length > 0 && (
          <>
            <StatRow
              items={[
                { num: String(rows.length), label: 'Clients', icon: 'briefcase' },
                { num: String(summaries.length), label: 'Managers', icon: 'users' },
              ]}
            />

            <TextInput
              style={styles.input}
              placeholder="Search by manager, organisation, or client..."
              placeholderTextColor={colors.textFaint}
              value={search}
              onChangeText={setSearch}
            />
          </>
        )}

        <DataTable
          scrollable={false}
          data={loading ? [] : visibleRows}
          keyExtractor={(r) => r.key}
          columns={[
            { key: 'client', header: 'Client', width: 200, render: (r) => <Text style={styles.cellPrimary}>{r.clientName ?? 'Unnamed'}</Text> },
            { key: 'org', header: 'Organisation', width: 200, render: (r) => <Text style={styles.cellSub}>{r.clientOrgName ?? '—'}</Text> },
            { key: 'manager', header: 'Manager', width: 200, render: (r) => <Text style={styles.cellSub}>{r.managerName ?? 'Unnamed'}</Text> },
          ]}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {loading ? 'Loading...' : rows.length === 0 ? "You don't have any assigned clients yet." : 'No matches for that search.'}
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
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 16 },
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
  summaryLine: { fontSize: 12, color: colors.textFaint, marginBottom: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    maxWidth: 320,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  cellPrimary: { fontSize: 14, fontWeight: '600', color: colors.text },
  cellSub: { fontSize: 12, color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
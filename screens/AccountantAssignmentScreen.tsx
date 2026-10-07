// LOCATION: docwire-app/screens/AccountantAssignmentScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { ScreenContainer, StatRow } from '../components/UI';
import { DataTable } from '../components/DataTable';
import { Profile } from '../lib/types';

type Row = {
  key: string;
  accountantId: string;
  accountantName: string | null;
  clientOrgName: string | null;
  clientName: string | null;
};

type AccountantSummary = { id: string; name: string | null; count: number };

// Manager's "Team" tab. Phase 2, item D.6, reworked this session into
// table format for readability against real data volumes — one row per
// (Accountant, Client) pair: Accountant | Client Organisation | Client.
// A follow-up pass this session added the workload summary chips and
// StatRow above the table — a bare table with no other context read as
// too sparse a screen on its own, especially for a Manager with only a
// couple of Accountants.
//
// This used to be a write screen — Manager assigned an Accountant to
// each of their Clients directly. That authority moved to Super Admin in
// Revision 3 (Migration_client_assignment_foundation.sql, section 1):
// accountant_assignments' Manager write policies were dropped and never
// replaced with anything scoped to Manager. Rebuilt as read-only, sourced
// from client_assignments — the same per-Client, currently-effective
// table D.1/D.3/D.6 all resolve through — rather than the org-level
// accountant_assignments this screen used to read.
export default function AccountantAssignmentScreen({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [summaries, setSummaries] = useState<AccountantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    // client_org_id already lives on client_assignments itself — no need
    // to join back through the client user's own record for it.
    const { data: assignments, error } = await supabase
      .from('client_assignments')
      .select('client_id,accountant_id,client_org_id')
      .eq('manager_id', profile.id);
    if (error) {
      console.error('[AccountantAssignmentScreen] load failed:', error);
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
    const accountantIds = Array.from(new Set(assignmentRows.map((r: any) => r.accountant_id))) as string[];
    const [{ data: clients }, { data: orgs }, { data: accountants }] = await Promise.all([
      supabase.from('users').select('id,name').in('id', clientIds),
      supabase.from('client_organizations').select('id,name').in('id', orgIds),
      supabase.from('users').select('id,name').in('id', accountantIds),
    ]);
    const clientNameById: Record<string, string | null> = {};
    (clients ?? []).forEach((c: any) => (clientNameById[c.id] = c.name));
    const orgNameById: Record<string, string | null> = {};
    (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));
    const accountantNameById: Record<string, string | null> = {};
    (accountants ?? []).forEach((a: any) => (accountantNameById[a.id] = a.name));

    const countByAccountant: Record<string, number> = {};
    assignmentRows.forEach((r: any) => {
      countByAccountant[r.accountant_id] = (countByAccountant[r.accountant_id] ?? 0) + 1;
    });

    const built: Row[] = assignmentRows.map((r: any) => ({
      key: `${r.accountant_id}::${r.client_id}`,
      accountantId: r.accountant_id,
      accountantName: accountantNameById[r.accountant_id] ?? null,
      clientOrgName: orgNameById[r.client_org_id] ?? null,
      clientName: clientNameById[r.client_id] ?? null,
    }));

    // Workload-desc ordering — the point of a Team view is seeing who's
    // carrying the most at a glance — via a per-accountant count computed
    // first, then each accountant's own rows sorted by org then client.
    built.sort((a, b) => {
      const workloadDiff = (countByAccountant[b.accountantId] ?? 0) - (countByAccountant[a.accountantId] ?? 0);
      if (workloadDiff !== 0) return workloadDiff;
      const orgDiff = (a.clientOrgName ?? '').localeCompare(b.clientOrgName ?? '');
      if (orgDiff !== 0) return orgDiff;
      return (a.clientName ?? '').localeCompare(b.clientName ?? '');
    });

    const builtSummaries: AccountantSummary[] = accountantIds
      .map((id) => ({ id, name: accountantNameById[id] ?? null, count: countByAccountant[id] ?? 0 }))
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

  const totalClients = useMemo(() => rows.length, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.accountantName ?? '').toLowerCase().includes(q) ||
        (r.clientOrgName ?? '').toLowerCase().includes(q) ||
        (r.clientName ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <ScreenContainer scroll>
      <View style={styles.screen}>
        <Text style={styles.heading}>Your team</Text>
        <Text style={styles.subheading}>
          The Accountants covering your Clients, and who each of them handles. Assignment changes now happen through Super
          Admin's Client Assignments — this view is read-only.
        </Text>
        {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

        {!loading && rows.length > 0 && (
          <>
            <StatRow
              items={[
                { num: String(summaries.length), label: 'Accountants', icon: 'user-plus' },
                { num: String(totalClients), label: 'Clients Covered', icon: 'briefcase' },
              ]}
            />

            <TextInput
              style={styles.input}
              placeholder="Search by accountant, organisation, or client..."
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
            { key: 'accountant', header: 'Accountant', width: 200, render: (r) => <Text style={styles.cellPrimary}>{r.accountantName ?? 'Unnamed'}</Text> },
            { key: 'org', header: 'Client Organisation', width: 200, render: (r) => <Text style={styles.cellSub}>{r.clientOrgName ?? '—'}</Text> },
            { key: 'client', header: 'Client', width: 200, render: (r) => <Text style={styles.cellSub}>{r.clientName ?? 'Unnamed'}</Text> },
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
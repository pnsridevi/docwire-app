import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { ChipSelect, ScreenContainer, useGridColumns, padForGrid } from '../components/UI';
import { Profile } from '../lib/types';

type ClientRow = {
  client_org_id: string;
  client_org_name: string;
  current_accountant_id: string | null;
};

type AccountantOption = {
  id: string;
  name: string | null;
  // Every OTHER client this accountant already serves, tenant-wide —
  // Architecture Section 8.1: "a Manager sees exactly which other clients
  // an Accountant is already handling."
  otherClients: string[];
};

// Manager-only. Architecture Section 8: Manager assigns an Accountant to
// each of THEIR OWN clients only — enforced by RLS
// (accountant_assignments_insert_manager / update_manager), not just by
// this screen only listing the Manager's own clients.
export default function AccountantAssignmentScreen({ profile }: { profile: Profile }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [accountants, setAccountants] = useState<AccountantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const columns = useGridColumns();

  const load = async () => {
    setLoading(true);
    const { data: myClients } = await supabase
      .from('manager_assignments')
      .select('client_org_id')
      .eq('manager_id', profile.id);
    const clientOrgIds = (myClients ?? []).map((r: any) => r.client_org_id);

    if (clientOrgIds.length === 0) {
      setClients([]);
      setAccountants([]);
      setLoading(false);
      return;
    }

    const [{ data: orgs }, { data: currentAssignments }, { data: allAccountantUsers }, { data: allAssignmentsTenantWide }] =
      await Promise.all([
        supabase.from('client_organizations').select('id,name').in('id', clientOrgIds),
        supabase.from('accountant_assignments').select('client_org_id,accountant_id').in('client_org_id', clientOrgIds),
        supabase.from('users').select('id,name').eq('role', 'accountant').eq('tenant_id', profile.tenant_id),
        // Tenant-wide, via accountant_assignments_tenant_managers policy —
        // this is what makes workload visibility possible.
        supabase.from('accountant_assignments').select('client_org_id,accountant_id'),
      ]);

    const orgNameById: Record<string, string> = {};
    (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));

    const currentByClient: Record<string, string> = {};
    (currentAssignments ?? []).forEach((a: any) => (currentByClient[a.client_org_id] = a.accountant_id));

    const rows: ClientRow[] = clientOrgIds.map((id: string) => ({
      client_org_id: id,
      client_org_name: orgNameById[id] ?? id,
      current_accountant_id: currentByClient[id] ?? null,
    }));

    // Build a global org-name lookup covering every client in the tenant-wide
    // assignment set, not just this Manager's own clients, so workload
    // labels can show real names instead of ids for clients outside this
    // Manager's own scope.
    const allClientOrgIds = Array.from(new Set((allAssignmentsTenantWide ?? []).map((a: any) => a.client_org_id)));
    const { data: allOrgs } = allClientOrgIds.length
      ? await supabase.from('client_organizations').select('id,name').in('id', allClientOrgIds)
      : { data: [] as any[] };
    const globalOrgNameById: Record<string, string> = { ...orgNameById };
    (allOrgs ?? []).forEach((o: any) => (globalOrgNameById[o.id] = o.name));

    const options: AccountantOption[] = (allAccountantUsers ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      otherClients: (allAssignmentsTenantWide ?? [])
        .filter((a: any) => a.accountant_id === u.id)
        .map((a: any) => globalOrgNameById[a.client_org_id] ?? a.client_org_id),
    }));

    setClients(rows);
    setAccountants(options);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assign = async (clientOrgId: string, accountantId: string) => {
    await supabase
      .from('accountant_assignments')
      .upsert({ client_org_id: clientOrgId, accountant_id: accountantId }, { onConflict: 'client_org_id' });
    await load();
  };

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <Text style={styles.heading}>Accountant assignments</Text>
        <Text style={styles.subheading}>Assign an Accountant to each of your clients. Chip shows their other current clients.</Text>
        {loading ? (
          <Text style={styles.empty}>Loading...</Text>
        ) : (
          <FlatList
            key={columns} // RN requires a remount when numColumns changes
            data={padForGrid(clients, columns)}
            keyExtractor={(c, i) => c?.client_org_id ?? `spacer-${i}`}
            numColumns={columns}
            columnWrapperStyle={columns === 2 ? styles.gridRow : undefined}
            renderItem={({ item }) =>
              !item ? (
                <View style={[styles.clientCard, styles.clientCardGrid, styles.spacer]} />
              ) : (
                <View style={[styles.clientCard, columns === 2 && styles.clientCardGrid]}>
                  <Text style={styles.clientName}>{item.client_org_name}</Text>
                  <ChipSelect
                    options={accountants.map((a) => ({
                      value: a.id,
                      label:
                        a.otherClients.length > 0
                          ? `${a.name ?? 'Unnamed'} (${a.otherClients.length} other client${a.otherClients.length > 1 ? 's' : ''})`
                          : `${a.name ?? 'Unnamed'} (no other clients)`,
                    }))}
                    value={item.current_accountant_id}
                    onChange={(id) => assign(item.client_org_id, id)}
                  />
                  {item.current_accountant_id &&
                    (() => {
                      const current = accountants.find((a) => a.id === item.current_accountant_id);
                      const others = (current?.otherClients ?? []).filter((n) => n !== item.client_org_name);
                      return others.length > 0 ? (
                        <Text style={styles.workloadText}>Also handles: {others.join(', ')}</Text>
                      ) : null;
                    })()}
                </View>
              )
            }
            ListEmptyComponent={<Text style={styles.empty}>You don't have any assigned clients yet.</Text>}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 16 },
  gridRow: { justifyContent: 'space-between' },
  clientCard: {
    padding: 14,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  clientCardGrid: { width: '48%' },
  spacer: { backgroundColor: 'transparent', borderColor: 'transparent' },
  clientName: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 8 },
  workloadText: { fontSize: 12, color: colors.textFaint, marginTop: 8, fontStyle: 'italic' },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
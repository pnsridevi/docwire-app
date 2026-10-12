// LOCATION: docwire-app/screens/SuperAdminDocumentsScreen.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { Pill, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { useBreakpoint } from '../components/useBreakpoint';
import { getDocumentSignedUrl, displayFileName } from '../lib/storage';
import { Doc, Profile } from '../lib/types';
import { loadDeactivatedIds, nameWithStatus } from '../lib/users';
import { useMasterDocMarking } from '../components/MasterDocControls';

type TypeFilter = 'all' | 'entry' | 'filed' | 'rework';

function roleLabel(source: string): string {
  return source === 'client' ? 'Client' : source === 'manager' ? 'Manager' : 'Accountant';
}

// Split in two so the org is ALWAYS visible, not just for broadcasts —
// previously a specific-client row (e.g. "Gandhi") showed no org at all,
// so a Super Admin scanning platform-wide couldn't tell which client org
// it belonged to without cross-referencing. clientOrgLabel is now the
// primary line; clientIdentityLabel is the secondary line underneath.
//
// A direct staff-to-staff share (migration_add_staff_direct_tasks_and_
// docs.sql) has no client_org_id at all — "Unknown org" would wrongly
// suggest missing/bad data rather than a deliberate internal exchange,
// so that case is called out explicitly instead of falling through to
// the same fallback used for a genuine data gap.
function clientOrgLabel(d: Doc): string {
  if (!d.client_org_id) return 'Internal';
  return d.client_org_name ?? 'Unknown org';
}
function clientIdentityLabel(d: Doc, dz: Set<string> = new Set()): string {
  if (!d.client_org_id) return d.shared_with_user_name ? `Direct to ${nameWithStatus(d.shared_with_user_name, d.shared_with_user_id, dz)}` : 'Direct share';
  return d.client_id ? nameWithStatus(d.client_name ?? 'Unnamed', d.client_id, dz) : 'All Clients';
}

// "Bhargavi (Accountant)" — who actually created this row, name + role
// together, matching the demo's elaborated style.
function sourceLabel(d: Doc, dz: Set<string> = new Set()): string {
  return `${nameWithStatus(d.uploaded_by_name, d.uploaded_by, dz)} (${roleLabel(d.source)})`;
}

// Who currently has visibility, spelled out rather than left implicit —
// resolves the exact ambiguity ("is this shared with Nandini or
// Gandhi?") a bare "Clients" label couldn't answer. Client-source
// documents always route to Manager + Accountant per the document
// lifecycle (Architecture §6.2-6.3), no toggle involved, so that case is
// fixed rather than computed from flags.
function sharedWithLabel(d: Doc, dz: Set<string> = new Set()): string {
  if (d.source === 'client') return 'Manager, Accountant';
  if (d.shared_with_user_id) return (d.shared_with_user_name ? nameWithStatus(d.shared_with_user_name, d.shared_with_user_id, dz) : 'One colleague (direct share)');
  const parts: string[] = [];
  if (d.shared_with_manager) parts.push('Manager');
  if (d.shared_with_accountant) parts.push('Accountant');
  if (d.shared_with_clients) {
    parts.push('Client Admin');
    parts.push(d.client_id ? nameWithStatus(d.client_name ?? 'a Client', d.client_id, dz) : 'All Clients');
  }
  return parts.length ? parts.join(', ') : 'Not shared';
}

// Super Admin's Documents view: platform-wide (Roles doc: "Full
// visibility: all clients, documents..."), view-only — no Mark
// Accounted/Reviewed/Rework actions (Roles doc: "Does not perform book
// entries or reviews"). RLS (documents_select_super_admin) already
// scopes this to the caller's own tenant, so no client-side scope toggle
// is needed the way Manager/Accountant have "My Clients / All Clients."
export default function SuperAdminDocumentsScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  // Master Documents: "Master" tag on documents that already are one, and a
  // "Mark as master" link on those that could be (components/MasterDocControls.tsx).
  const masterDocs = useMasterDocMarking(profile);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  // People who have been deactivated (Add_user_deactivation.sql) — shown as "Name (deactivated)".
  const [deactivatedIds, setDeactivatedIds] = useState<Set<string>>(new Set());
  // Doc names rendered here were plain Text with no action — the list
  // showed correctly, but nothing was ever wired to actually open a
  // file. Same signed-URL mechanism AccountantHomeScreen.tsx /
  // ManagerHomeScreen.tsx already use; Super Admin has no
  // Accounted/Reviewed/Rework actions, but opening the file itself isn't
  // an action gated by role — it's baseline access to something already
  // visible in the list.
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  const loadDocs = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[SuperAdminDocumentsScreen] loadDocs failed:', error);
      setLoadError(error.message);
      setDocs([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setDocs((data as Doc[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadDeactivatedIds().then(setDeactivatedIds);
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rows created before file storage existed have file_path=null and
  // have nothing to open — callers check that before rendering the
  // action as pressable.
  const handleOpenDocument = async (doc: Doc) => {
    if (!doc.file_path) return;
    setOpeningDocId(doc.id);
    const url = await getDocumentSignedUrl(doc.file_path);
    setOpeningDocId(null);
    if (!url) {
      setLoadError('Could not open this file — it may have been removed.');
      return;
    }
    await Linking.openURL(url);
  };

  const visibleDocs = useMemo(() => {
    let v = docs;
    if (typeFilter === 'entry') v = v.filter((d) => d.needs_entry);
    if (typeFilter === 'filed') v = v.filter((d) => !d.needs_entry);
    if (typeFilter === 'rework') v = v.filter((d) => d.status === 'rework');
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((d) => d.name.toLowerCase().includes(q) || (d.client_org_name ?? '').toLowerCase().includes(q));
    return v;
  }, [docs, typeFilter, search]);

  const listHeader = (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.heading}>Documents</Text>
      <Text style={styles.subheading}>Platform-wide, view-only.</Text>
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

      <StatRow
        items={[
          { num: String(docs.length), label: 'Total Documents', icon: 'file-text' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'pending').length), label: 'Pending', icon: 'clock' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'accounted').length), label: 'Accounted', icon: 'check-square' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'reviewed').length), label: 'Reviewed', icon: 'activity' },
        ]}
      />

      <View style={styles.filterSearchRow}>
        <ChipSelect
          options={[
            { value: 'all', label: 'All Types' },
            { value: 'entry', label: 'Needs Entry' },
            { value: 'filed', label: 'Filed Only' },
            { value: 'rework', label: 'Needs Rework' },
          ]}
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search documents..."
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />
      </View>
    </View>
  );

  const emptyMessage = (
    <Text style={styles.empty}>{loading ? 'Loading...' : docs.length === 0 ? 'No documents yet.' : 'No documents match this filter.'}</Text>
  );
  const rowData = loading ? [] : visibleDocs;

  return (
    <ScreenContainer scroll={breakpoint !== 'phone'}>
      <View style={[styles.screen, breakpoint === 'phone' && styles.screenPhone]}>
        {breakpoint === 'phone' ? (
          <ResponsiveGrid
            data={rowData}
            keyExtractor={(d) => d.id}
            ListHeaderComponent={listHeader}
            renderItem={(item, columns) => (
              <View style={[styles.docCard, columns === 2 && styles.docCardGrid]}>
                <TouchableOpacity style={styles.docNameRow} disabled={!item.file_path} onPress={() => handleOpenDocument(item)}>
                  <Feather name="file-text" size={13} color={colors.textFaint} />
                  <Text style={styles.docName}>{item.name}</Text>
                </TouchableOpacity>
                {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                {masterDocs.renderControl(item)}
                <Text style={styles.clientOrgText}>{clientOrgLabel(item)}</Text>
                <Text style={styles.clientIdentityText}>{clientIdentityLabel(item, deactivatedIds)}</Text>
                <Pill status={item.status} />
              </View>
            )}
            ListEmptyComponent={emptyMessage}
          />
        ) : (
          <DataTable
            scrollable={false}
            data={rowData}
            keyExtractor={(d) => d.id}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyMessage}
            columns={[
              { key: 'file', header: 'File', width: 280, render: (item) => (
                <View>
                  <TouchableOpacity style={styles.docNameRow} disabled={!item.file_path} onPress={() => handleOpenDocument(item)}>
                    <Feather name="file-text" size={13} color={colors.textFaint} />
                    <Text style={styles.docName}>{item.name}</Text>
                  </TouchableOpacity>
                  {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                  {masterDocs.renderControl(item)}
                </View>
              ) },
              { key: 'client', header: 'Client Org', width: 180, render: (item) => (
                <View>
                  <Text style={styles.clientOrgText}>{clientOrgLabel(item)}</Text>
                  <Text style={styles.clientIdentityText}>{clientIdentityLabel(item, deactivatedIds)}</Text>
                </View>
              ) },
              { key: 'source', header: 'Source', width: 190, render: (item) => <Text style={styles.docMeta}>{sourceLabel(item, deactivatedIds)}</Text> },
              { key: 'sharedWith', header: 'Shared with', width: 210, render: (item) => <Text style={styles.docMeta}>{sharedWithLabel(item, deactivatedIds)}</Text> },
              { key: 'status', header: 'Status', width: 140, render: (item) => <Pill status={item.status} /> },
            ]}
          />
        )}
      </View>
      {masterDocs.modal}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  // Only applied on phone — ResponsiveGrid's FlatList needs a
  // flex-bounded parent to size and scroll itself correctly. On
  // tablet/desktop, ScreenContainer(scroll) owns the scrolling instead,
  // and flex:1 here would risk the zero-height quirk that comes from
  // giving a scroll container's content flexBasis:0.
  screenPhone: { flex: 1 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
  filterSearchRow: { gap: 10, marginTop: 12, marginBottom: 4 },
  searchInput: {
    flex: 1,
    maxWidth: 320,
    minWidth: 160,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
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
  docCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  docCardGrid: { width: '48%' },
  docNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  docMeta: { fontSize: 12, color: colors.textFaint, marginBottom: 6 },
  currentFileText: { fontSize: 11, color: colors.textFaint, marginBottom: 4 },
  clientOrgText: { fontSize: 12, fontWeight: '600', color: colors.text },
  clientIdentityText: { fontSize: 11, color: colors.textFaint, marginTop: 2, marginBottom: 6 },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
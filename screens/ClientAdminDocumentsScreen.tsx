// LOCATION: docwire-app/screens/ClientAdminDocumentsScreen.tsx (NEW FILE)
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

function clientLabel(d: Doc, dz: Set<string> = new Set()): string {
  if (!d.client_org_id) return d.shared_with_user_name ? `Direct to ${nameWithStatus(d.shared_with_user_name, d.shared_with_user_id, dz)}` : 'Internal';
  return d.client_id ? nameWithStatus(d.client_name ?? 'Unnamed', d.client_id, dz) : `All Clients · ${d.client_org_name ?? 'org'}`;
}

function sourceLabel(d: Doc, dz: Set<string> = new Set()): string {
  return `${nameWithStatus(d.uploaded_by_name, d.uploaded_by, dz)} (${roleLabel(d.source)})`;
}

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

// Client Admin's Documents view: org-wide, every user's uploads, not just
// their own (Roles doc: "Documents — view only (org-wide)" — the whole
// point of the distinction from Client, who only sees their own
// uploads). RLS (documents_select_client_admin) already scopes this to
// the caller's own org, so — like Super Admin's version — there's no
// scope toggle to build, just the filters/search/table shared with every
// other Documents screen.
export default function ClientAdminDocumentsScreen({ profile }: { profile: Profile }) {
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
  // Doc names rendered in this screen were plain Text with no action —
  // the list showed correctly, but nothing was ever wired to actually
  // open a file. Same signed-URL mechanism AccountantHomeScreen.tsx /
  // ManagerHomeScreen.tsx already use; Client Admin has no
  // Accounted/Reviewed/Rework actions, but opening the file itself isn't
  // an action gated by role — it's baseline access to something they can
  // already see in the list.
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  const loadDocs = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[ClientAdminDocumentsScreen] loadDocs failed:', error);
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
    if (q) v = v.filter((d) => d.name.toLowerCase().includes(q));
    return v;
  }, [docs, typeFilter, search]);

  const listHeader = (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.heading}>Documents</Text>
      <Text style={styles.subheading}>Every document across your organization, view-only.</Text>
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
                <Text style={styles.docMeta}>{clientLabel(item, deactivatedIds)}</Text>
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
              { key: 'client', header: 'Client', width: 180, render: (item) => <Text style={styles.docMeta}>{clientLabel(item, deactivatedIds)}</Text> },
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
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
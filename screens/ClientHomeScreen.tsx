// LOCATION: docwire-app/screens/ClientHomeScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, Pill, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { pickDocumentFile, uploadDocumentFile, deleteUploadedFile, getDocumentSignedUrl, displayFileName, PickedFile } from '../lib/storage';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { useBreakpoint } from '../components/useBreakpoint';
import { Profile, Doc } from '../lib/types';
import { useMasterDocMarking } from '../components/MasterDocControls';

type TypeFilter = 'all' | 'entry' | 'filed' | 'rework';

function roleLabel(source: string): string {
  return source === 'client' ? 'Client' : source === 'manager' ? 'Manager' : 'Accountant';
}

function clientLabel(d: Doc): string {
  return d.client_id ? d.client_name ?? 'Unnamed' : `All Clients · ${d.client_org_name ?? 'org'}`;
}

function sourceLabel(d: Doc): string {
  return `${d.uploaded_by_name ?? 'Someone'} (${roleLabel(d.source)})`;
}

function sharedWithLabel(d: Doc): string {
  if (d.source === 'client') return 'Manager, Accountant';
  const parts: string[] = [];
  if (d.shared_with_manager) parts.push('Manager');
  if (d.shared_with_accountant) parts.push('Accountant');
  if (d.shared_with_clients) {
    parts.push('Client Admin');
    parts.push(d.client_id ? d.client_name ?? 'a Client' : 'All Clients');
  }
  return parts.length ? parts.join(', ') : 'Not shared';
}

export default function ClientHomeScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  // Master Documents: "Master" tag on documents that already are one, and a
  // "Mark as master" link on those that could be (components/MasterDocControls.tsx).
  const masterDocs = useMasterDocMarking(profile);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [needsEntry, setNeedsEntry] = useState(true);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [reuploadingId, setReuploadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  // Was silently swallowed before: a failed query (RLS rejection, auth
  // issue, bad query) looks IDENTICAL to "no documents" if you only check
  // `data` and ignore `error`. This surfaces the real reason on screen
  // instead of guessing from an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Who this Client's Manager/Accountant are (Architecture §8's mapping,
  // relevant to Client per Roles doc — Client should be able to tell who
  // handles their account). Phase 2 item D.1: this now reads
  // client_assignments (the per-Client, currently-effective assignment),
  // not manager_assignments/accountant_assignments (the org-level
  // default). Reading the org default here was the actual bug — a
  // per-Client override made via Super Admin's Client Assignments screen
  // correctly updated client_assignments, but this screen kept showing
  // the old team because it never looked there. RLS for the new query is
  // already in place (client_assignments_select_self,
  // Migration_client_assignment_foundation.sql).
  const [manager, setManager] = useState<{ name: string | null; email: string | null } | null>(null);
  const [accountant, setAccountant] = useState<{ name: string | null; email: string | null } | null>(null);

  // client_org_name isn't on Profile — fetched once so it can be stamped
  // onto documents at upload time (see Migration_add_display_names.sql).
  // Not shown in this screen's own cards (a Client's uploads are always
  // their own org — the label would just repeat itself), but populating
  // it here is what lets Manager/Accountant's "All Clients" documents
  // view actually show which client each of these came from.
  const loadOrgName = async () => {
    if (!profile.client_org_id) return;
    const { data } = await supabase
      .from('client_organizations')
      .select('name')
      .eq('id', profile.client_org_id)
      .single();
    setOrgName(data?.name ?? null);
  };

  const loadTeam = async () => {
    const { data: assignment, error } = await supabase
      .from('client_assignments')
      .select('manager_id,accountant_id')
      .eq('client_id', profile.id)
      .maybeSingle();
    if (error) {
      // Same reasoning as loadDocs: don't let a failed query masquerade
      // as "no assignment yet" (e.g. before the one-time backfill has
      // run for this Client, or an RLS issue).
      console.error('[ClientHomeScreen] loadTeam failed:', error);
      setManager(null);
      setAccountant(null);
      return;
    }
    const teamIds = [assignment?.manager_id, assignment?.accountant_id].filter(Boolean) as string[];
    if (teamIds.length === 0) {
      setManager(null);
      setAccountant(null);
      return;
    }
    const { data: people } = await supabase.from('users').select('id,name,email').in('id', teamIds);
    const byId: Record<string, { name: string | null; email: string | null }> = {};
    (people ?? []).forEach((p: any) => (byId[p.id] = { name: p.name, email: p.email }));
    setManager(assignment?.manager_id ? byId[assignment.manager_id] ?? null : null);
    setAccountant(assignment?.accountant_id ? byId[assignment.accountant_id] ?? null : null);
  };

  // Phase 2 fix: this used to hard-filter to .eq('uploaded_by', profile.id)
  // — correct before the sharing model existed (a Client's own uploads
  // were the only kind of document there was), but wrong now. A Manager/
  // Accountant work document shared with Clients (shared_with_clients =
  // true) is meant to reach this screen too, and the client-side filter
  // was silently dropping it before RLS ever got a chance to grant it.
  // RLS already resolves this correctly on its own — documents_client_
  // select_own (own uploads) and documents_client_select_shared_work
  // (shared staff work docs, scoped to this Client specifically or
  // org-general) are two separate SELECT policies that Postgres ORs
  // together, so an unfiltered select naturally returns the union of
  // both without this screen needing to know the difference up front.
  const loadDocs = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[ClientHomeScreen] loadDocs failed:', error);
      setLoadError(error.message);
      setDocs([]);
      return;
    }
    setLoadError(null);
    setDocs((data as Doc[]) ?? []);
  };

  useEffect(() => {
    loadOrgName();
    loadTeam();
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickFile = async () => {
    const file = await pickDocumentFile();
    if (!file) return; // user cancelled — not an error
    setPickedFile(file);
    // Name defaults to the file's own name if the field is still empty,
    // but never overwrites something the person already typed.
    if (!name.trim()) setName(file.name);
  };

  const handleUpload = async () => {
    if (!name.trim() || !pickedFile) return;
    setLoading(true);

    const uploadResult = await uploadDocumentFile(pickedFile, profile.id);
    if ('error' in uploadResult) {
      console.error('[ClientHomeScreen] file upload failed:', uploadResult.error);
      setLoadError(uploadResult.error);
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('documents').insert({
      tenant_id: profile.tenant_id,
      client_org_id: profile.client_org_id,
      client_org_name: orgName,
      uploaded_by: profile.id,
      uploaded_by_name: profile.name,
      // client_id itself is set server-side by the fix_client_document_org
      // trigger (always = the uploader, for a Client's own upload) —
      // client_name isn't trigger-derived, so it's supplied here to match.
      client_name: profile.name,
      name,
      needs_entry: needsEntry,
      // A document not flagged "needs book entry" skips the workflow
      // entirely and is just stored for reference (Architecture Section 6.2).
      // Previously this always inserted as 'pending', which incorrectly
      // routed non-entry documents into the Accountant's queue.
      status: needsEntry ? 'pending' : 'filed',
      file_path: uploadResult.path,
      file_size: pickedFile.size,
      mime_type: pickedFile.mimeType,
    });
    if (error) {
      console.error('[ClientHomeScreen] upload failed:', error);
      setLoadError(error.message);
      // The file made it to Storage but the row never did — clean it up
      // rather than leaving a permanently orphaned, inaccessible object
      // (it can never become visible anyway, since the SELECT policy
      // requires a matching documents.file_path row to exist).
      await deleteUploadedFile(uploadResult.path);
      setLoading(false);
      return;
    }
    setName('');
    setPickedFile(null);
    await loadDocs();
    setLoading(false);
  };

  // The actual moment a Manager's "the document itself needs to be
  // reuploaded" flag gets satisfied. Only ever shown/callable when
  // doc.status === 'rework' && doc.reupload_requested (RLS backs this up
  // independently via documents_client_update_own_rework_reupload — the
  // UI gate is a courtesy, not the real security boundary). Archives the
  // CURRENT file as a version before overwriting it, so nothing is ever
  // silently lost.
  const handleReupload = async (doc: Doc) => {
    console.log('[ClientHomeScreen] reupload: starting for document', { id: doc.id, name: doc.name, status: doc.status, reupload_requested: doc.reupload_requested, current_file_path: doc.file_path });
    const file = await pickDocumentFile();
    if (!file) {
      // Picker returned nothing — most commonly the user cancelled, but
      // also happens on web if the exact same file is re-selected twice
      // in a row: browsers don't fire the file input's change event when
      // the selected path string is unchanged, so the picker's promise
      // resolves as if cancelled even though the user did pick a file.
      console.log('[ClientHomeScreen] reupload: no file returned from picker (cancelled, or same-file-twice browser quirk)');
      return;
    }
    console.log('[ClientHomeScreen] reupload: file picked', { name: file.name, size: file.size, mimeType: file.mimeType });
    setReuploadingId(doc.id);

    const uploadResult = await uploadDocumentFile(file, profile.id);
    if ('error' in uploadResult) {
      console.error('[ClientHomeScreen] reupload file upload failed:', uploadResult.error);
      setLoadError(uploadResult.error);
      setReuploadingId(null);
      return;
    }
    console.log('[ClientHomeScreen] reupload: file uploaded to storage at path', uploadResult.path);

    // Archive the file being replaced — version_number is assigned by a
    // DB trigger, not supplied here, so concurrent reuploads can't race
    // into the same number. Older documents with no file yet (file_path
    // null) have nothing to archive — first real upload, not a reupload.
    if (doc.file_path) {
      const { error: versionError } = await supabase.from('document_versions').insert({
        document_id: doc.id,
        file_path: doc.file_path,
        file_size: doc.file_size,
        mime_type: doc.mime_type,
        uploaded_by: doc.uploaded_by,
        uploaded_by_name: doc.uploaded_by_name,
      });
      if (versionError) {
        console.error('[ClientHomeScreen] archiving previous version failed:', versionError);
        setLoadError(versionError.message);
        // The new file made it to Storage but nothing references it yet
        // — clean it up rather than leaving it orphaned.
        await deleteUploadedFile(uploadResult.path);
        setReuploadingId(null);
        return;
      }
      console.log('[ClientHomeScreen] reupload: previous version archived successfully');
    } else {
      console.log('[ClientHomeScreen] reupload: no previous file_path to archive (first real file on this document)');
    }

    const updatePayload = {
      file_path: uploadResult.path,
      file_size: file.size,
      mime_type: file.mimeType,
      reupload_fulfilled: true,
    };
    console.log('[ClientHomeScreen] reupload: sending documents UPDATE', { id: doc.id, updatePayload });

    // IMPORTANT: .select().single() here, not a bare .update() — without
    // it, Supabase reports success even when RLS silently matches zero
    // rows (documents_client_update_own_rework_reupload requires
    // status='rework' AND reupload_requested=true AND client_id=auth.uid()
    // all holding at this exact moment). A bare .update() would upload
    // the file fine and then silently leave the documents row completely
    // unchanged — exactly the "reupload looks like it worked but the old
    // file is still what everyone sees" failure mode. .single() forces
    // an error the moment zero rows come back, instead of hiding it.
    const { data: updated, error } = await supabase
      .from('documents')
      .update(updatePayload)
      .eq('id', doc.id)
      .select('id, file_path, reupload_fulfilled')
      .single();
    console.log('[ClientHomeScreen] reupload: UPDATE result', { updated, error });
    if (error || !updated) {
      console.error('[ClientHomeScreen] reupload failed:', error);
      setLoadError(
        error?.message ??
          'Could not save the reupload — this document may no longer be awaiting one (it may have already been re-submitted, or the request was withdrawn). Refresh and check its current status.'
      );
      await deleteUploadedFile(uploadResult.path);
      setReuploadingId(null);
      return;
    }
    setReuploadingId(null);
    await loadDocs();
  };

  // Opens a short-lived signed URL for an existing document's file.
  // Older rows created before this feature existed have file_path=null
  // and simply have nothing to open — callers check that before showing
  // the action at all.
  const handleOpenDocument = async (doc: Doc) => {
    if (!doc.file_path) return;
    setOpeningDocId(doc.id);
    const url = await getDocumentSignedUrl(doc.file_path);
    setOpeningDocId(null);
    if (!url) {
      setLoadError('Could not open this file — it may have been removed.');
      return;
    }
    Linking.openURL(url);
  };

  // Same filter set as the demo's docTypeFilter (All Types / Needs Entry /
  // Filed Only / Needs Rework), plus a client-side name search — this
  // screen's data is already small (one person's own uploads), so no
  // server round-trip is needed for either.
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
      <Text style={styles.heading}>Your documents</Text>
      {/* orgName was already fetched (loadOrgName) to stamp onto uploads —
          this is the first place it's actually shown, per this session's
          request that Client's home screen mention their organisation. */}
      {orgName && <Text style={styles.orgName}>{orgName}</Text>}
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

      {(manager || accountant) && (
        <View style={styles.teamPanel}>
          {manager && (
            <Text style={styles.teamText}>
              Manager: {manager.name ?? 'Unnamed'}{manager.email ? ` — ${manager.email}` : ''}
            </Text>
          )}
          {accountant && (
            <Text style={styles.teamText}>
              Accountant: {accountant.name ?? 'Unnamed'}{accountant.email ? ` — ${accountant.email}` : ''}
            </Text>
          )}
        </View>
      )}

      <StatRow
        items={[
          { num: String(docs.length), label: 'Total Documents', icon: 'file-text' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'pending').length), label: 'Pending', icon: 'clock' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'accounted').length), label: 'Accounted', icon: 'check-square' },
          { num: String(docs.filter((d) => d.needs_entry && d.status === 'reviewed').length), label: 'Reviewed', icon: 'activity' },
        ]}
      />

      {/* Upload is its own bounded card now, distinct from the filter/search
          row below — previously the name input, needs-entry toggle, and
          Upload button sat loose in the header with no container, reading
          as continuous with the "All Types / Needs Entry / ..." filter
          chips directly underneath (they're an unrelated search control,
          not part of the upload action). Matches the boundary already used
          for Accountant/Manager's "Upload Work Document" card. */}
      <View style={styles.uploadCard}>
        <Text style={styles.cardHeading}>Upload a document</Text>
        <View style={styles.filePickerRow}>
          <OutlineButton title={pickedFile ? 'Change file' : 'Choose file'} onPress={handlePickFile} />
          {pickedFile ? (
            <View style={styles.filePickerNameWrap}>
              <Feather name="paperclip" size={12} color={colors.textDim} />
              <Text style={styles.filePickerName} numberOfLines={1}>{pickedFile.name}</Text>
            </View>
          ) : (
            <Text style={styles.filePickerHint}>No file chosen yet</Text>
          )}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Document name (e.g. Bank Statement - July)"
          placeholderTextColor={colors.textFaint}
          value={name}
          onChangeText={setName}
        />
        <View style={styles.row}>
          <Text style={{ color: colors.textDim }}>Needs book entry</Text>
          <Switch
            value={needsEntry}
            onValueChange={setNeedsEntry}
            trackColor={{ false: colors.border, true: colors.tint }}
            thumbColor={needsEntry ? colors.orange : '#fff'}
          />
        </View>
        <PrimaryButton
          title={loading ? 'Uploading...' : 'Upload document'}
          onPress={handleUpload}
          disabled={loading || !pickedFile || !name.trim()}
        />
      </View>

      <Text style={styles.cardHeading}>Filter documents</Text>
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

  // Comment + the actual Reupload action, shared by both the phone card
  // and the desktop table. Reupload only appears when the Manager
  // explicitly flagged this document at rework time (reupload_requested)
  // — an ordinary entry-only Rework (the common case per Architecture
  // §6.3) needs nothing from the Client at all, so no action renders.
  const renderReworkNote = (item: Doc) =>
    item.status === 'rework' && item.comment ? (
      <View>
        <Text style={styles.commentText}>{item.comment}</Text>
        {item.reupload_requested && (
          <View style={styles.reuploadRow}>
            {item.reupload_fulfilled ? (
              <View style={styles.reuploadDoneRow}>
                <Feather name="check-circle" size={13} color={colors.orange} />
                <Text style={styles.reuploadDoneText}>Reuploaded — waiting on the Accountant</Text>
              </View>
            ) : (
              <Text style={styles.reuploadHint}>The Manager asked for a corrected file</Text>
            )}
            <OutlineButton
              title={reuploadingId === item.id ? 'Uploading...' : item.reupload_fulfilled ? 'Reupload again' : 'Reupload document'}
              onPress={() => handleReupload(item)}
            />
          </View>
        )}
      </View>
    ) : null;

  const emptyMessage = <Text style={styles.empty}>{docs.length === 0 ? 'No documents yet.' : 'No documents match this filter.'}</Text>;

  return (
    <ScreenContainer scroll={breakpoint !== 'phone'}>
      <View style={[styles.screen, breakpoint === 'phone' && styles.screenPhone]}>
        {breakpoint === 'phone' ? (
          <ResponsiveGrid
            data={visibleDocs}
            keyExtractor={(d) => d.id}
            ListHeaderComponent={listHeader}
            renderItem={(item, columns) => (
              <View style={[styles.docRow, columns === 2 && styles.docRowGrid]}>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.docNameRow} disabled={!item.file_path} onPress={() => handleOpenDocument(item)}>
                    <Feather name="file-text" size={13} color={colors.textFaint} />
                    <Text style={[styles.docName, item.file_path && styles.docNameLink]}>{item.name}</Text>
                    {openingDocId === item.id && <Text style={styles.docMeta}>Opening…</Text>}
                  </TouchableOpacity>
                  {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                  {masterDocs.renderControl(item)}
                  {item.source === 'client' ? (
                    renderReworkNote(item)
                  ) : (
                    <Text style={styles.docMeta}>{item.source === 'manager' ? 'Manager' : 'Accountant'}</Text>
                  )}
                </View>
                <Pill status={item.status} />
              </View>
            )}
            ListEmptyComponent={emptyMessage}
          />
        ) : (
          <DataTable
            scrollable={false}
            data={visibleDocs}
            keyExtractor={(d) => d.id}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyMessage}
            columns={[
              {
                key: 'file',
                header: 'File',
                width: 320,
                render: (item) => (
                  <View>
                    <TouchableOpacity
                      style={styles.docNameRow}
                      disabled={!item.file_path}
                      onPress={() => handleOpenDocument(item)}
                    >
                      <Feather name="file-text" size={13} color={colors.textFaint} />
                      <Text style={[styles.docName, item.file_path && styles.docNameLink]}>{item.name}</Text>
                      {openingDocId === item.id && <Text style={styles.docMeta}>Opening…</Text>}
                    </TouchableOpacity>
                    {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                    {masterDocs.renderControl(item)}
                    {renderReworkNote(item)}
                  </View>
                ),
              },
              {
                key: 'client',
                header: 'Client',
                width: 180,
                render: (item) => <Text style={styles.docMeta}>{clientLabel(item)}</Text>,
              },
              {
                key: 'source',
                header: 'Source',
                width: 190,
                render: (item) => <Text style={styles.docMeta}>{sourceLabel(item)}</Text>,
              },
              {
                key: 'sharedWith',
                header: 'Shared with',
                width: 210,
                render: (item) => <Text style={styles.docMeta}>{sharedWithLabel(item)}</Text>,
              },
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
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 4, color: colors.text },
  orgName: { fontSize: 12, color: colors.textFaint, marginBottom: 14 },
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
    maxWidth: 420,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  uploadCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardHeading: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 12, textTransform: 'uppercase' },
  filterSearchRow: { gap: 10, marginTop: 4, marginBottom: 4 },
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
  teamPanel: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 12 },
  teamText: { fontSize: 12, color: colors.textDim, marginBottom: 2 },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  docRowGrid: { width: '48%' },
  docNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currentFileText: { fontSize: 11, color: colors.textFaint, marginBottom: 2 },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text },
  docNameLink: { textDecorationLine: 'underline', color: colors.orange },
  filePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  filePickerNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  filePickerName: { fontSize: 12, color: colors.textDim, flexShrink: 1 },
  filePickerHint: { fontSize: 12, color: colors.textFaint, fontStyle: 'italic' },
  docMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  commentText: { fontSize: 12, color: colors.danger, marginTop: 4 },
  reuploadRow: { marginTop: 6, gap: 4 },
  reuploadHint: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic' },
  reuploadDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reuploadDoneText: { fontSize: 12, color: colors.orange, fontWeight: '700' },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
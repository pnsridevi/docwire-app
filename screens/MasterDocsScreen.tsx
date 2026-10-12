// LOCATION: docwire-app/screens/MasterDocsScreen.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { Dropdown } from '../components/Dropdown';
import { MasterCategoryPicker } from '../components/MasterCategoryPicker';
import { MasterCategoryManager } from '../components/MasterCategoryManager';
import { useBreakpoint } from '../components/useBreakpoint';
import { pickDocumentFile, uploadDocumentFile, deleteUploadedFile, getDocumentSignedUrl, displayFileName, PickedFile } from '../lib/storage';
import {
  OrgOption,
  canChangeMasterDoc,
  canDeleteMasterDocs,
  canManageCategories,
  categoryLabel,
  formatShortDate,
  loadAccessibleOrgs,
  loadMasterCategories,
  loadMasterDocuments,
} from '../lib/masterDocs';
import { MasterCategory, MasterDocument, MasterDocumentLogEntry, MasterDocumentVersion, Profile } from '../lib/types';
import { loadDeactivatedIds, nameWithStatus } from '../lib/users';

type StatusFilter = 'active' | 'deleted';
const ALL = '__all__';

// Master Documents: the permanent reference repository for each client
// ORGANISATION, separate from day-to-day Documents. One screen for every
// role — what each person sees and can act on is decided entirely by the
// database (can_access_master_org in Add_master_documents.sql):
//   Client Admin / Client   their own organisation
//   Manager / Accountant    organisations where they have an assigned Client
//   Firm-wide staff         every organisation
//   Super Admin             every organisation
//
// There is no approval step. Replacing a file keeps the old one as a
// version, every change is written to a log by the database itself, and
// Delete only hides a document (it can be restored from the Deleted
// filter).
//
// Who can do what (Update_master_documents_permissions.sql — enforced by
// the database; the helpers in lib/masterDocs.ts only decide which
// buttons to show):
//   Staff / Super Admin     replace, edit, restore an older version,
//                           delete and restore, on every document they see
//   Client / Client Admin   upload; replace, edit and restore an older
//                           version only on client-owned documents
//                           (documents added by the firm are view-only);
//                           never delete or restore, and the Deleted
//                           filter isn't shown to them
//   Managers / Super Admin  also manage the category list
export default function MasterDocsScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  const isClientSide = profile.role === 'client' || profile.role === 'client_admin';
  const canDelete = canDeleteMasterDocs(profile);
  const canManage = canManageCategories(profile);

  const [docs, setDocs] = useState<MasterDocument[]>([]);
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Upload form
  const [uploadOrgId, setUploadOrgId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategoryId, setUploadCategoryId] = useState<string | null>(null);
  const [uploadSubtagId, setUploadSubtagId] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);

  // Filters
  const [orgFilter, setOrgFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');

  // Row actions
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  // Edit panel
  const [editing, setEditing] = useState<MasterDocument | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editSubtagId, setEditSubtagId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // History panel
  const [historyDoc, setHistoryDoc] = useState<MasterDocument | null>(null);
  const [versions, setVersions] = useState<MasterDocumentVersion[]>([]);
  const [logEntries, setLogEntries] = useState<MasterDocumentLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmRestorePath, setConfirmRestorePath] = useState<string | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Manage categories panel
  const [managingCategories, setManagingCategories] = useState(false);

  // People who have been deactivated — shown as "Name (deactivated)".
  const [deactivatedIds, setDeactivatedIds] = useState<Set<string>>(new Set());

  const reloadDocs = async () => {
    const { data, error } = await loadMasterDocuments();
    if (error) {
      console.error('[MasterDocsScreen] loading master documents failed:', error);
      setLoadError(error);
    }
    setDocs(data);
  };

  const reloadCategories = async () => {
    const { data, error } = await loadMasterCategories();
    if (error) {
      console.error('[MasterDocsScreen] loading categories failed:', error);
      setLoadError(error);
    }
    setCategories(data);
    return data;
  };

  const reloadOrgs = async () => {
    const { data, error } = await loadAccessibleOrgs(profile);
    if (error) {
      console.error('[MasterDocsScreen] loading organisations failed:', error);
      setLoadError(error);
    }
    setOrgs(data);
    // Only one possible organisation (always true for Client/Client Admin)
    // — preselect it so the form has one less step.
    if (data.length === 1) setUploadOrgId(data[0].id);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      await Promise.all([reloadDocs(), reloadCategories(), reloadOrgs(), loadDeactivatedIds().then(setDeactivatedIds)]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Upload ----------

  const handlePickFile = async () => {
    const file = await pickDocumentFile();
    if (!file) return; // cancelled — not an error
    setPickedFile(file);
    if (!uploadName.trim()) setUploadName(file.name);
  };

  const canUpload = !!pickedFile && !!uploadOrgId && !!uploadCategoryId && !!uploadName.trim() && !uploading;

  const handleUpload = async () => {
    if (!pickedFile || !uploadOrgId || !uploadCategoryId || !uploadName.trim()) return;
    setUploading(true);
    setLoadError(null);

    const uploadResult = await uploadDocumentFile(pickedFile, profile.id);
    if ('error' in uploadResult) {
      setLoadError(uploadResult.error);
      setUploading(false);
      return;
    }

    // Names, version number, and audit fields are filled by the database
    // trigger — only the real choices are sent from here.
    const { error } = await supabase
      .from('master_documents')
      .insert({
        tenant_id: profile.tenant_id,
        client_org_id: uploadOrgId,
        name: uploadName.trim(),
        category_id: uploadCategoryId,
        subtag_id: uploadSubtagId,
        file_path: uploadResult.path,
        file_size: pickedFile.size,
        mime_type: pickedFile.mimeType,
        uploaded_by: profile.id,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[MasterDocsScreen] upload failed:', error);
      setLoadError(error.message);
      // File reached Storage but no row points at it — remove it rather
      // than leave it orphaned (it could never be opened anyway).
      await deleteUploadedFile(uploadResult.path);
      setUploading(false);
      return;
    }
    setPickedFile(null);
    setUploadName('');
    setUploadSubtagId(null);
    // Category is kept: uploading several files into the same category in
    // a row is the common case.
    await reloadDocs();
    setUploading(false);
  };

  // ---------- Row actions ----------

  const openFile = async (path: string) => {
    setOpeningPath(path);
    const url = await getDocumentSignedUrl(path);
    setOpeningPath(null);
    if (!url) {
      setLoadError('Could not open this file — it may have been removed.');
      return;
    }
    await Linking.openURL(url);
  };

  // Replacing never needs approval: the database archives the current
  // file as a version (master_documents_before_write) and logs the change
  // the moment file_path changes. Nothing to do here but send the new path.
  const handleReplace = async (doc: MasterDocument) => {
    const file = await pickDocumentFile();
    if (!file) return;
    setBusyId(doc.id);
    setLoadError(null);
    const uploadResult = await uploadDocumentFile(file, profile.id);
    if ('error' in uploadResult) {
      setLoadError(uploadResult.error);
      setBusyId(null);
      return;
    }
    // .select().single() so a write silently blocked by RLS surfaces as
    // an error instead of looking like success (same lesson as Rework).
    const { data: updated, error } = await supabase
      .from('master_documents')
      .update({ file_path: uploadResult.path, file_size: file.size, mime_type: file.mimeType })
      .eq('id', doc.id)
      .select('id')
      .single();
    if (error || !updated) {
      console.error('[MasterDocsScreen] replace failed:', error);
      setLoadError(error?.message ?? 'Could not replace this file. Refresh and try again.');
      await deleteUploadedFile(uploadResult.path);
      setBusyId(null);
      return;
    }
    await reloadDocs();
    setBusyId(null);
  };

  const setDeleted = async (doc: MasterDocument, deleted: boolean) => {
    setBusyId(doc.id);
    setConfirmDeleteId(null);
    setLoadError(null);
    // The database stamps the real time and who did it; this value only
    // signals "delete" vs "restore".
    const { data: updated, error } = await supabase
      .from('master_documents')
      .update({ deleted_at: deleted ? new Date().toISOString() : null })
      .eq('id', doc.id)
      .select('id')
      .single();
    if (error || !updated) {
      console.error('[MasterDocsScreen] delete/restore failed:', error);
      // 23505: restoring would create a second live Master Document for a
      // file that was marked again after this one was deleted — the
      // database allows only one live Master Document per marked file.
      setLoadError(
        error?.code === '23505'
          ? 'This file is already a live Master Document for this organisation (it was marked as master again after this one was deleted). Keep this one deleted, or delete the other one first.'
          : error?.message ?? 'Could not update this document. Refresh and try again.'
      );
    }
    await reloadDocs();
    setBusyId(null);
  };

  // ---------- Edit panel ----------

  const openEdit = (doc: MasterDocument) => {
    setEditing(doc);
    setEditName(doc.name);
    setEditCategoryId(doc.category_id);
    setEditSubtagId(doc.subtag_id);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim() || !editCategoryId) return;
    setEditSaving(true);
    setEditError(null);
    const { data: updated, error } = await supabase
      .from('master_documents')
      .update({ name: editName.trim(), category_id: editCategoryId, subtag_id: editSubtagId })
      .eq('id', editing.id)
      .select('id')
      .single();
    setEditSaving(false);
    if (error || !updated) {
      setEditError(error?.message ?? 'Could not save. Refresh and try again.');
      return;
    }
    setEditing(null);
    await reloadDocs();
  };

  // ---------- History panel ----------

  const openHistory = async (doc: MasterDocument) => {
    setHistoryDoc(doc);
    setConfirmRestorePath(null);
    setHistoryError(null);
    setHistoryLoading(true);
    const [v, l] = await Promise.all([
      supabase.from('master_document_versions').select('*').eq('master_document_id', doc.id).order('version_number', { ascending: false }),
      supabase.from('master_document_log').select('*').eq('master_document_id', doc.id).order('created_at', { ascending: false }),
    ]);
    if (v.error || l.error) console.error('[MasterDocsScreen] loading history failed:', v.error ?? l.error);
    setVersions((v.data as MasterDocumentVersion[]) ?? []);
    setLogEntries((l.data as MasterDocumentLogEntry[]) ?? []);
    setHistoryLoading(false);
  };

  // "Make this the current version": sends the older file's path as the
  // new current file. The database recognises it as one of this
  // document's own older files, keeps the current file as a version,
  // saves the old file as a NEW version number (nothing is discarded) and
  // logs it as a restore. File size and type are taken from the kept
  // version by the database, not from here.
  const restoreVersion = async (v: MasterDocumentVersion) => {
    if (!historyDoc) return;
    setRestoringVersion(true);
    setHistoryError(null);
    const { data: updated, error } = await supabase
      .from('master_documents')
      .update({ file_path: v.file_path })
      .eq('id', historyDoc.id)
      .select('*')
      .single();
    setRestoringVersion(false);
    setConfirmRestorePath(null);
    if (error || !updated) {
      console.error('[MasterDocsScreen] restore version failed:', error);
      setHistoryError(error?.message ?? 'Could not restore this version. Refresh and try again.');
      return;
    }
    await Promise.all([openHistory(updated as MasterDocument), reloadDocs()]);
  };

  // ---------- Derived data ----------

  const activeDocs = useMemo(() => docs.filter((d) => !d.deleted_at), [docs]);
  const topLevelCategories = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);

  // Org filter options come from the documents themselves plus the orgs
  // this person can upload to, so an org with no documents yet still
  // appears.
  const orgFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    orgs.forEach((o) => byId.set(o.id, o.name));
    docs.forEach((d) => byId.set(d.client_org_id, d.client_org_name ?? byId.get(d.client_org_id) ?? 'Unknown org'));
    return Array.from(byId, ([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orgs, docs]);
  const showOrgColumn = !isClientSide && orgFilterOptions.length > 0;

  const visibleDocs = useMemo(() => {
    let v = docs.filter((d) => (statusFilter === 'active' ? !d.deleted_at : !!d.deleted_at));
    if (orgFilter !== ALL) v = v.filter((d) => d.client_org_id === orgFilter);
    if (categoryFilter !== ALL) v = v.filter((d) => d.category_id === categoryFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      v = v.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.client_org_name ?? '').toLowerCase().includes(q) ||
          categoryLabel(categories, d.category_id, d.subtag_id).toLowerCase().includes(q)
      );
    }
    return v;
  }, [docs, statusFilter, orgFilter, categoryFilter, search, categories]);

  const thisMonthCount = useMemo(() => {
    const now = new Date();
    return activeDocs.filter((d) => {
      const u = new Date(d.updated_at);
      return u.getFullYear() === now.getFullYear() && u.getMonth() === now.getMonth();
    }).length;
  }, [activeDocs]);

  const subheading =
    profile.role === 'super_admin'
      ? "Every client organisation's permanent reference documents."
      : isClientSide
        ? 'Permanent reference documents for your organisation. Everyone in your organisation can see these. Documents from your firm are view-only.'
        : profile.firm_wide_staff
          ? 'Permanent reference documents for every client organisation.'
          : 'Permanent reference documents for the organisations you serve.';

  // ---------- Rendering pieces ----------

  const renderName = (d: MasterDocument) => (
    <View>
      <TouchableOpacity style={styles.docNameRow} onPress={() => openFile(d.file_path)}>
        <Feather name="archive" size={13} color={colors.textFaint} />
        <Text style={[styles.docName, styles.docNameLink]}>{d.name}</Text>
        {openingPath === d.file_path && <Text style={styles.metaText}>Opening…</Text>}
      </TouchableOpacity>
      <Text style={styles.currentFileText}>
        Current file: {displayFileName(d.file_path)} · v{d.current_version}
      </Text>
      {d.deleted_at && (
        <Text style={styles.deletedText}>
          Deleted by {d.deleted_by_name ?? 'someone'} on {formatShortDate(d.deleted_at)}
        </Text>
      )}
    </View>
  );

  const renderUpdated = (d: MasterDocument) => (
    <Text style={styles.metaText}>
      {d.updated_by
        ? nameWithStatus(d.updated_by_name, d.updated_by, deactivatedIds)
        : nameWithStatus(d.uploaded_by_name, d.uploaded_by, deactivatedIds)}{' '}
      · {formatShortDate(d.updated_at)}
    </Text>
  );

  const renderActions = (d: MasterDocument) => {
    if (busyId === d.id) return <Text style={styles.metaText}>Saving…</Text>;
    if (d.deleted_at) {
      // Only staff ever see deleted documents (hidden from client-side
      // users by the database).
      return (
        <View style={styles.actionRow}>
          {canDelete && <OutlineButton title="Restore" onPress={() => setDeleted(d, false)} />}
          <OutlineButton title="History" onPress={() => openHistory(d)} />
        </View>
      );
    }
    if (confirmDeleteId === d.id) {
      return (
        <View style={styles.actionRow}>
          <Text style={styles.confirmText}>Delete? It can be restored later.</Text>
          <TouchableOpacity onPress={() => setDeleted(d, true)}>
            <Text style={styles.confirmYes}>Yes, delete</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setConfirmDeleteId(null)}>
            <Text style={styles.confirmNo}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const canChange = canChangeMasterDoc(profile, d);
    return (
      <View style={styles.actionRow}>
        {canChange && <OutlineButton title="Replace file" onPress={() => handleReplace(d)} />}
        {canChange && <OutlineButton title="Edit" onPress={() => openEdit(d)} />}
        <OutlineButton title="History" onPress={() => openHistory(d)} />
        {canDelete && (
          <TouchableOpacity style={styles.deleteLink} onPress={() => setConfirmDeleteId(d.id)}>
            <Text style={styles.deleteLinkText}>Delete</Text>
          </TouchableOpacity>
        )}
        {!canChange && <Text style={styles.viewOnlyText}>From your firm · view only</Text>}
      </View>
    );
  };

  const uploadCard =
    !isClientSide && orgs.length === 0 && !loading ? (
      <View style={styles.uploadCard}>
        <Text style={styles.cardHeading}>Add a master document</Text>
        <Text style={styles.hintText}>
          You aren't assigned to any client organisation yet, so there's nowhere to add a Master Document. Super Admin
          can assign you to a client.
        </Text>
      </View>
    ) : (
      <View style={styles.uploadCard}>
        <Text style={styles.cardHeading}>Add a master document</Text>

        {orgs.length > 1 ? (
          <>
            <Text style={styles.label}>Organisation</Text>
            <View style={styles.dropdownWrap}>
              <Dropdown
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                value={uploadOrgId}
                onChange={setUploadOrgId}
                placeholder="Choose an organisation"
              />
            </View>
          </>
        ) : orgs.length === 1 ? (
          <Text style={styles.orgFixedText}>For {orgs[0].name}</Text>
        ) : null}

        <MasterCategoryPicker
          profile={profile}
          categories={categories}
          categoryId={uploadCategoryId}
          subtagId={uploadSubtagId}
          onChange={(c, s) => {
            setUploadCategoryId(c);
            setUploadSubtagId(s);
          }}
          onCategoriesChanged={reloadCategories}
        />

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
          placeholder="Name (e.g. GST Registration Certificate)"
          placeholderTextColor={colors.textFaint}
          value={uploadName}
          onChangeText={setUploadName}
        />
        <PrimaryButton title={uploading ? 'Uploading...' : 'Add master document'} onPress={handleUpload} disabled={!canUpload} />
      </View>
    );

  const listHeader = (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.heading}>Master Documents</Text>
      <Text style={styles.subheading}>{subheading}</Text>
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

      <StatRow
        items={[
          { num: String(activeDocs.length), label: 'Master Documents', icon: 'archive' },
          ...(!isClientSide
            ? [{ num: String(new Set(activeDocs.map((d) => d.client_org_id)).size), label: 'Organisations', icon: 'briefcase' as const }]
            : []),
          { num: String(new Set(activeDocs.map((d) => d.category_id)).size), label: 'Categories used', icon: 'tag' },
          { num: String(thisMonthCount), label: 'Updated this month', icon: 'refresh-cw' },
        ]}
      />

      {uploadCard}

      <View style={styles.findHeaderRow}>
        <Text style={[styles.cardHeading, { marginBottom: 0 }]}>Find documents</Text>
        {canManage && <OutlineButton title="Manage categories" onPress={() => setManagingCategories(true)} />}
      </View>
      <View style={styles.filterRow}>
        {showOrgColumn && orgFilterOptions.length > 1 && (
          <View style={styles.dropdownWrap}>
            <Dropdown
              options={[{ value: ALL, label: 'All organisations' }, ...orgFilterOptions]}
              value={orgFilter}
              onChange={setOrgFilter}
            />
          </View>
        )}
        <View style={styles.dropdownWrap}>
          <Dropdown
            options={[
              { value: ALL, label: 'All categories' },
              ...topLevelCategories.map((c) => ({ value: c.id, label: c.hidden ? `${c.name} (hidden)` : c.name })),
            ]}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
        </View>
      </View>
      <View style={styles.filterSearchRow}>
        {/* Deleted documents are staff-only (the database doesn't return
            them to Clients or Client Admins at all). */}
        {canDelete && (
          <ChipSelect
            options={[
              { value: 'active', label: 'Active' },
              { value: 'deleted', label: 'Deleted' },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
        )}
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, organisation, or category..."
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />
      </View>
    </View>
  );

  const emptyMessage = (
    <Text style={styles.empty}>
      {loading
        ? 'Loading...'
        : statusFilter === 'deleted'
          ? 'No deleted Master Documents.'
          : activeDocs.length === 0
            ? 'No Master Documents yet.'
            : 'No Master Documents match this filter.'}
    </Text>
  );
  const rowData = loading ? [] : visibleDocs;

  // Closing is ignored mid-save so a slow network can't leave the panel
  // gone while the save is still in flight.
  const closeEdit = () => {
    if (!editSaving) setEditing(null);
  };

  const editModal = (
    <Modal transparent visible={!!editing} animationType="fade" onRequestClose={closeEdit}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeEdit}>
        <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Edit details</Text>
            <Text style={styles.modalSubtitle}>
              Changes are saved to the document's history. To change the file itself, use Replace file.
            </Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textFaint} />
            <MasterCategoryPicker
              profile={profile}
              categories={categories}
              categoryId={editCategoryId}
              subtagId={editSubtagId}
              onChange={(c, s) => {
                setEditCategoryId(c);
                setEditSubtagId(s);
              }}
              onCategoriesChanged={reloadCategories}
            />
            {editError && <Text style={styles.modalError}>{editError}</Text>}
            <View style={styles.modalActions}>
              <PrimaryButton
                title={editSaving ? 'Saving...' : 'Save'}
                onPress={saveEdit}
                disabled={editSaving || !editName.trim() || !editCategoryId}
              />
              <TouchableOpacity onPress={closeEdit} disabled={editSaving}>
                <Text style={styles.confirmNo}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  const historyModal = (
    <Modal transparent visible={!!historyDoc} animationType="fade" onRequestClose={() => setHistoryDoc(null)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setHistoryDoc(null)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
          <ScrollView>
            <Text style={styles.modalTitle}>{historyDoc?.name}</Text>
            <Text style={styles.modalSubtitle}>
              {historyDoc?.client_org_name ?? ''} · {historyDoc ? categoryLabel(categories, historyDoc.category_id, historyDoc.subtag_id) : ''}
            </Text>

            <Text style={styles.sectionHeading}>Files</Text>
            {historyDoc && (
              <View style={styles.versionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.versionTitle}>Version {historyDoc.current_version} (current)</Text>
                  <Text style={styles.metaText}>
                    {displayFileName(historyDoc.file_path)} · added by{' '}
                    {nameWithStatus(historyDoc.file_uploaded_by_name, historyDoc.file_uploaded_by, deactivatedIds)}
                  </Text>
                </View>
                <OutlineButton title={openingPath === historyDoc.file_path ? 'Opening…' : 'Open'} onPress={() => openFile(historyDoc.file_path)} />
              </View>
            )}
            {historyError && <Text style={styles.modalError}>{historyError}</Text>}
            {historyLoading ? (
              <Text style={styles.metaText}>Loading...</Text>
            ) : (
              versions.map((v) => {
                // The same file can appear more than once (e.g. after an
                // earlier restore); "Make current" is pointless for a file
                // that is already the current one.
                const canRestoreThis =
                  !!historyDoc && canChangeMasterDoc(profile, historyDoc) && v.file_path !== historyDoc.file_path;
                return (
                  <View key={v.id} style={styles.versionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.versionTitle}>Version {v.version_number}</Text>
                      <Text style={styles.metaText}>
                        {displayFileName(v.file_path)} · added by {nameWithStatus(v.uploaded_by_name, v.uploaded_by, deactivatedIds)} ·
                        replaced by {nameWithStatus(v.replaced_by_name, v.replaced_by, deactivatedIds)} on {formatShortDate(v.replaced_at)}
                      </Text>
                      {confirmRestorePath === v.file_path && (
                        <View style={styles.restoreConfirmRow}>
                          <Text style={styles.confirmText}>
                            Make this the current file? The current file is kept as a version.
                          </Text>
                          <TouchableOpacity disabled={restoringVersion} onPress={() => restoreVersion(v)}>
                            <Text style={styles.confirmRestoreYes}>{restoringVersion ? 'Saving…' : 'Yes, make current'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity disabled={restoringVersion} onPress={() => setConfirmRestorePath(null)}>
                            <Text style={styles.confirmNo}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    <View style={styles.versionActions}>
                      <OutlineButton title={openingPath === v.file_path ? 'Opening…' : 'Open'} onPress={() => openFile(v.file_path)} />
                      {canRestoreThis && confirmRestorePath !== v.file_path && (
                        <OutlineButton title="Make current" onPress={() => setConfirmRestorePath(v.file_path)} />
                      )}
                    </View>
                  </View>
                );
              })
            )}

            <Text style={styles.sectionHeading}>Activity</Text>
            {!historyLoading &&
              logEntries.map((e) => (
                <View key={e.id} style={styles.logRow}>
                  <Text style={styles.logText}>{e.details ?? e.action}</Text>
                  <Text style={styles.metaText}>
                    {nameWithStatus(e.actor_name, e.actor_id, deactivatedIds)} · {formatShortDate(e.created_at)}
                  </Text>
                </View>
              ))}

            <View style={styles.modalActions}>
              <OutlineButton title="Close" onPress={() => setHistoryDoc(null)} />
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  return (
    <ScreenContainer scroll={breakpoint !== 'phone'}>
      <View style={[styles.screen, breakpoint === 'phone' && styles.screenPhone]}>
        {breakpoint === 'phone' ? (
          <ResponsiveGrid
            data={rowData}
            keyExtractor={(d) => d.id}
            ListHeaderComponent={listHeader}
            renderItem={(item, columns) => (
              <View style={[styles.docCard, columns === 2 && styles.docCardGrid, !!item.deleted_at && styles.docCardDeleted]}>
                {renderName(item)}
                {!isClientSide && <Text style={styles.orgText}>{item.client_org_name ?? 'Unknown org'}</Text>}
                <Text style={styles.categoryText}>{categoryLabel(categories, item.category_id, item.subtag_id)}</Text>
                {renderUpdated(item)}
                <View style={{ marginTop: 8 }}>{renderActions(item)}</View>
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
              { key: 'name', header: 'Document', width: 270, render: renderName },
              ...(showOrgColumn
                ? [{ key: 'org', header: 'Organisation', width: 160, render: (d: MasterDocument) => <Text style={styles.orgText}>{d.client_org_name ?? 'Unknown org'}</Text> }]
                : []),
              { key: 'category', header: 'Category', width: 180, render: (d) => <Text style={styles.categoryText}>{categoryLabel(categories, d.category_id, d.subtag_id)}</Text> },
              { key: 'updated', header: 'Last updated', width: 170, render: renderUpdated },
              { key: 'actions', header: 'Actions', width: 330, render: renderActions },
            ]}
          />
        )}
      </View>
      {editModal}
      {historyModal}
      {canManage && (
        <MasterCategoryManager
          visible={managingCategories}
          onClose={() => setManagingCategories(false)}
          profile={profile}
          categories={categories}
          onCategoriesChanged={reloadCategories}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  screenPhone: { flex: 1 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
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
  uploadCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardHeading: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 12, textTransform: 'uppercase' },
  hintText: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textDim, marginBottom: 6 },
  orgFixedText: { fontSize: 12, color: colors.textDim, marginBottom: 12 },
  dropdownWrap: { maxWidth: 320, minWidth: 180, marginBottom: 12, flexGrow: 1, flexShrink: 1 },
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
  filePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  filePickerNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  filePickerName: { fontSize: 12, color: colors.textDim, flexShrink: 1 },
  filePickerHint: { fontSize: 12, color: colors.textFaint, fontStyle: 'italic' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterSearchRow: { gap: 10, marginTop: 4, marginBottom: 4 },
  searchInput: {
    flex: 1,
    maxWidth: 360,
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
  docCardDeleted: { opacity: 0.75 },
  docNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text },
  docNameLink: { textDecorationLine: 'underline', color: colors.orange },
  currentFileText: { fontSize: 11, color: colors.textFaint, marginBottom: 4 },
  deletedText: { fontSize: 11, color: colors.danger, marginBottom: 4 },
  orgText: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 2 },
  categoryText: { fontSize: 12, color: colors.textDim, marginBottom: 2 },
  metaText: { fontSize: 12, color: colors.textFaint },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  deleteLink: { paddingVertical: 8, paddingHorizontal: 4 },
  deleteLinkText: { fontSize: 12, fontWeight: '600', color: colors.danger },
  confirmText: { fontSize: 12, color: colors.textDim },
  confirmYes: { fontSize: 12, fontWeight: '700', color: colors.danger },
  confirmNo: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 18,
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: colors.textDim, marginBottom: 14, lineHeight: 17 },
  modalError: { fontSize: 12, color: colors.danger, marginBottom: 10 },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  sectionHeading: { fontSize: 12, fontWeight: '700', color: colors.text, textTransform: 'uppercase', marginTop: 8, marginBottom: 8 },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  versionTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  logRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  logText: { fontSize: 12.5, color: colors.text, marginBottom: 2 },
  viewOnlyText: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic' },
  findHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  versionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  restoreConfirmRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6 },
  confirmRestoreYes: { fontSize: 12, fontWeight: '700', color: colors.orange },
});
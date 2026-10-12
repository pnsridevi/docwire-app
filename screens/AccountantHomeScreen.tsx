// LOCATION: docwire-app/screens/AccountantHomeScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, Pill, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { useBreakpoint } from '../components/useBreakpoint';
import { Doc, Profile } from '../lib/types';
import { useMasterDocMarking } from '../components/MasterDocControls';
import { pickDocumentFile, uploadDocumentFile, deleteUploadedFile, getDocumentSignedUrl, displayFileName, PickedFile } from '../lib/storage';
import { loadDeactivatedIds, nameWithStatus } from '../lib/users';

type TypeFilter = 'all' | 'entry' | 'filed' | 'rework';

// deactivated (Add_user_deactivation.sql): a deactivated Client keeps their
// assignment row so their old documents stay visible and editable here, but
// they're left out of every upload picker and "All Clients" broadcast.
type AssignedClient = { id: string; name: string | null; client_org_id: string; deactivated: boolean };
type OrgOption = { id: string; name: string };

// Phase 2, item D.2, later corrected against the actual Architecture doc
// (§6.6): Client Admin's Documents scope is unconditional org-wide, no
// sharing gate — so there is no "Share with Client Admin" checkbox here
// at all; that visibility is automatic (Migration_phase2_client_admin_
// full_visibility.sql), not something a Manager/Accountant opts them
// into. Two real changes from the pre-Phase-2 version remain:
//
// 1. The "My Clients / All Clients" toggle is gone entirely (Architecture
//    §6.6 removes it in Revision 3) — this Accountant's clients now come
//    from client_assignments (per-Client, not per-org), and loadDocs is a
//    plain unfiltered select — RLS alone decides what comes back.
//
// 2. "Upload Work Document" — rebuilt per direct product decision (not
//    in the Architecture doc, an explicit extension): independent
//    "Share with" controls, no more "For" subject-picker at all.
//      - Manager toggle — share with the counterpart staff role.
//      - "All Clients" toggle — fans out to one row per Client this
//        Accountant actually has a real client_assignments relationship
//        with (client_id set on each row, same shape as manually
//        selecting every one of them in the picker below). Deliberately
//        NOT an org-general broadcast: an Accountant assigned to Clients
//        spread across multiple orgs would otherwise leak this to every
//        OTHER Client in each of those orgs too, including ones actually
//        assigned to a different Accountant who just happens to share
//        the org. Available to everyone, firm-wide staff or not.
//      - "All Organisations" toggle — firm-wide staff only (hidden
//        otherwise, since it would be indistinguishable from "All
//        Clients" for anyone without firm-wide status). This ONE stays a
//        true org-general broadcast (client_id null, one row per org in
//        the entire tenant) — reaching Clients outside this Accountant's
//        own assignments is the entire point of firm-wide status, so
//        this always implies sharing with Clients rather than being a
//        separate on/off axis.
//      - Clients — multi-select, each entry labeled "Org - Client" so
//        it stays unambiguous across multiple orgs. Deliberately stays
//        scoped to real assignments only, even for firm-wide staff —
//        hand-picking a named Client is for your own clients
//        specifically; reaching beyond that is what "All Organisations"
//        is for. Selecting a Client here both scopes the document to
//        them AND makes them able to see it — one decision, not the old
//        separate "pick a subject" then "toggle sharing" two-step, which
//        read as picking the same person twice for no clear reason.
//        Multiple Clients (even across different orgs) can be selected
//        in one upload — each produces its own row.
//    The three sharing-scope controls (All Clients / All Organisations /
//    Clients) are mutually exclusive — picking one clears the others.
//    Nothing defaults to "on" — every control starts off/empty, so
//    submitting without touching anything is a no-op the Upload button
//    blocks, not an accidental broad share.
export default function AccountantHomeScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  // Master Documents: "Master" tag on documents that already are one, and a
  // "Mark as master" link on those that could be (components/MasterDocControls.tsx).
  const masterDocs = useMasterDocMarking(profile);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [myClients, setMyClients] = useState<AssignedClient[]>([]);
  // People who have been deactivated — shown as "Name (deactivated)".
  const [deactivatedIds, setDeactivatedIds] = useState<Set<string>>(new Set());
  // myOrgs stays the broadest reachable set (every org in the tenant for
  // firm-wide staff, same as before) — still used for edit-rights checks
  // and the "All Organisations" broadcast. myOwnOrgs is new: it's always
  // just the orgs this person actually has a real client_assignments
  // relationship in, regardless of firm-wide status — used for the "All
  // Clients" broadcast and as the default fallback, so a firm-wide
  // upload with nothing toggled no longer silently reaches every org in
  // the tenant.
  const [myOrgs, setMyOrgs] = useState<OrgOption[]>([]);
  const [myOwnOrgs, setMyOwnOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [shareManager, setShareManager] = useState(false);
  // "All Clients" — share with every client assigned to me (myOwnOrgs).
  // Available to everyone.
  const [shareAllClients, setShareAllClients] = useState(false);
  // "All Organisations" — share with every client across every
  // organisation, including ones I'm not assigned to (myOrgs, firm-wide
  // only). Only ever shown/usable when profile.firm_wide_staff is true.
  const [shareAllOrgs, setShareAllOrgs] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  // Add_staff_book_entry.sql — "Needs book entry" on this upload (only
  // offered when it's for specific Clients), and errors from the
  // Send / Cancel book entry buttons.
  const [uploadNeedsEntry, setUploadNeedsEntry] = useState(false);
  const [entryBusyId, setEntryBusyId] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<{ id: string; message: string } | null>(null);
  const [clientsDropdownOpen, setClientsDropdownOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  // Inline edit state — at most one row editable at a time. A row's
  // Client scope (specific Client vs org-general) is fixed once created —
  // that's what determines which row(s) exist — but whether it's visible
  // to the counterpart staff role or to Clients is still editable
  // afterward, which is exactly what makes "upload unshared for now,
  // decide later" (the default state below) actually usable.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShareManager, setEditShareManager] = useState(false);
  const [editShareClients, setEditShareClients] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadMyClients = async () => {
    const { data: assignments, error } = await supabase
      .from('client_assignments')
      .select('client_id,client_org_id')
      .eq('accountant_id', profile.id);
    if (error) {
      console.error('[AccountantHomeScreen] loadMyClients failed:', error);
      setLoadError(error.message);
      return;
    }
    const rows = assignments ?? [];
    const clientIds = rows.map((r: any) => r.client_id);
    const orgIds = Array.from(new Set(rows.map((r: any) => r.client_org_id))) as string[];

    const [{ data: people }, { data: orgs }] = await Promise.all([
      clientIds.length ? supabase.from('users').select('id,name,deactivated_at').in('id', clientIds) : Promise.resolve({ data: [] as any[] }),
      orgIds.length ? supabase.from('client_organizations').select('id,name').in('id', orgIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameById: Record<string, string | null> = {};
    (people ?? []).forEach((p: any) => (nameById[p.id] = p.name));
    const deactivatedById: Record<string, boolean> = {};
    (people ?? []).forEach((p: any) => (deactivatedById[p.id] = !!p.deactivated_at));
    const orgNameById: Record<string, string> = {};
    (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));

    // myClients always reflects only REAL per-client relationships —
    // firm_wide_staff never grants access to a specific Client, only to
    // org-general uploads (Migration_phase2_firm_wide_staff.sql). The
    // individual-client picker deliberately stays scoped to this list
    // even for firm-wide staff — hand-picking a named Client is for your
    // own clients specifically; reaching beyond that is what the "All
    // Organisations" broadcast is for, not the picker.
    setMyClients(
      rows.map((r: any) => ({
        id: r.client_id,
        name: nameById[r.client_id] ?? null,
        client_org_id: r.client_org_id,
        deactivated: !!deactivatedById[r.client_id],
      }))
    );

    // myOwnOrgs is always just the orgs from this person's real
    // client_assignments rows, firm-wide or not — this is what "All
    // Clients" and the no-toggle-selected default fall back to.
    const ownOrgs = orgIds.map((id) => ({ id, name: orgNameById[id] ?? id }));
    setMyOwnOrgs(ownOrgs);

    // myOrgs, by contrast, expands to every organization in the tenant
    // for a firm-wide-flagged Accountant — client_organizations is
    // already readable tenant-wide by anyone (client_org_same_tenant),
    // so this is a lookup, not a new access grant; the actual new access
    // is the RLS this list's org-general uploads then rely on. This is
    // what "All Organisations" broadcasts against, and stays the
    // broadest set used for edit-rights checks below (unchanged from
    // before this list was split).
    if (profile.firm_wide_staff) {
      const { data: allOrgs, error: allOrgsError } = await supabase
        .from('client_organizations')
        .select('id,name')
        .eq('tenant_id', profile.tenant_id);
      if (allOrgsError) {
        console.error('[AccountantHomeScreen] loadMyClients (firm-wide orgs) failed:', allOrgsError);
        setLoadError(allOrgsError.message);
        setMyOrgs(ownOrgs);
        return;
      }
      setMyOrgs((allOrgs ?? []).map((o: any) => ({ id: o.id, name: o.name })));
      return;
    }

    setMyOrgs(ownOrgs);
  };

  const loadDocs = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[AccountantHomeScreen] loadDocs failed:', error);
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
    loadMyClients();
    loadDocs();
    loadDeactivatedIds().then(setDeactivatedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markAccounted = async (id: string) => {
    await supabase.from('documents').update({ status: 'accounted' }).eq('id', id);
    await loadDocs();
  };

  // Architecture Section 6.3: Accounted -> Rework (Manager, with comment)
  // -> Accounted (Accountant re-submits). Also clears the rework comment
  // — it described a problem that's now been addressed, and leaving it
  // around could be misread as still describing the current state on the
  // next Rework cycle. Guarded by canResubmit below, which blocks this
  // entirely while a requested reupload hasn't happened yet.
  const resubmit = async (id: string) => {
    const { data: updated, error } = await supabase
      .from('documents')
      .update({ status: 'accounted', comment: null })
      .eq('id', id)
      .select('id')
      .single();
    if (error || !updated) {
      console.error('[AccountantHomeScreen] resubmit failed:', error);
      setLoadError(error?.message ?? 'Could not re-submit — this document may no longer be in Rework.');
      return;
    }
    await loadDocs();
  };

  // A Manager can flag, at rework time, that the DOCUMENT itself needs
  // to be reuploaded — not just the entry corrected. Re-submitting
  // against the old, flawed file before that happens would let the
  // Accountant mark something Accounted that the Manager already said
  // was wrong. Re-submit is withheld (not just discouraged) until the
  // Client actually reuploads.
  const canResubmit = (item: Doc) => !item.reupload_requested || item.reupload_fulfilled;

  const clientNameById = useMemo(() => {
    const m: Record<string, string | null> = {};
    myClients.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [myClients]);

  const orgNameById = useMemo(() => {
    const m: Record<string, string> = {};
    myOrgs.forEach((o) => (m[o.id] = o.name));
    return m;
  }, [myOrgs]);

  // Multi-select dropdown options for "Clients" — one entry per assigned
  // Client, labeled "Org - Client" so it stays unambiguous even when this
  // Accountant serves the same-named Client (or org) more than once
  // across different organizations.
  const clientDropdownOptions = useMemo(
    () => myClients.filter((c) => !c.deactivated).map((c) => ({ id: c.id, label: `${orgNameById[c.client_org_id] ?? c.client_org_id} - ${c.name ?? 'Unnamed'}` })),
    [myClients, orgNameById]
  );

  const toggleClientSelection = (id: string) => {
    setSelectedClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Picking a specific Client narrows away from either broadcast
    // option — the three are mutually exclusive.
    setShareAllClients(false);
    setShareAllOrgs(false);
  };

  const resetUploadForm = () => {
    setUploadName('');
    setUploadNeedsEntry(false);
    setShareManager(false);
    setShareAllClients(false);
    setShareAllOrgs(false);
    setSelectedClientIds([]);
    setClientsDropdownOpen(false);
    setUploadError(null);
    setPickedFile(null);
  };

  const handlePickFile = async () => {
    const file = await pickDocumentFile();
    if (!file) return; // user cancelled
    setPickedFile(file);
    if (!uploadName.trim()) setUploadName(file.name);
  };

  // Three mutually exclusive paths, chosen by what's picked/toggled:
  //
  // 1. One or more specific Clients picked -> one row per Client
  //    (possibly spanning different orgs in a single upload), always
  //    from myClients — real assignments only, firm-wide or not. Picking
  //    a Client both scopes the document to them and shares it with
  //    them — a single decision, not a separate "pick a subject" step
  //    plus a separate "toggle sharing" step for the same person.
  //
  // 2. "All Organisations" ON (firm-wide only) -> one row per org in the
  //    ENTIRE tenant (myOrgs), always shared with Clients — that's the
  //    whole point of this option, so it isn't a separate on/off axis
  //    the way "All Clients" is.
  //
  // 3. "All Clients" toggle ON (no individual pick, "All Organisations"
  //    off) -> treated exactly as if every one of this Accountant's own
  //    Clients had been individually selected in step 1 above — same
  //    per-Client row shape, myClients only. This is deliberately NOT an
  //    org-general broadcast: an Accountant can be assigned to Clients
  //    across MULTIPLE orgs (e.g. one Client in Org A, two in Org B),
  //    and an org-general row would reach every Client in that org,
  //    including ones actually assigned to a different Accountant who
  //    just happens to share the org. Fan out to real per-Client rows
  //    instead, so "All Clients" only ever reaches Clients this
  //    Accountant is actually, individually assigned to.
  //
  // 4. Default (nothing picked, neither broadcast toggle on) -> one row
  //    per org this person actually has a real assignment in (myOwnOrgs,
  //    never the tenant-wide list, even for firm-wide staff), never
  //    shared with Clients — this is the "I don't want to share this
  //    with anybody yet" state, not something the Upload button blocks.
  //    It's editable afterward via each row's own Edit action, which is
  //    exactly what makes deciding later actually possible.
  const handleUpload = async () => {
    if (!uploadName.trim() || !pickedFile) return;
    // Firm-wide staff can always fall back on "All Organisations" even
    // with zero real assignments of their own — everyone else needs at
    // least one real org to upload anything against.
    if (!profile.firm_wide_staff && myOwnOrgs.length === 0) {
      setUploadError("You don't have any assigned clients yet.");
      return;
    }
    setUploading(true);
    setUploadError(null);

    const uploadResult = await uploadDocumentFile(pickedFile, profile.id);
    if ('error' in uploadResult) {
      console.error('[AccountantHomeScreen] file upload failed:', uploadResult.error);
      setUploadError(uploadResult.error);
      setUploading(false);
      return;
    }
    const filePath = uploadResult.path;
    const fileSize = pickedFile.size;
    const mimeType = pickedFile.mimeType;

    type DocRow = {
      tenant_id: string;
      client_org_id: string;
      client_org_name: string | null;
      client_id: string | null;
      client_name: string | null;
      uploaded_by: string;
      uploaded_by_name: string | null;
      name: string;
      needs_entry: boolean;
      status: string;
      source: string;
      shared_with_manager: boolean;
      shared_with_accountant: boolean;
      shared_with_clients: boolean;
      file_path: string;
      file_size: number | null;
      mime_type: string | null;
    };

    // "All Clients" resolves to the full myClients id list here, then
    // flows through the exact same per-Client mapping as a manual
    // selection — one function, one behavior, regardless of whether the
    // person picked every Client individually or used the toggle as a
    // shortcut for the same thing.
    const effectiveClientIds = selectedClientIds.length > 0 ? selectedClientIds : shareAllClients ? myClients.filter((c) => !c.deactivated).map((c) => c.id) : [];

    // Book entry only applies when the document is for specific Clients —
    // each Client's copy lands as Pending for that Client's Accountant.
    const entryOn = uploadNeedsEntry && effectiveClientIds.length > 0;

    const rows: DocRow[] =
      effectiveClientIds.length > 0
        ? effectiveClientIds.map((id) => {
            const c = myClients.find((x) => x.id === id)!;
            return {
              tenant_id: profile.tenant_id,
              client_org_id: c.client_org_id,
              client_org_name: orgNameById[c.client_org_id] ?? null,
              client_id: c.id,
              client_name: c.name,
              uploaded_by: profile.id,
              uploaded_by_name: profile.name,
              name: uploadName.trim(),
              needs_entry: entryOn,
              status: entryOn ? 'pending' : 'filed',
              source: 'accountant',
              // The Manager must see it to do their part of book entry.
              shared_with_manager: shareManager || entryOn,
              shared_with_accountant: false,
              shared_with_clients: true,
              file_path: filePath,
              file_size: fileSize,
              mime_type: mimeType,
            };
          })
        : (shareAllOrgs && profile.firm_wide_staff ? myOrgs : myOwnOrgs).map((o) => ({
            tenant_id: profile.tenant_id,
            client_org_id: o.id,
            client_org_name: o.name,
            client_id: null,
            client_name: null,
            uploaded_by: profile.id,
            uploaded_by_name: profile.name,
            name: uploadName.trim(),
            needs_entry: false,
            status: 'filed',
            source: 'accountant',
            shared_with_manager: shareManager,
            shared_with_accountant: false,
            // Only "All Organisations" reaches this branch with sharing
            // on — "All Clients" is fully handled above now, and the
            // untouched default (nothing selected) is never shared with
            // Clients.
            shared_with_clients: !!(shareAllOrgs && profile.firm_wide_staff),
            file_path: filePath,
            file_size: fileSize,
            mime_type: mimeType,
          }));

    if (rows.length === 0) {
      setUploadError("You don't have any assigned clients yet.");
      setUploading(false);
      await deleteUploadedFile(filePath);
      return;
    }

    const { error } = await supabase.from('documents').insert(rows);
    if (error) {
      console.error('[AccountantHomeScreen] upload failed:', error);
      setUploadError(error.message);
      // One file, potentially many rows — if none of them made it in,
      // the file itself is unreachable (SELECT policy requires at least
      // one matching documents.file_path row), so clean it up rather
      // than leaving it orphaned in storage.
      await deleteUploadedFile(filePath);
      setUploading(false);
      return;
    }
    resetUploadForm();
    setShowUploadForm(false);
    await loadDocs();
    setUploading(false);
  };

  // Opens a short-lived signed URL for an existing document's file.
  // Rows created before this feature has file_path=null and have
  // nothing to open — callers check that before showing the action.
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

  const startEdit = (doc: Doc) => {
    setEditingId(doc.id);
    setEditName(doc.name);
    setEditShareManager(doc.shared_with_manager);
    setEditShareClients(doc.shared_with_clients);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('documents')
      .update({
        name: editName.trim(),
        shared_with_manager: editShareManager,
        shared_with_clients: editShareClients,
      })
      .eq('id', id);
    if (error) {
      console.error('[AccountantHomeScreen] saveEdit failed:', error);
      setLoadError(error.message);
    }
    setEditingId(null);
    setSavingEdit(false);
    await loadDocs();
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

  // Independent of the sharing checkboxes — this is who else, besides
  // the uploader, currently has visibility.
  // Client Admin sees every staff work document in their org
  // unconditionally (Migration_phase2_client_admin_full_visibility.sql)
  // — always listed here, not gated by any toggle, so "Not shared" never
  // appears when it would actually be misleading (Client Admin still
  // sees it even with every other toggle off).
  // Client Admin's visibility into a STAFF work document now piggybacks
  // exactly on shared_with_clients (Migration_phase2_staff_docs_refinement.sql)
  // — a private Manager<->Accountant exchange stays private from Client
  // Admin too, so it's no longer listed unconditionally.
  function roleLabel(source: string): string {
    return source === 'client' ? 'Client' : source === 'manager' ? 'Manager' : 'Accountant';
  }

  const sourceLabel = (d: Doc) => `${nameWithStatus(d.uploaded_by_name, d.uploaded_by, deactivatedIds)} (${roleLabel(d.source)})`;

  const sharedWithLabel = (d: Doc) => {
    if (d.source === 'client') return 'Manager, Accountant';
    if (d.shared_with_user_id) return d.shared_with_user_name ?? 'One colleague (direct share)';
    const parts: string[] = [];
    if (d.shared_with_manager) parts.push('Manager');
    if (d.shared_with_accountant) parts.push('Accountant');
    if (d.shared_with_clients) {
      parts.push('Client Admin');
      parts.push(d.client_id ? d.client_name ?? 'a Client' : 'All Clients');
    }
    return parts.length ? parts.join(', ') : 'Not shared';
  };

  // Uses the denormalized client_name directly now (Migration_add_document_
  // client_name.sql) rather than a clientNameById lookup built from
  // myClients — more robust, since it doesn't depend on this Accountant's
  // own client list still including that Client (e.g. after a
  // reassignment), and consistent with clientLabel on every other
  // Documents screen. A direct staff-to-staff share
  // (migration_add_staff_direct_tasks_and_docs.sql) has neither a
  // client_id nor a client_org_id at all — called out explicitly rather
  // than falling into the "All Clients · org" wording, which would
  // wrongly suggest a broadcast rather than a deliberate 1:1 exchange.
  const workDocSubject = (d: Doc) =>
    d.client_id ? d.client_name ?? 'a Client' : d.client_org_id ? `All Clients · ${d.client_org_name ?? 'org'}` : 'Internal — no client';

  const renderEditPanel = (doc: Doc) => (
    <View style={styles.editPanel}>
      <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={colors.textFaint} />
      <Text style={styles.shareHint}>Turning on Clients also makes this visible to your Client Admin. Leaving it off keeps this internal to whoever it's shared with below.</Text>
      <View style={styles.shareRow}>
        <Text style={styles.shareLabel}>Share with Manager</Text>
        <Switch value={editShareManager} onValueChange={setEditShareManager} trackColor={{ false: colors.border, true: colors.tint }} thumbColor={editShareManager ? colors.orange : '#fff'} />
      </View>
      <View style={styles.shareRow}>
        <Text style={styles.shareLabel}>
          Visible to {doc.client_id ? doc.client_name ?? 'this Client' : doc.client_org_id ? `all Clients · ${doc.client_org_name ?? 'org'}` : 'no clients (internal share)'}
        </Text>
        <Switch value={editShareClients} onValueChange={setEditShareClients} trackColor={{ false: colors.border, true: colors.tint }} thumbColor={editShareClients ? colors.orange : '#fff'} />
      </View>
      <View style={styles.actions}>
        <OutlineButton title="Cancel" onPress={cancelEdit} />
        <PrimaryButton title={savingEdit ? 'Saving...' : 'Save'} onPress={() => saveEdit(doc.id)} disabled={savingEdit || !editName.trim()} />
      </View>
    </View>
  );

  // Actions differ by what kind of row this is: a Client's own upload
  // (existing Accounted/Rework-resubmit flow, unchanged), vs a staff work
  // document. Edit rights follow the same live-relationship rule as the
  // corrected RLS (Migration_phase2_documents_reassignment_visibility_fix.sql):
  // editable by whoever CURRENTLY holds the Accountant role for this
  // document's Client/org — myClients/myOrgs already reflect that live
  // membership — not by who originally uploaded it. This is what makes a
  // reassigned-away Accountant correctly lose the Edit button, and the
  // newly assigned Accountant correctly gain it, on the same document.
  // Mirrors the RLS in Migration_phase2_documents_reassignment_visibility_fix.sql
  // exactly. Tier 1 (tied to a Client) and Tier 2 (institutional — org-
  // general, shared with Clients) are editable by whoever currently
  // holds the Accountant role for that Client/org — myClients/myOrgs
  // already reflect that live membership. Tier 3 (private — org-general,
  // never shared with Clients) is editable only by the original
  // uploader, permanently, regardless of any reassignment.
  const canEditWorkDoc = (item: Doc) => {
    if (item.source !== 'accountant') return false;
    if (item.client_id) return myClients.some((c) => c.id === item.client_id);
    if (item.shared_with_clients) return myOrgs.some((o) => o.id === item.client_org_id);
    // Tier 3 (private): editable by the uploader, but only while still
    // active in some capacity — myOrgs is empty here if and only if this
    // Accountant has zero current client_assignments AND isn't firm-wide
    // staff, so it's exactly the right "still active" signal without a
    // separate query.
    return myOrgs.length > 0 && item.uploaded_by === profile.id;
  };

  // ---------- Send / Cancel book entry (Add_staff_book_entry.sql) ----------
  // For the current Manager or Accountant of the Client the document is
  // about. The database checks the same.
  const canManageEntry = (item: Doc) => !!item.client_id && myClients.some((c) => c.id === item.client_id);

  const changeEntry = async (item: Doc, fn: 'send_document_for_entry' | 'cancel_document_entry') => {
    if (entryBusyId) return;
    setEntryBusyId(item.id);
    setEntryError(null);
    const { error } = await supabase.rpc(fn, { p_document_id: item.id });
    setEntryBusyId(null);
    if (error) {
      setEntryError({ id: item.id, message: error.message });
      return;
    }
    await loadDocs();
  };

  const renderActions = (item: Doc) => {
    const core = renderActionsCore(item);
    const canSend = canManageEntry(item) && !item.needs_entry && item.status === 'filed';
    const canCancel = canManageEntry(item) && item.needs_entry && item.status === 'pending' && !!item.entry_requested_by;
    const sentNote = item.entry_requested_by
      ? `Sent for book entry by ${nameWithStatus(item.entry_requested_by_name, item.entry_requested_by, deactivatedIds)}${
          item.entry_requested_at ? ` on ${new Date(item.entry_requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''
        }`
      : null;
    if (!canSend && !canCancel && !sentNote) return core;
    const busy = entryBusyId === item.id;
    return (
      <View>
        {core}
        {sentNote && <Text style={styles.entryNote}>{sentNote}</Text>}
        {(canSend || canCancel) && (
          <View style={styles.actions}>
            {canSend && (
              <OutlineButton title={busy ? 'Sending...' : 'Send for book entry'} onPress={() => changeEntry(item, 'send_document_for_entry')} />
            )}
            {canCancel && (
              <OutlineButton title={busy ? 'Cancelling...' : 'Cancel book entry'} onPress={() => changeEntry(item, 'cancel_document_entry')} />
            )}
          </View>
        )}
        {entryError?.id === item.id && <Text style={styles.errorText}>{entryError.message}</Text>}
      </View>
    );
  };

  const renderActionsCore = (item: Doc) => {
    // Was: `if (item.source === 'client')`. That correctly covers a
    // Client's own direct upload, but a document created via a Task's
    // immediate-creation path (TasksScreen.tsx) can have source='manager'
    // or 'accountant' while still being needs_entry=true — e.g. a Manager
    // creating a task for their Accountant counterpart and attaching a
    // document they already have. That combination hit neither this
    // branch nor canEditWorkDoc (which requires source==='accountant'
    // specifically), so the document sat in the list with literally no
    // action available — a genuine dead end, found while designing a
    // realistic multi-role test scenario. needs_entry is the actual
    // correct signal for "is this in the book-entry pipeline," regardless
    // of who created it.
    if (item.needs_entry) {
      return (
        <>
          {item.status === 'pending' && <OutlineButton title="Mark Accounted" onPress={() => markAccounted(item.id)} />}
          {item.status === 'rework' && canResubmit(item) && <OutlineButton title="Re-submit" onPress={() => resubmit(item.id)} />}
          {item.status === 'rework' && !canResubmit(item) && (
            <Text style={styles.reuploadBlockedText}>Waiting on the Client to reupload the document before this can be re-submitted</Text>
          )}
        </>
      );
    }
    if (canEditWorkDoc(item)) {
      if (editingId === item.id) return renderEditPanel(item);
      return <OutlineButton title="Edit" onPress={() => startEdit(item)} />;
    }
    return null;
  };

  const listHeader = (
    <View style={{ marginBottom: 4 }}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Documents</Text>
        <OutlineButton
          title={showUploadForm ? 'Cancel' : '+ Upload Work Document'}
          onPress={() => {
            if (!showUploadForm) resetUploadForm();
            setShowUploadForm((s) => !s);
          }}
        />
      </View>
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

      {myClients.length > 0 && (
        <Text style={styles.clientsLine}>Your clients: {myClients.filter((c) => !c.deactivated).map((c) => c.name ?? 'Unnamed').join(', ')}</Text>
      )}

      {showUploadForm && (
        <View style={styles.uploadPanel}>
          <Text style={styles.panelTitle}>Upload a work document</Text>
          {uploadError && <Text style={styles.errorText}>{uploadError}</Text>}
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
            placeholder="Document name (e.g. Q2 Working Papers)"
            placeholderTextColor={colors.textFaint}
            value={uploadName}
            onChangeText={setUploadName}
          />
          <Text style={styles.label}>Share with</Text>
          <Text style={styles.shareHint}>Turning on Clients also makes this visible to your Client Admin. Leaving it off keeps this internal to whoever it's shared with below.</Text>
          <View style={styles.shareRow}>
            <Text style={styles.shareLabel}>Manager</Text>
            <Switch value={shareManager} onValueChange={setShareManager} trackColor={{ false: colors.border, true: colors.tint }} thumbColor={shareManager ? colors.orange : '#fff'} />
          </View>
          <View style={styles.shareRow}>
            <Text style={styles.shareLabel}>All Clients</Text>
            <Switch
              value={shareAllClients}
              onValueChange={(v) => {
                setShareAllClients(v);
                // Mutually exclusive with the other two ways of picking
                // who sees this.
                if (v) {
                  setShareAllOrgs(false);
                  setSelectedClientIds([]);
                }
              }}
              trackColor={{ false: colors.border, true: colors.tint }}
              thumbColor={shareAllClients ? colors.orange : '#fff'}
            />
          </View>
          <Text style={styles.shareHint}>Share with every client assigned to you.</Text>
          {profile.firm_wide_staff && (
            <>
              <View style={styles.shareRow}>
                <Text style={styles.shareLabel}>All Organisations</Text>
                <Switch
                  value={shareAllOrgs}
                  onValueChange={(v) => {
                    setShareAllOrgs(v);
                    if (v) {
                      setShareAllClients(false);
                      setSelectedClientIds([]);
                    }
                  }}
                  trackColor={{ false: colors.border, true: colors.tint }}
                  thumbColor={shareAllOrgs ? colors.orange : '#fff'}
                />
              </View>
              <Text style={styles.shareHint}>Share with every client across every organisation, including ones you're not assigned to.</Text>
            </>
          )}

          <Text style={styles.label}>Clients</Text>
          <TouchableOpacity style={styles.dropdownHeader} onPress={() => setClientsDropdownOpen((o) => !o)}>
            <Text style={styles.dropdownHeaderText}>
              {selectedClientIds.length === 0 ? 'Select clients...' : `${selectedClientIds.length} selected`}
            </Text>
            <Feather name={clientsDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} />
          </TouchableOpacity>
          {clientsDropdownOpen && (
            <View style={styles.dropdownList}>
              {clientDropdownOptions.length === 0 ? (
                <Text style={styles.dropdownEmptyText}>No assigned clients yet.</Text>
              ) : (
                clientDropdownOptions.map((opt) => {
                  const isSelected = selectedClientIds.includes(opt.id);
                  return (
                    <TouchableOpacity key={opt.id} style={styles.dropdownRow} onPress={() => toggleClientSelection(opt.id)}>
                      <Text style={styles.dropdownRowText}>{opt.label}</Text>
                      {isSelected && <Feather name="check" size={14} color={colors.orange} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
          {selectedClientIds.length > 0 && (
            <View style={styles.selectedChipsRow}>
              {selectedClientIds.map((id) => (
                <View key={id} style={styles.selectedChip}>
                  <Text style={styles.selectedChipText}>{clientNameById[id] ?? 'Unnamed'}</Text>
                  <TouchableOpacity onPress={() => toggleClientSelection(id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Feather name="x" size={12} color={colors.textFaint} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={{ marginTop: 12 }}>
            {(selectedClientIds.length > 0 || shareAllClients) && (
              <>
                <TouchableOpacity style={styles.entryCheckRow} onPress={() => setUploadNeedsEntry((v) => !v)}>
                  <Feather name={uploadNeedsEntry ? 'check-square' : 'square'} size={16} color={uploadNeedsEntry ? colors.orange : colors.textFaint} />
                  <Text style={styles.entryCheckLabel}>Needs book entry</Text>
                </TouchableOpacity>
                {uploadNeedsEntry && (
                  <Text style={styles.entryHint}>
                    Each Client's copy lands as Pending for each Client's Accountant (you, for your own Clients), and is shared with the Manager automatically.
                  </Text>
                )}
              </>
            )}
            <PrimaryButton title={uploading ? 'Uploading...' : 'Upload'} onPress={handleUpload} disabled={uploading || !uploadName.trim() || !pickedFile} />
          </View>
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
    <Text style={styles.empty}>
      {loading ? 'Loading...' : docs.length === 0 ? 'Nothing here yet.' : 'No documents match this filter.'}
    </Text>
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
                  <Text style={[styles.docName, item.file_path && styles.docNameLink]}>{item.name}</Text>
                  {openingDocId === item.id && <Text style={styles.docMeta}>Opening…</Text>}
                </TouchableOpacity>
                {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                {masterDocs.renderControl(item)}
                {item.source === 'client' ? (
                  <Text style={styles.docMeta}>
                    {item.client_org_name ?? 'Unknown client'}
                    {item.uploaded_by_name ? `  ·  Uploaded by ${nameWithStatus(item.uploaded_by_name, item.uploaded_by, deactivatedIds)}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.docMeta}>
                    {item.source === 'manager' ? "From your Manager" : 'Your upload'} · {workDocSubject(item)} · {sharedWithLabel(item)}
                  </Text>
                )}
                <Pill status={item.status} />
                {item.status === 'rework' && item.comment ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentLabel}>Manager's note</Text>
                    <Text style={styles.commentText}>{item.comment}</Text>
                  </View>
                ) : null}
                <View style={styles.actionRow}>{renderActions(item)}</View>
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
              {
                key: 'file',
                header: 'File',
                width: 240,
                render: (item) => (
                  <View>
                    <TouchableOpacity style={styles.docNameRow} disabled={!item.file_path} onPress={() => handleOpenDocument(item)}>
                      <Feather name="file-text" size={13} color={colors.textFaint} />
                      <Text style={[styles.docName, item.file_path && styles.docNameLink]}>{item.name}</Text>
                      {openingDocId === item.id && <Text style={styles.docMeta}>Opening…</Text>}
                    </TouchableOpacity>
                    {item.file_path && <Text style={styles.currentFileText}>Current file: {displayFileName(item.file_path)}</Text>}
                    {masterDocs.renderControl(item)}
                  </View>
                ),
              },
              {
                key: 'client',
                header: 'Client Org',
                width: 160,
                render: (item) => (
                  <View>
                    <Text style={styles.clientOrgText}>{item.client_org_id ? item.client_org_name ?? 'Unknown org' : 'Internal'}</Text>
                    <Text style={styles.clientIdentityText}>
                      {item.client_org_id
                        ? item.client_id
                          ? nameWithStatus(item.client_name ?? 'Unnamed', item.client_id, deactivatedIds)
                          : 'All Clients'
                        : item.shared_with_user_name
                        ? `Direct to ${item.shared_with_user_name}`
                        : 'Direct share'}
                    </Text>
                  </View>
                ),
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
                width: 200,
                render: (item) => <Text style={styles.docMeta}>{sharedWithLabel(item)}</Text>,
              },
              {
                key: 'status',
                header: 'Status',
                width: 140,
                render: (item) => (
                  <View>
                    <Pill status={item.status} />
                    {item.status === 'rework' && item.comment ? <Text style={styles.commentText}>{item.comment}</Text> : null}
                  </View>
                ),
              },
              { key: 'actions', header: '', width: 220, render: renderActions },
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  filterSearchRow: { gap: 10, marginTop: 16, marginBottom: 4 },
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
  clientsLine: { fontSize: 12, color: colors.textFaint, marginTop: 4, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', color: colors.textFaint, marginTop: 10, marginBottom: 6, textTransform: 'uppercase' },
  shareHint: { fontSize: 11, color: colors.textFaint, marginTop: -4, marginBottom: 8, fontStyle: 'italic' },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surface2,
  },
  dropdownHeaderText: { fontSize: 13, color: colors.text },
  dropdownList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  dropdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dropdownRowText: { fontSize: 13, color: colors.textDim },
  dropdownEmptyText: { fontSize: 12, color: colors.textFaint, padding: 12, textAlign: 'center' },
  selectedChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: colors.tint,
  },
  selectedChipText: { fontSize: 12, fontWeight: '600', color: colors.orangeDeep },
  input: {
    borderWidth: 1,
    maxWidth: 420,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
    backgroundColor: colors.surface2,
    color: colors.text,
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
  errorText: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  uploadPanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  editPanel: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    minWidth: 200,
  },
  panelTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  shareLabel: { fontSize: 13, color: colors.textDim },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  entryCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4 },
  entryCheckLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  entryHint: { fontSize: 11.5, color: colors.textFaint, marginBottom: 8 },
  entryNote: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic', marginTop: 6 },
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
  currentFileText: { fontSize: 11, color: colors.textFaint, marginBottom: 4 },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  docNameLink: { textDecorationLine: 'underline', color: colors.orange },
  reuploadBlockedText: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic', flexShrink: 1 },
  filePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  filePickerNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  filePickerName: { fontSize: 12, color: colors.textDim, flexShrink: 1 },
  filePickerHint: { fontSize: 12, color: colors.textFaint, fontStyle: 'italic' },
  docMeta: { fontSize: 12, color: colors.textFaint, marginBottom: 6 },
  clientOrgText: { fontSize: 12, fontWeight: '600', color: colors.text },
  clientIdentityText: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  commentBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.surface2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commentLabel: { fontSize: 10, fontWeight: '700', color: colors.textFaint, marginBottom: 2, textTransform: 'uppercase' },
  commentText: { fontSize: 13, color: colors.textDim },
  actionRow: { marginTop: 10, alignItems: 'flex-start' },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
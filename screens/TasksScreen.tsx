// LOCATION: docwire-app/screens/TasksScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { DatePicker } from '../components/DatePicker';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { useBreakpoint } from '../components/useBreakpoint';
import { Profile, Task, TaskPriority, AssignableUser, AssignedClientOption, Role, RecurrenceTerm } from '../lib/types';
import { pickDocumentFile, uploadDocumentFile, deleteUploadedFile, getDocumentSignedUrl, PickedFile } from '../lib/storage';

type Filter = 'assigned_to_me' | 'created_by_me' | 'all';
type TypeFilter = 'all' | 'recurring' | 'onetime';
type AssigneeTarget = 'client' | 'counterpart';

function isOverdue(t: Task, todayStr: string): boolean {
  return t.status === 'in_progress' && !!t.due_date && t.due_date < todayStr;
}

function recurrenceLabel(term: RecurrenceTerm | null): string {
  if (!term) return '';
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function roleLabel(r: Role): string {
  return r === 'manager' ? 'Manager' : r === 'accountant' ? 'Accountant' : r === 'client' ? 'Client' : r;
}

// The resolved target of "Assign to", independent of which role's picker
// produced it — handleCreate reads only this, so it doesn't need to
// branch on profile.role at all. taskClientId is the Client this task is
// ABOUT, which is not always the same person as the assignee (e.g. a
// Manager assigning a task to the Accountant, about a specific Client —
// the assignee is the Accountant, but taskClientId is still that Client).
// All three client_* fields are null together for a direct staff-to-staff
// task/share — there is no Client involved at all in that case (see
// directMode below).
type ResolvedAssignee = {
  id: string;
  name: string | null;
  role: Role;
  client_org_id: string | null;
  client_org_name: string | null;
  taskClientId: string | null;
};

// Architecture Section 7 / 7.6. Shared by Client, Accountant, and Manager —
// the scoping difference between roles is enforced by RLS, this
// component just renders whatever the backend hands back.
//
// Phase 2, item D.3 (change list §E.3, settled): Manager/Accountant no
// longer pick an assignee from a flat list of people. They pick a Client
// first (from client_assignments), and the form then offers exactly two
// targets — that Client, or their one correct counterpart staff member,
// already resolved — never a separate person-picker. This also fixes the
// same bug D.1 fixed in ClientHomeScreen: the Client role's own picker
// used to resolve through manager_assignments/accountant_assignments
// (the org-level default) instead of client_assignments (the per-Client,
// currently-effective assignment) — the exact cause of "task assignment
// shows the wrong Manager/Accountant" from testing (session summary,
// item 11).
export default function TasksScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  // Client role's picker — a flat choice between their fixed Manager and
  // Accountant.
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  // Manager/Accountant's picker — one entry per Client they're assigned
  // to, each already carrying the correct counterpart.
  const [assignedClients, setAssignedClients] = useState<AssignedClientOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeKey, setAssigneeKey] = useState<string | null>(null); // Client role only
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null); // Manager/Accountant only
  const [assigneeTarget, setAssigneeTarget] = useState<AssigneeTarget | null>(null); // Manager/Accountant only
  // Direct mode: Manager/Accountant messaging their counterpart with no
  // Client involved at all — bypasses the Client picker entirely.
  // directCounterpartId is chosen from distinctCounterparts (below),
  // deliberately restricted to people the creator already shares at
  // least one Client with (Option A) rather than the whole firm.
  const [directMode, setDirectMode] = useState(false);
  const [directCounterpartId, setDirectCounterpartId] = useState<string | null>(null);
  // Only meaningful when a real Client is involved AND the task is going
  // to the counterpart staff member (not directly to the Client, who
  // already sees it as the assignee either way). One toggle controls
  // BOTH the task's own visibility to that Client and, if a document is
  // attached, whether it's shared with them too — kept as one choice
  // rather than two, since "the Client can see this" should mean the
  // same thing for the conversation and the paperwork together.
  const [shareWithClient, setShareWithClient] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceTerm, setRecurrenceTerm] = useState<RecurrenceTerm>('monthly');
  // Architecture §7.2 — a document created alongside the task, only at
  // creation time. requiresBookEntry is meaningless (and forced off)
  // unless attachDocument is on, same dependent-toggle relationship the
  // demo uses.
  const [attachDocument, setAttachDocument] = useState(false);
  const [requiresBookEntry, setRequiresBookEntry] = useState(false);
  // Only meaningful for the immediate-creation path (Client's own task,
  // or Manager/Accountant logging a document they already have for their
  // counterpart) — the deferred path (staff requesting from a Client)
  // has no file yet by definition, so this stays null until fulfill().
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  // Fulfillment: which awaiting-upload task (linked_document_name set,
  // linked_document_id still null) the Client is currently acting on.
  // Kept separate from the create-task form's own state above — this is
  // a different action on an existing task, not a new task being made.
  const [fulfillingTaskId, setFulfillingTaskId] = useState<string | null>(null);
  const [fulfillLoading, setFulfillLoading] = useState(false);
  const [fulfillPickedFile, setFulfillPickedFile] = useState<PickedFile | null>(null);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const loadTasks = async () => {
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[TasksScreen] loadTasks failed:', error);
      setLoadError(error.message);
      setTasks([]);
      return;
    }
    setLoadError(null);
    setTasks((data as Task[]) ?? []);
  };

  // Client -> their currently-assigned Manager + Accountant, from
  // client_assignments (the per-Client row, not the org-level default —
  // see the file header comment).
  //
  // Manager/Accountant -> one AssignedClientOption per Client they're
  // assigned to, each row already carrying the correct counterpart id —
  // client_assignments has both manager_id and accountant_id on the same
  // row, so this needs no join back to accountant_assignments/
  // manager_assignments the way the pre-Phase-2 version did. The two
  // roles are symmetric (only which id is "mine" vs "the counterpart"
  // differs), so one branch below covers both instead of two ~90-line
  // near-duplicates.
  const loadAssignableUsers = async () => {
    if (profile.role === 'client') {
      const { data: assignment, error } = await supabase
        .from('client_assignments')
        .select('manager_id,accountant_id,client_org_id')
        .eq('client_id', profile.id)
        .maybeSingle();
      if (error) {
        console.error('[TasksScreen] loadAssignableUsers failed:', error);
        setLoadError(error.message);
        setAssignable([]);
        return;
      }
      if (!assignment) {
        setAssignable([]);
        return;
      }
      const ids = [assignment.manager_id, assignment.accountant_id].filter(Boolean) as string[];
      const [{ data: people }, { data: org }] = await Promise.all([
        ids.length ? supabase.from('users').select('id,name,role').in('id', ids) : Promise.resolve({ data: [] as any[] }),
        supabase.from('client_organizations').select('name').eq('id', assignment.client_org_id).single(),
      ]);
      const byId: Record<string, any> = {};
      (people ?? []).forEach((p: any) => (byId[p.id] = p));
      const orgName = org?.name ?? '';
      // A Client only ever has one org, so no duplicate-person risk here —
      // key can just be the person's id.
      setAssignable(
        ids
          .filter((id) => byId[id])
          .map((id) => ({
            key: id,
            id,
            name: byId[id].name,
            role: byId[id].role,
            client_org_id: assignment.client_org_id,
            client_org_name: orgName,
          }))
      );
      return;
    }

    if (profile.role === 'manager' || profile.role === 'accountant') {
      const myRoleKey = profile.role === 'manager' ? 'manager_id' : 'accountant_id';
      const counterpartRoleKey = profile.role === 'manager' ? 'accountant_id' : 'manager_id';
      const counterpartRole: Role = profile.role === 'manager' ? 'accountant' : 'manager';

      const { data: assignments, error } = await supabase
        .from('client_assignments')
        .select('client_id,client_org_id,manager_id,accountant_id')
        .eq(myRoleKey, profile.id);
      if (error) {
        console.error('[TasksScreen] loadAssignableUsers failed:', error);
        setLoadError(error.message);
        setAssignedClients([]);
        return;
      }
      const rows = assignments ?? [];
      if (rows.length === 0) {
        setAssignedClients([]);
        return;
      }

      const clientIds = rows.map((r: any) => r.client_id);
      const counterpartIds = Array.from(new Set(rows.map((r: any) => r[counterpartRoleKey]))) as string[];
      const orgIds = Array.from(new Set(rows.map((r: any) => r.client_org_id))) as string[];

      const [{ data: clientPeople }, { data: counterpartPeople }, { data: orgs }] = await Promise.all([
        supabase.from('users').select('id,name').in('id', clientIds),
        counterpartIds.length ? supabase.from('users').select('id,name').in('id', counterpartIds) : Promise.resolve({ data: [] as any[] }),
        supabase.from('client_organizations').select('id,name').in('id', orgIds),
      ]);
      const clientNameById: Record<string, string | null> = {};
      (clientPeople ?? []).forEach((p: any) => (clientNameById[p.id] = p.name));
      const counterpartNameById: Record<string, string | null> = {};
      (counterpartPeople ?? []).forEach((p: any) => (counterpartNameById[p.id] = p.name));
      const orgNameById: Record<string, string> = {};
      (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));

      setAssignedClients(
        rows.map((r: any) => ({
          client_id: r.client_id,
          client_name: clientNameById[r.client_id] ?? null,
          client_org_id: r.client_org_id,
          client_org_name: orgNameById[r.client_org_id] ?? '',
          counterpart_id: r[counterpartRoleKey],
          counterpart_name: counterpartNameById[r[counterpartRoleKey]] ?? null,
          counterpart_role: counterpartRole,
        }))
      );
      return;
    }
  };

  useEffect(() => {
    loadTasks();
    loadAssignableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClient = useMemo(
    () => assignedClients.find((c) => c.client_id === selectedClientId) ?? null,
    [assignedClients, selectedClientId]
  );

  // Groups the Client picker by organization — e.g. "Moto - client 1"
  // shown once as a header, with just the Clients under it as chips
  // beneath, rather than repeating the org name inside every single chip
  // label. Matters as soon as a Manager/Accountant has more than one
  // Client in the same org (the whole point of §8.2's per-Client
  // splitting) — a flat "Nandini · Moto - client 1" / "Priya · Moto -
  // client 1" list reads as two unrelated people, not two Clients under
  // the same org.
  const clientsByOrg = useMemo(() => {
    const groups: { orgId: string; orgName: string; clients: AssignedClientOption[] }[] = [];
    const indexByOrg: Record<string, number> = {};
    assignedClients.forEach((c) => {
      if (indexByOrg[c.client_org_id] === undefined) {
        indexByOrg[c.client_org_id] = groups.length;
        groups.push({ orgId: c.client_org_id, orgName: c.client_org_name, clients: [] });
      }
      groups[indexByOrg[c.client_org_id]].clients.push(c);
    });
    return groups;
  }, [assignedClients]);

  // Same underlying data AccountantAssignmentScreen.tsx/
  // ManagerAssignmentScreen.tsx's "Team" tabs already compute (one row
  // per Client, each carrying its counterpart) — deduped here to one
  // entry per distinct counterpart person, since the same Accountant
  // commonly covers several of a Manager's Clients. This is Option A:
  // only people the creator currently shares at least one Client with,
  // not the whole firm — deliberately reuses this data rather than a
  // new query, since assignedClients already has everything needed.
  const distinctCounterparts = useMemo(() => {
    const byId: Record<string, { id: string; name: string | null; role: Role }> = {};
    assignedClients.forEach((c) => {
      if (!byId[c.counterpart_id]) {
        byId[c.counterpart_id] = { id: c.counterpart_id, name: c.counterpart_name, role: c.counterpart_role };
      }
    });
    return Object.values(byId).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [assignedClients]);

  const resolvedAssignee: ResolvedAssignee | null = useMemo(() => {
    if (profile.role === 'client') {
      const a = assignable.find((x) => x.key === assigneeKey);
      return a ? { id: a.id, name: a.name, role: a.role, client_org_id: a.client_org_id, client_org_name: a.client_org_name, taskClientId: profile.id } : null;
    }
    if (profile.role === 'manager' || profile.role === 'accountant') {
      if (directMode) {
        const dc = distinctCounterparts.find((c) => c.id === directCounterpartId);
        return dc ? { id: dc.id, name: dc.name, role: dc.role, client_org_id: null, client_org_name: null, taskClientId: null } : null;
      }
      if (!selectedClient || !assigneeTarget) return null;
      if (assigneeTarget === 'client') {
        return {
          id: selectedClient.client_id,
          name: selectedClient.client_name,
          role: 'client',
          client_org_id: selectedClient.client_org_id,
          client_org_name: selectedClient.client_org_name,
          taskClientId: selectedClient.client_id,
        };
      }
      return {
        id: selectedClient.counterpart_id,
        name: selectedClient.counterpart_name,
        role: selectedClient.counterpart_role,
        client_org_id: selectedClient.client_org_id,
        client_org_name: selectedClient.client_org_name,
        taskClientId: selectedClient.client_id,
      };
    }
    return null;
  }, [profile.role, profile.id, assignable, assigneeKey, selectedClient, assigneeTarget, directMode, directCounterpartId, distinctCounterparts]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
    setPriority('medium');
    setAssigneeKey(null);
    setSelectedClientId(null);
    setAssigneeTarget(null);
    setDirectMode(false);
    setDirectCounterpartId(null);
    setShareWithClient(false);
    setRecurring(false);
    setRecurrenceTerm('monthly');
    setAttachDocument(false);
    setRequiresBookEntry(false);
    setPickedFile(null);
    setShowForm(false);
  };

  const handlePickFile = async () => {
    const file = await pickDocumentFile();
    if (!file) return; // user cancelled
    setPickedFile(file);
  };

  const handleCreate = async () => {
    if (!title.trim() || !resolvedAssignee) return;
    // A recurring task repeats from its due date (the daily job creates the
    // next one on that date) — with no date it would never repeat. The
    // database refuses it too (Fix_recurring_task_catchup.sql); this just
    // stops it before the round trip.
    if (recurring && !dueDate.trim()) return;

    // Architecture §7.2: the attached document is created in the
    // Documents module at the same time as the task, not as a separate
    // later step. If this insert fails, the task is not created either —
    // an orphaned task that claims to have a document attached, when it
    // doesn't, is worse than the create button just failing outright.
    // Architecture §6.1: a staff-created task assigned to a Client is a
    // REQUEST — "the Client fulfils it by uploading, which creates the
    // linked Document." The document should not exist until that upload
    // actually happens. Previously this branch created a live document
    // (status: pending when requiresBookEntry) the instant the task was
    // created, before the Client had done anything — so the Accountant's
    // queue could show a "Pending" document with nothing real behind it
    // yet. Only defer when staff is requesting FROM a Client; a Client's
    // own task (they're the source) and a Manager/Accountant logging a
    // document they already physically have for their counterpart staff
    // member both still create the document immediately, same as before.
    const isStaffRequestingFromClient = profile.role !== 'client' && resolvedAssignee.role === 'client';

    let linkedDocumentId: string | null = null;
    let linkedDocumentName: string | null = null;
    let linkedDocumentNeedsEntry: boolean | null = null;

    if (attachDocument && isStaffRequestingFromClient) {
      // Defer: record the intent only. renderDocLink/the Book Entry
      // column below both already treat "name set, id null" as its own
      // state ("Awaiting upload"), so nothing downstream needs to guess.
      linkedDocumentName = title.trim();
      linkedDocumentNeedsEntry = requiresBookEntry;
    } else if (attachDocument) {
      // This branch only runs for "I already have this document in
      // hand" cases (Client's own task, Manager/Accountant logging
      // something for their counterpart, or a direct no-client share) —
      // so a real file is required, not optional, before the document
      // row gets created.
      if (!pickedFile) {
        setLoadError('Choose a file to attach before creating this task.');
        return;
      }
      const uploadResult = await uploadDocumentFile(pickedFile, profile.id);
      if ('error' in uploadResult) {
        console.error('[TasksScreen] file upload failed:', uploadResult.error);
        setLoadError(uploadResult.error);
        return;
      }
      const docName = title.trim();
      // BUG FIX (found during real-data testing): this insert previously
      // set NO sharing flag at all — a Manager attaching a document for
      // their Accountant counterpart was only ever visible to the
      // Manager who uploaded it, defeating the entire point of assigning
      // it to someone else. Now sets the correct flag for whoever the
      // task is actually assigned to:
      //   - counterpart is the Accountant -> shared_with_accountant
      //   - counterpart is the Manager -> shared_with_manager
      //   - a real Client is involved (taskClientId set) -> ALSO
      //     shared_with_clients, so that Client sees the document too,
      //     not just the two staff members discussing it
      //   - no Client at all (direct mode) -> shared_with_user_id, a
      //     precise point-to-point share (see migration comment for why
      //     this isn't just reusing the broad role-wide flags)
      const { data: newDoc, error: docError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile.tenant_id,
          client_org_id: resolvedAssignee.client_org_id,
          client_org_name: resolvedAssignee.client_org_name,
          client_id: resolvedAssignee.taskClientId,
          name: docName,
          needs_entry: requiresBookEntry,
          status: requiresBookEntry ? 'pending' : 'filed',
          // source must be one of 'client' | 'manager' | 'accountant'
          // (documents_source_check) — exactly the three roles that can
          // create a task in the first place (Architecture §7.2), so
          // profile.role is always a valid value here.
          source: profile.role as 'client' | 'manager' | 'accountant',
          uploaded_by: profile.id,
          uploaded_by_name: profile.name,
          file_path: uploadResult.path,
          file_size: pickedFile.size,
          mime_type: pickedFile.mimeType,
          shared_with_manager: !!resolvedAssignee.taskClientId && resolvedAssignee.role === 'manager',
          shared_with_accountant: !!resolvedAssignee.taskClientId && resolvedAssignee.role === 'accountant',
          shared_with_clients: !!resolvedAssignee.taskClientId && shareWithClient,
          shared_with_user_id: resolvedAssignee.taskClientId ? null : resolvedAssignee.id,
          shared_with_user_name: resolvedAssignee.taskClientId ? null : resolvedAssignee.name,
        })
        .select('id,name,needs_entry')
        .single();
      if (docError || !newDoc) {
        console.error('[TasksScreen] create linked document failed:', docError);
        setLoadError(docError?.message ?? 'Could not create the attached document.');
        // File uploaded but the row never did — clean it up, it can
        // never become visible without a matching documents.file_path row.
        await deleteUploadedFile(uploadResult.path);
        return;
      }
      linkedDocumentId = newDoc.id;
      linkedDocumentName = newDoc.name;
      linkedDocumentNeedsEntry = newDoc.needs_entry;
    }

    const { error } = await supabase.from('tasks').insert({
      tenant_id: profile.tenant_id,
      client_org_id: resolvedAssignee.client_org_id,
      client_org_name: resolvedAssignee.client_org_name,
      title: title.trim(),
      description: description.trim() || null,
      creator_id: profile.id,
      creator_name: profile.name,
      creator_role: profile.role,
      assignee_id: resolvedAssignee.id,
      assignee_name: resolvedAssignee.name,
      assignee_role: resolvedAssignee.role,
      priority,
      due_date: dueDate.trim() || null,
      status: 'in_progress',
      // Architecture Section 7.4: recurrence is set at creation via a
      // toggle + term. recurrence_term is only meaningful when recurring
      // is true — null it out otherwise so a half-filled state can't
      // linger in the row.
      recurring,
      recurrence_term: recurring ? recurrenceTerm : null,
      // Phase 2 originally required client_id on every task. That
      // decision is reversed by migration_add_staff_direct_tasks_and_docs
      // .sql — a direct (no-client) task correctly leaves this null.
      // resolvedAssignee.taskClientId is null exactly when directMode
      // produced this assignee; every other path still supplies a real
      // Client id (the Client themselves, or the Client a staff-to-staff
      // task is about) — the derive_task_client_id trigger would arrive
      // at the same value on its own for a Client-role creation, but
      // supplying it explicitly is required for the Manager-assigns-to-
      // Accountant case, since neither party there is a Client the
      // trigger could derive it from.
      client_id: resolvedAssignee.taskClientId,
      // Real requirement, not automatic: a Client sees this task only if
      // a Manager/Accountant explicitly chose to share it, via the
      // "Share with Client" toggle — NOT just because the task happens
      // to be about them. False by default whenever the toggle isn't
      // shown at all (direct mode, or assigned straight to the Client,
      // who already sees it as the assignee regardless).
      shared_with_client: shareWithClient,
      linked_document_id: linkedDocumentId,
      linked_document_name: linkedDocumentName,
      linked_document_needs_entry: linkedDocumentNeedsEntry,
    });
    if (error) {
      console.error('[TasksScreen] create task failed:', error);
      setLoadError(error.message);
      return;
    }
    resetForm();
    await loadTasks();
  };

  const complete = async (id: string) => {
    const { error } = await supabase.from('tasks').update({ status: 'completed' }).eq('id', id);
    if (error) {
      console.error('[TasksScreen] complete failed:', error);
      setLoadError(error.message);
      return;
    }
    await loadTasks();
  };

  const reopen = async (id: string) => {
    const { error } = await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', id);
    if (error) {
      console.error('[TasksScreen] reopen failed:', error);
      setLoadError(error.message);
      return;
    }
    await loadTasks();
  };

  // Architecture §6.1: this is the actual moment "the Client fulfils it
  // by uploading, which creates the linked Document." Only ever called
  // for a task where linked_document_id is still null and
  // linked_document_name was already set at request time (see
  // isStaffRequestingFromClient in handleCreate) — the name and
  // needs-entry decision were the requester's call, not renegotiated
  // here. Deliberately does NOT also mark the task complete — completion
  // is the assignee's own separate action (Architecture §7.3), not
  // implied by fulfillment.
  const handlePickFulfillFile = async () => {
    const file = await pickDocumentFile();
    if (!file) return; // user cancelled
    setFulfillPickedFile(file);
  };

  const fulfill = async (task: Task) => {
    if (!task.linked_document_name || !fulfillPickedFile) return;
    setFulfillLoading(true);

    const uploadResult = await uploadDocumentFile(fulfillPickedFile, profile.id);
    if ('error' in uploadResult) {
      console.error('[TasksScreen] fulfill (file upload) failed:', uploadResult.error);
      setLoadError(uploadResult.error);
      setFulfillLoading(false);
      return;
    }

    const { data: newDoc, error: docError } = await supabase
      .from('documents')
      .insert({
        tenant_id: profile.tenant_id,
        client_org_id: task.client_org_id,
        client_org_name: task.client_org_name,
        client_id: task.client_id,
        name: task.linked_document_name,
        needs_entry: !!task.linked_document_needs_entry,
        status: task.linked_document_needs_entry ? 'pending' : 'filed',
        source: 'client',
        uploaded_by: profile.id,
        uploaded_by_name: profile.name,
        file_path: uploadResult.path,
        file_size: fulfillPickedFile.size,
        mime_type: fulfillPickedFile.mimeType,
      })
      .select('id')
      .single();
    if (docError || !newDoc) {
      console.error('[TasksScreen] fulfill (create document) failed:', docError);
      setLoadError(docError?.message ?? 'Could not create the document.');
      // File uploaded but the row never did — clean it up rather than
      // leaving an orphaned, permanently-inaccessible object in storage.
      await deleteUploadedFile(uploadResult.path);
      setFulfillLoading(false);
      return;
    }
    const { error: taskError } = await supabase.from('tasks').update({ linked_document_id: newDoc.id }).eq('id', task.id);
    if (taskError) {
      console.error('[TasksScreen] fulfill (link task) failed:', taskError);
      setLoadError(taskError.message);
      setFulfillLoading(false);
      return;
    }
    setFulfillLoading(false);
    setFulfillingTaskId(null);
    setFulfillPickedFile(null);
    await loadTasks();
  };

  // Opens a short-lived signed URL for a task's linked document. Older
  // rows/tasks created before this feature has file_path=null on the
  // document — callers check that before showing the action.
  const handleOpenLinkedDocument = async (filePath: string | null | undefined, taskId: string) => {
    if (!filePath) return;
    setOpeningDocId(taskId);
    const url = await getDocumentSignedUrl(filePath);
    setOpeningDocId(null);
    if (!url) {
      setLoadError('Could not open this file — it may have been removed.');
      return;
    }
    await Linking.openURL(url);
  };

  const visibleTasks = useMemo(() => {
    let v = tasks;
    if (filter === 'assigned_to_me') v = v.filter((t) => t.assignee_id === profile.id);
    if (filter === 'created_by_me') v = v.filter((t) => t.creator_id === profile.id);
    if (typeFilter === 'recurring') v = v.filter((t) => t.recurring);
    if (typeFilter === 'onetime') v = v.filter((t) => !t.recurring);
    const q = search.trim().toLowerCase();
    if (q) {
      v = v.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.client_org_name ?? '').toLowerCase().includes(q)
      );
    }
    return v;
  }, [tasks, filter, typeFilter, search, profile.id]);

  // Title, filter chips, and the "new task" form (when open) — passed to
  // ResponsiveGrid as ListHeaderComponent rather than rendered as a plain
  // sibling above it. A plain sibling View isn't scrollable on its own, so
  // on a short screen (mostly mobile) a tall open form had no way to
  // scroll past it — it just filled the screen with no way to reach the
  // task list or, in bad cases, the Create task button below the fold.
  // Folding it into the list's own header makes the whole screen one
  // scrollable unit, same as the task cards below it.
  const listHeader = (
    <View style={{ marginBottom: 16 }}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Tasks</Text>
        <OutlineButton title={showForm ? 'Cancel' : '+ New task'} onPress={() => setShowForm((s) => !s)} />
      </View>
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

      {showForm && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Task title"
            placeholderTextColor={colors.textFaint}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
            placeholder="Description (optional)"
            placeholderTextColor={colors.textFaint}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            placeholder={recurring ? 'Due date (required for recurring)' : 'Due date (optional)'}
          />

          <View style={styles.recurringRow}>
            <Text style={styles.label}>Recurring</Text>
            <ChipSelect
              options={[
                { value: 'off', label: 'One-time' },
                { value: 'on', label: 'Recurring' },
              ]}
              value={recurring ? 'on' : 'off'}
              onChange={(v) => setRecurring(v === 'on')}
            />
          </View>
          {recurring && (
            <ChipSelect
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
              value={recurrenceTerm}
              onChange={(v) => setRecurrenceTerm(v as RecurrenceTerm)}
            />
          )}
          {recurring && (
            <Text style={[styles.docToggleHint, !dueDate.trim() && { color: colors.danger, fontStyle: 'normal' }]}>
              {dueDate.trim()
                ? `The next task is created automatically on the due date, then every ${
                    recurrenceTerm === 'weekly' ? 'week' : recurrenceTerm === 'monthly' ? 'month' : recurrenceTerm === 'quarterly' ? 'quarter' : 'year'
                  } after that.`
                : 'Pick a due date above — a recurring task repeats from its due date.'}
            </Text>
          )}

          <Text style={styles.label}>Priority</Text>
          <ChipSelect
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority)}
          />

          <View style={styles.docToggleRow}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => {
                const next = !attachDocument;
                setAttachDocument(next);
                // Matches the demo's dependent checkbox: turning the
                // attachment off also turns book entry off, since it's
                // meaningless without a document to carry the flag.
                if (!next) setRequiresBookEntry(false);
              }}
            >
              <Feather name={attachDocument ? 'check-square' : 'square'} size={16} color={attachDocument ? colors.orange : colors.textFaint} />
              <Text style={styles.checkboxLabel}>Attach document</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.checkboxRow, !attachDocument && styles.checkboxRowDisabled]}
              disabled={!attachDocument}
              onPress={() => setRequiresBookEntry((r) => !r)}
            >
              <Feather
                name={requiresBookEntry ? 'check-square' : 'square'}
                size={16}
                color={!attachDocument ? colors.textFaint : requiresBookEntry ? colors.orange : colors.textFaint}
              />
              <Text style={[styles.checkboxLabel, !attachDocument && styles.checkboxLabelDisabled]}>Requires book entry</Text>
            </TouchableOpacity>
          </View>
          {attachDocument && (
            <Text style={styles.docToggleHint}>
              {profile.role !== 'client' && resolvedAssignee?.role === 'client'
                ? `Nothing is created yet — once ${resolvedAssignee.name ?? 'the Client'} uploads to fulfill this task, it becomes a document ${requiresBookEntry ? 'landing as Pending in the Accountant\'s queue.' : 'filed for reference only.'}`
                : `Creates a document named "${title.trim() || 'Untitled task'}" in Documents, ${requiresBookEntry ? 'landing as Pending in the Accountant\'s queue.' : 'filed for reference only.'}`}
            </Text>
          )}
          {attachDocument && !(profile.role !== 'client' && resolvedAssignee?.role === 'client') && (
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
          )}

          {profile.role === 'client' ? (
            <>
              <Text style={styles.label}>Assign to</Text>
              {assignable.length === 0 ? (
                <Text style={styles.empty}>No one to assign yet — check your Client Assignments.</Text>
              ) : (
                <ChipSelect
                  options={assignable.map((a) => ({ value: a.key, label: `${a.name ?? 'Unnamed'} (${roleLabel(a.role)})` }))}
                  value={assigneeKey}
                  onChange={setAssigneeKey}
                />
              )}
            </>
          ) : (
            <>
              {distinctCounterparts.length > 0 && (
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => {
                    setDirectMode((v) => !v);
                    setSelectedClientId(null);
                    setAssigneeTarget(null);
                    setDirectCounterpartId(null);
                    setShareWithClient(false);
                  }}
                >
                  <Feather name={directMode ? 'check-square' : 'square'} size={16} color={directMode ? colors.orange : colors.textFaint} />
                  <Text style={styles.checkboxLabel}>
                    Not about any client — message {roleLabel(distinctCounterparts[0].role)} directly
                  </Text>
                </TouchableOpacity>
              )}

              {directMode ? (
                <>
                  <Text style={styles.label}>Assign to</Text>
                  <ChipSelect
                    options={distinctCounterparts.map((c) => ({ value: c.id, label: `${c.name ?? 'Unnamed'} (${roleLabel(c.role)})` }))}
                    value={directCounterpartId}
                    onChange={setDirectCounterpartId}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>Client</Text>
                  {assignedClients.length === 0 ? (
                    <Text style={styles.empty}>No assigned clients yet — check your Client Assignments.</Text>
                  ) : (
                    clientsByOrg.map((group) => (
                      <View key={group.orgId} style={styles.orgGroup}>
                        <Text style={styles.orgGroupLabel}>{group.orgName}</Text>
                        <ChipSelect
                          options={group.clients.map((c) => ({ value: c.client_id, label: c.client_name ?? 'Unnamed' }))}
                          value={selectedClientId}
                          onChange={(v) => {
                            setSelectedClientId(v);
                            setAssigneeTarget(null);
                            setShareWithClient(false);
                          }}
                        />
                      </View>
                    ))
                  )}
                  {selectedClient && (
                    <>
                      <Text style={styles.label}>Assign to</Text>
                      <ChipSelect
                        options={[
                          { value: 'client', label: `${selectedClient.client_name ?? 'Unnamed'} (Client)` },
                          { value: 'counterpart', label: `${selectedClient.counterpart_name ?? 'Unnamed'} (${roleLabel(selectedClient.counterpart_role)})` },
                        ]}
                        value={assigneeTarget}
                        onChange={(v) => {
                          setAssigneeTarget(v as AssigneeTarget);
                          setShareWithClient(false);
                        }}
                      />
                      {assigneeTarget === 'counterpart' && (
                        <TouchableOpacity style={styles.checkboxRow} onPress={() => setShareWithClient((v) => !v)}>
                          <Feather name={shareWithClient ? 'check-square' : 'square'} size={16} color={shareWithClient ? colors.orange : colors.textFaint} />
                          <Text style={styles.checkboxLabel}>
                            Share with {selectedClient.client_name ?? 'the Client'} — they'll see this task, and any attached document
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          <View style={{ marginTop: 8 }}>
            <PrimaryButton
              title="Create task"
              onPress={handleCreate}
              disabled={
                !title.trim() ||
                !resolvedAssignee ||
                (recurring && !dueDate.trim()) ||
                (attachDocument && !(profile.role !== 'client' && resolvedAssignee?.role === 'client') && !pickedFile)
              }
            />
          </View>
        </View>
      )}

      <StatRow
        items={[
          { num: String(tasks.length), label: 'Total Tasks', icon: 'check-square' },
          { num: String(tasks.filter((t) => t.status === 'in_progress').length), label: 'In Progress', icon: 'activity' },
          { num: String(tasks.filter((t) => t.status === 'completed').length), label: 'Completed', icon: 'check-square' },
          { num: String(tasks.filter((t) => isOverdue(t, todayStr)).length), label: 'Overdue', danger: true, icon: 'alert-circle' },
        ]}
      />

      <View style={styles.filterRow}>
        <ChipSelect
          options={[
            { value: 'all', label: 'All tasks' },
            { value: 'assigned_to_me', label: 'Assigned to me' },
            { value: 'created_by_me', label: 'Created by me' },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
        />
      </View>
      <View style={styles.filterSearchRow}>
        <ChipSelect
          options={[
            { value: 'all', label: 'All Types' },
            { value: 'recurring', label: 'Recurring' },
            { value: 'onetime', label: 'One-time' },
          ]}
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search tasks..."
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />
      </View>
    </View>
  );

  const emptyMessage = <Text style={styles.empty}>No tasks here yet.</Text>;

  // Shared status text + Mark complete/Reopen button, used by both the
  // card's bottom row and the table's Status column.
  //
  // A task with linked_document_name set but linked_document_id still
  // null is an unfulfilled request (Architecture §6.1) — the assignee
  // promised a document that doesn't exist yet. Letting them mark the
  // task Complete anyway would let the request quietly die (the "Upload
  // now" trigger only shows while status is in_progress, so completing
  // it removes the only path back to fulfilling it short of a manual
  // Reopen). OutlineButton has no disabled prop in this codebase, so
  // withholding the button entirely — with an explanatory line in its
  // place — rather than rendering it disabled.
  const renderStatusAndActions = (item: Task) => {
    const awaitingFulfillment = !!item.linked_document_name && !item.linked_document_id;
    const canComplete = item.status === 'in_progress' && item.assignee_id === profile.id;
    return (
      <View style={styles.taskBottomRow}>
        <Text style={[styles.statusText, item.status === 'completed' && styles.statusDone]}>
          {item.status === 'completed' ? 'Completed' : 'In progress'}
        </Text>
        {canComplete && awaitingFulfillment && <Text style={styles.completeBlockedText}>Upload the document to complete this task</Text>}
        {canComplete && !awaitingFulfillment && <OutlineButton title="Mark complete" onPress={() => complete(item.id)} />}
        {item.status === 'completed' && item.creator_id === profile.id && (
          <OutlineButton title="Reopen" onPress={() => reopen(item.id)} />
        )}
      </View>
    );
  };

  // Three states now, not two: a real linked document (file icon +
  // name), an awaiting-upload request from staff (Architecture §6.1 —
  // name/needs-entry decided already, document doesn't exist yet), or
  // nothing attached at all. Only the Client who is the task's assignee
  // gets the "Upload now" trigger — anyone else viewing the task (the
  // requester, Super Admin, Client Admin) just sees the waiting state.
  const renderDocLink = (item: Task) => {
    if (item.linked_document_id) {
      return (
        <View style={styles.docLinkRow}>
          <Feather name="file-text" size={11} color={colors.textFaint} />
          <Text style={styles.docLinkText}>{item.linked_document_name}</Text>
        </View>
      );
    }
    if (item.linked_document_name) {
      const canFulfill = profile.role === 'client' && item.assignee_id === profile.id && item.status === 'in_progress';
      return (
        <View style={styles.docLinkRow}>
          <Feather name="clock" size={11} color={colors.orange} />
          <Text style={styles.docLinkTextPending}>Awaiting upload: {item.linked_document_name}</Text>
          {canFulfill && fulfillingTaskId !== item.id && (
            <TouchableOpacity
              onPress={() => {
                setFulfillPickedFile(null);
                setFulfillingTaskId(item.id);
              }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.fulfillLink}>Upload now</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return null;
  };

  // Small inline confirm step shown once "Upload now" is tapped. Name
  // and the needs-entry decision are locked — those were the requester's
  // call at task-creation time, not renegotiated by the Client here.
  const renderFulfillPanel = (item: Task) =>
    fulfillingTaskId === item.id ? (
      <View style={styles.fulfillPanel}>
        <Text style={styles.fulfillPanelText}>
          Fulfill "{item.linked_document_name}" — {item.linked_document_needs_entry ? 'will land as Pending for your Accountant.' : 'filed for reference only.'}
        </Text>
        <View style={styles.filePickerRow}>
          <OutlineButton title={fulfillPickedFile ? 'Change file' : 'Choose file'} onPress={handlePickFulfillFile} />
          {fulfillPickedFile ? (
            <View style={styles.filePickerNameWrap}>
              <Feather name="paperclip" size={12} color={colors.textDim} />
              <Text style={styles.filePickerName} numberOfLines={1}>{fulfillPickedFile.name}</Text>
            </View>
          ) : (
            <Text style={styles.filePickerHint}>No file chosen yet</Text>
          )}
        </View>
        <View style={styles.fulfillPanelActions}>
          <OutlineButton
            title="Cancel"
            onPress={() => {
              setFulfillingTaskId(null);
              setFulfillPickedFile(null);
            }}
          />
          <PrimaryButton title={fulfillLoading ? 'Uploading...' : 'Upload'} onPress={() => fulfill(item)} disabled={fulfillLoading || !fulfillPickedFile} />
        </View>
      </View>
    ) : null;

  // A Client can only ever receive a row here where they're neither the
  // creator nor the assignee through tasks_select_client_shared (the
  // migration_add_task_client_sharing.sql policy) — every other task a
  // Client sees has them as one of the two parties. That makes this
  // condition, by itself, an unambiguous signal that this is a "shared
  // with you" row, not "your own" task — no new field needed to detect it.
  const isSharedIntoTask = (item: Task) => profile.role === 'client' && item.creator_id !== profile.id && item.assignee_id !== profile.id;

  const renderBadges = (item: Task, overdue: boolean) =>
    item.recurring || overdue || item.escalated || isSharedIntoTask(item) ? (
      <View style={styles.badgeRow}>
        {isSharedIntoTask(item) && (
          <View style={styles.badgeShared}>
            <Feather name="eye" size={10} color={colors.orangeDeep} />
            <Text style={styles.badgeSharedText}>Shared with you</Text>
          </View>
        )}
        {item.recurring && (
          <View style={styles.badgeNeutral}>
            <Text style={styles.badgeNeutralText}>↻ {recurrenceLabel(item.recurrence_term)}</Text>
          </View>
        )}
        {overdue && (
          <View style={styles.badgeDanger}>
            <Text style={styles.badgeDangerText}>Overdue</Text>
          </View>
        )}
        {item.escalated && (
          <View style={styles.badgeDanger}>
            <Text style={styles.badgeDangerText}>Escalated to Manager</Text>
          </View>
        )}
      </View>
    ) : null;

  return (
    <ScreenContainer scroll={breakpoint !== 'phone'}>
      <View style={[styles.screen, breakpoint === 'phone' && styles.screenPhone]}>
        {breakpoint === 'phone' ? (
          <ResponsiveGrid
            data={visibleTasks}
            keyExtractor={(t) => t.id}
            ListHeaderComponent={listHeader}
            renderItem={(item, columns) => {
              const overdue = isOverdue(item, todayStr);
              return (
                <View style={[styles.taskCard, columns === 2 && styles.taskCardGrid]}>
                  <View style={styles.taskTopRow}>
                    <Text style={styles.taskTitle}>{item.title}</Text>
                    <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
                  </View>
                  {item.description ? <Text style={styles.taskDesc}>{item.description}</Text> : null}
                  {renderDocLink(item)}
                  {renderFulfillPanel(item)}
                  <Text style={styles.taskMeta}>
                    {item.creator_name ?? 'Someone'} → {item.assignee_name ?? 'Someone'}
                    {item.client_org_name ? `  ·  ${item.client_org_name}` : ''}
                    {item.due_date ? `  ·  due ${item.due_date}` : ''}
                  </Text>
                  {renderBadges(item, overdue)}
                  {renderStatusAndActions(item)}
                </View>
              );
            }}
            ListEmptyComponent={emptyMessage}
          />
        ) : (
          <DataTable
            scrollable={false}
            data={visibleTasks}
            keyExtractor={(t) => t.id}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyMessage}
            columns={[
              {
                key: 'task',
                header: 'Task',
                width: 260,
                render: (item) => (
                  <View>
                    <Text style={styles.taskTitle}>{item.title}</Text>
                    {isSharedIntoTask(item) && (
                      <View style={[styles.badgeShared, { alignSelf: 'flex-start', marginTop: 4, marginBottom: 2 }]}>
                        <Feather name="eye" size={10} color={colors.orangeDeep} />
                        <Text style={styles.badgeSharedText}>Shared with you</Text>
                      </View>
                    )}
                    {item.description ? <Text style={styles.taskDesc}>{item.description}</Text> : null}
                    {renderDocLink(item)}
                    {renderFulfillPanel(item)}
                  </View>
                ),
              },
              { key: 'client', header: 'Client', width: 150, render: (item) => <Text style={styles.taskMeta}>{item.client_org_name ?? '—'}</Text> },
              {
                key: 'people',
                header: 'Creator → Assignee',
                width: 190,
                render: (item) => (
                  <Text style={styles.taskMeta}>
                    {item.creator_name ?? 'Someone'} → {item.assignee_name ?? 'Someone'}
                  </Text>
                ),
              },
              {
                key: 'recurring',
                header: 'Recurring',
                width: 130,
                render: (item) => (item.recurring ? <Text style={styles.taskMeta}>↻ {recurrenceLabel(item.recurrence_term)}</Text> : <Text style={styles.taskMeta}>One-time</Text>),
              },
              {
                key: 'due',
                header: 'Due',
                width: 130,
                render: (item) => {
                  const overdue = isOverdue(item, todayStr);
                  return (
                    <View>
                      <Text style={styles.taskMeta}>{item.due_date ?? '—'}</Text>
                      {overdue && (
                        <View style={styles.badgeDanger}>
                          <Text style={styles.badgeDangerText}>Overdue</Text>
                        </View>
                      )}
                      {item.escalated && (
                        <View style={styles.badgeDanger}>
                          <Text style={styles.badgeDangerText}>Escalated</Text>
                        </View>
                      )}
                    </View>
                  );
                },
              },
              {
                key: 'bookEntry',
                header: 'Book Entry',
                width: 100,
                render: (item) =>
                  item.linked_document_id ? (
                    <Text style={item.linked_document_needs_entry ? styles.bookEntryYes : styles.taskMeta}>
                      {item.linked_document_needs_entry ? 'Yes' : 'No'}
                    </Text>
                  ) : item.linked_document_name ? (
                    <Text style={styles.bookEntryAwaiting}>Awaiting</Text>
                  ) : (
                    <Text style={styles.taskMeta}>No doc</Text>
                  ),
              },
              {
                key: 'severity',
                header: 'Severity',
                width: 100,
                render: (item) => (
                  <View style={styles.severityCell}>
                    <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
                    <Text style={styles.taskMeta}>{item.priority}</Text>
                  </View>
                ),
              },
              { key: 'status', header: 'Status', width: 200, render: renderStatusAndActions },
            ]}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

function priorityColor(p: TaskPriority) {
  if (p === 'high') return colors.danger;
  if (p === 'low') return colors.textFaint;
  return colors.orange;
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  screenPhone: { flex: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  filterRow: { marginBottom: 12 },
  filterSearchRow: { gap: 10, marginBottom: 12 },
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
  recurringRow: { marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badgeNeutral: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeNeutralText: { fontSize: 11, fontWeight: '600', color: colors.textDim },
  badgeDanger: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeDangerText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  badgeShared: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeSharedText: { fontSize: 11, fontWeight: '700', color: colors.orangeDeep },
  form: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
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
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 12, marginTop: -6, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textFaint, marginBottom: 6, marginTop: 2, textTransform: 'uppercase' },
  orgGroup: { marginBottom: 10 },
  orgGroupLabel: { fontSize: 12, fontWeight: '700', color: colors.textDim, marginBottom: 6 },
  docToggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 4, marginBottom: 4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxRowDisabled: { opacity: 0.5 },
  checkboxLabel: { fontSize: 13, color: colors.textDim },
  checkboxLabelDisabled: { color: colors.textFaint },
  docToggleHint: { fontSize: 11, color: colors.textFaint, marginTop: 4, marginBottom: 8, fontStyle: 'italic' },
  docLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  docLinkText: { fontSize: 11, color: colors.textFaint },
  docLinkTextPending: { fontSize: 11, color: colors.orange, fontWeight: '600' },
  filePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  filePickerNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  filePickerName: { fontSize: 12, color: colors.textDim, flexShrink: 1 },
  filePickerHint: { fontSize: 12, color: colors.textFaint, fontStyle: 'italic' },
  fulfillLink: { fontSize: 11, color: colors.orange, fontWeight: '700', textDecorationLine: 'underline', marginLeft: 4 },
  bookEntryYes: { fontSize: 12, fontWeight: '700', color: colors.orange },
  bookEntryAwaiting: { fontSize: 12, fontWeight: '600', color: colors.textFaint, fontStyle: 'italic' },
  completeBlockedText: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic', flexShrink: 1 },
  fulfillPanel: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fulfillPanelText: { fontSize: 12, color: colors.textDim, marginBottom: 8 },
  fulfillPanelActions: { flexDirection: 'row', gap: 8 },
  taskCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  taskCardGrid: { width: '48%' },
  taskTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  severityCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  taskDesc: { fontSize: 13, color: colors.textDim, marginTop: 4 },
  taskMeta: { fontSize: 12, color: colors.textFaint, marginTop: 6 },
  taskBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  statusText: { fontSize: 12, fontWeight: '700', color: colors.orange },
  statusDone: { color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
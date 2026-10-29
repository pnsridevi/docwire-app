// LOCATION: docwire-app/lib/types.ts
export type Role = 'client' | 'accountant' | 'manager' | 'client_admin' | 'super_admin';

export type Profile = {
  id: string;
  tenant_id: string;
  client_org_id: string | null;
  name: string | null;
  role: Role;
  // Migration_phase2_firm_wide_staff.sql. Only meaningful for role in
  // ('manager','accountant') — Super Admin-set. Lets an otherwise
  // unassigned Manager/Accountant still upload org-general work
  // documents (never Client-specific ones) across every org in the
  // tenant, not just orgs they have a real client_assignments relationship
  // in. Deliberately opt-in per account, not automatic — see the
  // migration's header comment for why.
  firm_wide_staff?: boolean;
  // Add_user_deactivation.sql. Set when the account has been
  // deactivated — App.tsx signs such a profile out straight away.
  deactivated_at?: string | null;
  // Add_password_change.sql. True for every account created after that
  // file was run, until the person sets their own password — App.tsx
  // shows SetPasswordScreen instead of the app while it is true.
  must_change_password?: boolean;
};

export type Doc = {
  id: string;
  name: string;
  status: 'pending' | 'accounted' | 'reviewed' | 'rework' | 'filed';
  needs_entry: boolean;
  // migration_add_staff_direct_tasks_and_docs.sql. Was required; now
  // null exactly for a direct staff-to-staff share (see
  // shared_with_user_id below) — there is no client, so no client org
  // to attach either.
  client_org_id: string | null;
  // Phase 2 (Migration_phase2_documents_tasks.sql, section A). Null means
  // this document is general to the whole org; set means it's about one
  // specific Client. Client-source uploads always have this = the
  // uploader (enforced server-side by the fix_client_document_org
  // trigger, not just trusted from the app). Staff work documents may or
  // may not have it, depending on whether the upload was scoped to one
  // Client or left general.
  client_id: string | null;
  // Denormalized display name for client_id — same reasoning as
  // client_org_name below (a Manager/Accountant on "All Clients", or
  // Super Admin platform-wide, mixes documents about many different
  // Clients in one list with no way to tell them apart without a
  // per-row lookup). Null exactly when client_id is null — an
  // org-general document with no specific Client to name.
  client_name: string | null;
  // Role-specific rather than a generic 'staff' value (Phase 2 decision,
  // change list §E.1) — lets the UI show "from your Manager" vs "from
  // your Accountant" without an extra lookup. Auto-set at creation from
  // the uploader's own role; never something the user picks.
  source: 'client' | 'manager' | 'accountant';
  // Four independent sharing toggles for staff work documents (source in
  // ('manager','accountant')) — meaningless/ignored for source='client'
  // rows, which follow the older org-wide-to-Client-Admin /
  // own-upload-only rules instead. Any combination can be on at once;
  // see Phase 2 decision §E.2 for how shared_with_clients resolves when
  // client_id is set vs null.
  shared_with_manager: boolean;
  shared_with_accountant: boolean;
  shared_with_client_admin: boolean;
  shared_with_clients: boolean;
  // migration_add_staff_direct_tasks_and_docs.sql +
  // migration_add_shared_with_user_name.sql. A direct, point-to-point
  // share between two staff members with no Client involved at all
  // (TasksScreen.tsx's directMode). Deliberately NOT a fifth boolean
  // alongside the four above — those mean "any Manager/Accountant who
  // shares a Client with me," which has no meaning here since there is
  // no Client relationship left to scope by once client_id is null.
  // Both null together whenever this isn't a direct share.
  shared_with_user_id: string | null;
  shared_with_user_name: string | null;
  // Denormalized at insert time, same reasoning as Task.creator_name /
  // assignee_name below: a Manager/Accountant viewing "All Clients" mixes
  // documents from several client orgs in one list, and there was
  // previously no way to tell them apart, or to show who/what uploaded
  // each one, without a join per row. See
  // Migration_add_display_names.sql.
  client_org_name: string | null;
  // Phase 2 (D.2). The prior version of this type only had
  // uploaded_by_name — enough to display, but not enough for a screen to
  // determine "did I upload this?" client-side (e.g. to show an Edit
  // control only on a Manager/Accountant's own work-document uploads).
  uploaded_by: string;
  uploaded_by_name: string | null;
  // Real file storage (lib/storage.ts, migration_add_document_file_storage.sql).
  // Nullable because every document created before this feature existed
  // has nothing attached — the UI checks file_path before showing any
  // "open"/"view" affordance rather than assuming it's always set.
  // file_path is the private Storage object key (bucket 'documents'),
  // never a public URL — actual access always goes through a short-lived
  // signed URL (getDocumentSignedUrl), since these are private financial
  // records. A single file_path can legitimately be referenced by more
  // than one Doc row (e.g. one work document shared across several
  // selected Clients in one upload) — it's a many-to-one pointer, not a
  // 1:1 ownership relationship.
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  // Rework reupload tracking (migration_add_document_rework_reupload.sql).
  // Two separate booleans, not one — "a reupload was asked for" and "it
  // has actually happened" are different facts, and conflating them is
  // exactly what let an Accountant re-submit against a stale file before
  // this existed. reupload_requested is set only by the Manager's
  // send-to-rework action (only Manager can send to Rework — Architecture
  // §6.3, Roles doc capability matrix); reupload_fulfilled flips true
  // only when the Client actually reuploads (ClientHomeScreen.tsx's
  // handleReupload). Both false on every row created before this
  // feature — the correct default for an ordinary entry-only Rework.
  reupload_requested: boolean;
  reupload_fulfilled: boolean;
  // Add_staff_book_entry.sql: set when a Manager or Accountant put this
  // document into book entry (their own upload with the box ticked, or
  // "Send for book entry" on a stored document). Null for a Client's own
  // ticked upload and for stored documents.
  entry_requested_by?: string | null;
  entry_requested_by_name?: string | null;
  entry_requested_at?: string | null;
  comment: string | null;
  created_at: string;
};

// One archived previous version of a document's file — created only at
// the moment a Client reuploads after Rework (migration_add_document_
// rework_reupload.sql). The CURRENT file always lives on Doc.file_path
// itself; rows here are strictly history. version_number is assigned by
// a DB trigger, never the client, so it can't race.
export type DocumentVersion = {
  id: string;
  document_id: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  version_number: number;
  created_at: string;
};

export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'in_progress' | 'completed';
export type RecurrenceTerm = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type Task = {
  id: string;
  tenant_id: string;
  // migration_add_staff_direct_tasks_and_docs.sql. Was required; now
  // null exactly for a direct staff-to-staff task with no Client
  // involved at all (TasksScreen.tsx's directMode) — see client_id below
  // for the fuller history of this decision.
  client_org_id: string | null;
  // Phase 2 (Migration_phase2_documents_tasks.sql, section B) originally
  // made this required, reasoning "every Task has a real Client behind
  // it, no exceptions... purely staff-to-staff coordination stays out of
  // Tasks entirely." migration_add_staff_direct_tasks_and_docs.sql
  // deliberately REVERSES that decision — direct Manager<->Accountant
  // tasks are now a real, supported case, and this is null exactly then.
  // Every other path still supplies a real Client id (the Client
  // themselves, or the Client a staff-to-staff task is about) —
  // derive_task_client_id would arrive at the same value on its own for
  // a Client-role creation, but must be supplied explicitly for the
  // Manager-assigns-to-Accountant (and vice versa) case, since neither
  // party there is a Client the trigger could derive it from.
  client_id: string | null;
  // Denormalized at insert time, same as creator_name/assignee_name below.
  // Task had creator_name/assignee_name but no client_org_name — a real
  // gap, since Manager/Accountant on "All Clients" see tasks from
  // multiple orgs mixed together with no way to tell which client a task
  // belongs to. See Migration_add_display_names.sql.
  client_org_name: string | null;
  title: string;
  description: string | null;
  creator_id: string;
  creator_name: string | null;
  creator_role: Role;
  assignee_id: string;
  assignee_name: string | null;
  assignee_role: Role;
  priority: TaskPriority;
  due_date: string | null;
  status: TaskStatus;
  created_at: string;
  // Architecture Section 7.4: due-date based recurrence. recurrence_term
  // is only meaningful when recurring is true.
  recurring: boolean;
  recurrence_term: RecurrenceTerm | null;
  // Set by a backend scheduled job (see Migration_task_recurrence_and_overdue.sql)
  // once a task passes its due_date while still in_progress — Architecture
  // Section 7.5: "An overdue task automatically escalates to the Manager
  // responsible for that client." The Manager already sees every task for
  // their assigned clients regardless of this flag (tasks_select_manager
  // RLS is client-scoped, not creator/assignee-scoped) — this flag is what
  // lets the UI actually highlight it as escalated rather than just
  // "overdue right now" (which the UI can also compute live from due_date,
  // independent of whether the daily job has run yet).
  escalated: boolean;
  // Architecture §7.2: "An attached document is created in the
  // Documents module at the same time, and can independently carry the
  // needs book entry flag." Set together, only at task creation — a task
  // either has a document attached from the start or it never does;
  // there's no later "attach a document to an existing task" flow.
  // linked_document_needs_entry is denormalized from the Document's own
  // needs_entry at insert time (same reasoning as client_org_name below:
  // avoids a join per row just to render the Tasks table's Book Entry
  // column) — safe to duplicate since needs_entry is never edited after
  // a document is created.
  linked_document_id: string | null;
  linked_document_name: string | null;
  linked_document_needs_entry: boolean | null;
  // migration_add_task_client_sharing.sql. A Client sees this task only
  // when this is explicitly true — set by a Manager/Accountant's "Share
  // with Client" toggle in TasksScreen.tsx, never automatic just because
  // client_id happens to be set. Meaningless (left false) for a task
  // assigned directly to the Client themselves — they already see it as
  // the assignee regardless — and for a direct staff-to-staff task with
  // no client_id at all.
  shared_with_client: boolean;
  // Set by the daily recurring job once the next copy exists. A recurring
  // task with this still null is the live end of its series.
  next_occurrence_generated_at: string | null;
};

// One line of a task's history (Add_user_deactivation.sql) — written only
// by the database: reassignments (by hand or automatic), and closing /
// stopping a task whose creator or assignee was deactivated.
export type TaskActivity = {
  id: string;
  task_id: string;
  action: 'reassigned' | 'closed' | 'stopped_repeating';
  details: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};

// What get_deactivation_blockers() returns — everything that has to be
// sorted out before an account can be deactivated.
export type DeactivationBlockers = {
  open_tasks: {
    id: string;
    title: string;
    client_name: string | null;
    client_org_name: string | null;
    due_date: string | null;
    recurring: boolean;
    status: TaskStatus;
    reassigned_by: string;
  }[];
  client_assignments: { client_name: string | null; client_org_name: string; as: 'Manager' | 'Accountant' }[];
  org_defaults: { client_org_name: string; as: 'Manager' | 'Accountant' }[];
  rework_documents: { id: string; name: string }[];
  only_client_admin: boolean;
};

export type ReassignOption = { id: string; name: string | null; role: Role };

// A lightweight person reference used to populate the Client role's
// assignee picker in TasksScreen (a flat choice between their own,
// fixed, Manager and Accountant). Phase 2, D.3 (change list §E.3): this
// is NO LONGER used for the Manager/Accountant branch of that picker —
// see AssignedClientOption below for that. Kept here, scoped to Client,
// since a Client's own two options are still a genuinely flat choice
// with no Client-first step to take.
//
// `key` exists separately from `id` because the SAME person can appear
// as more than one valid option — e.g. an Accountant who serves two of a
// Manager's clients shows up once per client, each tied to a different
// client_org_id. Using `id` alone as the picker's selection key would make
// those two entries indistinguishable (selecting either one would resolve
// to whichever came first in the list), silently filing a task under the
// wrong client. `key` is `${id}::${client_org_id}` so each option is
// always unique, even when the underlying person repeats.
export type AssignableUser = {
  key: string;
  id: string;
  name: string | null;
  role: Role;
  client_org_id: string;
  client_org_name: string;
};

// Phase 2, D.3 design decision (change list §E.3): Manager/Accountant no
// longer pick an assignee from a flat list of people — there's exactly
// one right counterpart per Client under client_assignments now, so
// picking a person independently of a Client was never meaningful to
// begin with. Instead they pick a CLIENT first (this type, one entry per
// Client they're assigned to), and the form then offers exactly two
// targets: that Client themselves, or their correct counterpart staff
// member — already resolved here, never chosen from a separate list.
export type AssignedClientOption = {
  client_id: string;
  client_name: string | null;
  client_org_id: string;
  client_org_name: string;
  // The OTHER staff role relative to the caller — accountant_id/'accountant'
  // when this list belongs to a Manager, manager_id/'manager' when it
  // belongs to an Accountant.
  counterpart_id: string;
  counterpart_name: string | null;
  counterpart_role: Role;
};

// A client organization — Super Admin onboards these; seat_limit is
// enforced by the admin-create-user Edge Function when a Client Admin
// creates a Client (Roles doc: "Cannot exceed the seat limit set by
// Super Admin"). See Migration_super_admin_client_admin.sql.
export type ClientOrg = {
  id: string;
  tenant_id: string;
  name: string;
  seat_limit: number;
  created_at: string;
};

// Per-client staff assignment (Architecture V2 §5.1/§8.2). One row per
// individual Client (a user with role='client'), holding their CURRENTLY
// EFFECTIVE Manager and Accountant. Auto-seeded (by a DB trigger) from
// the client org's defaults — manager_assignments / accountant_assignments
// below — the moment the Client is created, then editable ONLY by Super
// Admin from here on (§8.2: "Super Admin is the only actor who can edit a
// ClientAssignment row"). No default/override distinction in practice
// despite the "empty means follow org default" wording in the
// Architecture doc's entity table — the actual mechanism (and the
// schema's seed-on-insert trigger) always copies real ids in at creation
// time, so every Client has a real, non-null row to read here. Manager
// and Accountant CANNOT independently be reassigned without going through
// Super Admin (§8.1) — Manager lost that capability in Revision 3.
export type ClientAssignment = {
  client_id: string;
  client_org_id: string;
  manager_id: string;
  accountant_id: string;
};

// Append-only audit record of every ClientAssignment change (§5.1, §8.2)
// — who was assigned when and who changed it. Reference/audit only, has
// no bearing on RLS or visibility (Revision 3 deliberately chose live/
// immediate reassignment over retained access). Not read by any screen
// yet — included for when an audit-trail view gets built.
export type ClientAssignmentHistory = {
  id: string;
  client_id: string;
  old_manager_id: string | null;
  new_manager_id: string | null;
  old_accountant_id: string | null;
  new_accountant_id: string | null;
  changed_at: string;
  changed_by: string;
};

// A firm staff member (Manager/Accountant/Client Admin) or Client user,
// as listed on the Super Admin / Client Admin user-management screens.
// Deliberately lighter than Profile — these are OTHER users being
// listed/managed, not the signed-in caller, and public.users doesn't
// store email (that lives only in auth.users, not exposed to the client
// app), so there's no field for it here.
export type StaffMember = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  client_org_id: string | null;
  created_at: string;
  // Migration_phase2_firm_wide_staff.sql. Only meaningful for
  // role in ('manager','accountant').
  firm_wide_staff?: boolean;
  // Add_user_deactivation.sql. Null/absent = active.
  deactivated_at?: string | null;
};
// ------------------------------------------------------------
// Master Documents (Add_master_documents.sql)
// ------------------------------------------------------------

// parent_id null = a category; parent_id set = a sub-tag under that
// category (only two levels). Nothing is ever deleted.
// Shared_master_categories.sql: tenant_id null = the STANDARD list, one
// copy shared by every firm — read-only in the app (no rename, no hide).
// tenant_id set = that firm's own entry, visible only to that firm;
// Managers and Super Admin add, rename and hide those.
export type MasterCategory = {
  id: string;
  tenant_id: string | null;
  name: string;
  parent_id: string | null;
  is_default: boolean;
  // Hidden entries can't be picked for new uploads or edits, but still
  // label the documents that already use them.
  hidden: boolean;
  created_by: string | null;
  created_at: string;
};

// A permanent reference document belonging to a whole client
// ORGANISATION (not one Client). Every *_name, file_uploaded_by*,
// current_version, updated_*, deleted_by* field is filled server-side by
// the master_documents_before_write trigger — the app never sends them.
// Deleting is a soft delete (deleted_at set); nothing is ever erased.
export type MasterDocument = {
  id: string;
  tenant_id: string;
  client_org_id: string;
  client_org_name: string | null;
  name: string;
  category_id: string;
  subtag_id: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  file_uploaded_by: string | null;
  file_uploaded_by_name: string | null;
  current_version: number;
  // Set only when this was created by marking an existing regular
  // document as master. source_file_path (the file at the moment of
  // marking) is how Documents screens also tag the other per-Client
  // copies of the same shared upload as "Master".
  source_document_id: string | null;
  source_file_path: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_by_name: string | null;
  // Fixed at creation by the database (Update_master_documents_permissions.sql):
  // 'client' = uploaded by a Client/Client Admin, or marked from a Client's
  // document; 'staff' = everything else. Clients and Client Admins can
  // change only client-owned documents; staff-owned ones are view-only
  // for them.
  owner: 'client' | 'staff';
};

// A previous file of a Master Document — written only by the DB trigger
// at the moment a file is replaced. The current file is always on
// MasterDocument.file_path itself.
export type MasterDocumentVersion = {
  id: string;
  master_document_id: string;
  version_number: number;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  replaced_at: string;
  replaced_by: string | null;
  replaced_by_name: string | null;
};

export type MasterDocumentLogAction =
  | 'created'
  | 'marked'
  | 'replaced'
  | 'renamed'
  | 'recategorised'
  | 'deleted'
  | 'restored'
  // An older file made current again from History.
  | 'version_restored';

// Who did what, when — written only by the DB trigger, so every change
// is logged no matter which screen made it.
export type MasterDocumentLogEntry = {
  id: string;
  master_document_id: string;
  action: MasterDocumentLogAction;
  details: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};
// ------------------------------------------------------------
// Chat (Add_chat.sql)
// ------------------------------------------------------------

// One row of my_chats(): a chat the signed-in person is in, with what
// the chat list shows.
export type ChatSummary = {
  chat_id: string;
  is_group: boolean;
  // Group name; for an unnamed group the other members' names; for a 1:1
  // chat the other person's name.
  display_name: string;
  group_name: string | null;
  // For a group: the person who manages it (adds, removes, renames).
  created_by: string;
  client_org_id: string | null;
  member_count: number;
  // 1:1 chats only.
  other_user_id: string | null;
  other_user_role: Role | null;
  other_deactivated: boolean;
  last_activity_at: string;
  last_kind: 'text' | 'system' | null;
  last_body: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  last_deleted: boolean | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string | null;
  // Kept on the message so it still shows after the sender leaves.
  sender_name: string | null;
  // 'system' = "Priya added Kavya" etc.
  kind: 'text' | 'system';
  // Null once deleted.
  body: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type ChatMember = {
  user_id: string;
  name: string | null;
  role: Role;
  client_org_name: string | null;
  deactivated: boolean;
  joined_at: string;
};

// Someone the signed-in person may start a chat with (chat_people()).
export type ChatPerson = {
  user_id: string;
  name: string | null;
  role: Role;
  client_org_id: string | null;
  client_org_name: string | null;
};

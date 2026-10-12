// LOCATION: docwire-app/lib/masterDocs.ts (NEW FILE)
//
// Shared data helpers for Master Documents — used by MasterDocsScreen.tsx
// and by the "Master" tag / "Mark as master" control on every Documents
// screen (components/MasterDocControls.tsx). All access rules live in the
// database (Add_master_documents.sql, can_access_master_org); nothing here
// is a security boundary, it only decides what to OFFER in the UI.
import { supabase } from './supabase';
import { Doc, MasterCategory, MasterDocument, Profile } from './types';

export type OrgOption = { id: string; name: string };

export async function loadMasterCategories(): Promise<{ data: MasterCategory[]; error: string | null }> {
  const { data, error } = await supabase.from('master_categories').select('*').order('name', { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: (data as MasterCategory[]) ?? [], error: null };
}

export async function loadMasterDocuments(): Promise<{ data: MasterDocument[]; error: string | null }> {
  const { data, error } = await supabase.from('master_documents').select('*').order('updated_at', { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as MasterDocument[]) ?? [], error: null };
}

// The organisations this person can upload Master Documents for — the
// same rule the database enforces, so the picker never offers an org the
// insert would then reject:
//   Client Admin / Client     -> their own org only
//   Super Admin / firm-wide   -> every org in the firm
//   Manager / Accountant      -> every org where they have at least one
//                                assigned Client (client_assignments)
export async function loadAccessibleOrgs(profile: Profile): Promise<{ data: OrgOption[]; error: string | null }> {
  if (profile.role === 'client' || profile.role === 'client_admin') {
    if (!profile.client_org_id) return { data: [], error: null };
    const { data, error } = await supabase.from('client_organizations').select('id,name').eq('id', profile.client_org_id);
    if (error) return { data: [], error: error.message };
    return { data: (data as OrgOption[]) ?? [], error: null };
  }

  const allOrgs = async () => {
    const { data, error } = await supabase.from('client_organizations').select('id,name').order('name', { ascending: true });
    if (error) return { data: [] as OrgOption[], error: error.message };
    return { data: (data as OrgOption[]) ?? [], error: null };
  };

  if (profile.role === 'super_admin' || profile.firm_wide_staff) return allOrgs();

  const column = profile.role === 'manager' ? 'manager_id' : 'accountant_id';
  const { data: rows, error } = await supabase.from('client_assignments').select('client_org_id').eq(column, profile.id);
  if (error) return { data: [], error: error.message };
  const ids = Array.from(new Set((rows ?? []).map((r: any) => r.client_org_id as string)));
  if (ids.length === 0) return { data: [], error: null };
  const { data: orgs, error: orgError } = await supabase
    .from('client_organizations')
    .select('id,name')
    .in('id', ids)
    .order('name', { ascending: true });
  if (orgError) return { data: [], error: orgError.message };
  return { data: (orgs as OrgOption[]) ?? [], error: null };
}

// "GST › GSTR-1", or just "GST" with no sub-tag.
export function categoryLabel(categories: MasterCategory[], categoryId: string | null, subtagId: string | null): string {
  const cat = categories.find((c) => c.id === categoryId);
  const sub = subtagId ? categories.find((c) => c.id === subtagId) : undefined;
  if (!cat) return 'Uncategorised';
  return sub ? `${cat.name} › ${sub.name}` : cat.name;
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Managers and Super Admin add, rename and hide categories/sub-tags
// (Update_master_documents_permissions.sql enforces the same rule).
export function canAddCategories(profile: Profile): boolean {
  return profile.role === 'manager' || profile.role === 'super_admin';
}

export function canManageCategories(profile: Profile): boolean {
  return canAddCategories(profile);
}

// Client and Client Admin are one side for Master Documents.
export function isClientSideRole(profile: Profile): boolean {
  return profile.role === 'client' || profile.role === 'client_admin';
}

// Replace file, Edit details, and "Make this the current version".
// Staff and Super Admin: any Master Document they can see. Clients and
// Client Admins: only client-owned ones — documents added by the firm are
// view-only for them. Mirrors master_documents_before_write; the database
// is the real boundary, this only decides which buttons to show.
export function canChangeMasterDoc(profile: Profile, doc: MasterDocument): boolean {
  if (doc.deleted_at) return false;
  return !isClientSideRole(profile) || doc.owner === 'client';
}

// Delete, restore and the Deleted filter: staff and Super Admin only.
export function canDeleteMasterDocs(profile: Profile): boolean {
  return !isClientSideRole(profile);
}

// Is this regular document already a Master Document? True when a live
// Master Document was created from it, OR from another per-Client copy
// of the same shared upload (same org, same file at the moment of
// marking) — a work document shared with several Clients is stored as
// one row per Client, and the org has only one Master Document for it.
export function findMasterForDoc(masters: MasterDocument[], doc: Doc): MasterDocument | undefined {
  return masters.find(
    (m) =>
      !m.deleted_at &&
      (m.source_document_id === doc.id ||
        (!!doc.file_path && m.client_org_id === doc.client_org_id && m.source_file_path === doc.file_path))
  );
}

// A regular document can be marked as master only if it has a real file
// and belongs to an organisation. Direct staff-to-staff shares have no
// organisation, so there's no org whose Master Documents it could join.
export function canMarkAsMaster(doc: Doc): boolean {
  return !!doc.file_path && !!doc.client_org_id;
}
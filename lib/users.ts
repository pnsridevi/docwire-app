// LOCATION: docwire-app/lib/users.ts (NEW FILE)
//
// Deactivation helpers shared by the Users screens, TasksScreen and the
// Documents screens (Add_user_deactivation.sql). Every rule lives in the
// database; nothing here is a security boundary.
import { supabase, extractFunctionError } from './supabase';
import { DeactivationBlockers } from './types';

// Deactivate (active = false) or reactivate (true) an account. Goes
// through the admin-set-user-active Edge Function, which runs the
// database checks as the signed-in person and then blocks or unblocks
// the login itself. Returns an error message for people, or null.
export async function setUserActive(userId: string, active: boolean): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('admin-set-user-active', {
    body: { userId, active },
  });
  if (error || data?.error) {
    const message = await extractFunctionError(error, data);
    return message ?? (active ? 'Could not reactivate this account.' : 'Could not deactivate this account.');
  }
  return null;
}

// Everything in the way of deactivating someone.
export async function loadDeactivationBlockers(
  userId: string
): Promise<{ data: DeactivationBlockers | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_deactivation_blockers', { p_user_id: userId });
  if (error) return { data: null, error: error.message };
  return { data: data as DeactivationBlockers, error: null };
}

export function hasBlockers(b: DeactivationBlockers): boolean {
  return (
    b.open_tasks.length > 0 ||
    b.client_assignments.length > 0 ||
    b.org_defaults.length > 0 ||
    b.rework_documents.length > 0
  );
}

// Ids of every deactivated person in the firm — used to put
// "(deactivated)" next to their name on old items. users_select_tenant
// already lets everyone read the firm's user rows.
export async function loadDeactivatedIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('users').select('id').not('deactivated_at', 'is', null);
  if (error) {
    console.error('[users] loadDeactivatedIds failed:', error);
    return new Set();
  }
  return new Set((data ?? []).map((r: any) => r.id as string));
}

export function nameWithStatus(name: string | null | undefined, id: string | null | undefined, deactivated: Set<string>): string {
  const base = name ?? 'Someone';
  return id && deactivated.has(id) ? `${base} (deactivated)` : base;
}
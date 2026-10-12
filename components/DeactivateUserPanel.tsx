// LOCATION: docwire-app/components/DeactivateUserPanel.tsx (NEW FILE)
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton } from './UI';
import { Dropdown } from './Dropdown';
import { DeactivationBlockers, Profile, ReassignOption } from '../lib/types';
import { hasBlockers, loadDeactivationBlockers, setUserActive } from '../lib/users';

export type DeactivateTarget = { id: string; name: string | null; role: string };

// One panel for both Users screens (Super Admin and Client Admin).
//
// Deactivate: first lists everything in the way (open tasks, assigned
// Clients, organisation defaults, documents waiting for this person to
// reupload). Super Admin can reassign each open task right here; a Client
// Admin is told whose job it is (the Client's Manager). Assigned Clients
// and defaults are changed in the Users tables as usual. "Check again"
// reloads the list; once it's empty the Deactivate button appears.
//
// Reactivate: a single confirmation. The database refuses it if the
// organisation has no free seat, and the message says so.
//
// The database repeats every check when the button is pressed, so the
// list here is guidance, not the gate.
export function DeactivateUserPanel({
  profile,
  target,
  mode,
  onClose,
  onDone,
}: {
  profile: Profile;
  target: DeactivateTarget | null;
  mode: 'deactivate' | 'reactivate';
  onClose: () => void;
  onDone: () => void;
}) {
  const isSuperAdmin = profile.role === 'super_admin';
  const [blockers, setBlockers] = useState<DeactivationBlockers | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline task reassignment (Super Admin only)
  const [reassigningTaskId, setReassigningTaskId] = useState<string | null>(null);
  const [options, setOptions] = useState<ReassignOption[]>([]);
  const [newAssigneeId, setNewAssigneeId] = useState<string | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);

  const load = async () => {
    if (!target || mode !== 'deactivate') return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await loadDeactivationBlockers(target.id);
    setLoading(false);
    if (loadError) {
      setError(loadError);
      return;
    }
    setBlockers(data);
  };

  useEffect(() => {
    setBlockers(null);
    setError(null);
    setReassigningTaskId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, mode]);

  const startReassign = async (taskId: string) => {
    setReassigningTaskId(taskId);
    setNewAssigneeId(null);
    setOptions([]);
    setError(null);
    const { data, error: optError } = await supabase.rpc('task_reassign_options', { p_task_id: taskId });
    if (optError) {
      setError(optError.message);
      return;
    }
    setOptions((data as ReassignOption[]) ?? []);
  };

  const saveReassign = async () => {
    if (!reassigningTaskId || !newAssigneeId) return;
    setReassignBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('reassign_task', {
      p_task_id: reassigningTaskId,
      p_new_assignee: newAssigneeId,
    });
    setReassignBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReassigningTaskId(null);
    await load();
  };

  const confirm = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);
    const message = await setUserActive(target.id, mode === 'reactivate');
    setSaving(false);
    if (message) {
      setError(message);
      // A blocker may have appeared since the list was loaded.
      if (mode === 'deactivate') await load();
      return;
    }
    onDone();
  };

  const close = () => {
    if (saving || reassignBusy) return;
    onClose();
  };

  const name = target?.name ?? 'This person';
  const blocked = !!blockers && hasBlockers(blockers);

  const roleLabel = (r: string) =>
    r === 'manager' ? 'Manager' : r === 'accountant' ? 'Accountant' : r === 'client' ? 'Client' : r === 'client_admin' ? 'Client Admin' : r;

  return (
    <Modal transparent visible={!!target} animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{mode === 'deactivate' ? `Deactivate ${name}` : `Reactivate ${name}`}</Text>

            {mode === 'reactivate' ? (
              <Text style={styles.subtitle}>
                {name} will be able to sign in again with their existing password, and will use a seat again.
                {target && (target.role === 'manager' || target.role === 'accountant')
                  ? ' They come back with no Clients — assign Clients to them as usual.'
                  : ''}
              </Text>
            ) : (
              <Text style={styles.subtitle}>
                {name} won't be able to sign in, and will lose access straight away, even on a device that is still
                signed in. Everything they uploaded or created stays, with their name on it. They no longer use a seat,
                and you can reactivate them later.
              </Text>
            )}

            {loading && <Text style={styles.meta}>Checking...</Text>}

            {mode === 'deactivate' && blockers && blocked && (
              <View style={styles.blockBox}>
                <Text style={styles.blockTitle}>Sort these out first</Text>

                {blockers.open_tasks.length > 0 && (
                  <>
                    <Text style={styles.sectionHeading}>Open tasks assigned to {name}</Text>
                    {blockers.open_tasks.map((t) => (
                      <View key={t.id} style={styles.itemRow}>
                        <Text style={styles.itemText}>
                          {t.title}
                          {t.client_name ? ` · about ${t.client_name}` : ''}
                          {t.due_date ? ` · due ${t.due_date}` : ''}
                          {t.recurring ? ' · repeats' : ''}
                        </Text>
                        {isSuperAdmin ? (
                          reassigningTaskId === t.id ? (
                            <View style={styles.reassignRow}>
                              {options.length === 0 ? (
                                <Text style={styles.meta}>No one else can take this task.</Text>
                              ) : (
                                <View style={styles.dropdownWrap}>
                                  <Dropdown
                                    options={options.map((o) => ({ value: o.id, label: `${o.name ?? 'Unnamed'} (${roleLabel(o.role)})` }))}
                                    value={newAssigneeId}
                                    onChange={setNewAssigneeId}
                                    placeholder="Give it to..."
                                  />
                                </View>
                              )}
                              <TouchableOpacity disabled={!newAssigneeId || reassignBusy} onPress={saveReassign}>
                                <Text style={[styles.linkStrong, (!newAssigneeId || reassignBusy) && { opacity: 0.5 }]}>
                                  {reassignBusy ? 'Saving...' : 'Reassign'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity disabled={reassignBusy} onPress={() => setReassigningTaskId(null)}>
                                <Text style={styles.link}>Cancel</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => startReassign(t.id)}>
                              <Text style={styles.linkStrong}>Reassign</Text>
                            </TouchableOpacity>
                          )
                        ) : (
                          <Text style={styles.meta}>Ask {t.reassigned_by} to reassign or close it.</Text>
                        )}
                      </View>
                    ))}
                  </>
                )}

                {blockers.client_assignments.length > 0 && (
                  <>
                    <Text style={styles.sectionHeading}>Clients assigned to {name}</Text>
                    {blockers.client_assignments.map((a, i) => (
                      <Text key={`ca-${i}`} style={styles.itemText}>
                        {a.client_name ?? 'Unnamed'} ({a.client_org_name}) — as {a.as}
                      </Text>
                    ))}
                    <Text style={styles.meta}>
                      Give each of these Clients a new {blockers.client_assignments[0].as} in the Clients table (Edit). Their
                      open tasks move to the new person automatically.
                    </Text>
                  </>
                )}

                {blockers.org_defaults.length > 0 && (
                  <>
                    <Text style={styles.sectionHeading}>Organisation default</Text>
                    {blockers.org_defaults.map((d, i) => (
                      <Text key={`od-${i}`} style={styles.itemText}>
                        {d.client_org_name} — default {d.as}
                      </Text>
                    ))}
                    <Text style={styles.meta}>Pick a different default in the Client Organizations table.</Text>
                  </>
                )}

                {blockers.rework_documents.length > 0 && (
                  <>
                    <Text style={styles.sectionHeading}>Documents waiting for {name} to reupload</Text>
                    {blockers.rework_documents.map((d) => (
                      <Text key={d.id} style={styles.itemText}>
                        {d.name}
                      </Text>
                    ))}
                    <Text style={styles.meta}>
                      Wait for the reupload, or ask their Manager to take the document out of Rework.
                    </Text>
                  </>
                )}

                <View style={{ marginTop: 10 }}>
                  <OutlineButton title={loading ? 'Checking...' : 'Check again'} onPress={load} />
                </View>
              </View>
            )}

            {mode === 'deactivate' && blockers && !blocked && blockers.only_client_admin && (
              <Text style={styles.warning}>
                {name} is the only active Client Admin of their organisation. Nobody there will be able to manage its users
                until another Client Admin is added.
              </Text>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
              {mode === 'reactivate' ? (
                <PrimaryButton title={saving ? 'Reactivating...' : 'Reactivate'} onPress={confirm} disabled={saving} />
              ) : (
                blockers &&
                !blocked && (
                  <PrimaryButton title={saving ? 'Deactivating...' : `Deactivate ${name}`} onPress={confirm} disabled={saving} />
                )
              )}
              <TouchableOpacity onPress={close} disabled={saving}>
                <Text style={styles.cancel}>{mode === 'deactivate' && blocked ? 'Close' : 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 18,
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: 12, color: colors.textDim, marginBottom: 14, lineHeight: 17 },
  blockBox: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.surface2,
  },
  blockTitle: { fontSize: 13, fontWeight: '700', color: colors.danger, marginBottom: 4 },
  sectionHeading: { fontSize: 12, fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 4 },
  itemRow: { paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  itemText: { fontSize: 12.5, color: colors.text, marginBottom: 2 },
  reassignRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  dropdownWrap: { minWidth: 180, maxWidth: 280, flexGrow: 1, flexShrink: 1 },
  meta: { fontSize: 11.5, color: colors.textFaint, marginTop: 2 },
  link: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  linkStrong: { fontSize: 12, fontWeight: '700', color: colors.orange },
  warning: { fontSize: 12, color: colors.danger, marginBottom: 12, lineHeight: 17 },
  error: { fontSize: 12, color: colors.danger, marginBottom: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  cancel: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
});
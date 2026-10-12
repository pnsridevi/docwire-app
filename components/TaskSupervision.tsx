// LOCATION: docwire-app/components/TaskSupervision.tsx (NEW FILE)
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { Dropdown } from './Dropdown';
import { ReassignOption, Task, TaskActivity } from '../lib/types';

// Shown under a task on the Super Admin and Client Admin task lists
// (Add_user_deactivation.sql). TasksScreen.tsx has its own copy of the
// same controls for Managers.
//
// - Always: the task's latest history line (e.g. "Reassigned from Kavya
//   to Arjun because the Client's Accountant changed · 8 Oct 2026").
// - When canSupervise (Super Admin): "Reassign" on open tasks, and
//   "Close task" / "Stop repeating" on tasks whose creator or assignee
//   has been deactivated. The database checks every one of these again.

// "Open" exactly as the database counts it (is_task_open).
export function isTaskOpen(t: Task): boolean {
  return t.status === 'in_progress' || (t.recurring && !t.next_occurrence_generated_at && !!t.due_date);
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function roleLabel(r: string): string {
  return r === 'manager' ? 'Manager' : r === 'accountant' ? 'Accountant' : r === 'client' ? 'Client' : r;
}

// Loads every history line the signed-in person can see, grouped by task,
// newest first.
export async function loadTaskActivity(): Promise<Record<string, TaskActivity[]>> {
  const { data, error } = await supabase.from('task_activity').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('[TaskSupervision] loading task history failed:', error);
    return {};
  }
  const grouped: Record<string, TaskActivity[]> = {};
  ((data as TaskActivity[]) ?? []).forEach((a) => {
    (grouped[a.task_id] = grouped[a.task_id] ?? []).push(a);
  });
  return grouped;
}

export function TaskSupervision({
  task,
  latest,
  canSupervise,
  deactivatedIds,
  onChanged,
}: {
  task: Task;
  latest: TaskActivity | undefined;
  canSupervise: boolean;
  deactivatedIds: Set<string>;
  onChanged: () => void | Promise<void>;
}) {
  const [reassigning, setReassigning] = useState(false);
  const [options, setOptions] = useState<ReassignOption[] | null>(null);
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departed = deactivatedIds.has(task.creator_id) || deactivatedIds.has(task.assignee_id);
  const showReassign = canSupervise && isTaskOpen(task);
  const showClose = canSupervise && departed && task.status === 'in_progress';
  const showStop = canSupervise && departed && task.recurring && !task.next_occurrence_generated_at;
  if (!latest && !showReassign && !showClose && !showStop) return null;

  const startReassign = async () => {
    setReassigning(true);
    setReassignTo(null);
    setOptions(null);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('task_reassign_options', { p_task_id: task.id });
    if (rpcError) {
      setError(rpcError.message);
      setOptions([]);
      return;
    }
    setOptions((data as ReassignOption[]) ?? []);
  };

  const saveReassign = async () => {
    if (!reassignTo) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('reassign_task', { p_task_id: task.id, p_new_assignee: reassignTo });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReassigning(false);
    await onChanged();
  };

  const supervise = async (action: 'complete' | 'stop_repeating') => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('supervise_task', { p_task_id: task.id, p_action: action });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await onChanged();
  };

  return (
    <View style={styles.wrap}>
      {latest && (
        <Text style={styles.activityText}>
          ↪ {latest.details} · {formatShortDate(latest.created_at)}
        </Text>
      )}
      {reassigning ? (
        <View style={styles.row}>
          {options === null ? (
            <Text style={styles.meta}>Loading who can take it…</Text>
          ) : options.length === 0 ? (
            <Text style={styles.meta}>No one else can take this task.</Text>
          ) : (
            <View style={styles.dropdownWrap}>
              <Dropdown
                options={options.map((o) => ({ value: o.id, label: `${o.name ?? 'Unnamed'} (${roleLabel(o.role)})` }))}
                value={reassignTo}
                onChange={setReassignTo}
                placeholder="Give it to..."
              />
            </View>
          )}
          <TouchableOpacity disabled={!reassignTo || busy} onPress={saveReassign}>
            <Text style={[styles.linkStrong, (!reassignTo || busy) && { opacity: 0.5 }]}>{busy ? 'Saving…' : 'Reassign'}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => setReassigning(false)}>
            <Text style={styles.link}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        (showReassign || showClose || showStop) && (
          <View style={styles.row}>
            {showReassign && (
              <TouchableOpacity onPress={startReassign}>
                <Text style={styles.linkStrong}>Reassign</Text>
              </TouchableOpacity>
            )}
            {showClose && (
              <TouchableOpacity disabled={busy} onPress={() => supervise('complete')}>
                <Text style={styles.link}>Close task</Text>
              </TouchableOpacity>
            )}
            {showStop && (
              <TouchableOpacity disabled={busy} onPress={() => supervise('stop_repeating')}>
                <Text style={styles.link}>Stop repeating</Text>
              </TouchableOpacity>
            )}
          </View>
        )
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  activityText: { fontSize: 11.5, color: colors.textDim, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  dropdownWrap: { minWidth: 160, maxWidth: 240, flexGrow: 1, flexShrink: 1 },
  meta: { fontSize: 11.5, color: colors.textFaint },
  link: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  linkStrong: { fontSize: 12, fontWeight: '700', color: colors.orange },
  error: { fontSize: 11.5, color: colors.danger },
});
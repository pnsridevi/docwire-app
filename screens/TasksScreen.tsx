import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, OutlineButton, ChipSelect, ScreenContainer } from '../components/UI';
import { Profile, Task, TaskPriority, AssignableUser } from '../lib/types';

type Filter = 'assigned_to_me' | 'created_by_me' | 'all';

function isValidDateString(s: string): boolean {
  if (!s) return true; // optional field — empty is valid
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !isNaN(d.getTime());
}

// Architecture Section 7 / 7.6. Shared by Client, Accountant, and Manager —
// the scoping difference between roles is enforced by RLS (see
// migration_tasks_and_assignments.sql), this component just renders
// whatever the backend hands back.
export default function TasksScreen({ profile }: { profile: Profile }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeKey, setAssigneeKey] = useState<string | null>(null);

  const dueDateValid = isValidDateString(dueDate.trim());

  const loadTasks = async () => {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    setTasks((data as Task[]) ?? []);
  };

  // Builds the list of people this user is allowed to raise a task for.
  // Client -> their assigned Manager + Accountant.
  // Manager -> Accountants assigned to their clients + Client contacts in those orgs.
  // Accountant -> Managers assigned to their clients + Client contacts in those orgs.
  //
  // Manager/Accountant branches build one entry PER (person, client) pair —
  // not deduped by person id — so a person serving multiple of this user's
  // clients appears once per client, each with its own composite `key`.
  // See the AssignableUser.key comment in types.ts for why this matters.
  const loadAssignableUsers = async () => {
    if (profile.role === 'client' && profile.client_org_id) {
      const [{ data: mgr }, { data: acc }, { data: org }] = await Promise.all([
        supabase.from('manager_assignments').select('manager_id').eq('client_org_id', profile.client_org_id).maybeSingle(),
        supabase.from('accountant_assignments').select('accountant_id').eq('client_org_id', profile.client_org_id).maybeSingle(),
        supabase.from('client_organizations').select('name').eq('id', profile.client_org_id).single(),
      ]);
      const ids = [mgr?.manager_id, acc?.accountant_id].filter(Boolean) as string[];
      if (ids.length === 0) return setAssignable([]);
      const { data: people } = await supabase.from('users').select('id,name,role').in('id', ids);
      // A Client only ever has one org, so no duplicate-person risk here —
      // key can just be the person's id.
      setAssignable(
        (people ?? []).map((p: any) => ({
          key: p.id,
          id: p.id,
          name: p.name,
          role: p.role,
          client_org_id: profile.client_org_id as string,
          client_org_name: org?.name ?? '',
        }))
      );
      return;
    }

    if (profile.role === 'manager') {
      const { data: myClients } = await supabase.from('manager_assignments').select('client_org_id').eq('manager_id', profile.id);
      const clientOrgIds = (myClients ?? []).map((r: any) => r.client_org_id);
      if (clientOrgIds.length === 0) return setAssignable([]);

      const [{ data: accAssignments }, { data: clientContacts }, { data: orgs }] = await Promise.all([
        supabase.from('accountant_assignments').select('accountant_id,client_org_id').in('client_org_id', clientOrgIds),
        supabase.from('users').select('id,name,role,client_org_id').eq('role', 'client').in('client_org_id', clientOrgIds),
        supabase.from('client_organizations').select('id,name').in('id', clientOrgIds),
      ]);
      const orgNameById: Record<string, string> = {};
      (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));

      // Fetch each distinct accountant's name/role once (query efficiency
      // only) — but build the actual OPTION list per (accountant, client)
      // pair below, so duplicates across clients are preserved as distinct,
      // correctly-scoped entries rather than collapsed into one.
      const accountantIds = Array.from(new Set((accAssignments ?? []).map((r: any) => r.accountant_id)));
      const { data: accountantUsers } = accountantIds.length
        ? await supabase.from('users').select('id,name,role').in('id', accountantIds)
        : { data: [] as any[] };
      const accountantById: Record<string, any> = {};
      (accountantUsers ?? []).forEach((u: any) => (accountantById[u.id] = u));

      const accountantEntries: AssignableUser[] = (accAssignments ?? [])
        .filter((r: any) => accountantById[r.accountant_id])
        .map((r: any) => ({
          key: `${r.accountant_id}::${r.client_org_id}`,
          id: r.accountant_id,
          name: accountantById[r.accountant_id].name,
          role: accountantById[r.accountant_id].role,
          client_org_id: r.client_org_id,
          client_org_name: orgNameById[r.client_org_id] ?? '',
        }));

      const clientEntries: AssignableUser[] = (clientContacts ?? []).map((u: any) => ({
        key: u.id, // a client user belongs to exactly one org — no duplicate-person risk
        id: u.id,
        name: u.name,
        role: u.role,
        client_org_id: u.client_org_id,
        client_org_name: orgNameById[u.client_org_id] ?? '',
      }));

      setAssignable([...accountantEntries, ...clientEntries]);
      return;
    }

    if (profile.role === 'accountant') {
      const { data: myClients } = await supabase.from('accountant_assignments').select('client_org_id').eq('accountant_id', profile.id);
      const clientOrgIds = (myClients ?? []).map((r: any) => r.client_org_id);
      if (clientOrgIds.length === 0) return setAssignable([]);

      const [{ data: mgrAssignments }, { data: clientContacts }, { data: orgs }] = await Promise.all([
        supabase.from('manager_assignments').select('manager_id,client_org_id').in('client_org_id', clientOrgIds),
        supabase.from('users').select('id,name,role,client_org_id').eq('role', 'client').in('client_org_id', clientOrgIds),
        supabase.from('client_organizations').select('id,name').in('id', clientOrgIds),
      ]);
      const orgNameById: Record<string, string> = {};
      (orgs ?? []).forEach((o: any) => (orgNameById[o.id] = o.name));

      // Same shape as the Manager branch above: a Manager can oversee more
      // than one of this Accountant's clients, so build one option per
      // (manager, client) pair rather than deduping by manager id.
      const managerIds = Array.from(new Set((mgrAssignments ?? []).map((r: any) => r.manager_id)));
      const { data: managerUsers } = managerIds.length
        ? await supabase.from('users').select('id,name,role').in('id', managerIds)
        : { data: [] as any[] };
      const managerById: Record<string, any> = {};
      (managerUsers ?? []).forEach((u: any) => (managerById[u.id] = u));

      const managerEntries: AssignableUser[] = (mgrAssignments ?? [])
        .filter((r: any) => managerById[r.manager_id])
        .map((r: any) => ({
          key: `${r.manager_id}::${r.client_org_id}`,
          id: r.manager_id,
          name: managerById[r.manager_id].name,
          role: managerById[r.manager_id].role,
          client_org_id: r.client_org_id,
          client_org_name: orgNameById[r.client_org_id] ?? '',
        }));

      const clientEntries: AssignableUser[] = (clientContacts ?? []).map((u: any) => ({
        key: u.id,
        id: u.id,
        name: u.name,
        role: u.role,
        client_org_id: u.client_org_id,
        client_org_name: orgNameById[u.client_org_id] ?? '',
      }));

      setAssignable([...managerEntries, ...clientEntries]);
      return;
    }
  };

  useEffect(() => {
    loadTasks();
    loadAssignableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
    setPriority('medium');
    setAssigneeKey(null);
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!title.trim() || !assigneeKey || !dueDateValid) return;
    const assignee = assignable.find((a) => a.key === assigneeKey);
    if (!assignee) return;
    await supabase.from('tasks').insert({
      tenant_id: profile.tenant_id,
      client_org_id: profile.role === 'client' ? profile.client_org_id : assignee.client_org_id,
      title: title.trim(),
      description: description.trim() || null,
      creator_id: profile.id,
      creator_name: profile.name,
      creator_role: profile.role,
      assignee_id: assignee.id,
      assignee_name: assignee.name,
      assignee_role: assignee.role,
      priority,
      due_date: dueDate.trim() || null,
      status: 'in_progress',
    });
    resetForm();
    await loadTasks();
  };

  const complete = async (id: string) => {
    await supabase.from('tasks').update({ status: 'completed' }).eq('id', id);
    await loadTasks();
  };

  const reopen = async (id: string) => {
    await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', id);
    await loadTasks();
  };

  const visibleTasks = useMemo(() => {
    if (filter === 'assigned_to_me') return tasks.filter((t) => t.assignee_id === profile.id);
    if (filter === 'created_by_me') return tasks.filter((t) => t.creator_id === profile.id);
    return tasks;
  }, [tasks, filter, profile.id]);

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Tasks</Text>
          <OutlineButton title={showForm ? 'Cancel' : '+ New task'} onPress={() => setShowForm((s) => !s)} />
        </View>

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
            <TextInput
              style={[styles.input, !dueDateValid && styles.inputError]}
              placeholder="Due date (YYYY-MM-DD, optional)"
              placeholderTextColor={colors.textFaint}
              value={dueDate}
              onChangeText={setDueDate}
            />
            {!dueDateValid && <Text style={styles.errorText}>Enter a valid date as YYYY-MM-DD, or leave it blank.</Text>}

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
            <Text style={styles.label}>Assign to</Text>
            {assignable.length === 0 ? (
              <Text style={styles.empty}>No one to assign yet — check your client/staff assignments.</Text>
            ) : (
              <ChipSelect
                options={assignable.map((a) => ({
                  value: a.key,
                  label: `${a.name ?? 'Unnamed'} (${a.role}${profile.role !== 'client' ? ` · ${a.client_org_name}` : ''})`,
                }))}
                value={assigneeKey}
                onChange={setAssigneeKey}
              />
            )}
            <View style={{ marginTop: 8 }}>
              <PrimaryButton
                title="Create task"
                onPress={handleCreate}
                disabled={!title.trim() || !assigneeKey || !dueDateValid}
              />
            </View>
          </View>
        )}

        <FlatList
          style={{ marginTop: 16 }}
          data={visibleTasks}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <View style={styles.taskCard}>
              <View style={styles.taskTopRow}>
                <Text style={styles.taskTitle}>{item.title}</Text>
                <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
              </View>
              {item.description ? <Text style={styles.taskDesc}>{item.description}</Text> : null}
              <Text style={styles.taskMeta}>
                {item.creator_name ?? 'Someone'} → {item.assignee_name ?? 'Someone'}
                {item.due_date ? `  ·  due ${item.due_date}` : ''}
              </Text>
              <View style={styles.taskBottomRow}>
                <Text style={[styles.statusText, item.status === 'completed' && styles.statusDone]}>
                  {item.status === 'completed' ? 'Completed' : 'In progress'}
                </Text>
                {item.status === 'in_progress' && item.assignee_id === profile.id && (
                  <OutlineButton title="Mark complete" onPress={() => complete(item.id)} />
                )}
                {item.status === 'completed' && item.creator_id === profile.id && (
                  <OutlineButton title="Reopen" onPress={() => reopen(item.id)} />
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No tasks here yet.</Text>}
        />
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
  screen: { flex: 1, padding: 20, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  filterRow: { marginBottom: 12 },
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
  taskCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  taskTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  taskDesc: { fontSize: 13, color: colors.textDim, marginTop: 4 },
  taskMeta: { fontSize: 12, color: colors.textFaint, marginTop: 6 },
  taskBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  statusText: { fontSize: 12, fontWeight: '700', color: colors.orange },
  statusDone: { color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
// LOCATION: docwire-app/screens/SuperAdminTasksScreen.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { ChipSelect, StatRow, ScreenContainer } from '../components/UI';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { DataTable } from '../components/DataTable';
import { useBreakpoint } from '../components/useBreakpoint';
import { Profile, Task, TaskPriority, RecurrenceTerm, TaskActivity } from '../lib/types';
import { loadDeactivatedIds, nameWithStatus } from '../lib/users';
import { TaskSupervision, loadTaskActivity } from '../components/TaskSupervision';

type TypeFilter = 'all' | 'recurring' | 'onetime';

function isOverdue(t: Task, todayStr: string): boolean {
  return t.status === 'in_progress' && !!t.due_date && t.due_date < todayStr;
}
function recurrenceLabel(term: RecurrenceTerm | null): string {
  if (!term) return '';
  return term.charAt(0).toUpperCase() + term.slice(1);
}
function priorityColor(p: TaskPriority) {
  if (p === 'high') return colors.danger;
  if (p === 'low') return colors.textFaint;
  return colors.orange;
}

// Super Admin's Tasks view. Architecture §7.6: "sees all tasks
// platform-wide by default, narrowable by a client-organization filter —
// this REPLACES the Assigned to Me / Created by Me toggle, which is
// meaningless for Super Admin since they're never on either side of a
// task (§7.2)." Read-only — no create form, no complete/reopen (Super
// Admin doesn't create or get assigned tasks).
export default function SuperAdminTasksScreen({ profile }: { profile: Profile }) {
  const breakpoint = useBreakpoint();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState<string | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Add_user_deactivation.sql: "Name (deactivated)" labels and each task's history.
  const [deactivatedIds, setDeactivatedIds] = useState<Set<string>>(new Set());
  const [activityByTask, setActivityByTask] = useState<Record<string, TaskActivity[]>>({});

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[SuperAdminTasksScreen] loadTasks failed:', error);
      setLoadError(error.message);
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setTasks((data as Task[]) ?? []);
    setLoading(false);
    setActivityByTask(await loadTaskActivity());
  };

  useEffect(() => {
    loadTasks();
    loadDeactivatedIds().then(setDeactivatedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Distinct client org names present in the loaded tasks — drives the
  // filter chip row, same idea as the demo's clientOrgsList loop.
  const clientNames = useMemo(() => {
    const names = new Set<string>();
    tasks.forEach((t) => t.client_org_name && names.add(t.client_org_name));
    return Array.from(names).sort();
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    let v = tasks;
    if (clientFilter !== 'all') v = v.filter((t) => t.client_org_name === clientFilter);
    if (typeFilter === 'recurring') v = v.filter((t) => t.recurring);
    if (typeFilter === 'onetime') v = v.filter((t) => !t.recurring);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((t) => t.title.toLowerCase().includes(q) || (t.client_org_name ?? '').toLowerCase().includes(q));
    return v;
  }, [tasks, clientFilter, typeFilter, search]);

  const listHeader = (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.heading}>Tasks</Text>
      <Text style={styles.subheading}>Platform-wide. You can reassign open tasks, and close tasks left behind by someone who was deactivated.</Text>
      {loadError && <Text style={styles.errorBanner}>Error: {loadError}</Text>}

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
          options={[{ value: 'all', label: 'All Clients' }, ...clientNames.map((n) => ({ value: n, label: n }))]}
          value={clientFilter}
          onChange={setClientFilter}
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

  const emptyMessage = <Text style={styles.empty}>{loading ? 'Loading...' : 'No tasks match this filter.'}</Text>;
  const rowData = loading ? [] : visibleTasks;

  return (
    <ScreenContainer scroll={breakpoint !== 'phone'}>
      <View style={[styles.screen, breakpoint === 'phone' && styles.screenPhone]}>
        {breakpoint === 'phone' ? (
          <ResponsiveGrid
            data={rowData}
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
                  <Text style={styles.taskMeta}>
                    {nameWithStatus(item.creator_name, item.creator_id, deactivatedIds)} →{' '}
                    {nameWithStatus(item.assignee_name, item.assignee_id, deactivatedIds)}
                    {item.client_org_name ? `  ·  ${item.client_org_name}` : ''}
                    {item.due_date ? `  ·  due ${item.due_date}` : ''}
                  </Text>
                  {(item.recurring || overdue || item.escalated) && (
                    <View style={styles.badgeRow}>
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
                  )}
                  <Text style={[styles.statusText, item.status === 'completed' && styles.statusDone]}>
                    {item.status === 'completed' ? 'Completed' : 'In progress'}
                  </Text>
                  <TaskSupervision
                    task={item}
                    latest={activityByTask[item.id]?.[0]}
                    canSupervise={true}
                    deactivatedIds={deactivatedIds}
                    onChanged={loadTasks}
                  />
                </View>
              );
            }}
            ListEmptyComponent={emptyMessage}
          />
        ) : (
          <DataTable
            scrollable={false}
            data={rowData}
            keyExtractor={(t) => t.id}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyMessage}
            columns={[
              {
                key: 'task',
                header: 'Task',
                width: 240,
                render: (item) => (
                  <View>
                    <Text style={styles.taskTitle}>{item.title}</Text>
                    {item.linked_document_id ? (
                      <View style={styles.docLinkRow}>
                        <Feather name="file-text" size={11} color={colors.textFaint} />
                        <Text style={styles.docLinkText}>{item.linked_document_name}</Text>
                      </View>
                    ) : item.linked_document_name ? (
                      <View style={styles.docLinkRow}>
                        <Feather name="clock" size={11} color={colors.orange} />
                        <Text style={styles.docLinkTextPending}>Awaiting upload: {item.linked_document_name}</Text>
                      </View>
                    ) : null}
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
                    {nameWithStatus(item.creator_name, item.creator_id, deactivatedIds)} →{' '}
                    {nameWithStatus(item.assignee_name, item.assignee_id, deactivatedIds)}
                  </Text>
                ),
              },
              {
                key: 'recurring',
                header: 'Recurring',
                width: 120,
                render: (item) => <Text style={styles.taskMeta}>{item.recurring ? `↻ ${recurrenceLabel(item.recurrence_term)}` : 'One-time'}</Text>,
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
              {
                key: 'status',
                header: 'Status',
                width: 240,
                render: (item) => (
                  <View>
                    <Text style={[styles.statusText, item.status === 'completed' && styles.statusDone]}>
                      {item.status === 'completed' ? 'Completed' : 'In progress'}
                    </Text>
                    <TaskSupervision
                      task={item}
                      latest={activityByTask[item.id]?.[0]}
                      canSupervise={true}
                      deactivatedIds={deactivatedIds}
                      onChanged={loadTasks}
                    />
                  </View>
                ),
              },
            ]}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, backgroundColor: colors.bg },
  screenPhone: { flex: 1 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  subheading: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
  filterRow: { marginTop: 8, marginBottom: 4 },
  filterSearchRow: { gap: 10, marginTop: 8, marginBottom: 4 },
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
  docLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  docLinkText: { fontSize: 11, color: colors.textFaint },
  docLinkTextPending: { fontSize: 11, color: colors.orange, fontWeight: '600' },
  bookEntryYes: { fontSize: 12, fontWeight: '700', color: colors.orange },
  bookEntryAwaiting: { fontSize: 12, fontWeight: '600', color: colors.textFaint, fontStyle: 'italic' },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  taskMeta: { fontSize: 12, color: colors.textFaint, marginTop: 6 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badgeNeutral: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  badgeNeutralText: { fontSize: 11, fontWeight: '600', color: colors.textDim },
  badgeDanger: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  badgeDangerText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  statusText: { fontSize: 12, fontWeight: '700', color: colors.orange, marginTop: 10 },
  statusDone: { color: colors.textFaint },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
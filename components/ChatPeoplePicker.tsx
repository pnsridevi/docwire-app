// LOCATION: docwire-app/components/ChatPeoplePicker.tsx (NEW FILE)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { PrimaryButton } from './UI';
import { ChatPerson } from '../lib/types';
import { chatRoleLabel, createGroupChat, isFirmStaff, loadChatPeople, startDirectChat, addChatMembers } from '../lib/chat';

// "New chat" and "Add people", one picker.
//
//   New chat:   pick one person -> 1:1 chat (the existing one opens if
//               there is one); pick several -> a group, name optional.
//   Add people: adds the picked people to an existing group.
//
// Rule 3 (one client organisation per chat) is also enforced by the
// database; here people from a second organisation are greyed out as
// soon as someone from a first one is picked, so the button never leads
// to an error.
export function ChatPeoplePicker({
  visible,
  mode,
  chatId,
  excludeIds,
  lockedOrgId,
  onClose,
  onDone,
}: {
  visible: boolean;
  mode: 'new' | 'add';
  // 'add' only: the group being added to, its current members, and its
  // client organisation (if it already has client-side members).
  chatId?: string;
  excludeIds?: string[];
  lockedOrgId?: string | null;
  onClose: () => void;
  // 'new': the chat to open. 'add': the same chatId.
  onDone: (chatId: string) => void;
}) {
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    setSelected([]);
    setGroupName('');
    setError(null);
    setLoading(true);
    loadChatPeople().then(({ data, error: loadError }) => {
      setPeople(data);
      setError(loadError);
      setLoading(false);
    });
  }, [visible]);

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const selectedPeople = people.filter((p) => selected.includes(p.user_id));

  // The client organisation already "in" this chat: the group's own, or
  // whoever has been picked so far.
  const activeOrgId = lockedOrgId ?? selectedPeople.find((p) => p.client_org_id)?.client_org_id ?? null;
  const isBlocked = (p: ChatPerson) => !!p.client_org_id && !!activeOrgId && p.client_org_id !== activeOrgId;

  // Firm staff first, then one section per client organisation.
  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    const visiblePeople = people.filter(
      (p) =>
        !excluded.has(p.user_id) &&
        (!term ||
          (p.name ?? '').toLowerCase().includes(term) ||
          (p.client_org_name ?? '').toLowerCase().includes(term) ||
          chatRoleLabel(p.role).toLowerCase().includes(term))
    );
    const staff = visiblePeople.filter((p) => isFirmStaff(p.role));
    const byOrg: Record<string, { title: string; people: ChatPerson[] }> = {};
    visiblePeople
      .filter((p) => !isFirmStaff(p.role))
      .forEach((p) => {
        const key = p.client_org_id ?? 'none';
        if (!byOrg[key]) byOrg[key] = { title: p.client_org_name ?? 'Client organisation', people: [] };
        byOrg[key].people.push(p);
      });
    const result: { title: string; people: ChatPerson[] }[] = [];
    if (staff.length) result.push({ title: 'Firm staff', people: staff });
    Object.values(byOrg)
      .sort((a, b) => a.title.localeCompare(b.title))
      .forEach((s) => result.push(s));
    return result;
  }, [people, excluded, search]);

  const toggle = (p: ChatPerson) => {
    if (isBlocked(p)) return;
    setSelected((cur) => (cur.includes(p.user_id) ? cur.filter((id) => id !== p.user_id) : [...cur, p.user_id]));
  };

  const isGroup = mode === 'new' && selected.length > 1;
  const buttonTitle = saving
    ? 'Please wait...'
    : mode === 'add'
    ? selected.length === 0
      ? 'Add people'
      : `Add ${selected.length} ${selected.length === 1 ? 'person' : 'people'}`
    : isGroup
    ? 'Create group'
    : 'Start chat';

  const submit = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    if (mode === 'add' && chatId) {
      const addError = await addChatMembers(chatId, selected);
      setSaving(false);
      if (addError) return setError(addError);
      onDone(chatId);
      return;
    }
    const result = isGroup ? await createGroupChat(groupName, selected) : await startDirectChat(selected[0]);
    setSaving(false);
    if (result.error || !result.data) return setError(result.error ?? 'Could not start the chat.');
    onDone(result.data);
  };

  const close = () => {
    if (!saving) onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        {/* No-op inner onPress stops taps on the card from closing it. */}
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{mode === 'add' ? 'Add people' : 'New chat'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'add'
              ? 'Added people can see the whole chat history.'
              : 'Pick one person for a private chat, or several for a group. A group can include any staff, but people from only one client organisation.'}
          </Text>

          <TextInput
            style={styles.search}
            placeholder="Search by name, role or organisation"
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {loading && <Text style={styles.hint}>Loading...</Text>}
            {!loading && sections.length === 0 && (
              <Text style={styles.hint}>{search ? 'No one matches that search.' : 'No one to add.'}</Text>
            )}
            {sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.people.map((p) => {
                  const checked = selected.includes(p.user_id);
                  const blocked = isBlocked(p);
                  return (
                    <TouchableOpacity
                      key={p.user_id}
                      style={[styles.personRow, blocked && styles.personRowBlocked]}
                      onPress={() => toggle(p)}
                      disabled={blocked}
                    >
                      <Feather
                        name={checked ? 'check-square' : 'square'}
                        size={16}
                        color={checked ? colors.orange : colors.textFaint}
                      />
                      <View style={styles.personText}>
                        <Text style={styles.personName}>{p.name ?? 'Unnamed'}</Text>
                        <Text style={styles.personMeta}>
                          {chatRoleLabel(p.role)}
                          {blocked ? ' · different client organisation' : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          {isGroup && (
            <TextInput
              style={styles.search}
              placeholder="Group name (optional)"
              placeholderTextColor={colors.textFaint}
              value={groupName}
              onChangeText={setGroupName}
              maxLength={80}
            />
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <PrimaryButton title={buttonTitle} onPress={submit} disabled={saving || selected.length === 0} />
            <TouchableOpacity onPress={close} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
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
    maxWidth: 460,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 12, color: colors.textDim, marginBottom: 12, lineHeight: 17 },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  list: { flexGrow: 0, maxHeight: 360, marginBottom: 10 },
  hint: { fontSize: 12, color: colors.textFaint, paddingVertical: 10 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, textTransform: 'uppercase', marginBottom: 4, marginTop: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  personRowBlocked: { opacity: 0.4 },
  personText: { flexShrink: 1 },
  personName: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  personMeta: { fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
  error: { fontSize: 12, color: colors.danger, marginBottom: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  cancelText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
});
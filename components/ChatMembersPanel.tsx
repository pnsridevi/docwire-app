// LOCATION: docwire-app/components/ChatMembersPanel.tsx (NEW FILE)
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { OutlineButton, PrimaryButton } from './UI';
import { ChatMember, ChatSummary, Profile } from '../lib/types';
import { chatRoleLabel, leaveChat, removeChatMember, renameChat } from '../lib/chat';
import { ChatPeoplePicker } from './ChatPeoplePicker';

// Group details: who's in it, and (for the person who manages the group)
// rename, add and remove. Anyone can leave. The database enforces the
// same rules (Add_chat.sql); this only decides which buttons to show.
export function ChatMembersPanel({
  visible,
  profile,
  chat,
  members,
  onClose,
  onChanged,
  onLeft,
}: {
  visible: boolean;
  profile: Profile;
  chat: ChatSummary;
  members: ChatMember[];
  onClose: () => void;
  // Something changed (name, members) — reload chat and members.
  onChanged: () => void;
  // The signed-in person left the group.
  onLeft: () => void;
}) {
  const manages = chat.created_by === profile.id;
  const [name, setName] = useState(chat.group_name ?? '');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(chat.group_name ?? '');
    setConfirmRemoveId(null);
    setConfirmLeave(false);
    setError(null);
  }, [visible, chat.chat_id, chat.group_name]);

  const run = async (action: () => Promise<string | null>, after: () => void) => {
    setBusy(true);
    setError(null);
    const actionError = await action();
    setBusy(false);
    if (actionError) return setError(actionError);
    after();
  };

  const saveName = () =>
    run(
      () => renameChat(chat.chat_id, name),
      () => onChanged()
    );

  const remove = (userId: string) =>
    run(
      () => removeChatMember(chat.chat_id, userId),
      () => {
        setConfirmRemoveId(null);
        onChanged();
      }
    );

  const leave = () =>
    run(
      () => leaveChat(chat.chat_id),
      () => onLeft()
    );

  const close = () => {
    if (!busy) onClose();
  };

  const nameChanged = name.trim() !== (chat.group_name ?? '');

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Group details</Text>

            {manages ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Group name (optional)"
                  placeholderTextColor={colors.textFaint}
                  value={name}
                  onChangeText={setName}
                  maxLength={80}
                />
                {nameChanged && <PrimaryButton title={busy ? 'Saving...' : 'Save name'} onPress={saveName} disabled={busy} />}
              </View>
            ) : (
              <Text style={styles.groupName}>{chat.group_name ?? chat.display_name}</Text>
            )}

            <View style={styles.membersHeader}>
              <Text style={styles.sectionTitle}>{members.length} members</Text>
              {manages && (
                <TouchableOpacity onPress={() => setAdding(true)} disabled={busy}>
                  <Text style={styles.linkStrong}>+ Add people</Text>
                </TouchableOpacity>
              )}
            </View>

            {members.map((m) => (
              <View key={m.user_id} style={styles.memberRow}>
                <View style={styles.memberText}>
                  <Text style={[styles.memberName, m.deactivated && styles.memberNameDeactivated]}>
                    {m.name ?? 'Unnamed'}
                    {m.user_id === profile.id ? ' (you)' : ''}
                    {m.deactivated ? ' (deactivated)' : ''}
                  </Text>
                  <Text style={styles.memberMeta}>
                    {chatRoleLabel(m.role)}
                    {m.client_org_name ? ` · ${m.client_org_name}` : ''}
                    {m.user_id === chat.created_by ? ' · Manages this group' : ''}
                  </Text>
                </View>
                {manages && m.user_id !== profile.id && (
                  confirmRemoveId === m.user_id ? (
                    <View style={styles.confirmRow}>
                      <TouchableOpacity onPress={() => remove(m.user_id)} disabled={busy}>
                        <Text style={styles.linkDanger}>{busy ? 'Removing...' : 'Remove'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setConfirmRemoveId(null)} disabled={busy}>
                        <Text style={styles.link}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setConfirmRemoveId(m.user_id)} disabled={busy}>
                      <Text style={styles.link}>Remove</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            ))}

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.leaveBox}>
              {confirmLeave ? (
                <>
                  <Text style={styles.leaveText}>
                    Leave this group? You won't see its messages any more.
                    {manages && members.length > 1 ? ' Someone else in the group will manage it from now on.' : ''}
                  </Text>
                  <View style={styles.confirmRow}>
                    <TouchableOpacity onPress={leave} disabled={busy}>
                      <Text style={styles.linkDanger}>{busy ? 'Leaving...' : 'Yes, leave'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setConfirmLeave(false)} disabled={busy}>
                      <Text style={styles.link}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity onPress={() => setConfirmLeave(true)} disabled={busy}>
                  <Text style={styles.linkDanger}>Leave group</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.footer}>
              <OutlineButton title="Close" onPress={close} />
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>

      <ChatPeoplePicker
        visible={adding}
        mode="add"
        chatId={chat.chat_id}
        excludeIds={members.map((m) => m.user_id)}
        lockedOrgId={chat.client_org_id}
        onClose={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          onChanged();
        }}
      />
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
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 12 },
  groupName: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  membersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, textTransform: 'uppercase' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  memberText: { flexShrink: 1 },
  memberName: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  memberNameDeactivated: { color: colors.textFaint },
  memberMeta: { fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  link: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  linkStrong: { fontSize: 12, fontWeight: '700', color: colors.orange },
  linkDanger: { fontSize: 12, fontWeight: '700', color: colors.danger },
  error: { fontSize: 12, color: colors.danger, marginTop: 10 },
  leaveBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  leaveText: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
  footer: { flexDirection: 'row', marginTop: 14 },
});

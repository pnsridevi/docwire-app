// LOCATION: docwire-app/components/ChatThread.tsx (NEW FILE)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  Keyboard,
  StatusBar,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { ChatMember, ChatMessage, ChatSummary, Profile } from '../lib/types';
import {
  CHAT_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  chatRoleLabel,
  dayKey,
  deleteChatMessage,
  editChatMessage,
  formatDayLabel,
  formatTime,
  loadChatChanges,
  loadChatMembers,
  loadChatMessages,
  markChatRead,
  mergeMessages,
  pollStartIso,
  sendChatMessage,
} from '../lib/chat';
import { CHAT_THREAD_POLL_MS, useChatPolling } from '../lib/chatLive';
import { ChatMembersPanel } from './ChatMembersPanel';

// Before any message exists there is no server time to poll from, so the
// first poll asks for everything (an empty chat has nothing to send back).
const BEGINNING = '1970-01-01T00:00:00.000Z';

// One open chat: header, messages, and the box to type in.
export function ChatThread({
  profile,
  chat,
  onBack,
  onChanged,
  onLeft,
}: {
  profile: Profile;
  chat: ChatSummary;
  // Phones only: back to the chat list.
  onBack?: () => void;
  // A message was sent / the group changed — refresh the chat list.
  onChanged: () => void;
  // The signed-in person left this group.
  onLeft: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Own message tapped: shows Edit / Delete under it.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const containerRef = useRef<View>(null);
  // Space the on-screen keyboard covers at the bottom of this chat.
  // Android draws the keyboard on top of the app (edge-to-edge) instead of
  // shrinking it, so the typing box is lifted by exactly the overlap:
  // where this chat's bottom edge is, minus where the keyboard starts.
  const [keyboardInset, setKeyboardInset] = useState(0);
  // Stay pinned to the newest message unless the person has scrolled up.
  const atBottomRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const chatId = chat.chat_id;
  const blockedDirect = !chat.is_group && chat.other_deactivated;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      // Android reports the keyboard's position from the very top of the
      // screen, but this chat's position from just below the status bar
      // (time, battery) — add that strip so both are measured the same way.
      const statusBarOffset = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
      containerRef.current?.measureInWindow((_x, y, _w, height) => {
        setKeyboardInset(Math.max(0, y + statusBarOffset + height - keyboardTop));
        // Keep the newest message in view above the typing box.
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardInset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const reloadMembers = useCallback(async () => {
    const { data } = await loadChatMembers(chatId);
    setMembers(data);
  }, [chatId]);

  // Opening a chat (or switching to another one).
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setMembers([]);
    setLoading(true);
    setError(null);
    setDraft('');
    setEditing(null);
    setActionsFor(null);
    setConfirmDeleteFor(null);
    atBottomRef.current = true;
    (async () => {
      const [{ data, error: loadError }] = await Promise.all([loadChatMessages(chatId), reloadMembers()]);
      if (cancelled) return;
      setMessages(data);
      setHasEarlier(data.length === CHAT_PAGE_SIZE);
      setError(loadError);
      setLoading(false);
      markChatRead(chatId);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, reloadMembers]);

  // New, edited and deleted messages, every few seconds.
  useChatPolling(
    async () => {
      const since = pollStartIso(messagesRef.current, BEGINNING);
      const { data } = await loadChatChanges(chatId, since);
      if (data.length === 0) return;
      const known = new Set(messagesRef.current.map((m) => m.id));
      const arrived = data.some((m) => !known.has(m.id) && m.sender_id !== profile.id);
      setMessages((cur) => mergeMessages(cur, data));
      if (arrived) {
        markChatRead(chatId);
        onChanged();
        // Membership may have changed ("Priya added Kavya").
        if (data.some((m) => m.kind === 'system')) reloadMembers();
      }
    },
    CHAT_THREAD_POLL_MS,
    !loading
  );

  const loadEarlier = async () => {
    if (messages.length === 0) return;
    setLoadingEarlier(true);
    atBottomRef.current = false;
    const { data, error: loadError } = await loadChatMessages(chatId, messages[0].created_at);
    setLoadingEarlier(false);
    if (loadError) return setError(loadError);
    setHasEarlier(data.length === CHAT_PAGE_SIZE);
    setMessages((cur) => mergeMessages(cur, data));
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const result = editing ? await editChatMessage(editing.id, text) : await sendChatMessage(chatId, text);
    setSending(false);
    if (result.error || !result.data) return setError(result.error ?? 'Could not send. Try again.');
    const saved = result.data;
    setMessages((cur) => mergeMessages(cur, [saved]));
    setDraft('');
    if (editing) {
      setEditing(null);
    } else {
      atBottomRef.current = true;
    }
    onChanged();
  };

  const startEdit = (m: ChatMessage) => {
    setEditing(m);
    setDraft(m.body ?? '');
    setActionsFor(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const remove = async (m: ChatMessage) => {
    setError(null);
    const result = await deleteChatMessage(m.id);
    if (result.error || !result.data) return setError(result.error ?? 'Could not delete. Try again.');
    const saved = result.data;
    setMessages((cur) => mergeMessages(cur, [saved]));
    setActionsFor(null);
    setConfirmDeleteFor(null);
    if (editing?.id === m.id) cancelEdit();
    onChanged();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  };

  // Web: Enter sends, Shift+Enter makes a new line. Phones use the button.
  const onKeyPress = (e: any) => {
    if (Platform.OS !== 'web') return;
    if (e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      send();
    }
  };

  const subtitle = chat.is_group
    ? `${members.length || chat.member_count} members`
    : chat.other_deactivated
    ? 'Deactivated'
    : chatRoleLabel(chat.other_user_role) +
      (members.find((m) => m.user_id === chat.other_user_id)?.client_org_name
        ? ` · ${members.find((m) => m.user_id === chat.other_user_id)?.client_org_name}`
        : '');

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const prev = index > 0 ? messages[index - 1] : null;
    const newDay = !prev || dayKey(prev.created_at) !== dayKey(item.created_at);
    const daySeparator = newDay ? (
      <View style={styles.dayRow}>
        <Text style={styles.dayText}>{formatDayLabel(item.created_at)}</Text>
      </View>
    ) : null;

    if (item.kind === 'system') {
      return (
        <View>
          {daySeparator}
          <Text style={styles.systemText}>
            {item.body} · {formatTime(item.created_at)}
          </Text>
        </View>
      );
    }

    const mine = item.sender_id === profile.id;
    const deleted = !!item.deleted_at;
    const showSender =
      chat.is_group && !mine && (newDay || !prev || prev.kind === 'system' || prev.sender_id !== item.sender_id);
    const canAct = mine && !deleted;

    return (
      <View>
        {daySeparator}
        <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
          {showSender && (
            <Text style={styles.senderName}>
              {item.sender_name ?? 'Unknown'}
              {members.some((m) => m.user_id === item.sender_id && m.deactivated) ? ' (deactivated)' : ''}
            </Text>
          )}
          <TouchableOpacity
            activeOpacity={canAct ? 0.7 : 1}
            disabled={!canAct}
            onPress={() => {
              setConfirmDeleteFor(null);
              setActionsFor(actionsFor === item.id ? null : item.id);
              // Edit / Delete appear under the bubble — keep them in view
              // when it's the newest message.
              if (index === messages.length - 1) {
                setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
              }
            }}
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              deleted && styles.bubbleDeleted,
              editing?.id === item.id && styles.bubbleEditing,
            ]}
          >
            <Text style={[styles.bodyText, deleted && styles.deletedText]} selectable={!canAct}>
              {deleted ? 'Message deleted' : item.body}
            </Text>
            <Text style={styles.timeText}>
              {formatTime(item.created_at)}
              {item.edited_at && !deleted ? ' · edited' : ''}
            </Text>
          </TouchableOpacity>
          {actionsFor === item.id && canAct && (
            <View style={styles.msgActions}>
              {confirmDeleteFor === item.id ? (
                <>
                  <Text style={styles.msgActionHint}>Delete this message?</Text>
                  <TouchableOpacity onPress={() => remove(item)}>
                    <Text style={styles.msgActionDanger}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmDeleteFor(null)}>
                    <Text style={styles.msgAction}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => startEdit(item)}>
                    <Text style={styles.msgAction}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmDeleteFor(item.id)}>
                    <Text style={styles.msgActionDanger}>Delete</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View ref={containerRef} style={[styles.container, { paddingBottom: keyboardInset }]}>
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {chat.display_name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {chat.is_group && (
          <TouchableOpacity style={styles.headerBtn} onPress={() => setMembersOpen(true)}>
            <Feather name="users" size={14} color={colors.textDim} />
            <Text style={styles.headerBtnText}>Members</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        extraData={`${actionsFor}|${confirmDeleteFor}|${editing?.id ?? ''}|${members.length}`}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        onScroll={onScroll}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListHeaderComponent={
          hasEarlier ? (
            <TouchableOpacity style={styles.earlierBtn} onPress={loadEarlier} disabled={loadingEarlier}>
              <Text style={styles.earlierText}>{loadingEarlier ? 'Loading...' : 'Load earlier messages'}</Text>
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>{loading ? 'Loading...' : 'No messages yet. Say hello!'}</Text>
        }
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {blockedDirect ? (
        <Text style={styles.blockedNote}>
          {chat.display_name} has been deactivated. You can read this chat, but can't send new messages.
        </Text>
      ) : (
        <View style={styles.composerWrap}>
          {editing && (
            <View style={styles.editingBar}>
              <Feather name="edit-2" size={12} color={colors.orangeDeep} />
              <Text style={styles.editingText}>Editing your message</Text>
              <TouchableOpacity onPress={cancelEdit}>
                <Text style={styles.msgAction}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Type a message"
              placeholderTextColor={colors.textFaint}
              value={draft}
              onChangeText={setDraft}
              onKeyPress={onKeyPress}
              multiline
              maxLength={CHAT_MAX_LENGTH}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!draft.trim() || sending}
            >
              <Feather name={editing ? 'check' : 'send'} size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {chat.is_group && (
        <ChatMembersPanel
          visible={membersOpen}
          profile={profile}
          chat={chat}
          members={members}
          onClose={() => setMembersOpen(false)}
          onChanged={() => {
            reloadMembers();
            onChanged();
          }}
          onLeft={() => {
            setMembersOpen(false);
            onLeft();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginRight: -2 },
  headerText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 15, fontWeight: '700', color: colors.text },
  headerSub: { fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  headerBtnText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  list: { flex: 1 },
  listContent: { padding: 14, paddingBottom: 8 },
  earlierBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, marginBottom: 8 },
  earlierText: { fontSize: 12, fontWeight: '600', color: colors.orange },
  emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 30, fontSize: 13 },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textDim,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  systemText: { textAlign: 'center', fontSize: 11.5, color: colors.textFaint, fontStyle: 'italic', marginVertical: 6 },
  msgRow: { marginVertical: 3, maxWidth: '80%' },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { fontSize: 11, fontWeight: '700', color: colors.orangeDeep, marginBottom: 2, marginLeft: 4, marginTop: 6 },
  bubble: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 11, borderWidth: 1 },
  bubbleMine: { backgroundColor: colors.tint, borderColor: '#F5D3B6' },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border },
  bubbleDeleted: { backgroundColor: colors.surface2, borderColor: colors.border },
  bubbleEditing: { borderColor: colors.orange },
  bodyText: { fontSize: 13.5, color: colors.text, lineHeight: 19 },
  deletedText: { color: colors.textFaint, fontStyle: 'italic' },
  timeText: { fontSize: 10.5, color: colors.textFaint, marginTop: 3, alignSelf: 'flex-end' },
  msgActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginRight: 4 },
  msgActionHint: { fontSize: 12, color: colors.textDim },
  msgAction: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  msgActionDanger: { fontSize: 12, fontWeight: '700', color: colors.danger },
  error: { fontSize: 12, color: colors.danger, paddingHorizontal: 14, paddingBottom: 6 },
  blockedNote: {
    fontSize: 12.5,
    color: colors.textDim,
    textAlign: 'center',
    padding: 14,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerWrap: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  editingBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  editingText: { fontSize: 12, fontWeight: '600', color: colors.orangeDeep, flex: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13.5,
    textAlignVertical: 'top',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
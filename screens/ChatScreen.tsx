// LOCATION: docwire-app/screens/ChatScreen.tsx (NEW FILE)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { ScreenContainer, PrimaryButton } from '../components/UI';
import { useIsWide } from '../components/useBreakpoint';
import { ChatThread } from '../components/ChatThread';
import { ChatPeoplePicker } from '../components/ChatPeoplePicker';
import { ChatSummary, Profile } from '../lib/types';
import { formatListTime, initialsOf, lastMessagePreview, loadMyChats } from '../lib/chat';
import { CHAT_LIST_POLL_MS, useChatPolling } from '../lib/chatLive';

// Chat (Add_chat.sql) — the same screen for every role. Who can chat with
// whom is decided by the database, not here.
//
// Wide screens: chat list on the left, the open chat on the right.
// Phones: the list, and tapping a chat opens it full screen (back arrow
// returns to the list).
export default function ChatScreen({
  profile,
  onUnreadTotalChange,
}: {
  profile: Profile;
  // Keeps the Chat tab's badge in step while this screen is open.
  onUnreadTotalChange?: (total: number) => void;
}) {
  const isWide = useIsWide();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: loadError } = await loadMyChats();
    if (loadError) {
      setError(loadError);
      return data;
    }
    setError(null);
    setChats(data);
    setLoaded(true);
    return data;
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useChatPolling(reload, CHAT_LIST_POLL_MS);

  // Removed from a group while it was open: close it with a note.
  useEffect(() => {
    if (loaded && selectedId && !chats.some((c) => c.chat_id === selectedId)) {
      setSelectedId(null);
      setNotice('You are no longer in that chat.');
    }
  }, [chats, loaded, selectedId]);

  const selectedChat = chats.find((c) => c.chat_id === selectedId) ?? null;

  // The open chat counts as read.
  useEffect(() => {
    if (!loaded) return;
    onUnreadTotalChange?.(
      chats.reduce((sum, c) => sum + (c.chat_id === selectedId ? 0 : c.unread_count), 0)
    );
  }, [chats, selectedId, loaded, onUnreadTotalChange]);

  const open = (chatId: string) => {
    setNotice(null);
    setSelectedId(chatId);
    // Opening marks it read (ChatThread) — clear the badge straight away.
    setChats((cur) => cur.map((c) => (c.chat_id === chatId ? { ...c, unread_count: 0 } : c)));
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return chats;
    return chats.filter((c) => c.display_name.toLowerCase().includes(term));
  }, [chats, search]);

  const listPane = (
    <View style={[styles.listPane, isWide && styles.listPaneWide]}>
      <View style={styles.listHeader}>
        <Text style={styles.heading}>Chat</Text>
        <PrimaryButton title="+ New chat" onPress={() => setPickerOpen(true)} />
      </View>
      {chats.length > 5 && (
        <TextInput
          style={styles.search}
          placeholder="Search chats"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.chat_id}
        extraData={selectedId}
        renderItem={({ item }) => {
          const active = isWide && item.chat_id === selectedId;
          const unread = item.unread_count > 0 && item.chat_id !== selectedId;
          return (
            <TouchableOpacity style={[styles.row, active && styles.rowActive]} onPress={() => open(item.chat_id)}>
              <View style={[styles.avatar, item.is_group && styles.avatarGroup]}>
                {item.is_group ? (
                  <Feather name="users" size={15} color="#fff" />
                ) : (
                  <Text style={styles.avatarText}>{initialsOf(item.display_name)}</Text>
                )}
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text style={[styles.rowName, unread && styles.rowNameUnread]} numberOfLines={1}>
                    {item.display_name}
                    {!item.is_group && item.other_deactivated ? ' (deactivated)' : ''}
                  </Text>
                  <Text style={styles.rowTime}>{formatListTime(item.last_activity_at)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={[styles.rowPreview, unread && styles.rowPreviewUnread]} numberOfLines={1}>
                    {lastMessagePreview(item, profile.id)}
                  </Text>
                  {unread && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Feather name="message-circle" size={28} color={colors.textFaint} />
              <Text style={styles.emptyText}>
                {search ? 'No chats match that search.' : 'No chats yet. Start one with "+ New chat".'}
              </Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>Loading...</Text>
          )
        }
      />
    </View>
  );

  const thread = selectedChat ? (
    <ChatThread
      key={selectedChat.chat_id}
      profile={profile}
      chat={selectedChat}
      onBack={isWide ? undefined : () => setSelectedId(null)}
      onChanged={reload}
      onLeft={() => {
        setSelectedId(null);
        reload();
      }}
    />
  ) : null;

  const picker = (
    <ChatPeoplePicker
      visible={pickerOpen}
      mode="new"
      onClose={() => setPickerOpen(false)}
      onDone={async (chatId) => {
        setPickerOpen(false);
        await reload();
        open(chatId);
      }}
    />
  );

  if (!isWide) {
    return (
      <View style={styles.phone}>
        {thread ?? listPane}
        {picker}
      </View>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.wide}>
        {listPane}
        <View style={styles.threadPane}>
          {thread ?? (
            <View style={styles.placeholder}>
              <Feather name="message-square" size={34} color={colors.textFaint} />
              <Text style={styles.placeholderText}>Choose a chat on the left, or start a new one.</Text>
            </View>
          )}
        </View>
      </View>
      {picker}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, backgroundColor: colors.bg },
  wide: {
    flex: 1,
    flexDirection: 'row',
    margin: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  listPane: { flex: 1, backgroundColor: colors.surface },
  // Fixed 320 wide. flexBasis must be set too: on web, listPane's flex: 1
  // leaves a 0% flex-basis behind, which overrides width and collapses it.
  listPaneWide: { flexGrow: 0, flexShrink: 0, flexBasis: 320, width: 320, borderRightWidth: 1, borderRightColor: colors.border },
  threadPane: { flex: 1 },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  search: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  error: { fontSize: 12, color: colors.danger, paddingHorizontal: 14, paddingBottom: 8 },
  notice: { fontSize: 12, color: colors.textDim, paddingHorizontal: 14, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.surface2,
  },
  rowActive: { backgroundColor: colors.tint },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.orangeDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGroup: { backgroundColor: colors.orange },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { flexShrink: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  rowNameUnread: { fontWeight: '800' },
  rowTime: { fontSize: 11, color: colors.textFaint },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  rowPreview: { flex: 1, fontSize: 12, color: colors.textFaint },
  rowPreviewUnread: { color: colors.text, fontWeight: '600' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 10, padding: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center', padding: 14 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30, backgroundColor: colors.bg },
  placeholderText: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
});

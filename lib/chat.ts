// LOCATION: docwire-app/lib/chat.ts (NEW FILE)
//
// Every Chat read and write goes through here (Add_chat.sql). Writes are
// database functions only — the tables have no insert/update/delete rules,
// so the checks (same firm, one client organisation per chat, own
// messages only, active people only) can't be skipped by any screen.
import { supabase } from './supabase';
import { ChatMember, ChatMessage, ChatPerson, ChatSummary, Role } from './types';

type Result<T> = { data: T; error: string | null };

// How many messages a chat loads at first, and per "Load earlier".
export const CHAT_PAGE_SIZE = 100;

// Matches the database limit in send_chat_message / edit_chat_message.
export const CHAT_MAX_LENGTH = 4000;

export async function loadMyChats(): Promise<Result<ChatSummary[]>> {
  const { data, error } = await supabase.rpc('my_chats');
  if (error) return { data: [], error: error.message };
  return { data: (data as ChatSummary[]) ?? [], error: null };
}

// Newest CHAT_PAGE_SIZE messages (or the page before `beforeIso`),
// returned oldest first, ready to display.
export async function loadChatMessages(chatId: string, beforeIso?: string): Promise<Result<ChatMessage[]>> {
  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE);
  if (beforeIso) query = query.lt('created_at', beforeIso);
  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: ((data as ChatMessage[]) ?? []).reverse(), error: null };
}

// Everything new OR changed (edited / deleted) since `sinceIso`. Used by
// the poll in chatLive.ts — updated_at changes on send, edit and delete.
export async function loadChatChanges(chatId: string, sinceIso: string): Promise<Result<ChatMessage[]>> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: true })
    .limit(500);
  if (error) return { data: [], error: error.message };
  return { data: (data as ChatMessage[]) ?? [], error: null };
}

export async function loadChatMembers(chatId: string): Promise<Result<ChatMember[]>> {
  const { data, error } = await supabase.rpc('chat_member_list', { p_chat_id: chatId });
  if (error) return { data: [], error: error.message };
  return { data: (data as ChatMember[]) ?? [], error: null };
}

// People the signed-in person may start a chat with (same firm, active,
// and for a Client/Client Admin only firm staff + their own organisation).
export async function loadChatPeople(): Promise<Result<ChatPerson[]>> {
  const { data, error } = await supabase.rpc('chat_people');
  if (error) return { data: [], error: error.message };
  return { data: (data as ChatPerson[]) ?? [], error: null };
}

export async function startDirectChat(otherUserId: string): Promise<Result<string | null>> {
  const { data, error } = await supabase.rpc('start_direct_chat', { p_other_id: otherUserId });
  if (error) return { data: null, error: error.message };
  return { data: data as string, error: null };
}

export async function createGroupChat(name: string, memberIds: string[]): Promise<Result<string | null>> {
  const { data, error } = await supabase.rpc('create_group_chat', { p_name: name, p_member_ids: memberIds });
  if (error) return { data: null, error: error.message };
  return { data: data as string, error: null };
}

async function voidCall(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const addChatMembers = (chatId: string, memberIds: string[]) =>
  voidCall('add_chat_members', { p_chat_id: chatId, p_member_ids: memberIds });
export const removeChatMember = (chatId: string, userId: string) =>
  voidCall('remove_chat_member', { p_chat_id: chatId, p_user_id: userId });
export const leaveChat = (chatId: string) => voidCall('leave_chat', { p_chat_id: chatId });
export const renameChat = (chatId: string, name: string) => voidCall('rename_chat', { p_chat_id: chatId, p_name: name });
export const markChatRead = (chatId: string) => voidCall('mark_chat_read', { p_chat_id: chatId });

async function messageCall(fn: string, args: Record<string, unknown>): Promise<Result<ChatMessage | null>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: error.message };
  return { data: data as ChatMessage, error: null };
}

export const sendChatMessage = (chatId: string, body: string) =>
  messageCall('send_chat_message', { p_chat_id: chatId, p_body: body });
export const editChatMessage = (messageId: string, body: string) =>
  messageCall('edit_chat_message', { p_message_id: messageId, p_body: body });
export const deleteChatMessage = (messageId: string) => messageCall('delete_chat_message', { p_message_id: messageId });

// ------------------------------------------------------------
// Display helpers
// ------------------------------------------------------------

export function chatRoleLabel(role: Role | null | undefined): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'manager':
      return 'Manager';
    case 'accountant':
      return 'Accountant';
    case 'client_admin':
      return 'Client Admin';
    case 'client':
      return 'Client';
    default:
      return '';
  }
}

export function isFirmStaff(role: Role | null | undefined): boolean {
  return role === 'super_admin' || role === 'manager' || role === 'accountant';
}

export function initialsOf(name: string | null | undefined): string {
  if (!name || !name.trim()) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "10:42 am" — the device's own time zone.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'am' : 'pm'}`;
}

// Chat list: time today, "Yesterday", or "23 Oct" (with year if not this year).
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

// Day separator inside a chat: "Today", "Yesterday", "Thu, 23 Oct 2026".
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// The one-line preview under a chat's name in the list.
export function lastMessagePreview(chat: ChatSummary, myId: string): string {
  if (!chat.last_kind) return chat.is_group ? 'Group created' : 'No messages yet';
  if (chat.last_kind === 'system') return chat.last_body ?? '';
  const who = chat.last_sender_id === myId ? 'You' : chat.is_group ? (chat.last_sender_name ?? 'Someone') : null;
  const text = chat.last_deleted ? 'Message deleted' : (chat.last_body ?? '').replace(/\s+/g, ' ');
  return who ? `${who}: ${text}` : text;
}

// Merge freshly loaded messages into the current list: same id replaces
// (edit/delete), new ids are added, result sorted oldest first.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m] as const));
  incoming.forEach((m) => byId.set(m.id, m));
  return Array.from(byId.values()).sort((a, b) => {
    const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

// Where the next poll starts: the latest updated_at seen, minus a few
// seconds of overlap so a message saved at almost the same moment as the
// last poll is never missed (duplicates are merged away by id).
export function pollStartIso(messages: ChatMessage[], fallbackIso: string): string {
  const latest = messages.reduce((max, m) => Math.max(max, Date.parse(m.updated_at)), Date.parse(fallbackIso));
  return new Date(latest - 5000).toISOString();
}

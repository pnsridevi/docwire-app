// LOCATION: docwire-app/components/MasterCategoryManager.tsx (NEW FILE)
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { OutlineButton } from './UI';
import { MasterCategory, Profile } from '../lib/types';

// "Manage categories" panel on the Master Docs screen — Managers and Super
// Admin only (Update_master_documents_permissions.sql enforces the same).
//
// Add, rename and hide categories and sub-tags, defaults included. There
// is no delete: a hidden entry disappears from the pickers but still
// labels every document already using it, and can be shown again at any
// time. Old History entries keep the name they had when they were written.
// Duplicate names (ignoring capitals and spaces) are refused by the
// database, including names of hidden entries.
export function MasterCategoryManager({
  visible,
  onClose,
  profile,
  categories,
  onCategoriesChanged,
}: {
  visible: boolean;
  onClose: () => void;
  profile: Profile;
  categories: MasterCategory[];
  onCategoriesChanged: () => Promise<MasterCategory[]>;
}) {
  const topLevel = useMemo(
    () => categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  const subtagsOf = (parentId: string) =>
    categories.filter((c) => c.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));

  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const friendlyError = (e: { code?: string; message: string } | null, name?: string) =>
    e?.code === '23505'
      ? `"${name ?? ''}" already exists here (it may be hidden — check the list below).`
      : e?.message ?? 'Could not save. Refresh and try again.';

  const addEntry = async (name: string, parentId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('master_categories')
      .insert({ tenant_id: profile.tenant_id, name: trimmed, parent_id: parentId, created_by: profile.id })
      .select('id')
      .single();
    setBusy(false);
    if (insertError) {
      setError(friendlyError(insertError, trimmed));
      return;
    }
    if (parentId) {
      setNewSubName('');
      setAddingSubFor(null);
    } else {
      setNewCategoryName('');
    }
    await onCategoriesChanged();
  };

  const saveRename = async (c: MasterCategory) => {
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === c.name) {
      setRenamingId(null);
      return;
    }
    setBusy(true);
    setError(null);
    // .select().single() so a write blocked by the database shows as an
    // error instead of looking like success.
    const { data, error: updateError } = await supabase
      .from('master_categories')
      .update({ name: trimmed })
      .eq('id', c.id)
      .select('id')
      .single();
    setBusy(false);
    if (updateError || !data) {
      setError(friendlyError(updateError, trimmed));
      return;
    }
    setRenamingId(null);
    await onCategoriesChanged();
  };

  const toggleHidden = async (c: MasterCategory) => {
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await supabase
      .from('master_categories')
      .update({ hidden: !c.hidden })
      .eq('id', c.id)
      .select('id')
      .single();
    setBusy(false);
    if (updateError || !data) {
      setError(friendlyError(updateError));
      return;
    }
    await onCategoriesChanged();
  };

  const startRename = (c: MasterCategory) => {
    setRenamingId(c.id);
    setRenameText(c.name);
    setError(null);
  };

  const close = () => {
    if (busy) return;
    setRenamingId(null);
    setAddingSubFor(null);
    setError(null);
    onClose();
  };

  const renderEntry = (c: MasterCategory, isSub: boolean) => (
    <View key={c.id} style={[styles.entryRow, isSub && styles.subRow]}>
      {renamingId === c.id ? (
        <View style={styles.renameWrap}>
          <TextInput style={styles.inlineInput} value={renameText} onChangeText={setRenameText} autoFocus />
          <TouchableOpacity disabled={busy} onPress={() => saveRename(c)}>
            <Text style={styles.linkStrong}>{busy ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => setRenamingId(null)}>
            <Text style={styles.link}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.nameWrap}>
            <Text style={[isSub ? styles.subName : styles.catName, c.hidden && styles.hiddenName]}>{c.name}</Text>
            {c.is_default && <Text style={styles.badge}>Default</Text>}
            {c.hidden && <Text style={[styles.badge, styles.badgeHidden]}>Hidden</Text>}
          </View>
          <View style={styles.linkRow}>
            <TouchableOpacity disabled={busy} onPress={() => startRename(c)}>
              <Text style={styles.link}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => toggleHidden(c)}>
              <Text style={styles.link}>{c.hidden ? 'Show again' : 'Hide'}</Text>
            </TouchableOpacity>
            {!isSub && (
              <TouchableOpacity
                disabled={busy}
                onPress={() => {
                  setAddingSubFor(c.id);
                  setNewSubName('');
                  setError(null);
                }}
              >
                <Text style={styles.link}>+ Sub-tag</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        {/* No-op inner onPress stops taps on the card from closing it. */}
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Manage categories</Text>
            <Text style={styles.subtitle}>
              One list for the whole firm. Hiding removes an entry from the pickers (hiding a category also hides its
              sub-tags from the pickers), but documents already using it keep it. Nothing is deleted, and a hidden
              entry can be shown again at any time.
            </Text>

            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                placeholder="New category name"
                placeholderTextColor={colors.textFaint}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
              />
              <TouchableOpacity
                style={[styles.smallBtn, (!newCategoryName.trim() || busy) && { opacity: 0.5 }]}
                disabled={!newCategoryName.trim() || busy}
                onPress={() => addEntry(newCategoryName, null)}
              >
                <Text style={styles.smallBtnText}>Add category</Text>
              </TouchableOpacity>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {topLevel.map((cat) => (
              <View key={cat.id} style={styles.group}>
                {renderEntry(cat, false)}
                {subtagsOf(cat.id).map((s) => renderEntry(s, true))}
                {addingSubFor === cat.id && (
                  <View style={[styles.addRow, styles.subRow]}>
                    <TextInput
                      style={styles.input}
                      placeholder={`New sub-tag under ${cat.name}`}
                      placeholderTextColor={colors.textFaint}
                      value={newSubName}
                      onChangeText={setNewSubName}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, (!newSubName.trim() || busy) && { opacity: 0.5 }]}
                      disabled={!newSubName.trim() || busy}
                      onPress={() => addEntry(newSubName, cat.id)}
                    >
                      <Text style={styles.smallBtnText}>Add</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setAddingSubFor(null)}>
                      <Text style={styles.link}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}

            <View style={styles.footer}>
              <OutlineButton title="Close" onPress={close} />
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
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 12, color: colors.textDim, marginBottom: 14, lineHeight: 17 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 160,
    maxWidth: 320,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 9,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  inlineInput: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 140,
    maxWidth: 280,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  smallBtn: { backgroundColor: colors.orange, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 14 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  error: { fontSize: 12, color: colors.danger, marginBottom: 10 },
  group: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6 },
  entryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingVertical: 5 },
  subRow: { paddingLeft: 18 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  catName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  subName: { fontSize: 12.5, color: colors.text },
  hiddenName: { color: colors.textFaint, textDecorationLine: 'line-through' },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textDim,
    backgroundColor: colors.surface2,
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  badgeHidden: { color: colors.danger },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  renameWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexWrap: 'wrap' },
  link: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  linkStrong: { fontSize: 12, fontWeight: '700', color: colors.orange },
  footer: { flexDirection: 'row', marginTop: 14 },
});
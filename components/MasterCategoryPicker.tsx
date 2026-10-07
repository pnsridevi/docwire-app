// LOCATION: docwire-app/components/MasterCategoryPicker.tsx (NEW FILE)
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { Dropdown } from './Dropdown';
import { MasterCategory, Profile } from '../lib/types';
import { canAddCategories } from '../lib/masterDocs';

// Category (required) + sub-tag (optional) for a Master Document. Used by
// the upload card and edit panel in MasterDocsScreen, and by the "Mark as
// master" panel on every Documents screen — one picker, so all three
// behave identically.
//
// Managers also get "+ New category" / "+ New sub-tag" right here, since
// that's the moment they notice something's missing. The list is
// firm-wide: anything a Manager adds shows up for every organisation.
// Duplicates (ignoring capitals and spaces) are rejected by the database;
// the message below says so in plain words.
export function MasterCategoryPicker({
  profile,
  categories,
  categoryId,
  subtagId,
  onChange,
  onCategoriesChanged,
}: {
  profile: Profile;
  categories: MasterCategory[];
  categoryId: string | null;
  subtagId: string | null;
  onChange: (categoryId: string | null, subtagId: string | null) => void;
  // Called after a Manager adds a category/sub-tag, so the parent reloads
  // the list. Returns the fresh list so the new entry can be selected.
  onCategoriesChanged: () => Promise<MasterCategory[]>;
}) {
  const topLevel = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const subtags = useMemo(
    () => (categoryId ? categories.filter((c) => c.parent_id === categoryId) : []),
    [categories, categoryId]
  );
  const allowAdd = canAddCategories(profile);

  const [adding, setAdding] = useState<'category' | 'subtag' | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAdding = (kind: 'category' | 'subtag') => {
    setAdding(kind);
    setNewName('');
    setError(null);
  };

  const saveNew = async () => {
    const name = newName.trim();
    if (!name || !adding) return;
    if (adding === 'subtag' && !categoryId) return;
    setSaving(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from('master_categories')
      .insert({
        tenant_id: profile.tenant_id,
        name,
        parent_id: adding === 'subtag' ? categoryId : null,
        created_by: profile.id,
      })
      .select('id')
      .single();
    setSaving(false);
    if (insertError || !data) {
      // 23505 = unique violation: the name already exists (case/space-insensitive).
      setError(
        insertError?.code === '23505'
          ? `"${name}" already exists${adding === 'subtag' ? ' under this category' : ''}. Pick it from the list instead.`
          : insertError?.message ?? 'Could not add it.'
      );
      return;
    }
    await onCategoriesChanged();
    if (adding === 'category') onChange(data.id, null);
    else onChange(categoryId, data.id);
    setAdding(null);
    setNewName('');
  };

  return (
    <View>
      <Text style={styles.label}>Category</Text>
      <View style={styles.fieldRow}>
        <View style={styles.dropdownWrap}>
          <Dropdown
            options={topLevel.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={(v) => onChange(v, null)}
            placeholder="Choose a category"
          />
        </View>
        {allowAdd && (
          <TouchableOpacity onPress={() => startAdding('category')}>
            <Text style={styles.addLink}>+ New category</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.label}>Sub-tag (optional)</Text>
      <View style={styles.fieldRow}>
        <View style={styles.dropdownWrap}>
          <Dropdown
            options={[{ value: '', label: 'No sub-tag' }, ...subtags.map((s) => ({ value: s.id, label: s.name }))]}
            value={subtagId ?? ''}
            onChange={(v) => onChange(categoryId, v || null)}
            placeholder={categoryId ? 'No sub-tag' : 'Choose a category first'}
          />
        </View>
        {allowAdd && categoryId && (
          <TouchableOpacity onPress={() => startAdding('subtag')}>
            <Text style={styles.addLink}>+ New sub-tag</Text>
          </TouchableOpacity>
        )}
      </View>

      {adding && (
        <View style={styles.addPanel}>
          <Text style={styles.addHint}>
            {adding === 'category'
              ? 'New category — available to every client organisation in the firm.'
              : `New sub-tag under ${topLevel.find((c) => c.id === categoryId)?.name ?? 'this category'}.`}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={adding === 'category' ? 'Category name' : 'Sub-tag name'}
            placeholderTextColor={colors.textFaint}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.addActions}>
            <TouchableOpacity style={[styles.smallBtn, (!newName.trim() || saving) && { opacity: 0.5 }]} disabled={!newName.trim() || saving} onPress={saveNew}>
              <Text style={styles.smallBtnText}>{saving ? 'Adding...' : 'Add'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAdding(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', color: colors.textDim, marginBottom: 6 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  dropdownWrap: { flexGrow: 1, flexShrink: 1, maxWidth: 320, minWidth: 180 },
  addLink: { fontSize: 12, fontWeight: '700', color: colors.orange },
  addPanel: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    maxWidth: 420,
  },
  addHint: { fontSize: 11, color: colors.textFaint, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 13,
    marginBottom: 8,
  },
  error: { fontSize: 12, color: colors.danger, marginBottom: 8 },
  addActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  smallBtn: { backgroundColor: colors.orange, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 14 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cancelText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
});
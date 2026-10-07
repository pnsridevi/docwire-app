// LOCATION: docwire-app/components/MasterDocControls.tsx (NEW FILE)
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton } from './UI';
import { MasterCategoryPicker } from './MasterCategoryPicker';
import { Doc, MasterCategory, MasterDocument, Profile } from '../lib/types';
import { canMarkAsMaster, findMasterForDoc, loadMasterCategories, loadMasterDocuments } from '../lib/masterDocs';

// Drop-in for every Documents screen: a small "Master" tag on documents
// that are already Master Documents, and a "Mark as master" link on the
// ones that could be. Marking keeps the regular document exactly where it
// is (same row, same status, same workflow) and creates an
// organisation-level Master Document pointing at the same stored file.
//
// Usage in a screen:
//   const masterDocs = useMasterDocMarking(profile);
//   ...in each row:   {masterDocs.renderControl(item)}
//   ...once, at root: {masterDocs.modal}
//
// Deliberately self-contained (its own data loading and modal) so the
// five Documents screens each need only those three small additions —
// none of their existing loading, filtering, or action logic changes.
export function useMasterDocMarking(profile: Profile) {
  const [masters, setMasters] = useState<MasterDocument[]>([]);
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [target, setTarget] = useState<Doc | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subtagId, setSubtagId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadMasters = async () => {
    const { data, error: loadError } = await loadMasterDocuments();
    // A failed load just means no tags show — never blocks the Documents
    // screen itself, which has its own loading and error handling.
    if (loadError) console.error('[useMasterDocMarking] loading master documents failed:', loadError);
    setMasters(data);
  };

  const reloadCategories = async () => {
    const { data, error: loadError } = await loadMasterCategories();
    if (loadError) console.error('[useMasterDocMarking] loading categories failed:', loadError);
    setCategories(data);
    return data;
  };

  useEffect(() => {
    reloadMasters();
    reloadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (doc: Doc) => {
    setTarget(doc);
    setName(doc.name);
    setCategoryId(null);
    setSubtagId(null);
    setError(null);
  };

  const close = () => {
    if (saving) return;
    setTarget(null);
  };

  const save = async () => {
    if (!target || !target.file_path || !target.client_org_id || !categoryId || !name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('master_documents')
      .insert({
        tenant_id: profile.tenant_id,
        client_org_id: target.client_org_id,
        name: name.trim(),
        category_id: categoryId,
        subtag_id: subtagId,
        // Same stored file as the regular document — not a copy. If the
        // regular document is later reuploaded during Rework, the Master
        // Document keeps this file; replacing the Master Document's file
        // is a separate, deliberate action on the Master Docs screen.
        file_path: target.file_path,
        file_size: target.file_size,
        mime_type: target.mime_type,
        uploaded_by: profile.id,
        source_document_id: target.id,
        source_file_path: target.file_path,
      })
      .select('id')
      .single();
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'This file is already a Master Document for this organisation.'
          : insertError.message
      );
      return;
    }
    setTarget(null);
    await reloadMasters();
  };

  const isMaster = (doc: Doc) => !!findMasterForDoc(masters, doc);

  const renderControl = (doc: Doc) => {
    if (isMaster(doc)) {
      return (
        <View style={styles.tag}>
          <Feather name="archive" size={11} color={colors.orangeDeep} />
          <Text style={styles.tagText}>Master</Text>
        </View>
      );
    }
    if (!canMarkAsMaster(doc)) return null;
    return (
      <TouchableOpacity style={styles.markLink} onPress={() => open(doc)}>
        <Feather name="archive" size={11} color={colors.textFaint} />
        <Text style={styles.markLinkText}>Mark as master</Text>
      </TouchableOpacity>
    );
  };

  const modal = (
    <Modal transparent visible={!!target} animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        {/* No-op inner onPress stops taps on the card from closing it —
            same pattern as Dropdown.tsx / DatePicker.tsx. */}
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Mark as master document</Text>
            <Text style={styles.subtitle}>
              Adds this file to {target?.client_org_name ?? 'the organisation'}'s Master Documents. Everyone in that
              organisation, and the staff assigned to it, will be able to see and open it. The original document
              stays in Documents unchanged.
            </Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Master document name"
              placeholderTextColor={colors.textFaint}
            />

            <MasterCategoryPicker
              profile={profile}
              categories={categories}
              categoryId={categoryId}
              subtagId={subtagId}
              onChange={(c, s) => {
                setCategoryId(c);
                setSubtagId(s);
              }}
              onCategoriesChanged={reloadCategories}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
              <PrimaryButton
                title={saving ? 'Saving...' : 'Mark as master'}
                onPress={save}
                disabled={saving || !categoryId || !name.trim()}
              />
              <TouchableOpacity onPress={close} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  return { isMaster, renderControl, modal, reloadMasters };
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.tint,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginBottom: 6,
  },
  tagText: { fontSize: 10.5, fontWeight: '700', color: colors.orangeDeep },
  markLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 6 },
  markLinkText: { fontSize: 11, fontWeight: '600', color: colors.textFaint, textDecorationLine: 'underline' },
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
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: 12, color: colors.textDim, marginBottom: 14, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textDim, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: 13,
  },
  error: { fontSize: 12, color: colors.danger, marginBottom: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  cancelText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
});
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Switch, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { PrimaryButton, Pill, ScreenContainer, useGridColumns, padForGrid } from '../components/UI';
import { Profile, Doc } from '../lib/types';

export default function ClientHomeScreen({ profile }: { profile: Profile }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [name, setName] = useState('');
  const [needsEntry, setNeedsEntry] = useState(true);
  const [loading, setLoading] = useState(false);
  const columns = useGridColumns();

  const loadDocs = async () => {
    const { data } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    setDocs((data as Doc[]) ?? []);
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleUpload = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await supabase.from('documents').insert({
      tenant_id: profile.tenant_id,
      client_org_id: profile.client_org_id,
      uploaded_by: profile.id,
      name,
      needs_entry: needsEntry,
      // A document not flagged "needs book entry" skips the workflow
      // entirely and is just stored for reference (Architecture Section 6.2).
      // Previously this always inserted as 'pending', which incorrectly
      // routed non-entry documents into the Accountant's queue.
      status: needsEntry ? 'pending' : 'filed',
    });
    setName('');
    await loadDocs();
    setLoading(false);
  };

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <Text style={styles.heading}>Your documents</Text>
        <TextInput
          style={styles.input}
          placeholder="Document name (e.g. Bank Statement - July)"
          placeholderTextColor={colors.textFaint}
          value={name}
          onChangeText={setName}
        />
        <View style={styles.row}>
          <Text style={{ color: colors.textDim }}>Needs book entry</Text>
          <Switch
            value={needsEntry}
            onValueChange={setNeedsEntry}
            trackColor={{ false: colors.border, true: colors.tint }}
            thumbColor={needsEntry ? colors.orange : '#fff'}
          />
        </View>
        <PrimaryButton title={loading ? 'Uploading...' : 'Upload document'} onPress={handleUpload} disabled={loading} />
        <FlatList
          key={columns} // RN requires a remount when numColumns changes
          style={{ marginTop: 20 }}
          data={padForGrid(docs, columns)}
          keyExtractor={(d, i) => d?.id ?? `spacer-${i}`}
          numColumns={columns}
          columnWrapperStyle={columns === 2 ? styles.gridRow : undefined}
          renderItem={({ item }) =>
            item ? (
              <View style={[styles.docRow, columns === 2 && styles.docRowGrid]}>
                <Text style={styles.docName}>{item.name}</Text>
                <Pill status={item.status} />
              </View>
            ) : (
              <View style={[styles.docRow, styles.docRowGrid, styles.spacer]} />
            )
          }
          ListEmptyComponent={<Text style={styles.empty}>No documents yet.</Text>}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  gridRow: { justifyContent: 'space-between' },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  docRowGrid: { width: '48%' },
  spacer: { backgroundColor: 'transparent', borderColor: 'transparent' },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
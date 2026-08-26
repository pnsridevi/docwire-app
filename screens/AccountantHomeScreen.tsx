import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { OutlineButton, Pill, ScreenContainer } from '../components/UI';
import { Doc } from '../lib/types';

export default function AccountantHomeScreen() {
  const [docs, setDocs] = useState<Doc[]>([]);

  const loadDocs = async () => {
    const { data } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    setDocs((data as Doc[]) ?? []);
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const markAccounted = async (id: string) => {
    await supabase.from('documents').update({ status: 'accounted' }).eq('id', id);
    await loadDocs();
  };

  // Architecture Section 6.3: Accounted -> Rework (Manager, with comment)
  // -> Accounted (Accountant re-submits). Re-submitting just moves the
  // status back to 'accounted' so the Manager can look again; the comment
  // is left in place as a record of what was flagged, rather than cleared.
  const resubmit = async (id: string) => {
    await supabase.from('documents').update({ status: 'accounted' }).eq('id', id);
    await loadDocs();
  };

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <Text style={styles.heading}>Assigned clients' documents</Text>
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <View style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName}>{item.name}</Text>
                <Pill status={item.status} />
                {item.status === 'rework' && item.comment ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentLabel}>Manager's note</Text>
                    <Text style={styles.commentText}>{item.comment}</Text>
                  </View>
                ) : null}
              </View>
              {item.status === 'pending' && (
                <OutlineButton title="Mark Accounted" onPress={() => markAccounted(item.id)} />
              )}
              {item.status === 'rework' && (
                <OutlineButton title="Re-submit" onPress={() => resubmit(item.id)} />
              )}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Nothing in your queue yet.</Text>}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: colors.text },
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
  docName: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  commentBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.surface2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commentLabel: { fontSize: 10, fontWeight: '700', color: colors.textFaint, marginBottom: 2, textTransform: 'uppercase' },
  commentText: { fontSize: 13, color: colors.textDim },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
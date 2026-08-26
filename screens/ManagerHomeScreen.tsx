import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { OutlineButton, DangerOutlineButton, CommentBox, Pill, ScreenContainer, useGridColumns, padForGrid } from '../components/UI';
import { Doc } from '../lib/types';

// Manager review screen.
// Architecture 6.1/6.3: Manager selectively reviews Accounted documents
// (not mandatory on every one). Two outcomes: mark Reviewed, or send to
// Rework with a comment explaining the issue. Rework then loops back to
// the Accountant (handled in AccountantHomeScreen's re-submit action).
export default function ManagerHomeScreen() {
  const [docs, setDocs] = useState<Doc[]>([]);
  // Tracks which row currently has its rework-comment box open, and the
  // draft text for it, keyed by document id.
  const [reworkDraftId, setReworkDraftId] = useState<string | null>(null);
  const [reworkComment, setReworkComment] = useState('');
  const columns = useGridColumns();

  const loadDocs = async () => {
    const { data } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
    setDocs((data as Doc[]) ?? []);
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const markReviewed = async (id: string) => {
    await supabase.from('documents').update({ status: 'reviewed' }).eq('id', id);
    await loadDocs();
  };

  const openReworkBox = (id: string) => {
    setReworkDraftId(id);
    setReworkComment('');
  };

  const cancelRework = () => {
    setReworkDraftId(null);
    setReworkComment('');
  };

  const confirmRework = async (id: string) => {
    if (!reworkComment.trim()) return; // a Rework without a reason isn't actionable for the Accountant
    await supabase.from('documents').update({ status: 'rework', comment: reworkComment.trim() }).eq('id', id);
    setReworkDraftId(null);
    setReworkComment('');
    await loadDocs();
  };

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <Text style={styles.heading}>Assigned clients' documents</Text>
        <FlatList
          key={columns} // RN requires a remount when numColumns changes
          data={padForGrid(docs, columns)}
          keyExtractor={(d, i) => d?.id ?? `spacer-${i}`}
          numColumns={columns}
          columnWrapperStyle={columns === 2 ? styles.gridRow : undefined}
          renderItem={({ item }) =>
            !item ? (
              <View style={[styles.docCard, styles.docCardGrid, styles.spacer]} />
            ) : (
              <View style={[styles.docCard, columns === 2 && styles.docCardGrid]}>
                <Text style={styles.docName}>{item.name}</Text>
                <Pill status={item.status} />

                {item.status === 'rework' && item.comment ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentLabel}>Your note</Text>
                    <Text style={styles.commentText}>{item.comment}</Text>
                    <Text style={styles.commentMeta}>Waiting on the Accountant to re-submit</Text>
                  </View>
                ) : null}

                {item.status === 'accounted' && reworkDraftId !== item.id && (
                  <View style={styles.actions}>
                    <OutlineButton title="Mark Reviewed" onPress={() => markReviewed(item.id)} />
                    <DangerOutlineButton title="Send to Rework" onPress={() => openReworkBox(item.id)} />
                  </View>
                )}

                {reworkDraftId === item.id && (
                  <View>
                    <CommentBox
                      value={reworkComment}
                      onChangeText={setReworkComment}
                      placeholder="What needs to be fixed?"
                    />
                    <View style={styles.actions}>
                      <OutlineButton title="Cancel" onPress={cancelRework} />
                      <DangerOutlineButton title="Confirm Rework" onPress={() => confirmRework(item.id)} />
                    </View>
                  </View>
                )}
              </View>
            )
          }
          ListEmptyComponent={<Text style={styles.empty}>No documents from your assigned clients yet.</Text>}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: colors.text },
  gridRow: { justifyContent: 'space-between' },
  docCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  docCardGrid: { width: '48%' },
  spacer: { backgroundColor: 'transparent', borderColor: 'transparent' },
  docName: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
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
  commentMeta: { fontSize: 11, color: colors.textFaint, marginTop: 4, fontStyle: 'italic' },
  empty: { color: colors.textFaint, marginTop: 20, textAlign: 'center' },
});
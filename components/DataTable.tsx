// LOCATION: docwire-app/components/DataTable.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { colors } from '../theme/colors';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  // The width the column would like (px, including its 12 px gap).
  width: number;
  // The narrowest the column may be squeezed to when room is short. Text
  // columns default to 75% of `width` (their text wraps); columns with no
  // header (buttons) and Status columns default to `width`, because
  // buttons and badges can't wrap.
  minWidth?: number;
  render: (item: T) => React.ReactNode;
};

// Table-styled layout for tablet/desktop (see useBreakpoint.ts). Built from
// plain Views rather than an HTML <table> so it renders the same on web and
// native from one file.
//
// P-28 (20 Nov 2026): the table never runs past the room it has.
//  - It measures the width it is given.
//  - If the columns fit at their preferred widths, any spare room goes to
//    the columns in proportion, so the table fills the page.
//  - If they don't, the text columns are squeezed (down to minWidth) and
//    wrap.
//  - If even that doesn't fit (a phone, or a narrow tablet with the side
//    menu), each row is shown as a card instead: the screen's own card when
//    it passes `renderCard`, otherwise a card built from the columns (the
//    first column as the title, then one line per column with its header,
//    then the buttons). Nothing sits out of sight to the right.
export function DataTable<T>({
  data,
  keyExtractor,
  columns,
  ListHeaderComponent,
  ListEmptyComponent,
  scrollable = true,
  renderCard,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  columns: DataTableColumn<T>[];
  ListHeaderComponent?: React.ReactNode;
  ListEmptyComponent?: React.ReactNode;
  // When false, DataTable renders as a plain block instead of wrapping
  // itself in its own vertical ScrollView — for screens that stack several
  // DataTables (or a DataTable and other content) inside their own
  // page-level ScrollView. A vertical ScrollView nested inside another
  // doesn't reliably pass scroll gestures on.
  scrollable?: boolean;
  // The screen's own card for one row, used when the table can't fit.
  renderCard?: (item: T) => React.ReactElement;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  // Until the first layout, assume the window's width less the side menu
  // and page padding; corrected as soon as the real width is known.
  const room = measured ?? Math.max(0, windowWidth - (windowWidth >= 768 ? 260 : 32));
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== measured) setMeasured(w);
  };

  const widths = fitColumns(columns, room);

  let rows: React.ReactNode;
  if (data.length === 0) {
    rows = ListEmptyComponent;
  } else if (widths === null) {
    rows = (
      <View>
        {data.map((item, i) => (
          <React.Fragment key={keyExtractor(item, i)}>
            {renderCard ? renderCard(item) : <ColumnCard item={item} columns={columns} />}
          </React.Fragment>
        ))}
      </View>
    );
  } else {
    rows = (
      <View>
        <View style={styles.headerRow}>
          {columns.map((c, ci) => (
            <View key={c.key} style={{ width: widths[ci], paddingRight: 12 }}>
              <Text style={styles.headerText}>{c.header}</Text>
            </View>
          ))}
        </View>
        {data.map((item, i) => (
          <View key={keyExtractor(item, i)} style={styles.row}>
            {columns.map((c, ci) => (
              <View key={c.key} style={{ width: widths[ci], paddingRight: 12 }}>
                {c.render(item)}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  const body = (
    <>
      {ListHeaderComponent}
      <View onLayout={onLayout} style={styles.measure}>
        {rows}
      </View>
    </>
  );

  if (!scrollable) return <View style={styles.outerContent}>{body}</View>;

  return (
    <ScrollView style={styles.outer} contentContainerStyle={styles.outerContent}>
      {body}
    </ScrollView>
  );
}

// Column widths that fit `room`, or null when the table can't fit and rows
// should be cards. Exported for the tests of the layout arithmetic.
export function fitColumns(columns: { header: string; key: string; width: number; minWidth?: number }[], room: number): number[] | null {
  const pref = columns.map((c) => c.width);
  const min = columns.map((c) => c.minWidth ?? (fixedColumn(c) ? c.width : Math.round(c.width * 0.75)));
  const prefSum = pref.reduce((a, b) => a + b, 0);
  const minSum = min.reduce((a, b) => a + b, 0);
  if (room <= 0) return null;
  if (prefSum <= room) {
    // Spare room: share it out in proportion, but don't stretch a short
    // table across a very wide page by more than half again.
    const scale = Math.min(room / prefSum, 1.5);
    return pref.map((w) => Math.floor(w * scale));
  }
  if (minSum > room) return null;
  // Squeeze the squeezable columns in proportion to how much each can give.
  const give = pref.map((w, i) => w - min[i]);
  const giveSum = give.reduce((a, b) => a + b, 0);
  const short = prefSum - room;
  return pref.map((w, i) => Math.floor(w - (giveSum ? (short * give[i]) / giveSum : 0)));
}

function fixedColumn(c: { header: string; key: string }) {
  return c.header.trim() === '' || /^(status|actions?)$/i.test(c.key) || /^(status|actions?)$/i.test(c.header.trim());
}

function ColumnCard<T>({ item, columns }: { item: T; columns: DataTableColumn<T>[] }) {
  const [first, ...rest] = columns;
  const lines = rest.filter((c) => c.header.trim() !== '');
  const buttons = rest.filter((c) => c.header.trim() === '');
  return (
    <View style={styles.card}>
      {first && <View style={styles.cardTitle}>{first.render(item)}</View>}
      {lines.map((c) => {
        const v = c.render(item);
        if (v === null || v === undefined || v === false) return null;
        return (
          <View key={c.key} style={styles.cardLine}>
            <Text style={styles.cardLabel}>{c.header}</Text>
            <View style={styles.cardValue}>{v}</View>
          </View>
        );
      })}
      {buttons.map((c) => {
        const v = c.render(item);
        if (v === null || v === undefined || v === false) return null;
        return (
          <View key={c.key} style={styles.cardButtons}>
            {v}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  outerContent: { flexGrow: 1 },
  measure: { width: '100%' },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 4,
  },
  headerText: { fontSize: 11, fontWeight: '700', color: colors.textFaint, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'flex-start',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.surface,
  },
  cardTitle: { marginBottom: 6 },
  cardLine: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  cardLabel: { width: 96, fontSize: 11, fontWeight: '700', color: colors.textFaint, textTransform: 'uppercase', paddingTop: 2 },
  cardValue: { flex: 1, minWidth: 0 },
  cardButtons: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 8 },
});

import React from 'react';
import { FlatList, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useGridColumns, padForGrid } from './useBreakpoint';

type ResponsiveGridProps<T> = {
  data: T[];
  // Given an item and the current column count, return its key. Called
  // only for real items — spacer slots key themselves.
  keyExtractor: (item: T, index: number) => string;
  // Given an item and the current column count, render its card. Receiving
  // `columns` lets the card apply its own grid-width style (e.g.
  // `columns === 2 && styles.cardGrid`) without ResponsiveGrid needing to
  // know anything about each screen's card styling.
  renderItem: (item: T, columns: 1 | 2) => React.ReactElement;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  // Anything that should scroll ABOVE the grid as part of the same list —
  // a page title, filters, an inline form. Putting it here instead of as a
  // plain sibling View above <ResponsiveGrid> matters: a sibling View isn't
  // scrollable on its own, so on a short screen (mostly mobile) tall header
  // content — like TasksScreen's "new task" form — can end up with no way
  // to scroll to see the rest of it. Folding it into the FlatList's own
  // header makes the whole screen one scrollable unit instead.
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  // Width each card takes when columns === 2. Every current screen
  // (Client/Accountant/Manager home, Tasks, AccountantAssignment) uses
  // '48%', so that's the default — override only if a future screen needs
  // something else.
  itemWidthPercent?: number;
};

// Owns everything the four list screens each used to hand-roll separately:
// the numColumns/key-remount trick RN requires when column count changes,
// the columnWrapperStyle spacing, and the odd-item spacer fix (padForGrid).
// A screen using this hands it a data array and a card renderer; it no
// longer needs its own gridRow/spacer styles or `key={columns}` FlatList
// prop at all.
export function ResponsiveGrid<T>({
  data,
  keyExtractor,
  renderItem,
  ListEmptyComponent,
  ListHeaderComponent,
  ListFooterComponent,
  style,
  contentContainerStyle,
  itemWidthPercent = 48,
}: ResponsiveGridProps<T>) {
  const columns = useGridColumns();
  const padded = padForGrid(data, columns);
  const spacerStyle: ViewStyle | undefined =
    columns === 2 ? { width: `${itemWidthPercent}%` as any, backgroundColor: 'transparent', borderColor: 'transparent' } : undefined;

  return (
    <FlatList
      key={columns} // RN requires a remount when numColumns changes
      style={[styles.flatList, style]}
      contentContainerStyle={contentContainerStyle}
      data={padded}
      keyExtractor={(item, i) => (item ? keyExtractor(item, i) : `spacer-${i}`)}
      numColumns={columns}
      columnWrapperStyle={columns === 2 ? styles.gridRow : undefined}
      renderItem={({ item }) => (item ? renderItem(item, columns) : <View style={spacerStyle} />)}
      ListEmptyComponent={ListEmptyComponent}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
    />
  );
}

const styles = StyleSheet.create({
  gridRow: { justifyContent: 'space-between' },
  flatList: { flex: 1 },
});
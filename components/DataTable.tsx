// LOCATION: docwire-app/components/DataTable.tsx (NEW FILE)
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  // Fixed px width — a horizontally-scrolling layout needs known column
  // widths up front (unlike a real HTML <table>, which can size columns
  // to content automatically).
  width: number;
  render: (item: T) => React.ReactNode;
};

// Table-styled layout for tablet/desktop (see useBreakpoint.ts), used
// alongside ResponsiveGrid rather than replacing it — phone stays on
// cards, tablet/desktop get this. Built from plain Views rather than a
// literal HTML <table>: React Native has no table primitive at all, so a
// real <table> would only be possible on web (the same pattern
// SideNav.web.tsx uses for CSS :hover), which would leave native
// tablet/desktop builds with no equivalent. This renders identically on
// web and native from one file instead.
//
// Wrapped in a horizontal ScrollView so columns don't get crushed at
// tablet width rather than trying to shrink them to fit.
export function DataTable<T>({
  data,
  keyExtractor,
  columns,
  ListHeaderComponent,
  ListEmptyComponent,
  scrollable = true,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  columns: DataTableColumn<T>[];
  ListHeaderComponent?: React.ReactNode;
  ListEmptyComponent?: React.ReactNode;
  // When false, DataTable renders as a plain block instead of wrapping
  // itself in its own vertical ScrollView. Default (true) is unchanged —
  // DataTable used alone, as its own page's scroll container with a
  // ListHeaderComponent (its original design, e.g. ClientHomeScreen), is
  // exactly right and needs nothing different.
  //
  // Set this to false only when a screen stacks MULTIPLE DataTables (or
  // a DataTable alongside other content) inside its OWN page-level
  // ScrollView — e.g. SuperAdminUsersScreen's Client Orgs / Clients /
  // Staff tables. A vertical ScrollView nested inside another vertical
  // ScrollView doesn't reliably propagate scroll gestures past itself,
  // so the page appears to stop scrolling partway down. scrollable=false
  // lets the ancestor ScrollView be the only one, and DataTable just
  // renders its header + horizontally-scrolling rows as normal content.
  scrollable?: boolean;
}) {
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  const body = (
    <>
      {ListHeaderComponent}
      {data.length === 0 ? (
        ListEmptyComponent
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ width: totalWidth }}>
            <View style={styles.headerRow}>
              {columns.map((c) => (
                <View key={c.key} style={{ width: c.width, paddingRight: 12 }}>
                  <Text style={styles.headerText}>{c.header}</Text>
                </View>
              ))}
            </View>
            {data.map((item, i) => (
              <View key={keyExtractor(item, i)} style={styles.row}>
                {columns.map((c) => (
                  <View key={c.key} style={{ width: c.width, paddingRight: 12 }}>
                    {c.render(item)}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </>
  );

  if (!scrollable) return <View style={styles.outerContent}>{body}</View>;

  return (
    <ScrollView style={styles.outer} contentContainerStyle={styles.outerContent}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  outerContent: { flexGrow: 1 },
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
});
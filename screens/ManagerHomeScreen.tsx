import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// Placeholder — build this once the Client -> Accountant loop is solid.
// Will handle: Accounted -> Reviewed / Rework, and Accountant assignment.
export default function ManagerHomeScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Manager review screen — build this next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.bg },
  text: { color: colors.textDim, textAlign: 'center' },
});

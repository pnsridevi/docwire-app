// LOCATION: docwire-app/components/Dropdown.tsx (NEW FILE)
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// A real dropdown/select — tap the field, pick from a scrollable list in
// a modal, tap done. Added this session to replace ChipSelect wherever
// the option list scales with tenant size (Managers, Accountants, Client
// Organizations) instead of staying a small fixed set.
//
// ChipSelect renders every option as its own inline button — fine for
// 2–4 options (a Role toggle, a filter row), but it doesn't scale: 15
// Accountants inside a table cell means 15 wrapping chip buttons, and it
// only gets worse as the tenant grows. This scales the same way
// regardless of option count — the closed field stays one line; only the
// list scrolls.
//
// Same Modal-based approach DatePicker.tsx already uses, for the same
// reason: no native <Picker> dependency, which would force a full `eas
// build` instead of a JS-only `eas update`.
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Select...',
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)}>
        <Text style={[styles.fieldText, !selected && styles.fieldPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Feather name="chevron-down" size={14} color={colors.textFaint} />
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          {/* No-op inner onPress stops a tap on the list itself from
              bubbling to the backdrop and closing the modal — same
              reasoning as DatePicker.tsx's card. */}
          <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
            <ScrollView style={styles.optionList} showsVerticalScrollIndicator>
              {options.length === 0 ? (
                <Text style={styles.emptyText}>No options available.</Text>
              ) : (
                options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.option, isSelected && styles.optionActive]}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <Text style={[styles.optionText, isSelected && styles.optionTextActive]} numberOfLines={2}>
                        {opt.label}
                      </Text>
                      {isSelected && <Feather name="check" size={14} color={colors.orangeDeep} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surface2,
    minWidth: 160,
  },
  fieldText: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: '600' },
  fieldPlaceholder: { color: colors.textFaint, fontWeight: '400' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 6,
    width: 280,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionList: { maxHeight: 308 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: colors.tint },
  optionText: { flex: 1, fontSize: 13, color: colors.text },
  optionTextActive: { fontWeight: '700', color: colors.orangeDeep },
  emptyText: { fontSize: 12, color: colors.textFaint, padding: 12, textAlign: 'center' },
});
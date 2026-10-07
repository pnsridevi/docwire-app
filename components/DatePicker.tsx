import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// Task due dates in this app are things like GST filings, document
// requests, monthly/quarterly close items — realistically near-term work,
// not open-ended planning. Capping the picker at 6 months out comfortably
// covers a quarterly cadence with buffer, while preventing a due date from
// silently drifting years into the future by mistake (e.g. a typo, or a
// stray tap). One constant — change it here if the business wants a
// different cap.
const MAX_MONTHS_AHEAD = 6;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addMonths(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + n);
  return copy;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// A no-native-dependency calendar picker. RN's <Picker> (or a native date
// dialog) would need a real `eas build` to add, not just a JS `eas
// update` — same reasoning ChipSelect already follows elsewhere in this
// app. This is a plain Modal + hand-rolled month grid instead.
export function DatePicker({
  value,
  onChange,
  placeholder = 'Select due date',
}: {
  value: string; // 'YYYY-MM-DD', or '' for none
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => startOfDay(new Date()), []);
  const maxDate = useMemo(() => startOfDay(addMonths(today, MAX_MONTHS_AHEAD)), [today]);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = value ? new Date(`${value}T00:00:00`) : today;
    return firstOfMonth(base);
  });

  const canGoPrev = firstOfMonth(viewMonth) > firstOfMonth(today);
  const canGoNext = firstOfMonth(viewMonth) < firstOfMonth(maxDate);

  const openPicker = () => {
    const base = value ? new Date(`${value}T00:00:00`) : today;
    setViewMonth(firstOfMonth(base));
    setOpen(true);
  };

  const days = useMemo(() => {
    const first = firstOfMonth(viewMonth);
    const startWeekday = first.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return cells;
  }, [viewMonth]);

  const selectDay = (d: Date) => {
    onChange(toDateOnly(d));
    setOpen(false);
  };

  const displayLabel = value
    ? (() => {
        const d = new Date(`${value}T00:00:00`);
        return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
      })()
    : placeholder;

  return (
    <View>
      <TouchableOpacity style={styles.field} onPress={openPicker}>
        <Feather name="calendar" size={15} color={colors.textFaint} />
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]}>{displayLabel}</Text>
        {value ? (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={14} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          {/* Inner TouchableOpacity with a no-op onPress stops a tap on the
              card itself from bubbling to the backdrop and closing the
              modal — otherwise picking a month arrow or a day would also
              immediately dismiss it. */}
          <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
            <View style={styles.headerRow}>
              <TouchableOpacity
                disabled={!canGoPrev}
                onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-left" size={18} color={canGoPrev ? colors.text : colors.border} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>
                {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </Text>
              <TouchableOpacity
                disabled={!canGoNext}
                onPress={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-right" size={18} color={canGoNext ? colors.text : colors.border} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((w, i) => (
                <Text key={i} style={styles.weekdayLabel}>{w}</Text>
              ))}
            </View>

            <View style={styles.grid}>
              {days.map((d, i) => {
                if (!d) return <View key={i} style={styles.cell} />;
                const disabled = d < today || d > maxDate;
                const isSelected = value === toDateOnly(d);
                const isToday = toDateOnly(d) === toDateOnly(today);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.cell, isSelected && styles.cellSelected]}
                    disabled={disabled}
                    onPress={() => selectDay(d)}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        disabled && styles.cellTextDisabled,
                        isToday && !isSelected && styles.cellTextToday,
                        isSelected && styles.cellTextSelected,
                      ]}
                    >
                      {d.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.rangeHint}>
              Selectable: today through {MONTH_NAMES[maxDate.getMonth()].slice(0, 3)} {maxDate.getDate()}, {maxDate.getFullYear()}
            </Text>
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
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: colors.surface2,
  },
  fieldText: { flex: 1, color: colors.text, fontSize: 13 },
  fieldPlaceholder: { color: colors.textFaint },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    width: 300,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayLabel: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, color: colors.textFaint, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellSelected: { backgroundColor: colors.orange, borderRadius: 999 },
  cellText: { fontSize: 13, color: colors.text },
  cellTextDisabled: { color: colors.border },
  cellTextSelected: { color: '#fff', fontWeight: '700' },
  cellTextToday: { color: colors.orange, fontWeight: '700' },
  rangeHint: { fontSize: 10, color: colors.textFaint, marginTop: 8, textAlign: 'center' },
});
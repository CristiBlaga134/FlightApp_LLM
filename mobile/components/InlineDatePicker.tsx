import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Radius, Typography } from "../src/theme/colors";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type DateVal = { year: number; month: number; day: number } | null;


function formatDisplay(v: DateVal): string {
  if (!v) return "";
  return `${String(v.day).padStart(2, "0")} ${MONTH_SHORT[v.month - 1]} ${v.year}`;
}

function formatForLLM(v: DateVal): string {
  if (!v) return "";
  return `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstWeekdayOf(year: number, month: number): number {
  const d = new Date(year, month - 1, 1).getDay();
  return d === 0 ? 6 : d - 1; // 0=Mon … 6=Sun
}

function compareDates(a: DateVal, b: DateVal): number {
  if (!a || !b) return 0;
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function isInRange(day: DateVal, start: DateVal, end: DateVal): boolean {
  if (!day || !start || !end) return false;
  return compareDates(day, start) > 0 && compareDates(day, end) < 0;
}

type Props = {
  needsDeparture: boolean;
  needsReturn: boolean;
  tripType: "one_way" | "round_trip" | null;
  onConfirm: (text: string) => void;
  disabled?: boolean;
};

export function InlineDatePicker({ needsDeparture, needsReturn, tripType, onConfirm, disabled }: Props) {
  const today = new Date();
  const todayVal: DateVal = { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(todayVal.year);
  const [viewMonth, setViewMonth] = useState(todayVal.month);

  const isRound = tripType === "round_trip" || (needsDeparture && needsReturn);
  const [departure, setDeparture] = useState<DateVal>(null);
  const [returnD, setReturnD] = useState<DateVal>(null);
  const [phase, setPhase] = useState<"departure" | "return">("departure");

  const handleDayPress = (day: number) => {
    const tapped: DateVal = { year: viewYear, month: viewMonth, day };
    if (compareDates(tapped, todayVal) < 0) return; // past

    if (!isRound) {
      setDeparture(tapped);
      return;
    }

    if (phase === "departure") {
      setDeparture(tapped);
      setReturnD(null);
      setPhase("return");
    } else {
      if (compareDates(tapped, departure) <= 0) {
        setDeparture(tapped);
        setReturnD(null);
        setPhase("return");
      } else {
        setReturnD(tapped);
        setPhase("departure");
      }
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  };

  const handleConfirm = () => {
    if (isRound && departure && returnD) {
      onConfirm(`${formatForLLM(departure)} ${formatForLLM(returnD)}`);
    } else if (!isRound && departure) {
      onConfirm(formatForLLM(departure));
    } else if (!needsDeparture && returnD) {
      onConfirm(formatForLLM(returnD));
    }
    setOpen(false);
  };

  const canConfirm = isRound ? !!(departure && returnD) : !!(departure || returnD);

  const triggerLabel = (() => {
    if (!departure && !returnD) return "Pick dates";
    const parts: string[] = [];
    if (departure) parts.push(formatDisplay(departure));
    if (returnD) parts.push(formatDisplay(returnD));
    return parts.join(" → ");
  })();

  const numDays = daysInMonth(viewYear, viewMonth);
  const firstWd = firstWeekdayOf(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstWd).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={() => !disabled && setOpen(o => !o)}
      >
        <Feather name="calendar" size={14} color={Colors.accent} />
        <Text style={styles.triggerText}>{triggerLabel}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={Colors.textMuted} />
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          {isRound ? (
            <View style={styles.phaseRow}>
              <View style={[styles.phaseTab, phase === "departure" && styles.phaseTabActive]}>
                <Text style={[styles.phaseLabel, phase === "departure" && styles.phaseLabelActive]}>
                  Departure
                </Text>
                {departure ? (
                  <Text style={styles.phaseValue}>{formatDisplay(departure)}</Text>
                ) : null}
              </View>
              <View style={[styles.phaseTab, phase === "return" && styles.phaseTabActive]}>
                <Text style={[styles.phaseLabel, phase === "return" && styles.phaseLabelActive]}>
                  Return
                </Text>
                {returnD ? (
                  <Text style={styles.phaseValue}>{formatDisplay(returnD)}</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.monthNav}>
            <Pressable style={styles.navBtn} onPress={handlePrevMonth}>
              <Feather name="chevron-left" size={18} color={Colors.accent} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </Text>
            <Pressable style={styles.navBtn} onPress={handleNextMonth}>
              <Feather name="chevron-right" size={18} color={Colors.accent} />
            </Pressable>
          </View>

          <View style={styles.dayLabelRow}>
            {DAY_LABELS.map(dl => (
              <Text key={dl} style={styles.dayLabel}>{dl}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, idx) => {
              if (day === null) {
                return <View key={`e-${idx}`} style={styles.cell} />;
              }

              const cellVal: DateVal = { year: viewYear, month: viewMonth, day };
              const isPast = compareDates(cellVal, todayVal) < 0;
              const isDep = departure ? compareDates(cellVal, departure) === 0 : false;
              const isRet = returnD ? compareDates(cellVal, returnD) === 0 : false;
              const inRange = isRound ? isInRange(cellVal, departure, returnD) : false;
              const isSelected = isDep || isRet;

              return (
                <Pressable
                  key={`d-${day}`}
                  style={[
                    styles.cell,
                    inRange && styles.cellInRange,
                    isSelected && styles.cellSelected,
                    isPast && styles.cellPast,
                  ]}
                  onPress={() => handleDayPress(day)}
                  disabled={isPast}
                >
                  <Text style={[
                    styles.cellText,
                    isSelected && styles.cellTextSelected,
                    inRange && styles.cellTextInRange,
                    isPast && styles.cellTextPast,
                  ]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {isRound && phase === "return" && departure ? (
            <Text style={styles.hint}>Now pick your return date</Text>
          ) : isRound && phase === "departure" ? (
            <Text style={styles.hint}>Pick your departure date</Text>
          ) : null}

          <Pressable
            style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
          >
            <Text style={styles.confirmBtnText}>Confirm dates</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  triggerDisabled: {
    opacity: 0.4,
  },
  triggerText: {
    color: Colors.accent,
    fontFamily: Typography.sansSemiBold,
    fontSize: 13,
    flex: 1,
  },
  panel: {
    marginTop: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    maxWidth: 338,
    alignSelf: "flex-start",
  },
  phaseRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  phaseTab: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    alignItems: "center",
  },
  phaseTabActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  phaseLabel: {
    fontFamily: Typography.sansSemiBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: Colors.textMuted,
  },
  phaseLabelActive: {
    color: Colors.accent,
  },
  phaseValue: {
    fontFamily: Typography.sansBold,
    fontSize: 13,
    color: Colors.textPrimary,
    marginTop: 3,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  navBtn: {
    padding: 6,
  },
  monthLabel: {
    fontFamily: Typography.sansBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  dayLabelRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  dayLabel: {
    width: 45,
    textAlign: "center",
    fontFamily: Typography.sansSemiBold,
    fontSize: 11,
    color: Colors.textMuted,
    paddingVertical: 3,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 315,
  },
  cell: {
    width: 45,
    height: 45,
    alignItems: "center",
    justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: Colors.accent,
    borderRadius: 999,
  },
  cellInRange: {
    backgroundColor: Colors.accentSoft,
  },
  cellPast: {
    opacity: 0.3,
  },
  cellText: {
    fontFamily: Typography.sansMedium,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  cellTextSelected: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
  },
  cellTextInRange: {
    color: Colors.accent,
  },
  cellTextPast: {
    color: Colors.textMuted,
  },
  hint: {
    fontFamily: Typography.sans,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  confirmBtn: {
    marginTop: 12,
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    alignItems: "center",
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnText: {
    fontFamily: Typography.sansBold,
    fontSize: 14,
    color: Colors.textOnDark,
  },
});

import { normalizeReminderRecurrence, normalizeReminderRecurrenceInterval } from './reminderRecurrenceConfig';

export const WEEKDAY_LABELS_MON = ['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'];

const DAY_MS = 1000 * 60 * 60 * 24;

const toDateKey = (value) => String(value || '').trim();

const toLocalDate = (value) => {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  return parseDateKeyToLocalDate(value);
};

const addDaysToDate = (date, days) => (
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
);

const addMonthsFromAnchor = (baseDate, monthOffset) => {
  const anchorDay = baseDate.getDate();
  const targetMonthStart = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthOffset, 1);
  const lastDayOfTargetMonth = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0
  ).getDate();

  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(anchorDay, lastDayOfTargetMonth)
  );
};

const dayDiff = (leftDate, rightDate) => (
  Math.floor((leftDate.getTime() - rightDate.getTime()) / DAY_MS)
);

const dateRangesOverlap = (startA, endA, startB, endB) => (
  startA.getTime() <= endB.getTime() && startB.getTime() <= endA.getTime()
);

const mondayBasedWeekdayIndex = (date) => {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
};

const compareDateKeys = (left, right) => {
  const leftDate = parseDateKeyToLocalDate(left);
  const rightDate = parseDateKeyToLocalDate(right);
  if (!leftDate || !rightDate) return 0;
  if (leftDate.getTime() === rightDate.getTime()) return 0;
  return leftDate.getTime() < rightDate.getTime() ? -1 : 1;
};

const buildOccurrenceReminder = (reminder, occurrenceStartDate, occurrenceEndDate, occurrenceIndex) => {
  const occurrenceStartKey = getLocalDateKey(occurrenceStartDate);
  const occurrenceEndKey = getLocalDateKey(occurrenceEndDate);

  return {
    ...reminder,
    id: reminder.id,
    source_reminder_id: reminder.id,
    occurrence_index: occurrenceIndex,
    occurrence_key: `${reminder.id || 'reminder'}:${occurrenceStartKey}:${occurrenceIndex}`,
    occurrence_start_date: occurrenceStartKey,
    occurrence_end_date: occurrenceEndKey,
    occurrence_anchor_date: occurrenceStartKey,
    start_date: occurrenceStartKey,
    end_date: occurrenceEndKey !== occurrenceStartKey ? occurrenceEndKey : null,
    due_date: occurrenceEndKey,
  };
};

const buildSingleOccurrence = (reminder) => {
  const startDateKey = getReminderStartDateKey(reminder);
  const endDateKey = getReminderEndDateKey(reminder);
  const startDate = parseDateKeyToLocalDate(startDateKey);
  const endDate = parseDateKeyToLocalDate(endDateKey);
  if (!startDate || !endDate) return null;
  return buildOccurrenceReminder(reminder, startDate, endDate, 0);
};

export const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDateKeyToLocalDate = (dateKey) => {
  const [year, month, day] = String(dateKey || '').split('-').map((segment) => Number.parseInt(segment, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

export const shiftDateKeyByDays = (dateKey, offsetDays) => {
  const date = parseDateKeyToLocalDate(dateKey);
  if (!date) return '';
  return getLocalDateKey(addDaysToDate(date, offsetDays));
};

export const getReminderStartDateKey = (reminder) => {
  const startDateKey = toDateKey(reminder?.start_date);
  if (startDateKey) return startDateKey;
  return toDateKey(reminder?.due_date);
};

export const getReminderEndDateKey = (reminder) => {
  const startDateKey = getReminderStartDateKey(reminder);
  const endDateKey = toDateKey(reminder?.end_date);
  if (!endDateKey) return startDateKey;
  if (!startDateKey) return endDateKey;
  return compareDateKeys(endDateKey, startDateKey) >= 0 ? endDateKey : startDateKey;
};

export const getReminderOccurrenceAnchorDateKey = (reminder) => {
  const occurrenceStartKey = toDateKey(reminder?.occurrence_start_date);
  if (occurrenceStartKey) return occurrenceStartKey;
  return getReminderStartDateKey(reminder);
};

export const getReminderOccurrenceLookupKey = (reminderId, occurrenceDateKey) => {
  const normalizedReminderId = String(reminderId || '').trim();
  const normalizedDateKey = toDateKey(occurrenceDateKey);
  if (!normalizedReminderId || !normalizedDateKey) return '';
  return `${normalizedReminderId}:${normalizedDateKey}`;
};

export const isReminderRecurring = (reminder) => (
  normalizeReminderRecurrence(reminder?.recurrence) !== 'none'
);

export const buildCompletedReminderOccurrenceSet = (occurrenceRows) => {
  const result = new Set();
  (Array.isArray(occurrenceRows) ? occurrenceRows : []).forEach((row) => {
    if (String(row?.status || '').toLowerCase() !== 'completed') return;
    const key = getReminderOccurrenceLookupKey(row?.reminder_id, row?.occurrence_date);
    if (key) result.add(key);
  });
  return result;
};

export const isReminderOccurrenceCompleted = (reminder, completedOccurrenceSet) => {
  if (!isReminderRecurring(reminder)) {
    return Boolean(reminder?.is_completed);
  }
  if (!(completedOccurrenceSet instanceof Set) || completedOccurrenceSet.size === 0) {
    return false;
  }

  const reminderId = reminder?.source_reminder_id || reminder?.reminder_id || reminder?.id;
  const occurrenceDateKey = getReminderOccurrenceAnchorDateKey(reminder);
  const lookupKey = getReminderOccurrenceLookupKey(reminderId, occurrenceDateKey);
  if (!lookupKey) return false;
  return completedOccurrenceSet.has(lookupKey);
};

export const isDateKeyWithinRange = (dateKey, startDateKey, endDateKey) => {
  if (!dateKey || !startDateKey || !endDateKey) return false;
  return startDateKey <= dateKey && dateKey <= endDateKey;
};

export const formatDueDate = (dueDateKey) => {
  const parsed = parseDateKeyToLocalDate(dueDateKey);
  if (!parsed) return '-';
  return parsed.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatReminderDateRange = (startDateKey, endDateKey) => {
  const startDate = parseDateKeyToLocalDate(startDateKey);
  const endDate = parseDateKeyToLocalDate(endDateKey || startDateKey);
  if (!startDate) return '-';
  if (!endDate || startDate.getTime() === endDate.getTime()) {
    return startDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
  }

  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();

  if (sameMonth) {
    const monthLabel = startDate.toLocaleDateString('ms-MY', { month: 'short' });
    return `${startDate.getDate()}-${endDate.getDate()} ${monthLabel}`;
  }

  if (sameYear) {
    const startLabel = startDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
    const endLabel = endDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
    return `${startLabel} - ${endLabel}`;
  }

  const startLabel = startDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  const endLabel = endDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
};

export const formatMonthTitle = (monthDate) => (
  new Intl.DateTimeFormat('ms-MY', { month: 'long', year: 'numeric' }).format(monthDate)
);

export const getOverdueDays = (dueDateKey, todayKey) => {
  const dueDate = parseDateKeyToLocalDate(dueDateKey);
  const todayDate = parseDateKeyToLocalDate(todayKey);
  if (!dueDate || !todayDate) return 0;

  const diffMs = todayDate.getTime() - dueDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / DAY_MS);
};

export const getMonthGridDateRange = (monthDate) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startOffset = mondayBasedWeekdayIndex(firstDayOfMonth);
  const gridStart = new Date(year, month, 1 - startOffset);
  const gridEnd = addDaysToDate(gridStart, 41);

  return {
    startDateKey: getLocalDateKey(gridStart),
    endDateKey: getLocalDateKey(gridEnd),
  };
};

export const expandReminderOccurrencesInWindow = (
  reminder,
  { windowStartKey, windowEndKey, maxOccurrences = 500 } = {}
) => {
  const baseStartKey = getReminderStartDateKey(reminder);
  const baseEndKey = getReminderEndDateKey(reminder);
  const baseStartDate = parseDateKeyToLocalDate(baseStartKey);
  const baseEndDate = parseDateKeyToLocalDate(baseEndKey);
  if (!baseStartDate || !baseEndDate) return [];

  const windowStartDate = toLocalDate(windowStartKey) || baseStartDate;
  const windowEndDate = toLocalDate(windowEndKey) || baseEndDate;
  if (!windowStartDate || !windowEndDate) return [];

  const normalizedWindowStart = windowStartDate.getTime() <= windowEndDate.getTime() ? windowStartDate : windowEndDate;
  const normalizedWindowEnd = windowStartDate.getTime() <= windowEndDate.getTime() ? windowEndDate : windowStartDate;

  const recurrence = normalizeReminderRecurrence(reminder?.recurrence);
  const recurrenceInterval = normalizeReminderRecurrenceInterval(reminder?.recurrence_interval);
  const recurrenceUntilDate = parseDateKeyToLocalDate(reminder?.recurrence_until);
  const spanDays = Math.max(dayDiff(baseEndDate, baseStartDate), 0);
  const occurrences = [];

  if (recurrence === 'none') {
    if (!dateRangesOverlap(baseStartDate, baseEndDate, normalizedWindowStart, normalizedWindowEnd)) {
      return [];
    }
    const singleOccurrence = buildSingleOccurrence(reminder);
    return singleOccurrence ? [singleOccurrence] : [];
  }

  if (recurrence === 'daily' || recurrence === 'weekly') {
    const stepDays = recurrence === 'weekly' ? recurrenceInterval * 7 : recurrenceInterval;
    const stepMs = stepDays * DAY_MS;
    const firstRelevantIndex = Math.max(
      0,
      Math.floor((normalizedWindowStart.getTime() - baseEndDate.getTime()) / stepMs)
    );

    let occurrenceIndex = firstRelevantIndex > 0 ? firstRelevantIndex - 1 : 0;
    let safetyCounter = 0;
    while (safetyCounter < maxOccurrences) {
      const occurrenceStartDate = addDaysToDate(baseStartDate, occurrenceIndex * stepDays);
      const occurrenceEndDate = addDaysToDate(occurrenceStartDate, spanDays);

      if (recurrenceUntilDate && occurrenceStartDate.getTime() > recurrenceUntilDate.getTime()) {
        break;
      }
      if (occurrenceStartDate.getTime() > normalizedWindowEnd.getTime() && occurrenceEndDate.getTime() > normalizedWindowEnd.getTime()) {
        break;
      }
      if (dateRangesOverlap(occurrenceStartDate, occurrenceEndDate, normalizedWindowStart, normalizedWindowEnd)) {
        occurrences.push(buildOccurrenceReminder(reminder, occurrenceStartDate, occurrenceEndDate, occurrenceIndex));
      }

      occurrenceIndex += 1;
      safetyCounter += 1;
    }

    return occurrences;
  }

  // monthly
  const monthsDiffFromBase = (
    (normalizedWindowStart.getFullYear() - baseStartDate.getFullYear()) * 12
    + (normalizedWindowStart.getMonth() - baseStartDate.getMonth())
  );
  let occurrenceIndex = Math.max(0, Math.floor(monthsDiffFromBase / recurrenceInterval) - 1);
  let safetyCounter = 0;
  while (safetyCounter < maxOccurrences) {
    const occurrenceStartDate = addMonthsFromAnchor(baseStartDate, occurrenceIndex * recurrenceInterval);
    const occurrenceEndDate = addDaysToDate(occurrenceStartDate, spanDays);

    if (recurrenceUntilDate && occurrenceStartDate.getTime() > recurrenceUntilDate.getTime()) {
      break;
    }
    if (occurrenceStartDate.getTime() > normalizedWindowEnd.getTime() && occurrenceEndDate.getTime() > normalizedWindowEnd.getTime()) {
      break;
    }
    if (dateRangesOverlap(occurrenceStartDate, occurrenceEndDate, normalizedWindowStart, normalizedWindowEnd)) {
      occurrences.push(buildOccurrenceReminder(reminder, occurrenceStartDate, occurrenceEndDate, occurrenceIndex));
    }

    occurrenceIndex += 1;
    safetyCounter += 1;
  }

  return occurrences;
};

export const expandRemindersOccurrencesInWindow = (reminders, options = {}) => {
  const completedOccurrenceSet = options?.completedOccurrenceSet;
  const expanded = (Array.isArray(reminders) ? reminders : []).flatMap((reminder) => (
    expandReminderOccurrencesInWindow(reminder, options)
  ));

  if (!(completedOccurrenceSet instanceof Set) || completedOccurrenceSet.size === 0) {
    return expanded;
  }

  return expanded.map((occurrence) => ({
    ...occurrence,
    is_completed: isReminderOccurrenceCompleted(occurrence, completedOccurrenceSet),
  }));
};

export const evaluateReminderStatusForDate = (
  reminder,
  todayKey,
  lookbackDays = 30,
  completedOccurrenceSet = null
) => {
  const recurrence = normalizeReminderRecurrence(reminder?.recurrence);
  if (recurrence === 'none') {
    const startDateKey = getReminderStartDateKey(reminder);
    const endDateKey = getReminderEndDateKey(reminder);
    if (!startDateKey || !endDateKey) {
      return { key: 'pending', overdueDays: 0 };
    }
    if (isDateKeyWithinRange(todayKey, startDateKey, endDateKey)) {
      return { key: 'today', overdueDays: 0 };
    }
    if (endDateKey < todayKey) {
      return {
        key: 'overdue',
        overdueDays: Math.max(getOverdueDays(endDateKey, todayKey), 1),
      };
    }
    return { key: 'pending', overdueDays: 0 };
  }

  const windowStartKey = shiftDateKeyByDays(todayKey, -Math.max(lookbackDays, 1));
  const occurrences = expandReminderOccurrencesInWindow(reminder, {
    windowStartKey,
    windowEndKey: todayKey,
    maxOccurrences: 600,
  });
  const openOccurrences = occurrences.filter(
    (occurrence) => !isReminderOccurrenceCompleted(occurrence, completedOccurrenceSet)
  );

  const todayOccurrence = openOccurrences.find((occurrence) => (
    isDateKeyWithinRange(
      todayKey,
      occurrence.occurrence_start_date,
      occurrence.occurrence_end_date
    )
  ));

  if (todayOccurrence) {
    return {
      key: 'today',
      overdueDays: 0,
    };
  }

  const latestPastOccurrence = openOccurrences
    .filter((occurrence) => occurrence.occurrence_end_date < todayKey)
    .sort((left, right) => right.occurrence_end_date.localeCompare(left.occurrence_end_date))[0];

  if (latestPastOccurrence) {
    return {
      key: 'overdue',
      overdueDays: Math.max(getOverdueDays(latestPastOccurrence.occurrence_end_date, todayKey), 1),
    };
  }

  return {
    key: 'pending',
    overdueDays: 0,
  };
};

export const groupRemindersByDate = (reminders, options = {}) => {
  const completedOccurrenceSet = options?.completedOccurrenceSet;
  const grouped = {};
  const expandedOccurrences = expandRemindersOccurrencesInWindow(reminders, options);

  expandedOccurrences.forEach((occurrence) => {
    const occurrenceStartDate = parseDateKeyToLocalDate(occurrence.occurrence_start_date);
    const occurrenceEndDate = parseDateKeyToLocalDate(occurrence.occurrence_end_date);
    if (!occurrenceStartDate || !occurrenceEndDate) return;

    const totalDays = Math.max(
      Math.floor((occurrenceEndDate.getTime() - occurrenceStartDate.getTime()) / DAY_MS),
      0
    );
    const boundedDays = Math.min(totalDays, 366);

    for (let dayOffset = 0; dayOffset <= boundedDays; dayOffset += 1) {
      const cursorDate = addDaysToDate(occurrenceStartDate, dayOffset);
      const cursorDateKey = getLocalDateKey(cursorDate);
      if (!Array.isArray(grouped[cursorDateKey])) {
        grouped[cursorDateKey] = [];
      }
      grouped[cursorDateKey].push({
        ...occurrence,
        is_completed: isReminderOccurrenceCompleted(occurrence, completedOccurrenceSet),
      });
    }
  });

  return grouped;
};

export const buildMonthCalendarCells = (monthDate, selectedDateKey, todayKey, remindersByDate) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startOffset = mondayBasedWeekdayIndex(firstDayOfMonth);
  const gridStart = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDaysToDate(gridStart, index);
    const dateKey = getLocalDateKey(date);
    const isCurrentMonth = date.getMonth() === month;
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedDateKey;
    const reminders = sortRemindersForDate(remindersByDate[dateKey] || []);

    return {
      date,
      dateKey,
      dayNumber: date.getDate(),
      isCurrentMonth,
      isToday,
      isSelected,
      reminders,
      reminderCount: reminders.length,
    };
  });
};

const PRIORITY_SCORE = { high: 3, normal: 2, low: 1 };

export const sortRemindersForDate = (reminders) => (
  [...(Array.isArray(reminders) ? reminders : [])].sort((left, right) => {
    const leftPriority = PRIORITY_SCORE[String(left?.priority || 'normal').toLowerCase()] || 0;
    const rightPriority = PRIORITY_SCORE[String(right?.priority || 'normal').toLowerCase()] || 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;

    const leftOccurrenceStart = String(left?.occurrence_start_date || left?.start_date || left?.due_date || '');
    const rightOccurrenceStart = String(right?.occurrence_start_date || right?.start_date || right?.due_date || '');
    if (leftOccurrenceStart !== rightOccurrenceStart) {
      return leftOccurrenceStart.localeCompare(rightOccurrenceStart);
    }

    const leftCreatedAt = new Date(left?.created_at || 0).getTime();
    const rightCreatedAt = new Date(right?.created_at || 0).getTime();
    return rightCreatedAt - leftCreatedAt;
  })
);

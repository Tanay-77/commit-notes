export interface ScheduleItem {
  interval: number;
  easeFactor: number;
  repetitions: number;
  dueDate: string;
}

export function formatDate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createInitialSchedule(now: Date = new Date()): ScheduleItem {
  return {
    interval: 0,
    easeFactor: 2.5,
    repetitions: 0,
    dueDate: formatDate(now),
  };
}

export function calculateSM2(
  item: ScheduleItem,
  grade: number,
  now: Date = new Date()
): ScheduleItem {
  // Clamp grade to integer between 0 and 5
  const clampedGrade = Math.max(0, Math.min(5, Math.round(grade)));

  let interval = item.interval;
  let easeFactor = item.easeFactor;
  let repetitions = item.repetitions;

  if (clampedGrade >= 3) {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(interval * easeFactor));
    }
    repetitions += 1;
  } else {
    // Failure resets repetitions and sets interval to 1 day
    repetitions = 0;
    interval = 1;
  }

  // SM-2 Ease Factor formula:
  // EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  const delta = 5 - clampedGrade;
  easeFactor = easeFactor + (0.1 - delta * (0.08 + delta * 0.02));

  // Hard lower bound for ease factor is 1.3
  easeFactor = Math.max(1.3, Number(easeFactor.toFixed(2)));

  // Advance due date by interval days
  const nextDate = new Date(now.getTime());
  nextDate.setDate(nextDate.getDate() + interval);
  const dueDate = formatDate(nextDate);

  return {
    interval,
    easeFactor,
    repetitions,
    dueDate,
  };
}

export function isDue(
  item: ScheduleItem,
  targetDateStr: string = formatDate(new Date())
): boolean {
  return item.dueDate <= targetDateStr;
}

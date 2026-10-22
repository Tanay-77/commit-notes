import { describe, it, expect } from "vitest";
import {
  createInitialSchedule,
  calculateSM2,
  isDue,
  formatDate,
  type ScheduleItem,
} from "../src/schedule.js";

describe("createInitialSchedule", () => {
  it("initializes schedule with default SM-2 constants and today's due date", () => {
    const fixedNow = new Date("2026-10-22T10:00:00Z");
    const item = createInitialSchedule(fixedNow);

    expect(item.interval).toBe(0);
    expect(item.easeFactor).toBe(2.5);
    expect(item.repetitions).toBe(0);
    expect(item.dueDate).toBe("2026-10-22");
  });
});

describe("calculateSM2", () => {
  const fixedNow = new Date("2026-10-22T10:00:00Z");

  it("case 1: first review with grade 5 advances interval to 1 and increases ease factor", () => {
    const initial = createInitialSchedule(fixedNow);
    const updated = calculateSM2(initial, 5, fixedNow);

    expect(updated.repetitions).toBe(1);
    expect(updated.interval).toBe(1);
    expect(updated.easeFactor).toBe(2.6);
    expect(updated.dueDate).toBe("2026-10-23");
  });

  it("case 2: first review with grade 4 advances interval to 1 and maintains ease factor", () => {
    const initial = createInitialSchedule(fixedNow);
    const updated = calculateSM2(initial, 4, fixedNow);

    expect(updated.repetitions).toBe(1);
    expect(updated.interval).toBe(1);
    expect(updated.easeFactor).toBe(2.5);
    expect(updated.dueDate).toBe("2026-10-23");
  });

  it("case 3: first review with grade 3 advances interval to 1 and decreases ease factor", () => {
    const initial = createInitialSchedule(fixedNow);
    const updated = calculateSM2(initial, 3, fixedNow);

    expect(updated.repetitions).toBe(1);
    expect(updated.interval).toBe(1);
    expect(updated.easeFactor).toBe(2.36);
    expect(updated.dueDate).toBe("2026-10-23");
  });

  it("case 4: second consecutive success sets interval to 6 days", () => {
    const stateAfterFirst: ScheduleItem = {
      interval: 1,
      easeFactor: 2.5,
      repetitions: 1,
      dueDate: "2026-10-23",
    };
    const updated = calculateSM2(stateAfterFirst, 4, fixedNow);

    expect(updated.repetitions).toBe(2);
    expect(updated.interval).toBe(6);
    expect(updated.dueDate).toBe("2026-10-28");
  });

  it("case 5: third consecutive success multiplies interval by ease factor", () => {
    const stateAfterSecond: ScheduleItem = {
      interval: 6,
      easeFactor: 2.5,
      repetitions: 2,
      dueDate: "2026-10-28",
    };
    const updated = calculateSM2(stateAfterSecond, 4, fixedNow);

    expect(updated.repetitions).toBe(3);
    // 6 * 2.5 = 15
    expect(updated.interval).toBe(15);
  });

  it("case 6: failure with grade 2 resets repetitions to 0 and interval to 1", () => {
    const matureItem: ScheduleItem = {
      interval: 30,
      easeFactor: 2.5,
      repetitions: 5,
      dueDate: "2026-10-22",
    };
    const updated = calculateSM2(matureItem, 2, fixedNow);

    expect(updated.repetitions).toBe(0);
    expect(updated.interval).toBe(1);
    expect(updated.easeFactor).toBeLessThan(2.5);
    expect(updated.dueDate).toBe("2026-10-23");
  });

  it("case 7: failure with grade 0 resets repetitions and heavily reduces ease factor", () => {
    const matureItem: ScheduleItem = {
      interval: 15,
      easeFactor: 2.5,
      repetitions: 3,
      dueDate: "2026-10-22",
    };
    const updated = calculateSM2(matureItem, 0, fixedNow);

    expect(updated.repetitions).toBe(0);
    expect(updated.interval).toBe(1);
    // delta = 5 -> EF - 0.8
    expect(updated.easeFactor).toBe(1.7);
  });

  it("case 8: ease factor limits: multiple failures never drop ease factor below 1.3", () => {
    let item = createInitialSchedule(fixedNow);
    for (let i = 0; i < 10; i++) {
      item = calculateSM2(item, 0, fixedNow);
    }

    expect(item.easeFactor).toBe(1.3);
  });

  it("case 9: clamps out-of-range grades (e.g. negative or > 5)", () => {
    const item = createInitialSchedule(fixedNow);
    const clampedHigh = calculateSM2(item, 10, fixedNow);
    expect(clampedHigh.easeFactor).toBe(2.6); // same as 5

    const clampedLow = calculateSM2(item, -5, fixedNow);
    expect(clampedLow.easeFactor).toBe(1.7); // same as 0
  });

  it("case 10: accurately calculates next due date across month boundaries", () => {
    const endOfMonth = new Date("2026-10-30T10:00:00Z");
    const item: ScheduleItem = {
      interval: 6,
      easeFactor: 2.5,
      repetitions: 1,
      dueDate: "2026-10-30",
    };
    const updated = calculateSM2(item, 4, endOfMonth);

    expect(updated.dueDate).toBe("2026-11-05");
  });
});

describe("isDue and formatDate", () => {
  it("case 11: isDue returns true when dueDate is today or earlier", () => {
    expect(isDue({ interval: 1, easeFactor: 2.5, repetitions: 1, dueDate: "2026-10-22" }, "2026-10-22")).toBe(true);
    expect(isDue({ interval: 1, easeFactor: 2.5, repetitions: 1, dueDate: "2026-10-20" }, "2026-10-22")).toBe(true);
  });

  it("case 12: isDue returns false when dueDate is strictly in the future", () => {
    expect(isDue({ interval: 1, easeFactor: 2.5, repetitions: 1, dueDate: "2026-10-23" }, "2026-10-22")).toBe(false);
  });

  it("formatDate produces YYYY-MM-DD", () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDate(d)).toBe("2026-01-05");
  });
});

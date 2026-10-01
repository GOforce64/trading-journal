import { describe, expect, it } from "vitest";
import {
  addDays,
  easterSunday,
  expiryMoment,
  holdBucket,
  holidayName,
  isTradingDay,
  nyMinuteOfDay,
  nyseEarlyCloses,
  nyseHolidays,
  nyWallClock,
  nyWeekday,
  regularClose,
  sessionMoment,
  sessionsBetween,
  weekdayOfDate,
} from "./calendar.js";

/** Epoch ms for a New York wall-clock time; daylight time (UTC−4) unless another offset is given. */
const ny = (stamp: string, offset = "-04:00") => Date.parse(`${stamp.replace(" ", "T")}:00${offset}`);

describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
  ])("puts Easter %i on %s", (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe("nyseHolidays", () => {
  it.each([
    [
      2024,
      [
        "2024-01-01",
        "2024-01-15",
        "2024-02-19",
        "2024-03-29",
        "2024-05-27",
        "2024-06-19",
        "2024-07-04",
        "2024-09-02",
        "2024-11-28",
        "2024-12-25",
      ],
    ],
    [
      2025,
      [
        "2025-01-01",
        "2025-01-09",
        "2025-01-20",
        "2025-02-17",
        "2025-04-18",
        "2025-05-26",
        "2025-06-19",
        "2025-07-04",
        "2025-09-01",
        "2025-11-27",
        "2025-12-25",
      ],
    ],
    [
      2026,
      [
        "2026-01-01",
        "2026-01-19",
        "2026-02-16",
        "2026-04-03",
        "2026-05-25",
        "2026-06-19",
        "2026-07-03",
        "2026-09-07",
        "2026-11-26",
        "2026-12-25",
      ],
    ],
  ])("matches the NYSE's published %i dates", (year, dates) => {
    expect([...nyseHolidays(year).keys()].sort()).toEqual(dates);
  });

  it("names Good Friday and the 2025 day of mourning", () => {
    expect(holidayName("2026-04-03")).toBe("Good Friday");
    expect(holidayName("2025-01-09")).toBe("National Day of Mourning");
  });

  it("moves a Saturday holiday to Friday and a Sunday one to Monday", () => {
    expect(holidayName("2027-12-24")).toBe("Christmas Day");
    expect(holidayName("2027-07-05")).toBe("Independence Day");
    expect(holidayName("2027-06-18")).toBe("Juneteenth");
  });

  it("does not move a Saturday New Year's Day back into December", () => {
    expect(isTradingDay("2027-12-31")).toBe(true);
  });
});

describe("nyseEarlyCloses and regularClose", () => {
  it("closes at 13:00 on July 3 and Christmas Eve when they're sessions, and the day after Thanksgiving", () => {
    expect([...nyseEarlyCloses(2025)].sort()).toEqual(["2025-07-03", "2025-11-28", "2025-12-24"]);
    // 2026: July 3 is the observed Independence Day, a holiday, so no early close then.
    expect([...nyseEarlyCloses(2026)].sort()).toEqual(["2026-11-27", "2026-12-24"]);
    // 2027: Christmas Eve is the observed Christmas; 2023: July 3 is a Monday.
    expect(nyseEarlyCloses(2027).has("2027-12-24")).toBe(false);
    expect(nyseEarlyCloses(2023).has("2023-07-03")).toBe(true);
  });

  it("gives each date's regular close, in minutes since midnight", () => {
    expect(regularClose("2026-11-27")).toBe(13 * 60);
    expect(regularClose("2026-11-30")).toBe(16 * 60);
  });
});

describe("isTradingDay", () => {
  it("is false on weekends and holidays, true on other weekdays", () => {
    expect(isTradingDay("2026-09-05")).toBe(false);
    expect(isTradingDay("2026-09-07")).toBe(false);
    expect(isTradingDay("2025-01-09")).toBe(false);
    expect(isTradingDay("2026-09-08")).toBe(true);
  });
});

describe("dates and the New York clock", () => {
  it("reads the weekday and minute in New York, not UTC", () => {
    const lateFriday = ny("2026-09-04 23:30");
    expect(nyWeekday(lateFriday)).toBe("Fri");
    expect(nyMinuteOfDay(lateFriday)).toBe(23 * 60 + 30);
  });

  it("moves dates by days across months, and names their weekday", () => {
    expect(addDays("2026-09-27", -89)).toBe("2026-06-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOfDate("2026-09-21")).toBe("Mon");
    expect(weekdayOfDate("2026-09-27")).toBe("Sun");
  });
});

describe("sessionsBetween", () => {
  it("counts trading days after the open date, up to and including the close date", () => {
    expect(sessionsBetween("2026-09-02", "2026-09-02")).toBe(0);
    expect(sessionsBetween("2026-09-02", "2026-09-03")).toBe(1);
    expect(sessionsBetween("2026-09-04", "2026-09-08")).toBe(1);
    expect(sessionsBetween("2026-09-14", "2026-09-16")).toBe(2);
  });
});

describe("holdBucket", () => {
  it.each([
    ["same day", ny("2026-09-08 07:45"), ny("2026-09-08 09:45")],
    ["overnight", ny("2026-09-02 15:45"), ny("2026-09-03 09:50")],
    ["overnight", ny("2026-09-02 15:45"), ny("2026-09-03 11:59")],
    ["1 full day", ny("2026-09-09 15:50"), ny("2026-09-10 12:00")],
    ["1 full day", ny("2026-09-09 15:54"), ny("2026-09-10 15:44")],
    ["weekend", ny("2026-09-11 15:50"), ny("2026-09-14 09:45")],
    ["weekend", ny("2026-09-04 15:30"), ny("2026-09-08 09:45")],
    ["overnight", ny("2026-11-25 15:50", "-05:00"), ny("2026-11-27 09:45", "-05:00")],
    ["longer", ny("2026-09-14 15:40"), ny("2026-09-16 10:00")],
  ])("calls %s a hold from %i to %i", (bucket, openedAt, closedAt) => {
    expect(holdBucket(openedAt, closedAt)).toBe(bucket);
  });

  it("is unknown when the close is before the open", () => {
    expect(holdBucket(ny("2026-09-03 09:50"), ny("2026-09-02 15:45"))).toBe("unknown");
  });
});

describe("nyWallClock", () => {
  it("reads a New York time in daylight time as UTC−4", () => {
    expect(nyWallClock("2026-09-09", 15 * 60 + 54)).toBe(Date.UTC(2026, 8, 9, 19, 54));
  });

  it.each([
    ["2026-03-06", 16 * 60, Date.UTC(2026, 2, 6, 21, 0)],
    ["2026-03-08", 12 * 60, Date.UTC(2026, 2, 8, 16, 0)],
    ["2026-03-09", 16 * 60, Date.UTC(2026, 2, 9, 20, 0)],
    ["2026-10-30", 16 * 60, Date.UTC(2026, 9, 30, 20, 0)],
    ["2026-11-01", 12 * 60, Date.UTC(2026, 10, 1, 17, 0)],
    ["2026-11-02", 16 * 60, Date.UTC(2026, 10, 2, 21, 0)],
  ])("gets the offset right around the clock changes: %s at minute %i", (date, minute, expected) => {
    expect(nyWallClock(date, minute)).toBe(expected);
  });
});

describe("sessionMoment", () => {
  it("keeps a time inside the session and drops its seconds", () => {
    expect(sessionMoment(Date.UTC(2026, 8, 9, 19, 54, 37))).toBe(Date.UTC(2026, 8, 9, 19, 54));
  });

  it("moves a time before the open to 09:31, when the first bar has closed", () => {
    expect(sessionMoment(ny("2026-08-05 07:45"))).toBe(ny("2026-08-05 09:31"));
  });

  it("moves a time after the close to 16:00 on the same New York date", () => {
    expect(sessionMoment(ny("2026-08-26 18:11"))).toBe(ny("2026-08-26 16:00"));
    // 23:30 ET is already the next day in UTC.
    expect(sessionMoment(ny("2026-09-09 23:30"))).toBe(ny("2026-09-09 16:00"));
  });

  it("uses 16:00 on a half day too, where the bars simply stop earlier", () => {
    expect(sessionMoment(ny("2026-11-27 17:30", "-05:00"))).toBe(ny("2026-11-27 16:00", "-05:00"));
  });
});

describe("expiryMoment", () => {
  it("puts expiry at 16:00 New York, in summer and in winter", () => {
    expect(expiryMoment("2026-09-11")).toBe(Date.UTC(2026, 8, 11, 20, 0));
    expect(expiryMoment("2026-12-18")).toBe(Date.UTC(2026, 11, 18, 21, 0));
  });
});

import { z } from "zod";

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Must be a real YYYY-MM-DD calendar date.");

const measurementWindowSchema = z.strictObject({
  start: calendarDateSchema,
  end: calendarDateSchema,
});

export const outcomeWindowsSchema = z
  .strictObject({
    baselineWindow: measurementWindowSchema,
    comparisonWindow: measurementWindowSchema,
  })
  .superRefine((windows, context) => {
    if (windows.baselineWindow.start > windows.baselineWindow.end) {
      context.addIssue({
        code: "custom",
        path: ["baselineWindow", "end"],
        message: "Baseline start must be on or before baseline end.",
      });
    }
    if (windows.comparisonWindow.start > windows.comparisonWindow.end) {
      context.addIssue({
        code: "custom",
        path: ["comparisonWindow", "end"],
        message: "Comparison start must be on or before comparison end.",
      });
    }
    if (windows.baselineWindow.end >= windows.comparisonWindow.start) {
      context.addIssue({
        code: "custom",
        path: ["comparisonWindow", "start"],
        message: "Comparison must start after the baseline ends.",
      });
    }
  });

export type OutcomeWindows = z.infer<typeof outcomeWindowsSchema>;

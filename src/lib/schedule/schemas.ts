import { z } from "zod";
import {
  assertTimeRange,
  isISODateString,
  isMondayISODate,
  timeToMinutes,
} from "@/lib/dates";

const uuid = z.string().uuid();
const isoDate = z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date");
const mondayISO = isoDate.refine(isMondayISODate, "Must be a Monday in ET");
const timeStr = z.string().refine((v) => !Number.isNaN(timeToMinutes(v)), "Must be HH:MM (15-min granular)");

const timeRangeRefine = (data: { startTime: string; endTime: string }, ctx: z.RefinementCtx) => {
  try {
    assertTimeRange(data.startTime, data.endTime);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: (e as Error).message,
      path: ["endTime"],
    });
  }
};

const partialTimeRefine = (
  data: { startTime?: string; endTime?: string },
  ctx: z.RefinementCtx,
) => {
  const both = data.startTime !== undefined && data.endTime !== undefined;
  const neither = data.startTime === undefined && data.endTime === undefined;
  if (!both && !neither) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startTime and endTime must be set together",
      path: ["startTime"],
    });
    return;
  }
  if (both) timeRangeRefine(data as { startTime: string; endTime: string }, ctx);
};

export const createShiftInputSchema = z
  .object({
    classId: uuid,
    employeeId: uuid,
    date: isoDate,
    startTime: timeStr,
    endTime: timeStr,
    sourceTemplateId: uuid.optional(),
  })
  .superRefine(timeRangeRefine);

export const updateShiftInputSchema = z
  .object({
    shiftId: uuid,
    employeeId: uuid.optional(),
    startTime: timeStr.optional(),
    endTime: timeStr.optional(),
  })
  .superRefine(partialTimeRefine);

export const deleteShiftInputSchema = z.object({ shiftId: uuid });

export const createShiftTemplateInputSchema = z
  .object({
    classId: uuid,
    employeeId: uuid,
    dayOfWeek: z.number().int().min(0).max(4),
    startTime: timeStr,
    endTime: timeStr,
    effectiveFromISO: mondayISO,
  })
  .superRefine(timeRangeRefine);

export const updateShiftTemplateInputSchema = z
  .object({
    templateId: uuid,
    employeeId: uuid.optional(),
    dayOfWeek: z.number().int().min(0).max(4).optional(),
    startTime: timeStr.optional(),
    endTime: timeStr.optional(),
  })
  .superRefine(partialTimeRefine);

export const deleteShiftTemplateInputSchema = z.object({ templateId: uuid });

export const moveShiftInputSchema = z
  .object({
    shiftId: uuid,
    date: isoDate,
    startTime: timeStr,
    endTime: timeStr,
  })
  .superRefine(timeRangeRefine);

export type CreateShiftInput = z.infer<typeof createShiftInputSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftInputSchema>;
export type DeleteShiftInput = z.infer<typeof deleteShiftInputSchema>;
export type CreateShiftTemplateInput = z.infer<typeof createShiftTemplateInputSchema>;
export type UpdateShiftTemplateInput = z.infer<typeof updateShiftTemplateInputSchema>;
export type DeleteShiftTemplateInput = z.infer<typeof deleteShiftTemplateInputSchema>;
export type MoveShiftInput = z.infer<typeof moveShiftInputSchema>;

import type { roleInClassEnum } from "@/db/schema";

type RoleInClass = (typeof roleInClassEnum.enumValues)[number];

export type ShiftSource = "template" | "override";
export type ScheduleMode = "template" | "week";

export type ResolvedShift = {
  date: string;            // 'YYYY-MM-DD', ET wall-clock
  employee_id: string;
  start_time: string;      // 'HH:MM' (15-min granular)
  end_time: string;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    role_in_class: RoleInClass;
  };
} & (
  | { source: "template"; template_id: string }
  | { source: "override"; shift_id: string; source_template_id: string | null }
);

export type ShiftLike = {
  id: string;
  classId: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type TemplateLike = {
  id: string;
  classId: string;
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type ShiftCandidate = {
  kind: "shift";
  classId: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type TemplateCandidate = {
  kind: "template";
  classId: string;
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFromISO: string;
};

export type ConflictContext = {
  crossClassShifts: ShiftLike[];
  crossClassTemplates: TemplateLike[];
  sameClassTemplates: TemplateLike[];
  excludeShiftId?: string;
  excludeTemplateId?: string;
};

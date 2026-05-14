export type ConflictReason =
  | {
      rule: "a";
      otherClassId: string;
      otherId: string;
      otherWindow: { start: string; end: string };
    }
  | {
      rule: "c";
      otherTemplateId: string;
      otherWindow: { start: string; end: string };
    }
  | { rule: "d"; otherId: string };

export type ActionError =
  | { code: "unauthorized"; message: string }
  | {
      code: "validation";
      message: string;
      fieldErrors?: Record<string, string[]>;
    }
  | { code: "conflict"; message: string; conflicts: ConflictReason[] }
  | { code: "not_found"; message: string }
  | { code: "already_linked"; message: string }
  | { code: "invite_pending"; message: string }
  | { code: "class_missing"; message: string }
  | { code: "internal"; message: string; details?: unknown };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

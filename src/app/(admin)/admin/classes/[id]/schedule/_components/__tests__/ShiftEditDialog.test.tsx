// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShiftEditDialog } from "../ShiftEditDialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const createShiftMock = vi.fn(async () => ({
  ok: true as const,
  data: { id: "x" },
}));
const createTemplateMock = vi.fn(async () => ({
  ok: true as const,
  data: { id: "x" },
}));
vi.mock("@/app/(admin)/admin/classes/[id]/actions", () => ({
  createShiftAction: (...args: unknown[]) => createShiftMock(...args),
  updateShiftAction: vi.fn(async () => ({
    ok: true as const,
    data: { id: "x" },
  })),
  deleteShiftAction: vi.fn(async () => ({
    ok: true as const,
    data: { id: "x" },
  })),
  createShiftTemplateAction: (...args: unknown[]) =>
    createTemplateMock(...args),
  updateShiftTemplateAction: vi.fn(async () => ({
    ok: true as const,
    data: { id: "x" },
  })),
  deleteShiftTemplateAction: vi.fn(async () => ({
    ok: true as const,
    data: { id: "x" },
  })),
}));

afterEach(() => cleanup());

describe("ShiftEditDialog", () => {
  it("submits createShiftAction with current input values for a new-shift target", async () => {
    render(
      <ShiftEditDialog
        classId="cls-1"
        mode="week"
        weekStartISO="2026-05-18"
        target={{
          kind: "new-shift",
          date: "2026-05-18",
          employeeId: "emp-1",
        }}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createShiftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "cls-1",
        employeeId: "emp-1",
        date: "2026-05-18",
      }),
    );
  });

  it("submits createShiftTemplateAction with effectiveFromISO = weekStartISO for new-template target", async () => {
    render(
      <ShiftEditDialog
        classId="cls-1"
        mode="template"
        weekStartISO="2026-05-18"
        target={{
          kind: "new-template",
          dayOfWeek: 0,
          employeeId: "emp-1",
          effectiveFromISO: "2026-05-18",
        }}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "cls-1",
        employeeId: "emp-1",
        dayOfWeek: 0,
        effectiveFromISO: "2026-05-18",
      }),
    );
  });
});

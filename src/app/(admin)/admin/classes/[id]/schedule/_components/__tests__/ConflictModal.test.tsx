// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictModal } from "../ConflictModal";

afterEach(() => cleanup());

describe("ConflictModal", () => {
  it("renders rule (a) with the opposing time window", () => {
    render(
      <ConflictModal
        conflicts={[
          {
            rule: "a",
            otherClassId: "00000000-0000-0000-0000-0000000000a1",
            otherId: "00000000-0000-0000-0000-0000000000a2",
            otherWindow: { start: "10:00", end: "13:00" },
          },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/cross-class/i)).toBeTruthy();
    expect(screen.getByText(/10:00–13:00/)).toBeTruthy();
  });

  it("renders rule (c) with the opposing template time window", () => {
    render(
      <ConflictModal
        conflicts={[
          {
            rule: "c",
            otherTemplateId: "00000000-0000-0000-0000-0000000000c1",
            otherWindow: { start: "10:00", end: "13:00" },
          },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/overlaps an existing template/i)).toBeTruthy();
  });

  it("renders rule (d) as identical-times language", () => {
    render(
      <ConflictModal
        conflicts={[
          { rule: "d", otherId: "00000000-0000-0000-0000-0000000000d1" },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/identical times/i)).toBeTruthy();
  });

  it("calls onClose on OK button click", async () => {
    const onClose = vi.fn();
    render(
      <ConflictModal conflicts={[{ rule: "d", otherId: "x" }]} onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /ok/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

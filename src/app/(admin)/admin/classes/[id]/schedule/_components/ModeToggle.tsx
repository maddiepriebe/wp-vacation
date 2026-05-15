"use client";

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: "week" | "template";
  onChange: (m: "week" | "template") => void;
}) {
  return (
    <select
      value={mode}
      onChange={(e) => onChange(e.target.value as "week" | "template")}
    >
      <option value="week">Week</option>
      <option value="template">Template</option>
    </select>
  );
}

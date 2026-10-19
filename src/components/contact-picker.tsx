"use client";

// STUB owned by the Recipients agent: replace with the full searchable picker, keeping this exact props contract.
export type ContactPickerProps = {
  value: string[];
  onChange: (next: string[]) => void;
  customer?: string;
  max?: number;
  label?: string;
  emptyHint?: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
};

export function ContactPicker({ value, id }: ContactPickerProps) {
  return <div id={id}>{value.join(", ") || "No one added yet"}</div>;
}

"use client";

import { DtSelect } from "@/components/dt/dt-select";
import type { DtOversightMember } from "@/lib/dt/oversight";

const ALL_VALUE = "__all__";

const ROLE_LABELS: Record<string, string> = {
  owner: "Inhaber",
  admin: "Admin",
  member: "Mitglied",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Mitglied";
}

export function DtChatPeopleFilter(props: {
  members: DtOversightMember[];
  selectedUserId: string | null;
  onChange: (userId: string | null) => void;
  compact?: boolean;
}) {
  if (props.members.length === 0) return null;

  const options = [
    {
      value: ALL_VALUE,
      label: "Alle Personen",
      description: `${props.members.length} ${props.members.length === 1 ? "Person" : "Personen"}`,
    },
    ...props.members.map((m) => ({
      value: m.id,
      label: m.label,
      description: roleLabel(m.role),
    })),
  ];

  return (
    <DtSelect
      className={props.compact ? "mt-2" : "mt-4"}
      label={props.compact ? undefined : "Person"}
      labelClassName="text-xs font-semibold normal-case tracking-normal text-sbkm-ink-500 dark:text-white/50"
      srLabel="Person filtern"
      size={props.compact ? "sm" : "default"}
      fullWidth
      menuMaxHeight="max-h-64"
      value={props.selectedUserId ?? ALL_VALUE}
      onValueChange={(value) =>
        props.onChange(value === ALL_VALUE ? null : value)
      }
      options={options}
    />
  );
}

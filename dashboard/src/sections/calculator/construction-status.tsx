import { CircleDashed, Hammer, CircleCheck } from 'lucide-react';

const statuses = {
  planned: { label: 'Planned', icon: CircleDashed, color: 'text-muted-foreground' },
  building: { label: 'In progress', icon: Hammer, color: 'text-amber-500' },
  built: { label: 'Built', icon: CircleCheck, color: 'text-emerald-500' },
};

/** Construction state with the same label and icon in cards and selectors. */
export function ConstructionStatus({ value }: { value: string }) {
  const status = statuses[value as keyof typeof statuses] ?? statuses.planned;
  const Icon = status.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={`size-3.5 shrink-0 ${status.color}`} />
      {status.label}
    </span>
  );
}

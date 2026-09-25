import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, Package, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PlannerCatalog } from '@/services/plannerApi';

/** App-styled selection for the planner's finite choices. */
export function ChoiceSelect({
  value,
  onChange,
  children,
  className,
  ...props
}: {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const options = Children.toArray(children).filter(
    isValidElement<{ value: string | number; children: ReactNode; disabled?: boolean }>
  );
  const placeholder = options.find((o) => o.props.value === '')?.props.children;
  return (
    <Select
      value={value === '' ? '__empty' : String(value)}
      onValueChange={(v) => onChange({ target: { value: v === '__empty' ? '' : v } })}
      disabled={props.disabled}
    >
      <SelectTrigger className={className ?? 'w-full'} aria-label={props['aria-label']}>
        <SelectValue placeholder={placeholder ?? 'Choose…'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem
            key={String(o.props.value)}
            value={o.props.value === '' ? '__empty' : String(o.props.value)}
            disabled={o.props.disabled}
          >
            {o.props.children}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Item artwork from the same game assets used by the rest of the app. */
export function MaterialIcon({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <Package className="size-8 shrink-0 text-muted-foreground" />
  ) : (
    <img
      className="size-8 shrink-0 object-contain"
      src={`/assets/images/satisfactory/64x64/${encodeURIComponent(name)}.png`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

/** Searchable material list with explicit selection and keyboard navigation. */
export function MaterialPicker({
  items,
  value,
  onChange,
}: {
  items: PlannerCatalog['items'];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Command
      className="overflow-hidden rounded-md border bg-popover text-popover-foreground"
      label="Materials"
      filter={(_value, search, keywords) =>
        (keywords ?? []).some((name) =>
          search
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .every((word) => name.toLowerCase().includes(word))
        )
          ? 1
          : 0
      }
    >
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Command.Input
          autoFocus
          aria-label="Search material"
          placeholder="Search material…"
          className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Command.List
        className="max-h-[min(300px,40dvh)] min-h-24 overflow-y-auto p-1"
        aria-label="Materials"
      >
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No materials found
        </Command.Empty>
        {items
          .filter((i) => !i.unavailable)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => (
            <Command.Item
              key={item.id}
              value={item.id}
              keywords={[item.name]}
              onSelect={() => onChange(item.id)}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <MaterialIcon name={item.name} />
              <span className="flex-1">{item.name}</span>
              {value === item.id && <Check className="size-4" />}
            </Command.Item>
          ))}
      </Command.List>
    </Command>
  );
}

/** A material picker presented as a compact field in the inspector. */
export function MaterialSelect({
  items,
  value,
  onChange,
  placeholder = 'Choose material…',
}: {
  items: PlannerCatalog['items'];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex min-h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm"
        aria-label={placeholder}
      >
        {items.find((i) => i.id === value)?.name ?? (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
        <MaterialPicker
          items={items}
          value={value}
          onChange={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

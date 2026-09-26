import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Package, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { PlannerCatalog } from '@/services/plannerApi';

/** App-styled selection for the planner's finite choices. */
export function ChoiceSelect({
  value,
  onChange,
  children,
  className,
  renderOption,
  ...props
}: {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  renderOption?: (value: string) => ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const options = Children.toArray(children).filter(
    isValidElement<{ value: string | number; children: ReactNode; disabled?: boolean }>
  );
  const placeholder = options.find((o) => o.props.value === '')?.props.children;
  const selected = options.find((o) => String(o.props.value) === String(value));
  return (
    <Select
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setActivated(true);
      }}
      value={value === '' ? '__empty' : String(value)}
      onValueChange={(v) => {
        const next = v === '__empty' ? '' : v;
        if (
          options.some(
            (o) =>
              !o.props.disabled && (o.props.value === '' ? '__empty' : String(o.props.value)) === v
          )
        )
          onChange({ target: { value: next } });
      }}
      disabled={props.disabled}
    >
      <SelectTrigger
        className={cn('w-full text-foreground enabled:hover:bg-accent', className)}
        aria-label={props['aria-label']}
        onFocus={() => setActivated(true)}
      >
        <SelectValue className="min-w-0 flex-1" placeholder={placeholder ?? 'Choose…'}>
          {selected &&
            (renderOption ? renderOption(String(selected.props.value)) : selected.props.children)}
        </SelectValue>
      </SelectTrigger>
      {activated && (
        <SelectContent>
          {options.map((o) => (
            <SelectItem
              key={String(o.props.value)}
              value={o.props.value === '' ? '__empty' : String(o.props.value)}
              disabled={o.props.disabled}
              className={
                renderOption ? '[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1' : undefined
              }
            >
              {renderOption ? renderOption(String(o.props.value)) : o.props.children}
            </SelectItem>
          ))}
        </SelectContent>
      )}
    </Select>
  );
}

/** Item artwork from the same game assets used by the rest of the app. */
export function MaterialIcon({ name, className }: { name: string; className?: string }) {
  const [failedName, setFailedName] = useState<string | null>(null);
  return failedName === name ? (
    <Package className={cn('size-8 shrink-0 text-muted-foreground', className)} />
  ) : (
    <img
      className={cn('size-8 shrink-0 object-contain', className)}
      src={`/assets/images/satisfactory/64x64/${encodeURIComponent(name)}.png`}
      alt=""
      onError={() => setFailedName(name)}
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
      <Command.List className="h-[min(300px,40dvh)] overflow-y-auto p-1" aria-label="Materials">
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

/** A material picker presented as a compact dropdown field. */
export function MaterialSelect({
  items,
  value,
  onChange,
  placeholder = 'Search material…',
  defaultOpen = false,
}: {
  items: PlannerCatalog['items'];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const selected = items.find((i) => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm"
        aria-label={placeholder}
      >
        {selected && (
          <MaterialIcon key={selected.id} name={selected.name} className="size-5 shrink-0" />
        )}
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
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

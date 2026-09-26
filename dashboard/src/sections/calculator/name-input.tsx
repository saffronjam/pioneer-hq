import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';

/** Keeps typing local and publishes name edits after a pause or when focus leaves. */
export function NameInput({
  value,
  onChange,
  onPendingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const commit = useRef(onChange);
  commit.current = onChange;
  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next !== null) commit.current(next);
    onPendingChange(false);
  };
  useEffect(() => {
    const input = container.current?.querySelector('input');
    if (input && pending.current === null && input.value !== value) input.value = value;
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div ref={container}>
      <Input
        defaultValue={value}
        onChange={(event) => {
          pending.current = event.target.value;
          onPendingChange(event.target.value !== value);
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 400);
        }}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            clearTimeout(timer.current);
            pending.current = null;
            onPendingChange(false);
            event.currentTarget.value = value;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

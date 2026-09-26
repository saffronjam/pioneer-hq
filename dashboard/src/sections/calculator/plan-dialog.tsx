import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { plannerApi, type PlannerDiagram } from '@/services/plannerApi';
import { newDocument } from './model';

/** Creates a blank, imported, or independently duplicated plan. */
export function PlanDialog({
  catalogVersion,
  sessionId,
  duplicate,
  close,
  created,
}: {
  catalogVersion: string;
  sessionId: string;
  duplicate?: PlannerDiagram;
  close: () => void;
  created: (id: string, keepOpen: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(
    duplicate ? `${duplicate.document.name.slice(0, 193)} (copy)` : ''
  );
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{
    state: 'idle' | 'processing' | 'success' | 'error';
    json?: string;
    filename?: string;
    error?: string;
  }>({ state: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusName = useRef(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    []
  );
  useEffect(() => {
    if (!saving && focusName.current) {
      focusName.current = false;
      form.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    }
  }, [saving]);
  const processing = upload.state === 'processing';
  const ready = !saving && !processing && upload.state !== 'error' && !!name.trim();
  const selectFile = async (file: File) => {
    const id = ++request.current;
    const started = performance.now();
    setUpload({ state: 'processing', filename: file.name });
    let json = '',
      importedName = '',
      error = '';
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Plan files must be smaller than 10 MB.');
      json = await file.text();
      try {
        JSON.parse(json);
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      importedName = (await plannerApi.validateImport(sessionId, json)).name;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not validate this plan file.';
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 500 - (performance.now() - started)))
    );
    if (request.current !== id) return;
    if (error) setUpload({ state: 'error', filename: file.name, error });
    else {
      setUpload({ state: 'success', filename: file.name, json });
      setName((value) => (value.trim() ? value : importedName));
    }
  };
  const create = async (keepOpen: boolean) => {
    if (!ready) return;
    setSaving(true);
    try {
      const d = duplicate
        ? await plannerApi.duplicate(sessionId, duplicate.id, name.trim())
        : upload.json
          ? await plannerApi.import(sessionId, name.trim(), upload.json)
          : await plannerApi.save(sessionId, '', 0, {
              ...newDocument(catalogVersion),
              name: name.trim(),
            });
      await created(d.id, keepOpen);
      if (keepOpen) {
        focusName.current = true;
        setName('');
        setUpload({ state: 'idle' });
      } else close();
    } catch (e) {
      console.error('Planner creation failed', e);
      toast.error(
        duplicate
          ? 'Could not duplicate the plan. Please try again.'
          : 'Could not create the plan. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-lg">
        <DialogTitle>{duplicate ? 'Duplicate plan' : 'Create plan'}</DialogTitle>
        <form
          ref={form}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create(false);
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              autoFocus
              aria-label="Plan name"
              placeholder="Plan name"
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
            {!duplicate && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Upload plan JSON"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void selectFile(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-32 shrink-0"
                  disabled={saving || processing}
                  aria-busy={processing}
                  onClick={() => fileInput.current?.click()}
                >
                  <span className="relative size-4 shrink-0" aria-hidden="true">
                    {(
                      [
                        ['idle', Upload],
                        ['processing', LoaderCircle],
                        ['success', Check],
                      ] as const
                    ).map(([state, Icon]) => (
                      <Icon
                        key={state}
                        className={`absolute inset-0 size-4 transition-[opacity,transform] duration-200 motion-reduce:transition-none ${upload.state === state || (state === 'idle' && upload.state === 'error') ? 'scale-100 opacity-100' : 'scale-75 opacity-0'} ${state === 'processing' && processing ? 'animate-spin motion-reduce:animate-none' : ''}`}
                      />
                    ))}
                  </span>
                  <span aria-live="polite">
                    {processing ? 'Checking…' : upload.state === 'success' ? 'Uploaded' : 'Upload'}
                  </span>
                </Button>
              </>
            )}
          </div>
          {upload.filename && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{upload.filename}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Remove uploaded plan"
                disabled={saving}
                onClick={() => {
                  request.current++;
                  setUpload({ state: 'idle' });
                }}
              >
                <X size={14} />
              </Button>
            </div>
          )}
          {upload.error && (
            <p role="alert" className="text-sm text-destructive">
              {upload.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={close}>
              Cancel
            </Button>
            {!duplicate && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!ready}
                onClick={() => void create(true)}
              >
                Create another
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!ready}>
              {saving
                ? duplicate
                  ? 'Duplicating…'
                  : 'Creating…'
                : duplicate
                  ? 'Duplicate'
                  : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';

export type ConfirmationRequest = {
  title: string;
  description: string;
  action: string;
  confirm: () => void | boolean | Promise<void | boolean>;
};

/** App-styled confirmation for destructive planner actions. */
export function PlannerConfirmation({
  request,
  close,
}: {
  request: ConfirmationRequest;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      if ((await request.confirm()) !== false) close();
    } catch (e) {
      console.error('Planner confirmation failed', e);
      toast.error('Could not complete the action. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>{request.description}</DialogDescription>
        <DialogFooter>
          <Button autoFocus variant="outline" size="sm" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void confirm()}>
            {request.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

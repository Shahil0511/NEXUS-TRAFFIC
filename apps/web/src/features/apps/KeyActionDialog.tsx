'use client';

import type { ApiKeyDto, AppDto } from '@nexus/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { InlineError } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { formatDateTime } from '@/lib/format';

import { expiresAtFor, type Grace } from './appForm';
import { useExpireKey, useRevokeKey } from './useAppMutations';

export type KeyAction = 'expire' | 'revoke';

/** The key an action targets, with its app. */
export interface KeyActionTarget {
  action: KeyAction;
  app: AppDto;
  key: ApiKeyDto;
}

const GRACE_OPTIONS: readonly SegmentedOption<Grace>[] = [
  { value: 'now', label: 'Now', ariaLabel: 'Expire now' },
  { value: '1h', label: '1 hour', ariaLabel: 'Expire in 1 hour' },
  { value: '24h', label: '24 hours', ariaLabel: 'Expire in 24 hours' },
  { value: '7d', label: '7 days', ariaLabel: 'Expire in 7 days' },
];

const DEFAULT_GRACE: Grace = '24h';

/** The destructive confirm button (the shared Button has no destructive variant). */
const DESTRUCTIVE_CLASS = 'bg-destructive text-white hover:bg-destructive/90 dark:text-background';

function KeyName({ keyDto }: { keyDto: ApiKeyDto }) {
  return (
    <span className="font-mono text-foreground">
      {keyDto.keyPrefix}… <span className="font-sans">({keyDto.label})</span>
    </span>
  );
}

/** Expire = the rotation step: the old key keeps working until the chosen time. */
function ExpireBody({ target, onDone }: { target: KeyActionTarget; onDone: () => void }) {
  const [grace, setGrace] = useState<Grace>(DEFAULT_GRACE);
  const expire = useExpireKey();
  const confirm = () => {
    const expiresAt = expiresAtFor(grace, Date.now());
    expire.mutate(
      { slug: target.app.slug, keyId: target.key.id, body: { expiresAt } },
      {
        onSuccess: () => {
          toast.success(`${target.key.keyPrefix}… expires ${formatDateTime(expiresAt)} IST`);
          onDone();
        },
      },
    );
  };
  return (
    <>
      <DialogDescription>
        <KeyName keyDto={target.key} /> keeps working during the grace period, then every request
        with it gets 401. Deploy the new key first.
      </DialogDescription>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Grace period</p>
        <SegmentedControl
          ariaLabel="Grace period"
          value={grace}
          options={GRACE_OPTIONS}
          onValueChange={setGrace}
        />
      </div>
      <InlineError error={expire.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={expire.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={confirm}
          disabled={expire.isPending}
          className={grace === 'now' ? DESTRUCTIVE_CLASS : undefined}
        >
          {expire.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Expire key
        </Button>
      </DialogFooter>
    </>
  );
}

/** Revoke = immediate and final (a leaked key). */
function RevokeBody({ target, onDone }: { target: KeyActionTarget; onDone: () => void }) {
  const revoke = useRevokeKey();
  const confirm = () =>
    revoke.mutate(
      { slug: target.app.slug, keyId: target.key.id },
      {
        onSuccess: () => {
          toast.success(`${target.key.keyPrefix}… revoked`);
          onDone();
        },
      },
    );
  return (
    <>
      <DialogDescription>
        <KeyName keyDto={target.key} /> stops working immediately — every request with it gets
        401. This cannot be undone. To rotate without downtime, expire it instead.
      </DialogDescription>
      <InlineError error={revoke.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={revoke.isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={confirm} disabled={revoke.isPending} className={DESTRUCTIVE_CLASS}>
          {revoke.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Revoke key
        </Button>
      </DialogFooter>
    </>
  );
}

export interface KeyActionDialogProps {
  target: KeyActionTarget | null;
  onClose: () => void;
}

/** WHY: the in-page confirmation of expire / revoke (admins) — NEVER `window.confirm`. */
export function KeyActionDialog({ target, onClose }: KeyActionDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {target ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {target.action === 'expire' ? 'Expire key' : 'Revoke key'} · {target.app.displayName}
              </DialogTitle>
            </DialogHeader>
            {target.action === 'expire' ? (
              <ExpireBody target={target} onDone={onClose} />
            ) : (
              <RevokeBody target={target} onDone={onClose} />
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

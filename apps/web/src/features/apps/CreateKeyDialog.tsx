'use client';

import { KEY_KIND_VALUES, type AppDto, type KeyCreatedDto, type KeyKind } from '@nexus/shared';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { CopyButton } from '@/components/CopyButton';
import { FormField } from '@/components/FormField';
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
import { Input } from '@/components/ui/input';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';

import { toCreateKeyBody, type FieldErrors, type KeyFormValues } from './appForm';
import { useCreateKey } from './useAppMutations';

const KIND_LABELS: Record<KeyKind, string> = { secret: 'Secret', publishable: 'Publishable' };

const KIND_OPTIONS: readonly SegmentedOption<KeyKind>[] = KEY_KIND_VALUES.map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}));

const KIND_HINTS: Record<KeyKind, string> = {
  secret: 'For the BACKEND (X-Nexus-Key header). Server env only — never in a browser bundle.',
  publishable: 'For the BROWSER tracker. Safe to ship in the bundle; only writes browser events.',
};

/** Where the team should put the key (guide chapter 01). */
const KIND_ENV: Record<KeyKind, string> = {
  secret: 'NEXUS_SECRET_KEY (server environment)',
  publishable: 'NEXT_PUBLIC_NEXUS_KEY / VITE_NEXUS_KEY (build time)',
};

export interface CreateKeyDialogProps {
  app: AppDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The ONE-TIME reveal of a new key. It lives only in this component's state: never logged,
 * stored, put in a URL or kept in the query cache; closing the dialog forgets it. The dialog only
 * closes through the explicit acknowledgement (no ✕, no Escape, no outside click).
 */
function KeyReveal({ created, onDone }: { created: KeyCreatedDto; onDone: () => void }) {
  const [copyFailed, setCopyFailed] = useState(false);
  const kind = created.key.kind;

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-lg bg-warning/8 p-3 text-xs ring-1 ring-warning/25 ring-inset">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="leading-relaxed">
          <strong className="font-semibold">Copy this key now — it will not be shown again.</strong>{' '}
          Hand it to the team over a secure channel; they store it as{' '}
          <span className="font-mono">{KIND_ENV[kind]}</span>.
        </p>
      </div>

      <FormField label={`${KIND_LABELS[kind]} key · ${created.key.label}`}>
        {(control) => (
          <div className="flex gap-2">
            <Input
              {...control}
              readOnly
              value={created.plaintextKey}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <CopyButton
              value={created.plaintextKey}
              label="key"
              showText
              onCopyResult={(ok) => setCopyFailed(!ok)}
            />
          </div>
        )}
      </FormField>
      {copyFailed ? (
        <p role="alert" className="text-2xs text-destructive">
          The browser blocked the clipboard — select the key and copy it manually.
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          I have stored the key
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Step 1: kind + label. */
function KeyForm({
  onCreated,
  onCancel,
  slug,
}: {
  slug: string;
  onCreated: (created: KeyCreatedDto) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<KeyFormValues>({ kind: 'secret', label: '' });
  const [errors, setErrors] = useState<FieldErrors<keyof KeyFormValues>>({});
  const createKey = useCreateKey();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = toCreateKeyBody(values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    createKey.mutate(
      { slug, body: result.body },
      {
        onSuccess: (created) => {
          onCreated(created);
          createKey.reset(); // drop the plaintext from the mutation state at once
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Kind</p>
        <SegmentedControl
          ariaLabel="Key kind"
          value={values.kind}
          options={KIND_OPTIONS}
          onValueChange={(kind) => setValues((current) => ({ ...current, kind }))}
        />
        <p className="text-2xs leading-relaxed text-muted-foreground">
          {KIND_HINTS[values.kind]}
        </p>
      </div>
      <FormField
        label="Label"
        error={errors.label}
        hint="Where it is used, e.g. “prod backend” or “rotation 2026-10”."
      >
        {(control) => (
          <Input
            {...control}
            value={values.label}
            onChange={(event) =>
              setValues((current) => ({ ...current, label: event.target.value }))
            }
            autoComplete="off"
            placeholder="prod backend"
          />
        )}
      </FormField>

      <InlineError error={createKey.error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={createKey.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createKey.isPending}>
          {createKey.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Create key
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * WHY: issue a key (admins) — step 1 picks kind + label, step 2 reveals the plaintext ONCE.
 * Rotation = create a new key here, deploy it, then expire the old one (guide chapter 01).
 */
export function CreateKeyDialog({ app, open, onOpenChange }: CreateKeyDialogProps) {
  const [created, setCreated] = useState<KeyCreatedDto | null>(null);
  const close = () => {
    setCreated(null);
    onOpenChange(false);
  };
  const revealing = created !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !revealing) close();
      }}
    >
      <DialogContent
        hideClose={revealing}
        onEscapeKeyDown={(event) => {
          if (revealing) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (revealing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{revealing ? 'Your new key' : `New key for ${app.displayName}`}</DialogTitle>
          <DialogDescription>
            {revealing
              ? 'Shown once. Nexus stores only a hash of it.'
              : 'An app can have several active keys, so rotation needs no downtime.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <KeyReveal created={created} onDone={close} />
        ) : open ? (
          <KeyForm slug={app.slug} onCreated={setCreated} onCancel={close} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

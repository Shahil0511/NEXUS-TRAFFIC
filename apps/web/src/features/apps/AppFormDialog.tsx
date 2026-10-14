'use client';

import { APP_SLUG_PATTERN, type AppDto } from '@nexus/shared';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import {
  appFormOf,
  emptyAppForm,
  toCreateAppBody,
  toUpdateAppBody,
  type AppFormField,
  type AppFormValues,
  type FieldErrors,
} from './appForm';
import { useCreateApp, useUpdateApp } from './useAppMutations';

export interface AppFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent → register a new app; present → edit it (the slug is immutable). */
  app?: AppDto;
}

/** A labelled on/off row. */
function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg p-3 ring-1 ring-border ring-inset">
      <span className="space-y-0.5">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-2xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

/** The form body; mounted fresh on every open, so it always starts from the app's current values. */
function AppForm({ app, onDone }: { app?: AppDto; onDone: () => void }) {
  const [values, setValues] = useState<AppFormValues>(() => (app ? appFormOf(app) : emptyAppForm()));
  const [errors, setErrors] = useState<FieldErrors<AppFormField>>({});
  const create = useCreateApp();
  const update = useUpdateApp();
  const mutation = app ? update : create;

  const set = <K extends AppFormField>(field: K, value: AppFormValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (app) {
      const result = toUpdateAppBody(values, app);
      if (!result.ok) return setErrors(result.errors);
      setErrors({});
      if (result.body === null) return onDone();
      update.mutate(
        { slug: app.slug, body: result.body },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.displayName} updated`);
            onDone();
          },
        },
      );
      return;
    }
    const result = toCreateAppBody(values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.body, {
      onSuccess: (created) => {
        toast.success(`${created.displayName} registered — issue its keys next`);
        onDone();
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Slug"
          error={errors.slug}
          hint={app ? 'The public app id; it cannot change.' : 'Lower-case, e.g. ebo-sales. Permanent.'}
        >
          {(control) => (
            <Input
              {...control}
              value={values.slug}
              onChange={(event) => set('slug', event.target.value.toLowerCase())}
              disabled={Boolean(app)}
              pattern={APP_SLUG_PATTERN.source}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="ebo-sales"
            />
          )}
        </FormField>
        <FormField label="Display name" error={errors.displayName}>
          {(control) => (
            <Input
              {...control}
              value={values.displayName}
              onChange={(event) => set('displayName', event.target.value)}
              placeholder="EBO Sales"
              autoComplete="off"
            />
          )}
        </FormField>
      </div>

      <FormField
        label="Base path"
        error={errors.basePath}
        hint="Public prefix of the app (e.g. /ebo-sales). Browser events outside it are refused. Leave empty for none."
      >
        {(control) => (
          <Input
            {...control}
            value={values.basePath}
            onChange={(event) => set('basePath', event.target.value)}
            placeholder="/ebo-sales"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>

      <FormField
        label="Allowed origins"
        error={errors.allowedOrigins}
        hint="Where browser beacons may come from — one origin per line, scheme + host [+ port], no path."
      >
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={values.allowedOrigins}
            onChange={(event) => set('allowedOrigins', event.target.value)}
            placeholder={'https://nexus.libas.in\nhttp://localhost:5173'}
            spellCheck={false}
          />
        )}
      </FormField>

      <div className="space-y-2">
        <SwitchRow
          label="Browser ingest"
          hint="Accept page views and tool clicks from the publishable key."
          checked={values.browserIngestEnabled}
          onCheckedChange={(checked) => set('browserIngestEnabled', checked)}
        />
        {app ? (
          <SwitchRow
            label="Active"
            hint="A disabled app's events are refused (APP_DISABLED); its data stays."
            checked={values.isActive}
            onCheckedChange={(checked) => set('isActive', checked)}
          />
        ) : null}
      </div>

      <InlineError error={mutation.error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {app ? 'Save changes' : 'Register app'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * WHY: register or edit an app (admins). Validated with the SAME shared zod schemas as the API
 * (./appForm.ts); the API audits every change and refreshes its key cache.
 */
export function AppFormDialog({ open, onOpenChange, app }: AppFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{app ? `Edit ${app.displayName}` : 'Register an app'}</DialogTitle>
          <DialogDescription>
            {app
              ? 'Changes apply to new events at once.'
              : 'Its team then gets a secret key (backend) and a publishable key (browser).'}
          </DialogDescription>
        </DialogHeader>
        {open ? <AppForm app={app} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

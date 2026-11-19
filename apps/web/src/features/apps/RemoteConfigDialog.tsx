'use client';

import {
  ERROR_CODES,
  SDK_CAPTURE_MODULE_VALUES,
  SDK_DEFAULTS,
  SDK_MODULE_SWITCH_MIN_VERSION,
  type AppDto,
  type SdkCaptureModule,
} from '@nexus/shared';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { InlineError } from '@/components/InlineError';
import { SwitchRow } from '@/components/SwitchRow';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/format';
import { guideHref } from '@/lib/guide';

import {
  SDK_MODULE_COPY,
  sdkConfigFormOf,
  toKillSwitchBody,
  toUpdateSdkConfigBody,
  type FieldErrors,
  type SdkConfigFormField,
  type SdkConfigFormValues,
} from './appForm';
import { useUpdateApp, useUpdateSdkConfig } from './useAppMutations';

/** How long a browser SDK keeps its cached config before asking again (the module-switch delay). */
const CONFIG_MAX_AGE_MINUTES = Math.round(SDK_DEFAULTS.browser.configMaxAgeMs / 60_000);

export interface RemoteConfigDialogProps {
  /** The app whose config is edited; null = closed. */
  app: AppDto | null;
  onClose: () => void;
}

/** One module of the checklist: checked = it keeps capturing. */
function ModuleCheckbox({
  module,
  checked,
  onCheckedChange,
}: {
  module: SdkCaptureModule;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const copy = SDK_MODULE_COPY[module];
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="space-y-0.5">
        <span className="block text-xs font-medium">{copy.label}</span>
        <span className="block text-2xs leading-relaxed text-muted-foreground">{copy.hint}</span>
      </span>
    </label>
  );
}

/** The form body; mounted fresh on every open, so it starts from the app's current config. */
function RemoteConfigForm({ app, onDone }: { app: AppDto; onDone: () => void }) {
  const [values, setValues] = useState<SdkConfigFormValues>(() => sdkConfigFormOf(app));
  const [errors, setErrors] = useState<FieldErrors<SdkConfigFormField>>({});
  const updateApp = useUpdateApp();
  const updateConfig = useUpdateSdkConfig();
  // The browserIngestEnabled the server holds as far as this dialog knows. The `app` prop is the
  // snapshot the dialog opened with, so after the kill switch landed and the module save failed,
  // a retry compares against THIS and does not send (and audit) the same switch again.
  const savedIngestEnabled = useRef(app.browserIngestEnabled);
  const pending = updateApp.isPending || updateConfig.isPending;

  const setModule = (module: SdkCaptureModule, enabled: boolean) =>
    setValues((current) => ({
      ...current,
      enabledModules: enabled
        ? SDK_CAPTURE_MODULE_VALUES.filter(
            (value) => value === module || current.enabledModules.includes(value),
          )
        : current.enabledModules.filter((value) => value !== module),
    }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const config = toUpdateSdkConfigBody(values, app);
    if (!config.ok) return setErrors(config.errors);
    setErrors({});
    const kill = toKillSwitchBody(values, {
      ...app,
      browserIngestEnabled: savedIngestEnabled.current,
    });
    if (config.body === null && kill === null) return onDone();
    updateApp.reset();
    updateConfig.reset();
    try {
      // The kill switch first: when an admin is stopping capture, that must land even if the
      // module list then conflicts with someone else's change.
      if (kill) {
        await updateApp.mutateAsync({ slug: app.slug, body: kill });
        savedIngestEnabled.current = kill.browserIngestEnabled ?? savedIngestEnabled.current;
      }
      if (config.body) await updateConfig.mutateAsync({ slug: app.slug, body: config.body });
      toast.success(`${app.displayName}: remote config saved`);
      onDone();
    } catch {
      // Shown in place by InlineError (a CONFLICT says someone else saved first).
    }
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      <SwitchRow
        label="Kill switch (browser capture)"
        hint={`On: every browser SDK of this app stops capturing (any version), and ingest refuses its beacons with ${ERROR_CODES.BROWSER_INGEST_DISABLED}. Server events are not affected.`}
        checked={values.killSwitch}
        onCheckedChange={(checked) => setValues((current) => ({ ...current, killSwitch: checked }))}
        tone={values.killSwitch ? 'destructive' : 'default'}
      />

      <fieldset disabled={values.killSwitch} className="space-y-1 disabled:opacity-60">
        <legend className="mb-1 text-xs font-semibold">Capture modules</legend>
        <p className="mb-2 text-2xs leading-relaxed text-muted-foreground">
          Unchecked modules are switched off remotely in SDK {SDK_MODULE_SWITCH_MIN_VERSION} and
          newer, within about {CONFIG_MAX_AGE_MINUTES} minutes. Remote config only switches modules
          off; it never turns on what the app’s code leaves off.
        </p>
        {SDK_CAPTURE_MODULE_VALUES.map((module) => (
          <ModuleCheckbox
            key={module}
            module={module}
            checked={values.enabledModules.includes(module)}
            onCheckedChange={(checked) => setModule(module, checked)}
          />
        ))}
        {errors.disabledModules ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.disabledModules}
          </p>
        ) : null}
      </fieldset>

      <InlineError error={updateApp.error ?? updateConfig.error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save config
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * WHY: switch browser capture off for one app without a deploy (ADR 0009) — the kill switch
 * (`browserIngestEnabled`, enforced at ingest for EVERY SDK version) and per-module switches
 * (honoured by SDK ≥ SDK_MODULE_SWITCH_MIN_VERSION). Saved with the version the admin saw, so two admins never overwrite
 * each other silently: a 409 CONFLICT is shown in place.
 */
export function RemoteConfigDialog({ app, onClose }: RemoteConfigDialogProps) {
  return (
    <Dialog
      open={app !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {app ? (
          <>
            <DialogHeader>
              <DialogTitle>Remote config · {app.displayName}</DialogTitle>
              <DialogDescription>
                Version {app.sdkConfig.version}
                {app.sdkConfig.updatedAt
                  ? `, changed ${formatDateTime(app.sdkConfig.updatedAt)} IST`
                  : ', never changed'}
                .{' '}
                <a
                  href={guideHref('browserContract')}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 font-medium text-link underline-offset-2 hover:underline"
                >
                  How the SDK applies it
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </a>
              </DialogDescription>
            </DialogHeader>
            <RemoteConfigForm app={app} onDone={onClose} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

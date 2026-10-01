/**
 * Progress of the start sequence (env → db → build → migrate → api → web), shown live on the
 * launcher page while `npm run dev` is still starting.
 */

export const STEP_IDS = ['env', 'db', 'build', 'migrate', 'api', 'web'] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = 'pending' | 'running' | 'ok' | 'warn' | 'failed' | 'skipped';

export interface StepInfo {
  id: StepId;
  label: string;
  state: StepState;
  note: string | null;
}

const LABELS: Record<StepId, string> = {
  env: 'Dev settings (.env.dev)',
  db: 'Dev database (Docker)',
  build: 'Build shared packages + guide',
  migrate: 'Database migrations',
  api: 'API server',
  web: 'Dashboard (Next.js)',
};

/** WHY a class: one mutable list shared by the orchestrator (writes) and /status (reads). */
export class StepTracker {
  private readonly steps = new Map<StepId, StepInfo>(
    STEP_IDS.map((id) => [id, { id, label: LABELS[id], state: 'pending', note: null }]),
  );

  set(id: StepId, state: StepState, note: string | null = null): void {
    this.steps.set(id, { id, label: LABELS[id], state, note });
  }

  list(): StepInfo[] {
    return STEP_IDS.map((id) => this.steps.get(id) as StepInfo);
  }
}

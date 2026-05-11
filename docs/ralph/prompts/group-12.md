# Group 12: Strength Tracker + Body Weight

## What You're Doing

Rebuild the Strength Tracker page (legacy: 403 lines) in `apps/dashboard/src/routes/strength-tracker.tsx`, including the **Body Weight** subtab. Follow the pattern Group 8 established for Garmin Health — server-computed summaries, Zod-validated search params, query factories, `@argo/charts` for charts. Forms use `@mantine/form` with `insertListItem` / `removeListItem` for dynamic sets and Zod resolver for validation. Saves/edits/deletes flow through `useMutation` + `invalidateQueries`.

Workouts are the **entry point** of the app for gym use — mobile UX matters more here than on Garmin Health. Form sits at the top on mobile; chart panel collapses below.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 772-780 (Group 9).
2. Group 8's prompt and the realized garmin-health page — match the structure.
3. Legacy page: `packages/dashboard/src/pages/strength-tracker/index.tsx`. Extract:
   - Form fields per workout / per set.
   - Validation rules (required, ranges).
   - The bodyweight subtab UI.
   - Mobile decisions (touch target sizes, defaulted values, autofocus order).
4. `docs/STRENGTH-ANALYTICS.md` (spec doc).
5. The summary + series endpoints you'll consume: `/workouts/summary/strength`, `/workouts/summary/series`, `/weight-log/summary`, `/weight-log/series` — confirm exact shapes from `apps/api/src/routes/workouts.ts` + `weight-log.ts` (post Group 6).
6. `@mantine/form` docs (esp. `insertListItem`, `removeListItem`, `zodResolver`): https://mantine.dev/form/use-form/, https://mantine.dev/form/nested/, https://mantine.dev/form/schema-validation/
7. `~/SourceRoot/dotfiles/rules/tanstack-router.md` + `tanstack-start.md` + `visx-charts.md`.
8. Visual reference: production deploy at `https://argo.jkrumm.com/strength-tracker`.

---

## What to Implement

### 1. Search params

```ts
const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).default('90d'),
  from:   z.string().optional(),
  to:     z.string().optional(),
  tab:    z.enum(['workouts', 'bodyweight']).default('workouts'),
});
```

### 2. Route

```ts
export const Route = createFileRoute('/strength-tracker')({
  validateSearch: zodValidator(SearchSchema),
  loaderDeps: ({ search }) => ({ window: search.window, from: search.from, to: search.to, tab: search.tab }),
  loader: ({ context, deps }) => {
    if (deps.tab === 'bodyweight') {
      return Promise.all([
        context.queryClient.ensureQueryData(weightLogQueries.summary(deps)),
        context.queryClient.ensureQueryData(weightLogQueries.series(deps)),
      ]);
    }
    return Promise.all([
      context.queryClient.ensureQueryData(workoutsQueries.summaryStrength(deps)),
      context.queryClient.ensureQueryData(workoutsQueries.summarySeries(deps)),
      context.queryClient.ensureQueryData(workoutsQueries.list({ page: 1, limit: 20 })),
      context.queryClient.ensureQueryData(exercisesQueries.list()),
    ]);
  },
  component: StrengthTracker,
});
```

### 3. Query factories

Create `apps/dashboard/src/lib/queries/workouts.ts`, `weight-log.ts`, `exercises.ts`. Follow Group 8's factory pattern. Add mutation hooks alongside:

```ts
// queries/workouts.ts
export const useCreateWorkout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkoutInput) => unwrap(api.workouts.post(body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: workoutsQueries.all() }),
  });
};
// same for useUpdateWorkout, useDeleteWorkout, useCreateWeightLog
```

### 4. Workouts subtab

**Top section — workout entry form (Mantine `@mantine/form`):**

```ts
const form = useForm({
  initialValues: {
    date: new Date().toISOString().slice(0, 10),
    exerciseId: undefined,
    notes: '',
    sets: [{ reps: 5, weightKg: 0, rpe: undefined }] as Set[],
  },
  validate: zodResolver(WorkoutInputSchema),
});
```

- Dynamic sets via `form.insertListItem('sets', emptySet)` / `form.removeListItem('sets', i)`.
- Exercise picker: Mantine `Select` populated from `exercisesQueries.list()`.
- Save button: `useCreateWorkout()`.
- Touch targets: `size="lg"` on Inputs; `inputMode="decimal"` on weight; `inputMode="numeric"` on reps.

**Summary cards** (use `summaryStrength.byExercise`): per-exercise `currentE1RM`, `bestE1RM`, `prDate`, `totalVolumeWindow`, `sessionCountWindow`.

**Charts** (use `summarySeries.byExercise[].points`): one chart kind per exercise selected (or a single chart with exercise filter). Compose via `@argo/charts` kinds. Trend zones / refLines as in legacy.

**Recent workouts table** (Mantine `Table`): `workoutsQueries.list({ page, limit })`. Edit / delete row actions trigger `useUpdateWorkout` / `useDeleteWorkout` via a modal (Mantine `ModalsProvider` + `modals.openConfirmModal`).

### 5. Body Weight subtab

Simpler layout: summary cards (current, ma7, ma30, trend, weeklyDelta, monthlyDelta), single chart (weight over time), entry form (date + weight).

Use `useCreateWeightLog()` mutation. Same touch-target discipline.

### 6. Mobile layout

`<Tabs.Panel value="workouts">` uses a single column on mobile, two columns (form left / charts right) at `lg` and above. Sticky top header with the "Add Workout" button on mobile.

### 7. Optimistic updates

Reasonable to apply optimistic mutations on weight-log inserts (single field, hard to go wrong). For workouts, prefer pessimistic — the form is non-trivial and an error mid-mutation would be confusing.

---

## Validation

```bash
bun install
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Manual end-to-end (with api + dashboard + Postgres running):
# 1. Visit /strength-tracker.
# 2. Add a workout with 3 sets — saves, appears in recent table.
# 3. Edit a set in an existing workout — saves.
# 4. Delete a workout — confirms modal, removes.
# 5. Switch to Body Weight tab.
# 6. Add a weight entry — appears in series chart.
# 7. Switch window 7d → 30d → 90d — charts redraw, summary cards update.
# 8. Mobile breakpoint (DevTools 375px) — form is usable one-handed.
# 9. Theme toggle propagates to charts without reload.
# 10. Summary card numbers match production for the same window.
```

---

## Commit

```
feat(dashboard): rebuild strength-tracker page incl. body weight subtab
```

If you needed to add fields to a summary endpoint, separate `feat(api): …` commit.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 12
```

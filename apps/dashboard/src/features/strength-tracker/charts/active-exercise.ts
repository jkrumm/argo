/** The lift the chart shows: the stored pick if it has points, else the first lift that does. The
 * API returns an entry per requested exercise even when its points are empty. */
export function pickActiveExercise<T extends { exercise_id: string; points: readonly unknown[] }>(
  byExercise: readonly T[] | undefined,
  selected: string,
): T | undefined {
  return (
    byExercise?.find((e) => e.exercise_id === selected && e.points.length > 0) ??
    byExercise?.find((e) => e.points.length > 0)
  )
}

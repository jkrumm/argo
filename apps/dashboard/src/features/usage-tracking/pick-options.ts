/** The options of a store field narrowed to the values a tab offers, labels kept (`field.options`). */
export function pickOptions<T extends string>(
  options: readonly { value: string; label: string }[],
  keep: readonly T[],
): { value: T; label: string }[] {
  return keep.flatMap((value) => {
    const option = options.find((o) => o.value === value)
    return option === undefined ? [] : [{ value, label: option.label }]
  })
}

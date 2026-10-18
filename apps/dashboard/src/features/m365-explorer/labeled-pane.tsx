import { Alert, ScrollArea } from '@mantine/core'
import { LABELED_FILTER, labelsByTag, type LabelLite } from './model'
import { SourceRow } from './source-row'
import classes from './m365.module.css'

export type LabeledPaneProps = {
  labels: readonly LabelLite[]
  /** `''`/`*` show every tag group; a tag shows only its group. */
  tag: string
  selectedId: string | null
  /** The source whose label is being removed right now. */
  removingId: string | null
  /** The last failed remove, shown above the groups. */
  error: string | null
  /** The pane's own title; omitted where a Section title above already names it. */
  title?: string | undefined
  onOpen: (label: LabelLite) => void
  onRemove: (sourceId: string) => void
}

/** The right pane's default: every labeled source, grouped by tag — the page's main surface, never a placeholder. */
export function LabeledPane(props: LabeledPaneProps) {
  const groups = labelsByTag(props.labels).filter(
    (g) => props.tag === '' || props.tag === LABELED_FILTER || g.tag === props.tag,
  )
  const header =
    props.title === undefined ? null : (
      <header className={classes.recordHeader} data-shot="labeled-header">
        <h2 className={classes.recordName}>{props.title}</h2>
      </header>
    )
  if (groups.length === 0) {
    return (
      <div data-shot="labeled-pane">
        {header}
        <p className={classes.empty}>
          No labeled sources — label a chat to include it in /m365/important
        </p>
      </div>
    )
  }
  return (
    <ScrollArea
      className={classes.paneScroll}
      classNames={{ scrollbar: classes.scrollbar }}
      type="auto"
      scrollbars="y"
      data-shot="labeled-pane"
    >
      {header}
      {props.error ? (
        <Alert color="red" variant="light" m="sm">
          {props.error}
        </Alert>
      ) : null}
      {groups.map((g) => (
        <section key={g.tag} aria-label={g.tag}>
          <h3 className={classes.groupHeading}>
            {g.tag} · {g.rows.length}
          </h3>
          {g.rows.map((l) => (
            <SourceRow
              key={l.sourceId}
              glyph={l.kind === 'chat' ? 'group' : 'channel'}
              name={l.displayName ?? l.sourceId}
              meta={l.kind === 'channel' ? 'team channel' : undefined}
              selected={props.selectedId === l.sourceId}
              onSelect={() => props.onOpen(l)}
              onRemove={() => props.onRemove(l.sourceId)}
              removing={props.removingId === l.sourceId}
            />
          ))}
        </section>
      ))}
    </ScrollArea>
  )
}

/**
 * DecisionCard — the title is the question, a `·`-separated facts line follows, optional evidence in
 * an inset panel and a context preview on the right. At most ONE primary (filled) and ONE secondary
 * (subtle) action are visible; every other verb lives in a single quiet menu. All actions are
 * optional, so a read-only or copy-only card is just a card without them.
 *
 * The interior shape (Keel's), top to bottom:
 *   1. question    — a short title (`QUESTION_MAX` chars); an ask that is not a question becomes a plain
 *                    question from the item's kind and state
 *   2. subject     — the raw title the question does not already say, under the question, never above it
 *   3. facts       — two or three `·`-separated facts (`capFacts`, `FACTS_MAX` = 3)
 *   4. evidenceLine — ONE line, the lead of the reason (+ an age/confidence where the source has one);
 *                    the whole ask sits behind `disclosure` only when the line had to shorten it
 *   5. actions     — one primary, one secondary, the rest in the menu
 *   6. preview     — context on the right. With a single line of history set `previewPlacement="inline"`: it
 *                    then sits under the facts as plain text, with no well and no box
 * `cardCopy` (lib/question-copy) derives 1, 2 + 4 from an ask; callers pass its `question`,
 * `evidenceLine` and `detail` (as `disclosure.content`). `evidence` (the inset) is the older,
 * heavier slot for multi-line evidence and still works unchanged. A long identifier in the question
 * breaks only at its joints; anything else unbreakable wraps at any character
 * (`overflow-wrap: anywhere`) rather than overflow.
 *
 * Prototype of the shared decision-card recipe (docs/design/UPSTREAM.md); props stay close to that row
 * so basalt-ui can promote it.
 */
import { ActionIcon, Box, Button, Card, Collapse, Group, Menu, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconDots } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { Fragment, useId, type ReactNode } from 'react'
import { NBSP } from '../../lib/format'
import { identifierRuns } from './identifier-runs'
import classes from './decision-card.module.css'
import { VX } from 'basalt-ui/tokens'
import {
  hasActions,
  isRenderable,
  isInactive,
  visibleFacts,
  type DecisionCardAction,
  type DecisionCardFact,
} from './decision-card-model'

export type { DecisionCardAction, DecisionCardFact } from './decision-card-model'

/** ` · ` with the dot glued to both neighbours, so a wrapped facts line never ends or starts on a bare `·`. */
const FACT_SEPARATOR = `${NBSP}·${NBSP}`

export type DecisionCardProps = {
  /** The headline, written as the question the owner answers. Wraps; never truncated. */
  question: string
  /** Rendered as one `·`-separated line under the question. */
  facts: readonly DecisionCardFact[]
  /** Leading chip or label before the facts (status, source). */
  status?: ReactNode
  /** The raw title under the question when the question does not already say it. */
  subject?: ReactNode
  /** Inset panel under the facts: the reasoning behind the question. */
  evidence?: ReactNode
  /** One plain line under the facts: the lead of the reasoning (no inset). Wraps, never cut. */
  evidenceLine?: string | null | undefined
  /** Right-hand context column (draft excerpt, from → to trend). Stacks below at narrow widths. */
  preview?: ReactNode
  primary?: DecisionCardAction | undefined
  secondary?: DecisionCardAction | undefined
  /** Every other verb, behind one quiet icon button. */
  menu?: readonly DecisionCardAction[] | undefined
  /** `well` (default) puts `preview` in the right-hand column; `inline` renders it as plain text under the facts (one line of history, no box). */
  previewPlacement?: 'well' | 'inline' | undefined
  /** A collapsed section revealed on demand, e.g. the full evidence at 390. */
  disclosure?: { label: string; content: ReactNode }
  /** Trailing meta line under the actions. */
  meta?: ReactNode
}

function ActionButton({
  action,
  variant,
}: {
  action: DecisionCardAction
  variant: 'filled' | 'subtle'
}) {
  return (
    <Button
      size="xs"
      variant={variant}
      {...(action.href === undefined
        ? { onClick: action.onClick }
        : { component: Link, to: action.href })}
      loading={action.loading ?? false}
      disabled={isInactive(action)}
      leftSection={action.icon}
    >
      {action.label}
    </Button>
  )
}

/** A long identifier: a break opportunity (`<wbr>`) between its parts, none inside them; copy sees the plain token. */
function BreakableRun({ parts }: { parts: readonly string[] }) {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ))
}

function ActionRow({
  question,
  primary,
  secondary,
  menu,
}: Pick<DecisionCardProps, 'question' | 'primary' | 'secondary' | 'menu'>) {
  if (!hasActions(primary, secondary, menu)) return null
  return (
    <Group gap="xs" wrap="wrap">
      {primary !== undefined && <ActionButton action={primary} variant="filled" />}
      {secondary !== undefined && <ActionButton action={secondary} variant="subtle" />}
      {menu !== undefined && menu.length > 0 && (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              aria-label={`More actions: ${question}`}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {menu.map((action) => (
              <Menu.Item
                key={action.key ?? action.label}
                leftSection={action.icon}
                disabled={isInactive(action)}
                {...(action.href === undefined
                  ? { onClick: action.onClick }
                  : { component: Link, to: action.href })}
              >
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}

function Disclosure({ label, content }: { label: string; content: ReactNode }) {
  const [opened, { toggle }] = useDisclosure(false)
  const contentId = useId()
  return (
    <Stack gap="xs">
      <Button
        variant="subtle"
        color="gray"
        size="compact-xs"
        onClick={toggle}
        rightSection={<IconChevronDown size={12} />}
        aria-expanded={opened}
        aria-controls={contentId}
        w="fit-content"
      >
        {label}
      </Button>
      <Collapse id={contentId} expanded={opened}>
        {content}
      </Collapse>
    </Stack>
  )
}

export function DecisionCard({
  question,
  facts,
  status,
  subject,
  evidence,
  evidenceLine,
  preview,
  previewPlacement = 'well',
  primary,
  secondary,
  menu,
  disclosure,
  meta,
}: DecisionCardProps) {
  const shown = visibleFacts(facts)
  return (
    <Card>
      <Group align="stretch" gap="md" wrap="wrap">
        <Stack gap="sm" flex="1 1 14rem" miw={0}>
          <Text component="h3" m={0} fw={600} size="md" lh={1.35} className={classes.question}>
            {/* Render-only: identifiers stay on one line; the copy model, rung and aria-label stay raw. */}
            {identifierRuns(question).map((run, index) =>
              run.kind === 'identifier' ? (
                <Box key={index} component="span" className={classes.identifier}>
                  {run.text}
                </Box>
              ) : run.kind === 'breakable' ? (
                <BreakableRun key={index} parts={run.parts} />
              ) : (
                <Fragment key={index}>{run.text}</Fragment>
              ),
            )}
          </Text>
          {isRenderable(subject) && (
            <Text size="xs" c="dimmed" className={classes.wrap}>
              {subject}
            </Text>
          )}
          {(isRenderable(status) || shown.length > 0) && (
            <Group gap="xs" wrap="nowrap" align="baseline">
              {isRenderable(status) && <Box className={classes.status}>{status}</Box>}
              {shown.length > 0 && (
                <Text size="xs" c="dimmed" miw={0} className={classes.wrap}>
                  {shown.map((fact, index) => (
                    <Fragment key={`${index}-${fact.text}`}>
                      {index > 0 ? FACT_SEPARATOR : null}
                      {fact.tone === undefined ? (
                        fact.text
                      ) : (
                        <Text span size="xs" c={VX.status[fact.tone]}>
                          {fact.text}
                        </Text>
                      )}
                    </Fragment>
                  ))}
                </Text>
              )}
            </Group>
          )}
          {isRenderable(evidenceLine) && (
            <Text size="sm" className={classes.wrap}>
              {evidenceLine}
            </Text>
          )}
          {previewPlacement === 'inline' && isRenderable(preview) && (
            <Box className={classes.wrap}>{preview}</Box>
          )}
          {isRenderable(evidence) && <Box className={classes.inset}>{evidence}</Box>}
          {disclosure !== undefined && <Disclosure {...disclosure} />}
          <Stack gap="sm" mt="auto">
            <ActionRow question={question} primary={primary} secondary={secondary} menu={menu} />
            {isRenderable(meta) && (
              <Text size="xs" c="dimmed">
                {meta}
              </Text>
            )}
          </Stack>
        </Stack>
        {previewPlacement === 'well' && isRenderable(preview) && (
          <Box className={classes.preview}>{preview}</Box>
        )}
      </Group>
    </Card>
  )
}

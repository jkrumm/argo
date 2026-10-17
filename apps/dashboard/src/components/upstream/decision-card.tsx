/**
 * DecisionCard — the title is the question, a `·`-separated facts line follows, optional evidence in
 * an inset panel and a context preview on the right. At most ONE primary (filled) and ONE secondary
 * (subtle) action are visible; every other verb lives in a single quiet menu. All actions are
 * optional, so a read-only or copy-only card is just a card without them.
 *
 * Prototype of the shared decision-card recipe (docs/design/UPSTREAM.md); props stay close to that row
 * so basalt-ui can promote it.
 */
import { ActionIcon, Box, Button, Card, Collapse, Group, Menu, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconDots } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import classes from './decision-card.module.css'
import { factsLine, hasActions, type DecisionCardAction } from './decision-card-model'

export type { DecisionCardAction } from './decision-card-model'

export type DecisionCardProps = {
  /** The headline, written as the question the owner answers. Wraps; never truncated. */
  question: string
  /** Rendered as one `·`-separated line under the question. */
  facts: readonly string[]
  /** Leading chip or label before the facts (status, source). */
  status?: ReactNode
  /** Actor / timing line above the question (who flagged it, when). */
  actor?: ReactNode
  /** Inset panel under the facts: the reasoning behind the question. */
  evidence?: ReactNode
  /** Right-hand context column (draft excerpt, from → to trend). Stacks below at narrow widths. */
  preview?: ReactNode
  primary?: DecisionCardAction | undefined
  secondary?: DecisionCardAction | undefined
  /** Every other verb, behind one quiet icon button. */
  menu?: readonly DecisionCardAction[] | undefined
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
      onClick={action.onClick}
      loading={action.loading ?? false}
      disabled={action.disabled ?? false}
      leftSection={action.icon}
    >
      {action.label}
    </Button>
  )
}

function ActionRow({
  primary,
  secondary,
  menu,
}: Pick<DecisionCardProps, 'primary' | 'secondary' | 'menu'>) {
  if (!hasActions(primary, secondary, menu)) return null
  return (
    <Group gap="xs" wrap="wrap">
      {primary !== undefined && <ActionButton action={primary} variant="filled" />}
      {secondary !== undefined && <ActionButton action={secondary} variant="subtle" />}
      {menu !== undefined && menu.length > 0 && (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="md" aria-label="More actions">
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {menu.map((action) => (
              <Menu.Item
                key={action.label}
                leftSection={action.icon}
                disabled={(action.disabled ?? false) || (action.loading ?? false)}
                onClick={action.onClick}
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
  return (
    <Stack gap="xs">
      <Button
        variant="subtle"
        color="gray"
        size="compact-xs"
        onClick={toggle}
        rightSection={<IconChevronDown size={12} />}
        aria-expanded={opened}
        w="fit-content"
      >
        {label}
      </Button>
      <Collapse expanded={opened}>{content}</Collapse>
    </Stack>
  )
}

export function DecisionCard({
  question,
  facts,
  status,
  actor,
  evidence,
  preview,
  primary,
  secondary,
  menu,
  disclosure,
  meta,
}: DecisionCardProps) {
  const line = factsLine(facts)
  return (
    <Card>
      <Group align="stretch" gap="md" wrap="wrap">
        <Stack gap="sm" flex="1 1 18rem" miw={0}>
          {actor !== undefined && (
            <Text size="xs" c="dimmed">
              {actor}
            </Text>
          )}
          <Text fw={600} size="md" lh="snug" className={classes.question}>
            {question}
          </Text>
          {(status !== undefined || line !== '') && (
            <Group gap="xs" wrap="wrap">
              {status}
              {line !== '' && (
                <Text size="xs" c="dimmed">
                  {line}
                </Text>
              )}
            </Group>
          )}
          {evidence !== undefined && <Box className={classes.inset}>{evidence}</Box>}
          {disclosure !== undefined && <Disclosure {...disclosure} />}
          <ActionRow primary={primary} secondary={secondary} menu={menu} />
          {meta !== undefined && (
            <Text size="xs" c="dimmed">
              {meta}
            </Text>
          )}
        </Stack>
        {preview !== undefined && <Box className={classes.preview}>{preview}</Box>}
      </Group>
    </Card>
  )
}

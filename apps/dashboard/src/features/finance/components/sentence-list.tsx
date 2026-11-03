import { Box, Group, Stack, Text } from '@mantine/core'
import { StatusVerdict } from 'basalt-ui'
import type { ReportSentence, Tone } from '../api/types'
import { toneColor } from '../lib/format'
import { EvidenceLink } from './evidence-link'

/** The word beside the dot: a tone is never colour alone. */
const TONE_WORD: Record<Tone, string> = {
  good: 'Good',
  warn: 'Watch',
  bad: 'Problem',
  neutral: 'Note',
}

/** The report: one row per sentence, its tone as dot and word, its evidence one click away. */
export function SentenceList({ sentences }: { sentences: readonly ReportSentence[] }) {
  return (
    <Stack gap="sm" component="ol" m={0} p={0} style={{ listStyle: 'none' }}>
      {sentences.map((s) => (
        <Box component="li" key={s.id}>
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <Box miw={72}>
              <StatusVerdict color={toneColor(s.tone)} word={TONE_WORD[s.tone]} />
            </Box>
            <Text size="sm" flex={1}>
              {s.text} <EvidenceLink link={s.link}>See evidence</EvidenceLink>
            </Text>
          </Group>
        </Box>
      ))}
    </Stack>
  )
}

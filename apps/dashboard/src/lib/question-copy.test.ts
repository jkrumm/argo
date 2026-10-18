import { describe, expect, it } from 'bun:test'
import {
  ENTITY_MAX,
  EVIDENCE_LINE_MAX,
  QUESTION_MAX,
  cardCopy,
  collidingCopies,
  isAlert,
  leadOf,
  plainQuestion,
  resolveCopies,
  wardenPlainQuestion,
} from './question-copy'

describe('leadOf', () => {
  it('returns text that fits whole', () => {
    expect(leadOf('  short   text ', 40)).toBe('short text')
  })
  it('cuts at a word boundary with an ellipsis', () => {
    const lead = leadOf('alpha beta gamma delta epsilon', 18)
    expect(lead).toBe('alpha beta gamma…')
  })
})

describe('cardCopy', () => {
  const longQuestion = `Should we ${'word '.repeat(QUESTION_MAX)}now?`

  it('uses the authored question verbatim, flattened', () => {
    const copy = cardCopy({
      authored: '  Merge   the {repo} fix? ',
      ask: 'Something else?',
      body: 'It touches the loop.',
      title: 'fix(loop): raw subject',
      plain: 'Merge {repo} PR?',
    })
    expect(copy).toMatchObject({
      question: 'Merge the {repo} fix?',
      source: 'authored',
      entity: 'fix(loop): raw subject',
    })
  })

  it('never cuts a long authored question into a fragment: it falls through, whole in the detail', () => {
    const copy = cardCopy({ authored: longQuestion, title: '{t}', plain: 'Merge {r} PR?' })
    expect(copy.source).toBe('plain')
    expect(copy.question).toBe('Merge {r} PR?')
    expect(copy.detail).toContain(longQuestion.replace(/\s+/g, ' '))
  })

  it('lets a long authored question fall to a fitting ask question', () => {
    expect(cardCopy({ authored: longQuestion, ask: 'Ship it?' }).question).toBe('Ship it?')
  })

  it('ignores a blank authored question', () => {
    expect(cardCopy({ authored: '   ', ask: 'Ship {thing}?', title: '{t}' }).source).toBe('ask')
  })

  it('takes the ask when it is a question that fits, evidence from the body', () => {
    expect(
      cardCopy({ ask: 'Ship {thing}?', body: 'It touches the loop.', title: '{title}' }),
    ).toEqual({
      question: 'Ship {thing}?',
      entity: '{title}',
      evidenceLine: 'It touches the loop.',
      detail: null,
      source: 'ask',
    })
  })

  it('does not take an ask that is a statement; it becomes the evidence', () => {
    const copy = cardCopy({
      ask: 'Deploy needs approval.',
      title: 'fix(loop): raw subject',
      plain: 'Merge {repo} PR?',
    })
    expect(copy).toMatchObject({
      question: 'Merge {repo} PR?',
      source: 'plain',
      evidenceLine: 'Deploy needs approval.',
      entity: 'fix(loop): raw subject',
    })
  })

  it('does not take an ask question past the limit', () => {
    const copy = cardCopy({ ask: longQuestion, title: '{t}', plain: 'Decide on {r} item?' })
    expect(copy.source).toBe('plain')
    expect(copy.evidenceLine).toBeNull()
    expect(copy.detail).toBe(longQuestion.replace(/\s+/g, ' '))
  })

  it('takes the title when it already is a question', () => {
    const copy = cardCopy({ ask: 'Fine.', title: 'Ship v2 now?', plain: 'Merge {r} PR?' })
    expect(copy).toMatchObject({ question: 'Ship v2 now?', source: 'title', entity: null })
  })

  it('never glues a verb onto a raw title', () => {
    for (const title of [
      'fix(dashboard): review round 1',
      'disk_usage_high',
      'Add retry to loop',
    ]) {
      const copy = cardCopy({ title, plain: 'Retry failed {r} run?' })
      expect(copy.question).toBe('Retry failed {r} run?')
      expect(copy.entity).toBe(title)
    }
  })

  it('keeps the raw title whole on the entity line', () => {
    const title = 'x'.repeat(ENTITY_MAX)
    expect(cardCopy({ title }).entity).toBe(title)
  })

  it('moves a title past the entity limit, whole, into the detail', () => {
    const title = `${'word '.repeat(ENTITY_MAX)}end`
    const copy = cardCopy({ title, body: 'Why.' })
    expect(copy.entity).toBeNull()
    expect(copy.detail).toBe(`${title.replace(/\s+/g, ' ')} Why.`)
  })

  it('has a question and no evidence for an empty item', () => {
    expect(cardCopy({})).toMatchObject({
      question: 'Decide on this item?',
      evidenceLine: null,
      detail: null,
      entity: null,
    })
  })

  it('shows the title as the entity unless the question already is it', () => {
    expect(cardCopy({ ask: 'Proceed?', title: '{t}' }).entity).toBe('{t}')
    expect(cardCopy({ ask: '{t}?', title: '{t}' }).entity).toBeNull()
  })
})

describe('evidence line', () => {
  it('is one line: statements only, never a second question', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Tests pass. Should we wait? CI is green.' })
    expect(copy.evidenceLine).toBe('Tests pass. CI is green.')
    expect(copy.detail).toBe('Tests pass. Should we wait? CI is green.')
  })

  it('is empty when the reason is only questions, with the whole text behind the detail', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Is it safe? Who knows?' })
    expect(copy.evidenceLine).toBeNull()
    expect(copy.detail).toBe('Is it safe? Who knows?')
  })

  it('never ends in a raw URL, and keeps the URL in the detail', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed, see https://example.com/runs/42',
    })
    expect(copy.evidenceLine).toBe('Checks failed,')
    expect(copy.detail).toBe('Checks failed, see https://example.com/runs/42')
  })

  it('cuts at a word boundary within the line limit', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'word '.repeat(EVIDENCE_LINE_MAX) })
    expect(copy.evidenceLine?.length).toBeLessThanOrEqual(EVIDENCE_LINE_MAX)
    expect(copy.evidenceLine?.endsWith('…')).toBe(true)
    expect(copy.detail).not.toBeNull()
  })

  it('has no detail when the line holds the whole text', () => {
    expect(cardCopy({ authored: 'Merge?', body: 'Short.' })).toMatchObject({
      evidenceLine: 'Short.',
      detail: null,
    })
  })
})

describe('plainQuestion', () => {
  it('is `<verb> <object>?`', () => {
    expect(plainQuestion('Merge', '{repo}  PR')).toBe('Merge {repo} PR?')
  })
  it('is bounded and keeps its question mark', () => {
    const q = plainQuestion('Retry', 'x'.repeat(200))
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.endsWith('?')).toBe(true)
  })
  it('is never empty', () => {
    expect(plainQuestion('', '')).toBe('Decide on this item?')
    expect(cardCopy({ plain: '  ' }).question).toBe('Decide on this item?')
  })
  it('bounds a caller-built plain question too', () => {
    const q = cardCopy({ plain: `Merge ${'x'.repeat(200)}?` }).question
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.endsWith('?')).toBe(true)
  })
})

describe('wardenPlainQuestion', () => {
  const ask = (
    primary: Parameters<typeof wardenPlainQuestion>[0]['primary'],
    failed = false,
    repo: string | null = '{r}',
  ) => wardenPlainQuestion({ failed, repo, primary })
  it('names the verb the card offers first', () => {
    expect(ask('merge')).toBe('Merge {r} PR?')
    expect(ask('implement')).toBe('Implement {r} change?')
    expect(ask('reinvestigate')).toBe('Re-investigate {r} item?')
    expect(ask('merge', false, null)).toBe('Merge this PR?')
  })
  it('says Retry failed run only for a failed item whose primary is retry', () => {
    expect(ask('retry', true)).toBe('Retry failed {r} run?')
    expect(ask('retry', true, null)).toBe('Retry failed run?')
    expect(ask('retry', false)).toBe('Retry {r} item?')
  })
  it('is neutral when the primary is not a verb that names a question', () => {
    expect(ask('dismiss', true)).toBe('Decide on {r} item?')
    expect(ask('merge', true)).toBe('Merge {r} PR?')
    expect(ask(null, true, null)).toBe('Decide on this item?')
  })
})

describe('evidence urls', () => {
  it('removes a bracketed URL whole, leaving no dangling bracket', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed (see https://example.com/runs/42).',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })
  it('closes a bracket the URL removal left open', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Checks failed (at https://example.com/x' })
    expect(copy.evidenceLine).toBe('Checks failed ()')
  })
})

describe('round 2 rules', () => {
  it('closes a square bracket the URL removal left open', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Checks failed [at https://example.com/x' })
    expect(copy.evidenceLine).toBe('Checks failed []')
  })
  it('removes a square-bracketed URL whole', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed [see https://example.com/x].',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })
  it('always ends a plain question in `?`', () => {
    expect(cardCopy({ plain: 'Merge the PR' }).question).toBe('Merge the PR?')
    expect(cardCopy({ plain: 'Merge the PR???' }).question).toBe('Merge the PR?')
  })
  it('keeps question-only evidence when asked to', () => {
    const body = 'Which branch should I use?'
    expect(cardCopy({ authored: 'Pick?', body }).evidenceLine).toBeNull()
    expect(cardCopy({ authored: 'Pick?', body, keepQuestionEvidence: true }).evidenceLine).toBe(
      body,
    )
  })
})

describe('plain rung: handles that tell items apart', () => {
  const plain = wardenPlainQuestion({ failed: false, repo: 'project-a', primary: 'implement' })
  const resolve = (titles: readonly string[]) =>
    resolveCopies(titles, {
      key: (title) => title,
      derive: (title, { handle }) => ({
        copy: cardCopy({
          title,
          plain,
          handle: handle === null ? null : { source: title, ...handle },
        }),
      }),
    }).map((r) => r.copy)

  it('keeps the short form for a lone item', () => {
    const [copy] = resolve(['Disk filling up'])
    expect(copy!.question).toBe('Implement project-a change?')
    expect(copy!.entity).toBe('Disk filling up')
  })

  it('gives two same-repo items different titles and drops the entity line', () => {
    const copies = resolve(['Disk filling up — host a', 'Certificate expires soon'])
    expect(copies[0]!.question).toBe('Implement project-a change: Disk filling up?')
    expect(copies[1]!.question).toBe('Implement project-a change: Certificate expires soon?')
    expect(copies.map((c) => c.entity)).toEqual([null, null])
    // The cut title stays whole behind the disclosure; the fully said one needs no repeat.
    expect(copies[0]!.detail).toBe('Disk filling up — host a')
    expect(copies[1]!.detail).toBeNull()
  })

  it('takes the next clause when the first clause is shared', () => {
    const copies = resolve(['Disk full — host a', 'Disk full — host b'])
    expect(copies.map((c) => c.question)).toEqual([
      'Implement project-a change: Disk full — host a?',
      'Implement project-a change: Disk full — host b?',
    ])
  })

  it('falls back to an ordinal, in key order, for identical titles', () => {
    const copies = resolve(['Disk full', 'Disk full', 'Disk full'])
    expect(copies.map((c) => c.question)).toEqual([
      'Implement project-a change: Disk full (1)?',
      'Implement project-a change: Disk full (2)?',
      'Implement project-a change: Disk full (3)?',
    ])
  })

  it('re-checks after the handled pass: a handle that collides with another card is not enough', () => {
    const copies = resolve(['Disk full', 'Disk full — host a', 'Disk full — host b'])
    expect(new Set(copies.map((c) => c.question)).size).toBe(3)
  })

  it('numbers an item with no usable title text, never leaving the clash', () => {
    const copies = resolve(['…', '…'])
    expect(copies.map((c) => c.question)).toEqual([
      'Implement project-a change (1)?',
      'Implement project-a change (2)?',
    ])
  })

  it('leaves an authored question alone even when two cards share it', () => {
    const copies = resolveCopies(['a', 'b'], {
      key: (t) => t,
      derive: (t, { handle }) => ({
        copy: cardCopy({
          authored: 'Ship it?',
          title: t,
          plain,
          handle: handle === null ? null : { source: t, ...handle },
        }),
      }),
    }).map((r) => r.copy)
    expect(collidingCopies(copies)).toEqual([false, false])
    expect(copies.map((c) => c.question)).toEqual(['Ship it?', 'Ship it?'])
  })

  it('never cuts a handle: one that does not fit whole gives way to the ordinal', () => {
    const long = `Replication lag ${'on the standby node '.repeat(12)}is growing`
    const [only] = resolve([long])
    expect(only!.question).toBe('Implement project-a change?')
    // Two cards sharing the same long opening: no whole handle fits, so the ordinal tells them apart.
    const copies = resolve([long, `${long} again`])
    expect(copies.map((c) => c.question)).toEqual([
      'Implement project-a change (1)?',
      'Implement project-a change (2)?',
    ])
    for (const copy of copies) expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
  })

  it('uses no handle when not even the first word fits, then numbers the clash', () => {
    const word = 'x'.repeat(90)
    const copies = resolve([word, `${word}y`])
    expect(copies.map((c) => c.question)).toEqual([
      'Implement project-a change (1)?',
      'Implement project-a change (2)?',
    ])
  })

  it('drops the handle when the stem leaves no room for it', () => {
    const stem = 'Unblock '.concat('x'.repeat(QUESTION_MAX - 12), ' agent')
    const copy = cardCopy({
      title: 'Some title',
      plain: stem,
      handle: { source: 'Some title', clauses: 1, ordinal: null },
    })
    expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(copy.question.endsWith('?')).toBe(true)
    expect(copy.entity).toBe('Some title')
  })
})

describe('ordinals are distinct on the whole surface', () => {
  const plain = 'Implement project-a change'
  const resolve = (titles: readonly string[], keys?: readonly string[]) =>
    resolveCopies(
      titles.map((title, i) => ({ title, key: keys?.[i] ?? `k${i}` })),
      {
        key: (item) => item.key,
        derive: ({ title }, { handle }) => ({
          copy: cardCopy({
            title,
            plain,
            handle: handle === null ? null : { source: title, ...handle },
          }),
        }),
      },
    ).map((r) => r.copy.question)

  it('skips an ordinal another card already reads', () => {
    const questions = resolve(['Disk full', 'Disk full', 'Disk full (1)'])
    expect(new Set(questions).size).toBe(3)
    expect(questions).toContain('Implement project-a change: Disk full (1)?')
  })

  it('keeps three or more identical items stable whatever order they arrive in', () => {
    const keys = ['c', 'a', 'b']
    const forward = resolve(['Same', 'Same', 'Same'], keys)
    const reversed = resolve(['Same', 'Same', 'Same'], [...keys].reverse()).toReversed()
    expect(forward).toEqual(reversed)
    expect(new Set(forward).size).toBe(3)
    // Ordinals follow the key, not the position.
    expect(forward[1]).toBe('Implement project-a change: Same (1)?')
  })

  it('keeps the ordinal when the stem fills the question', () => {
    const stem = `Implement ${'x'.repeat(QUESTION_MAX - 24)} change`
    const questions = resolveCopies(['Same', 'Same'], {
      key: (t, i = 0) => `${t}${i}`,
      derive: (t, { handle }) => ({
        copy: cardCopy({
          title: t,
          plain: stem,
          handle: handle === null ? null : { source: t, ...handle },
        }),
      }),
    }).map((r) => r.copy.question)
    for (const q of questions) {
      expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
      expect(q).toMatch(/\(\d\)\?$/)
    }
  })
})

describe('alerts are asked about, never framed as a change', () => {
  const ask = (primary: Parameters<typeof wardenPlainQuestion>[0]['primary']) =>
    wardenPlainQuestion({ failed: false, repo: 'project-a', primary, alert: true })

  it('names the verb the card carries, for every primary', () => {
    expect(ask('implement')).toBe('Implement fix for project-a alert?')
    expect(ask('reinvestigate')).toBe('Re-investigate project-a alert?')
    expect(ask('retry')).toBe('Retry project-a alert?')
    expect(ask('merge')).toBe('Merge fix for project-a alert?')
    expect(ask('dismiss')).toBe('Dismiss project-a alert?')
    expect(ask('note')).toBe('Add a note to project-a alert?')
    expect(ask('implement')).not.toMatch(/change|handle/i)
  })

  it('is neutral when the card carries no verb', () => {
    expect(ask(null)).toBe('Decide on project-a alert?')
    expect(wardenPlainQuestion({ failed: false, repo: null, primary: null, alert: true })).toBe(
      'Decide on this alert?',
    )
  })

  it('carries the alert handle once two alerts collide', () => {
    const alertPlain = ask('implement')
    const copies = resolveCopies(['Service A down', 'Service B down'], {
      key: (t) => t,
      derive: (t, { handle }) => ({
        copy: cardCopy({
          title: t,
          plain: alertPlain,
          handle: handle === null ? null : { source: t, ...handle },
        }),
      }),
    }).map((r) => r.copy)
    expect(copies.map((c) => c.question)).toEqual([
      'Implement fix for project-a alert: Service A down?',
      'Implement fix for project-a alert: Service B down?',
    ])
  })
})

describe('isAlert', () => {
  it('prefers the explicit kind field over the title', () => {
    expect(isAlert({ kinds: ['alert'], title: 'Disk full' })).toBe(true)
    expect(isAlert({ kinds: [null, 'incident'], title: 'x' })).toBe(true)
    expect(isAlert({ kinds: ['github_issue'], title: 'Alert: disk full' })).toBe(false)
  })
  it('reads a title only as a leading kind, and only with no field at all', () => {
    expect(isAlert({ title: 'Alert: disk full' })).toBe(true)
    expect(isAlert({ title: ':fire: Outage — api down' })).toBe(true)
    expect(isAlert({ title: 'Add incident-response runbook' })).toBe(false)
    expect(isAlert({ title: 'Incident-response runbook' })).toBe(false)
    expect(isAlert({ title: 'Incident - api down' })).toBe(true)
    expect(isAlert({ title: 'Reduce alert noise' })).toBe(false)
    expect(isAlert({ kinds: [42, {}], title: 7 })).toBe(false)
  })
  it('reads the producer bracket tag in any case, ahead of the kind field', () => {
    expect(isAlert({ title: '[alert] {key} disk full' })).toBe(true)
    expect(isAlert({ title: '[ALERT] {key}' })).toBe(true)
    expect(isAlert({ title: ' [Alert] {key}' })).toBe(true)
    expect(isAlert({ kinds: ['job'], title: '[alert] {key}' })).toBe(true)
    expect(isAlert({ kinds: ['alert'], title: 'no tag' })).toBe(true)
    expect(isAlert({ title: '[alerting] rules' })).toBe(false)
    expect(isAlert({ title: 'Fix [alert] rules' })).toBe(false)
  })
})

describe('handles are whole', () => {
  const surface = (titles: string[], plain = 'Implement fix for {r} alert?', terseStem = false) =>
    resolveCopies(titles, {
      key: (t) => t,
      terseStem,
      derive: (t, { handle }) => ({
        copy: cardCopy({
          title: t,
          plain,
          handle: handle === null ? null : { source: t, ...handle },
        }),
      }),
    }).map((r) => r.copy.question)

  it('drops the leading bracket tag and never leaves a bracket open', () => {
    const q = surface(['[alert] {key-a} disk full', '[alert] {key-b} disk full'])
    expect(q).toEqual([
      'Implement fix for {r} alert: {key-a} disk full?',
      'Implement fix for {r} alert: {key-b} disk full?',
    ])
  })

  it('never cuts a token or ends in an ellipsis before the question mark', () => {
    const long = (k: string) => `[alert] ${k} ${'overloaded '.repeat(12)}`.trim()
    for (const q of surface([long('{key-a}'), long('{key-b}')])) {
      expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
      expect(q).not.toMatch(/…\?$/)
      expect(q).not.toMatch(/[([][^)\]]*\?$/)
    }
  })

  it('falls back to an ordinal when no whole handle fits', () => {
    const huge = `${'x'.repeat(90)}`
    const q = surface([huge, huge])
    expect(q).toEqual(['Implement fix for {r} alert (1)?', 'Implement fix for {r} alert (2)?'])
  })

  it('does not repeat the handle in the evidence line', () => {
    const copy = cardCopy({
      body: 'Service down after deploy. Check the logs.',
      title: 'Service down after deploy',
      plain: 'Unblock {r} agent?',
      handle: { source: 'Service down after deploy', clauses: 1, ordinal: null },
    })
    expect(copy.question).toBe('Unblock {r} agent: Service down after deploy?')
    expect(copy.evidenceLine).toBe('Check the logs.')
  })

  it('keeps only the verb when one stem heads every card', () => {
    expect(surface(['Disk full', 'Queue deep'], 'Answer this request?', true)).toEqual([
      'Answer: Disk full?',
      'Answer: Queue deep?',
    ])
    expect(surface(['Disk full', 'Queue deep'], 'Answer this request?')).toEqual([
      'Answer this request: Disk full?',
      'Answer this request: Queue deep?',
    ])
  })
})

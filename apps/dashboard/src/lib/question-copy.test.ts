import { describe, expect, it } from 'bun:test'
import {
  ENTITY_MAX,
  EVIDENCE_LINE_MAX,
  QUESTION_MAX,
  cardCopy,
  collidingCopies,
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
    expect(ask('reinvestigate')).toBe('Reinvestigate {r} item?')
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
  const plain = wardenPlainQuestion({ failed: false, repo: 'api', primary: 'implement' })
  const derive = (title: string) => (_: string, withHandle: boolean) =>
    cardCopy({ title, plain, handle: withHandle ? title : null })

  it('keeps the short form for a lone item', () => {
    const [copy] = resolveCopies(['Disk filling up'], (t, h) => derive(t)(t, h))
    expect(copy!.question).toBe('Implement api change?')
    expect(copy!.entity).toBe('Disk filling up')
  })

  it('gives two same-repo items different titles and drops the entity line', () => {
    const titles = ['Disk filling up — host a', 'Certificate expires soon']
    const copies = resolveCopies(titles, (t, h) => derive(t)(t, h))
    expect(copies[0]!.question).toBe('Implement api change: Disk filling up?')
    expect(copies[1]!.question).toBe('Implement api change: Certificate expires soon?')
    expect(copies.map((c) => c.entity)).toEqual([null, null])
    // The cut title stays whole behind the disclosure; the fully said one needs no repeat.
    expect(copies[0]!.detail).toBe('Disk filling up — host a')
    expect(copies[1]!.detail).toBeNull()
  })

  it('leaves an authored question alone even when two cards share it', () => {
    const copies = resolveCopies(['a', 'b'], (t, h) =>
      cardCopy({ authored: 'Ship it?', title: t, plain, handle: h ? t : null }),
    )
    expect(collidingCopies(copies)).toEqual([false, false])
    expect(copies.map((c) => c.question)).toEqual(['Ship it?', 'Ship it?'])
  })

  it('never ends mid-word, never loses its ?, never exceeds QUESTION_MAX', () => {
    const long = `Replication lag ${'on the standby node '.repeat(12)}is growing`
    const lead = (title: string) =>
      resolveCopies([long, title], (t, h) => cardCopy({ title: t, plain, handle: h ? t : null }))
    for (const copy of [...lead(long), ...lead(`${long} again`)]) {
      expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
      expect(copy.question.endsWith('?')).toBe(true)
      expect(copy.question).toMatch(/\b[\w}]*…?\?$/)
      expect(copy.question).not.toMatch(/\s\w{1,2}…\?$/)
    }
    const [first] = lead(long)
    expect(
      first!.question
        .replace(/…?\?$/, '')
        .split(' ')
        .pop(),
    ).toBe('node')
  })

  it('drops the handle when the stem leaves no room for it', () => {
    const stem = 'Unblock '.concat('x'.repeat(QUESTION_MAX - 12), ' agent')
    const copy = cardCopy({ title: 'Some title', plain: stem, handle: 'Some title' })
    expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(copy.question.endsWith('?')).toBe(true)
    expect(copy.entity).toBe('Some title')
  })
})

describe('alerts are asked about, never framed as a change', () => {
  it('asks to handle an alert whose card offers implement', () => {
    const q = wardenPlainQuestion({ failed: false, repo: 'api', primary: 'implement', alert: true })
    expect(q).toBe('Handle api alert?')
    expect(q).not.toMatch(/implement|change/i)
  })
  it('asks to acknowledge an alert whose card offers no handling verb', () => {
    expect(wardenPlainQuestion({ failed: false, repo: null, primary: null, alert: true })).toBe(
      'Acknowledge this alert?',
    )
  })
  it('matches the verb to the primary action', () => {
    expect(wardenPlainQuestion({ failed: true, repo: 'api', primary: 'retry', alert: true })).toBe(
      'Retry api alert?',
    )
    expect(
      wardenPlainQuestion({ failed: false, repo: 'api', primary: 'reinvestigate', alert: true }),
    ).toBe('Reinvestigate api alert?')
  })
  it('keeps a merge a merge', () => {
    expect(wardenPlainQuestion({ failed: false, repo: 'api', primary: 'merge', alert: true })).toBe(
      'Merge api PR?',
    )
  })
  it('carries the alert handle once two alerts collide', () => {
    const plain = wardenPlainQuestion({
      failed: false,
      repo: 'api',
      primary: 'implement',
      alert: true,
    })
    const copies = resolveCopies(['Service A down', 'Service B down'], (t, h) =>
      cardCopy({ title: t, plain, handle: h ? t : null }),
    )
    expect(copies.map((c) => c.question)).toEqual([
      'Handle api alert: Service A down?',
      'Handle api alert: Service B down?',
    ])
  })
})

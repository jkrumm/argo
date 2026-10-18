import { describe, expect, it } from 'bun:test'
import { deriveDecisions } from './decisions'
import { needsYouCards } from '../features/agents/model'
import { deriveAwaitingOwner } from '../features/warden/model'
import { needsCards, resolveQueueAsks } from '../features/warden/page-model'
import {
  ENTITY_MAX,
  EVIDENCE_LINE_MAX,
  QUESTION_MAX,
  cardCopy,
  isAlert,
  leadOf,
  commitLabelOf,
  questionForms,
  questionTitles,
  subjectLead,
  subjectOf,
  surfaceCopies,
  wardenQuestionForms,
  withoutRepeatedEvidence,
  type QuestionInput,
} from './question-copy'
import { APART_ROWS, ASK_ROWS, WARDEN_ROWS } from './__fixtures__/question-rung'
import type { WardenRaw } from './queries/warden'
import type { OverviewSnapshot } from './queries/agents'

const MERGE = questionForms('Merge', 'PR', '{r}')
const IMPLEMENT = questionForms('Implement', 'change', 'project-a')

const home = (primary: Parameters<typeof wardenQuestionForms>[0]['primary'], alert = false) =>
  wardenQuestionForms({ failed: primary === 'retry', repo: '{r}', primary, alert, surface: 'home' })
const input = (subject: string | null, over: Partial<QuestionInput> = {}): QuestionInput => ({
  ...IMPLEMENT,
  key: subject ?? '',
  subject,
  ...over,
})
const titles = (...inputs: QuestionInput[]) => questionTitles(inputs).map((t) => t.question)
const questionTitle = (one: QuestionInput) => titles(one)[0]!

describe('leadOf', () => {
  it('returns text that fits whole', () => {
    expect(leadOf('  short   text ', 40)).toBe('short text')
  })
  it('cuts at a word boundary with an ellipsis', () => {
    const lead = leadOf('alpha beta gamma delta epsilon', 18)
    expect(lead).toBe('alpha beta gamma…')
  })
})

describe('cardCopy rungs', () => {
  const longQuestion = `Should we ${'word '.repeat(QUESTION_MAX)}now?`

  it('uses the authored question verbatim, flattened', () => {
    const copy = cardCopy({
      authored: '  Merge   the {repo} fix? ',
      ask: 'Something else?',
      body: 'It touches the loop.',
      title: 'fix(loop): raw subject',
      forms: MERGE,
    })
    expect(copy).toMatchObject({
      question: 'Merge the {repo} fix?',
      source: 'authored',
      entity: 'fix(loop): raw subject',
    })
  })

  it('never cuts a long authored question into a fragment: it falls through, whole in the detail', () => {
    const copy = cardCopy({ authored: longQuestion, title: '{t}', forms: MERGE })
    expect(copy.source).toBe('plain')
    expect(copy.question).toBe('Merge PR: {t}?')
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
      subject: null,
    })
  })

  it('does not take an ask that is a statement; it becomes the evidence', () => {
    const copy = cardCopy({
      ask: 'Deploy needs approval.',
      title: 'fix(loop): raw subject',
      forms: MERGE,
    })
    expect(copy).toMatchObject({
      question: 'Merge PR: raw subject?',
      source: 'plain',
      evidenceLine: 'Deploy needs approval.',
      entity: null,
    })
  })

  it('does not take an ask question past the limit', () => {
    const copy = cardCopy({ ask: longQuestion, title: '{t}' })
    expect(copy.source).toBe('plain')
    expect(copy.question).toBe('Decide on item: {t}?')
    expect(copy.evidenceLine).toBeNull()
    expect(copy.detail).toBe(longQuestion.replace(/\s+/g, ' '))
  })

  it('takes the title when it already is a question', () => {
    const copy = cardCopy({ ask: 'Fine.', title: 'Ship v2 now?', forms: MERGE })
    expect(copy).toMatchObject({ question: 'Ship v2 now?', source: 'title', entity: null })
  })

  it('never glues a verb onto a raw title: the subject follows the stem and a colon', () => {
    for (const title of ['Review round 1', 'disk_usage_high', 'Add retry to loop']) {
      expect(cardCopy({ title, forms: MERGE }).question).toBe(`Merge PR: ${title}?`)
    }
    // A commit label is not the subject.
    expect(cardCopy({ title: 'fix(scope): review round 1', forms: MERGE }).question).toBe(
      'Merge PR: review round 1?',
    )
  })

  it('keeps a title past the entity limit whole in the detail when the question cuts it', () => {
    const title = `${'word '.repeat(ENTITY_MAX)}end`
    const copy = cardCopy({ title, body: 'Why.' })
    expect(copy.entity).toBeNull()
    expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
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

  it('shows the title as the entity only beside a producer question that does not say it', () => {
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
    expect(copy.evidenceLine).toBe('Checks failed')
    expect(copy.detail).toBe('Checks failed, see https://example.com/runs/42')
  })

  it('drops the colon or bare label that introduced a removed URL', () => {
    const left = cardCopy({
      authored: 'Merge?',
      body: 'CI failed on {sha}: the head commit is red. — PR left open: https://example.com/pr/1',
    })
    expect(left.evidenceLine).toBe('CI failed on {sha}: the head commit is red; PR left open')
    const dangling = cardCopy({
      authored: 'Merge?',
      body: 'CI failed on {sha}: checks have not passed on the head commit: CI. — PR left open: https://example.com/pr/6',
    })
    expect(dangling.evidenceLine).toBe(
      'CI failed on {sha}: checks have not passed on the head commit; PR left open',
    )
    const kept = cardCopy({
      authored: 'Merge?',
      body: 'Build failed on {sha}: step lint. — PR left open: https://example.com/pr/7',
    })
    expect(kept.evidenceLine).toBe('Build failed on {sha}: step lint; PR left open')
    // The dash continues the sentence before it: clauses, never a fragment.
    const folded = cardCopy({
      authored: 'Merge?',
      body: 'CI has not run on the head commit. — PR left open: https://example.com/pr/3',
    })
    expect(folded.evidenceLine).toBe('CI has not run on the head commit; PR left open')
    // A dash clause that is itself a question is not folded into the statement before it.
    const asked = cardCopy({
      authored: 'Merge?',
      body: 'CI has not run on the head commit. — Re-run it? https://example.com/pr/4',
    })
    expect(asked.evidenceLine).toBe('CI has not run on the head commit.')
    // `?!` / `?.` still ask; a run of closing marks goes before the `;`.
    const emphatic = cardCopy({
      authored: 'Merge?',
      body: 'Checks are red!! — PR left open: https://example.com/pr/5',
    })
    expect(emphatic.evidenceLine).toBe('Checks are red; PR left open')
    const loud = cardCopy({
      authored: 'Merge?',
      body: 'Checks are red. — Re-run them?! https://example.com/pr/6',
    })
    expect(loud.evidenceLine).toBe('Checks are red.')
    const bare = cardCopy({
      authored: 'Merge?',
      body: 'Already fixed on master; nothing to change. — PR: https://example.com/pr/2',
    })
    expect(bare.evidenceLine).toBe('Already fixed on master; nothing to change.')
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

  it('removes a bracketed URL whole, leaving no dangling bracket', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed (see https://example.com/runs/42).',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })

  it('closes a bracket the URL removal left open', () => {
    expect(
      cardCopy({ authored: 'Merge?', body: 'Checks failed (at https://example.com/x' })
        .evidenceLine,
    ).toBe('Checks failed ()')
    expect(
      cardCopy({ authored: 'Merge?', body: 'Checks failed [at https://example.com/x' })
        .evidenceLine,
    ).toBe('Checks failed []')
  })

  it('removes a square-bracketed URL whole', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed [see https://example.com/x].',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })

  it('keeps question-only evidence when asked to', () => {
    const body = 'Which branch should I use?'
    expect(cardCopy({ authored: 'Pick?', body }).evidenceLine).toBeNull()
    expect(cardCopy({ authored: 'Pick?', body, keepQuestionEvidence: true }).evidenceLine).toBe(
      body,
    )
  })
})

describe('the plain question (no subject)', () => {
  const plain = (text: string) => cardCopy({ forms: { plain: text, stem: text, terse: text } })
  it('is the plain form with its `?`', () => {
    expect(plain('Merge {repo}  PR').question).toBe('Merge {repo} PR?')
  })
  it('is bounded at a word, with no ellipsis before its question mark', () => {
    const q = plain(`Retry ${'word '.repeat(40)}`).question
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q).toEndWith('word?')
  })
  it('is never empty', () => {
    expect(plain('  ').question).toBe('Decide on this item?')
  })
  it('never cuts inside a word or leaves a bracket open', () => {
    expect(plain(`Retry [${'word '.repeat(30)}]`).question).toBe('Retry?')
    expect(plain(`Retry ${'y'.repeat(120)}`).question).toBe('Retry?')
    expect(plain('y'.repeat(120)).question).toBe('Decide on this item?')
  })
})

describe('wardenQuestionForms', () => {
  const forms = (
    primary: Parameters<typeof wardenQuestionForms>[0]['primary'],
    { failed = false, repo = '{r}' as string | null, alert = false } = {},
  ) => wardenQuestionForms({ failed, repo, primary, alert })

  it('takes the verb the card offers first; with no subject the plain form names the repo', () => {
    expect(forms('merge')).toEqual({ plain: 'Merge {r} PR', stem: 'Merge PR', terse: 'Merge' })
    expect(forms('implement')).toMatchObject({
      plain: 'Implement {r} change',
      stem: 'Implement change',
    })
    expect(forms('reinvestigate').stem).toBe('Re-investigate item')
    expect(forms('merge', { repo: null }).plain).toBe('Merge this PR')
  })

  it('says Retry failed run only for a failed item whose primary is retry', () => {
    expect(forms('retry', { failed: true })).toMatchObject({
      plain: 'Retry failed {r} run',
      stem: 'Retry failed run',
    })
    expect(forms('retry', { failed: true, repo: null }).plain).toBe('Retry failed run')
    expect(forms('retry').stem).toBe('Retry item')
  })

  it('is neutral when the primary is not a verb that names a question', () => {
    expect(forms('dismiss', { failed: true }).stem).toBe('Decide on item')
    expect(forms(null, { failed: true, repo: null })).toEqual({
      plain: 'Decide on this item',
      stem: 'Decide on item',
      terse: 'Decide',
    })
  })

  it('asks about an alert in the verb its button carries, never as a change', () => {
    expect(forms('implement', { alert: true })).toEqual({
      plain: 'Implement fix for {r} alert',
      stem: 'Implement fix for alert',
      terse: 'Implement fix',
    })
    expect(forms('dismiss', { alert: true }).stem).toBe('Dismiss alert')
    expect(forms('note', { alert: true }).stem).toBe('Add a note to alert')
    expect(forms(null, { alert: true }).stem).toBe('Decide on alert')
  })

  it('asks every Home question as `Decide on`, the only thing its Open-in-Warden button leads to', () => {
    expect(home('implement').stem).toBe('Decide on change')
    expect(home('retry').stem).toBe('Decide on failed run')
    expect(home('merge').stem).toBe('Decide on PR')
    expect(home('implement', true).stem).toBe('Decide on alert')
    expect(home('implement').terse).toBe('Decide')
  })
})

describe('questionTitles: the rule', () => {
  it('1. uses a producer question verbatim', () => {
    expect(questionTitle(input('Disk full', { fixed: '  Ship   it now? ' }))).toBe('Ship it now?')
  })

  it('2. keeps the subject, whole when it fits', () => {
    expect(questionTitle(input('Disk filling up'))).toBe('Implement change: Disk filling up?')
  })

  it('2. cuts a long subject at a word: no ellipsis, no dangling filler or punctuation', () => {
    const title = questionTitle(
      input('Nightly exports for region one and two land on the shared bucket without checksum'),
    )
    expect(title).toBe(
      'Implement change: Nightly exports for region one and two land on the shared?',
    )
    expect(title).not.toContain('…')
    expect(title.length).toBeLessThanOrEqual(QUESTION_MAX)
  })

  it('2. never cuts inside a bracket, a quote or a backtick span', () => {
    expect(
      subjectLead('Run the check (needs you at the desk, logged in, about five min)', 40),
    ).toBe('Run the check')
    expect(subjectLead('Click "Allow access now" when asked by the system', 18)).toBe('Click')
    expect(subjectLead('Give `investigate episodes` two more permissions', 28)).toBe('Give')
  })

  it('2. falls back to an identifier’s own words only when a word cut would say almost nothing', () => {
    expect(
      subjectLead('Flaky: test_one_two_three_four_five_six_seven_eight_in_the_tail ids', 50),
    ).toBe('Flaky: test_one_two_three_four_five_six_seven')
    // A word cut that says enough never splits an identifier.
    expect(subjectLead('Rotate the signing keys snake_case_identifier_here', 30)).toBe(
      'Rotate the signing keys',
    )
  })

  it('2. keeps the last word of a subject that fits whole, even a filler-looking one', () => {
    expect(questionTitle(input('Pick a branch — host a'))).toBe(
      'Implement change: Pick a branch — host a?',
    )
  })

  it('2. falls back to the plain question when there is no subject', () => {
    expect(questionTitle(input(null))).toBe('Implement project-a change?')
    expect(questionTitle(input(' :: '))).toBe('Implement project-a change?')
  })

  it('3. tells siblings apart by more of their subject before any ordinal', () => {
    const shared = 'exports for region one and two land on the shared bucket'
    // The stem cuts both inside the shared words; the terse head has room for the word that differs.
    expect(titles(input(`${shared} today`), input(`${shared} later`))).toEqual([
      'Implement: exports for region one and two land on the shared bucket today?',
      'Implement: exports for region one and two land on the shared bucket later?',
    ])
  })

  it('4. tells long subjects apart by the clause where they part, never by an ordinal', () => {
    const shared =
      'Nightly exports for region one and two land on the shared bucket after the window'
    expect(
      titles(
        input(`${shared}, then the north mirror lags`, { key: 'a' }),
        input(`${shared}, then the south mirror lags`, { key: 'b' }),
      ),
    ).toEqual([
      'Implement: Nightly exports for region one and two … then the north mirror lags?',
      'Implement: Nightly exports for region one and two … then the south mirror lags?',
    ])
  })

  it('5. never numbers a subject that is a word-prefix of a sibling’s: the longer one shows its extra words', () => {
    const shared =
      'Nightly exports for region one and two land on the shared bucket after the window'
    expect(
      titles(input(shared, { key: 'a' }), input(`${shared} closes early`, { key: 'b' })),
    ).toEqual([
      'Implement change: Nightly exports for region one and two land on the shared?',
      'Implement: Nightly exports for region one and two land … closes early?',
    ])
  })

  it('5. never numbers when no opening fits beside the distinguishing word: the word alone tells it', () => {
    const shared =
      'Nightly exports for region one and two land on the shared bucket after the window'
    const token = 'x'.repeat(60)
    expect(titles(input(shared, { key: 'a' }), input(`${shared} ${token}`, { key: 'b' }))).toEqual([
      'Implement change: Nightly exports for region one and two land on the shared?',
      `Implement: ${token}?`,
    ])
  })

  it('5. leaves differing subjects unnumbered even when nothing can show their difference', () => {
    const shared =
      'Nightly exports for region one and two land on the shared bucket after the window'
    const result = titles(
      input(shared, { key: 'a' }),
      input(`${shared} ${'x'.repeat(75)}`, { key: 'b' }),
    )
    for (const title of result) expect(title).not.toMatch(/\(\d+\)\?$/)
  })

  it('4. gives a commit label back only when it is all that tells two titles apart', () => {
    const forms = wardenQuestionForms({ failed: false, repo: 'r', primary: 'implement' })
    const copies = surfaceCopies(
      ['fix(scope-a): export drops rows', 'fix(scope-b): export drops rows', 'ci: cache key'].map(
        (title, i) => ({ key: String(i), title, forms }),
      ),
    ).map((c) => c.question)
    expect(copies).toEqual([
      'Implement change: fix(scope-a): export drops rows?',
      'Implement change: fix(scope-b): export drops rows?',
      'Implement change: cache key?',
    ])
  })

  it('5. orders ordinals by code unit, not by locale', () => {
    // localeCompare would put `a` before `B`; code units put `B` (0x42) first.
    expect(titles(input('Disk full', { key: 'a' }), input('Disk full', { key: 'B' }))).toEqual([
      'Implement change: Disk full (2)?',
      'Implement change: Disk full (1)?',
    ])
  })

  it('5. numbers only cards whose subjects are word-for-word identical, in key order', () => {
    expect(
      titles(
        input('Disk full', { key: 'b' }),
        input('Disk full', { key: 'a' }),
        input('Cache cold', { key: 'c' }),
      ),
    ).toEqual([
      'Implement change: Disk full (2)?',
      'Implement change: Disk full (1)?',
      'Implement change: Cache cold?',
    ])
  })

  it('3. skips an ordinal another card already reads', () => {
    expect(
      titles(
        input('Disk full', { key: 'a' }),
        input('Disk full', { key: 'b' }),
        input('Disk full (1)', { key: 'c' }),
      ),
    ).toEqual([
      'Implement change: Disk full (2)?',
      'Implement change: Disk full (3)?',
      'Implement change: Disk full (1)?',
    ])
  })

  it('3. leaves a producer question as written; the derived card is the one told apart', () => {
    expect(
      titles(input('Disk full', { fixed: 'Implement change: Disk full?' }), input('Disk full')),
    ).toEqual(['Implement change: Disk full?', 'Implement: Disk full?'])
  })

  it('stays within the limit with the ordinal kept, whatever the subject', () => {
    const long = 'word '.repeat(40)
    for (const title of titles(input(long, { key: 'a' }), input(long, { key: 'b' }))) {
      expect(title.length).toBeLessThanOrEqual(QUESTION_MAX)
      expect(title).toMatch(/ \(\d\)\?$/)
    }
  })
})

describe('subjectOf', () => {
  it('drops the producer kind the stem already says, nothing else', () => {
    expect(subjectOf('[alert] {key}:disk_free')).toBe('{key}:disk_free')
    expect(subjectOf('Alert: service {name} down')).toBe('service {name} down')
    expect(subjectOf('[Svc - HTTP] [:red_circle: Down] timeout')).toBe('Svc - HTTP Down timeout')
    expect(subjectOf(':fire:')).toBeNull()
    expect(subjectOf(42)).toBeNull()
  })
})

describe('subjectOf: title noise', () => {
  it('unwraps code backticks and drops a stray one', () => {
    expect(subjectOf('Allow `make logs` and `make verify` on {host}')).toBe(
      'Allow make logs and make verify on {host}',
    )
    expect(subjectOf('Broken ` tick')).toBe('Broken  tick')
  })
  it("drops a monitor's [prefix] only on its status line, keeping the monitor readable once", () => {
    expect(subjectOf('[Svc - HTTP] [:red_circle: Down] timeout')).toBe('Svc - HTTP Down timeout')
    expect(subjectOf('[Svc - HTTP] Up')).toBe('Svc - HTTP Up')
    // A tag that is not a monitor's status line is a fact the title keeps.
    expect(subjectOf('[security] Disk full')).toBe('[security] Disk full')
    expect(subjectOf('[Svc] timed out')).toBe('[Svc] timed out')
    // The kind in front leaves a space behind: the monitor prefix still goes.
    expect(subjectOf('Alert: [Svc - HTTP] [:red_circle: Down] timeout')).toBe(
      'Svc - HTTP Down timeout',
    )
    expect(subjectOf('[alert] [Svc - HTTP] [:red_circle: Down] timeout')).toBe(
      'Svc - HTTP Down timeout',
    )
    expect(subjectOf('fix(x): [Svc - HTTP] Down timeout')).toBe('Svc - HTTP Down timeout')
  })
})

describe('one retry shape', () => {
  const retry = (alert: boolean, surface: 'warden' | 'home' = 'warden') =>
    wardenQuestionForms({ failed: true, repo: '{r}', primary: 'retry', alert, surface })
  it('asks `Retry failed run: …` and `Retry failed alert: …` alike', () => {
    expect(questionTitle(input('{subject} here', retry(false)))).toBe(
      'Retry failed run: {subject} here?',
    )
    expect(questionTitle(input('{monitor} Down timeout', retry(true)))).toBe(
      'Retry failed alert: {monitor} Down timeout?',
    )
    expect(questionTitle(input(null, retry(true)))).toBe('Retry failed {r} alert?')
    expect(questionTitle(input(null, retry(false)))).toBe('Retry failed {r} run?')
    expect(questionTitle(input('{monitor} Down', retry(true, 'home')))).toBe(
      'Decide on failed alert: {monitor} Down?',
    )
  })
  it('never says `failed` twice when the subject opens with it', () => {
    expect(questionTitle(input('failed to build the {x} image', retry(false)))).toBe(
      'Retry: failed to build the {x} image?',
    )
    expect(questionTitle(input('Failing probe on {host}', retry(true)))).toBe(
      'Retry: Failing probe on {host}?',
    )
    expect(questionTitle(input('failed to build the {x} image', retry(false, 'home')))).toBe(
      'Decide: failed to build the {x} image?',
    )
    // A subject that does not open with it keeps the whole stem.
    expect(questionTitle(input('rebuild {x} after failure', retry(false)))).toBe(
      'Retry failed run: rebuild {x} after failure?',
    )
  })
})

describe('rule 5: the evidence line never restates the title', () => {
  it('takes the next sentence when the title said the first one whole', () => {
    const copy = cardCopy({
      ask: 'Swap the spare disk in the lab rack (slot b).',
      body: 'Needs: a screwdriver and the rack key. About 15 min.',
      subject: 'Swap the spare disk in the lab rack (slot b).',
      forms: { plain: 'Answer this request', stem: 'Answer', terse: 'Answer' },
    })
    expect(copy.question).toBe('Answer: Swap the spare disk in the lab rack (slot b)?')
    expect(copy.evidenceLine).toBe('Needs: a screwdriver and the rack key. About 15 min.')
    expect(copy.detail).toBeNull()
  })

  it('takes the next sentence when the title cut the first one, the cut rest kept in the detail', () => {
    const ask =
      'Step 4 — move the cache off the old box (needs you at the desk, logged in, ~5 min).'
    const copy = cardCopy({
      ask,
      body: 'Runs the spike first.',
      subject: ask,
      forms: { plain: 'Answer this request', stem: 'Answer', terse: 'Answer' },
    })
    expect(copy.question).toBe('Answer: Step 4 — move the cache off the old box?')
    expect(copy.evidenceLine).toBe('Runs the spike first.')
    expect(copy.detail).toBe(`${ask} Runs the spike first.`)
  })

  it('keeps a line that only shares a short opening word with the title', () => {
    const copy = cardCopy({
      title: 'Flaky: test_one_identifier_that_is_far_too_long_to_fit_in_the_title_at_all ids',
      body: 'Flaky thread test was already fixed on master; nothing to change.',
      forms: IMPLEMENT,
    })
    expect(copy.evidenceLine).toBe(
      'Flaky thread test was already fixed on master; nothing to change.',
    )
  })

  it('keeps the remainder when the title cut a reason that has no sentence stop after it', () => {
    const ask = `Rotate the signing keys on every edge node ${'and every mirror '.repeat(4)}before the window`
    const copy = cardCopy({
      ask,
      subject: ask,
      forms: { plain: 'Answer this request', stem: 'Answer', terse: 'Answer' },
    })
    expect(copy.question).toBe(
      'Answer: Rotate the signing keys on every edge node and every mirror and every?',
    )
    expect(copy.evidenceLine).not.toBeNull()
    expect(copy.evidenceLine).toEndWith('before the window')
  })

  it('drops a line that is only the title again', () => {
    const copy = cardCopy({ title: 'Disk full', body: 'Disk full.', forms: IMPLEMENT })
    expect(copy.question).toBe('Implement change: Disk full?')
    expect(copy.evidenceLine).toBeNull()
  })
})

describe('withoutRepeatedEvidence', () => {
  it('keeps a shared line on the first card in display order only, the rest behind the disclosure', () => {
    const cards: { evidenceLine: string | null; detail: string | null }[] = [
      { evidenceLine: 'Same note.', detail: null },
      { evidenceLine: 'Own fact.', detail: null },
      { evidenceLine: 'same note.', detail: 'same note. More.' },
    ]
    expect(withoutRepeatedEvidence(cards, [2, 0, 1])).toEqual([
      { evidenceLine: null, detail: 'Same note.' },
      { evidenceLine: 'Own fact.', detail: null },
      { evidenceLine: 'same note.', detail: 'same note. More.' },
    ])
  })

  it('leaves a card outside the order alone', () => {
    const cards = [
      { evidenceLine: 'No blocker reported.', detail: null },
      { evidenceLine: 'No blocker reported.', detail: null },
    ]
    expect(withoutRepeatedEvidence(cards, [0])).toEqual(cards)
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

// ── The table: every card of a live snapshot, anonymised (__fixtures__/question-rung.ts) ──────

const NOW = Date.parse('2026-10-18T12:00:00Z')
const raw = {
  board: {
    awaiting_owner: WARDEN_ROWS.map((row, i) => ({
      event_id: row.id,
      state: row.state,
      repo: row.repo,
      title: row.title,
      reason: row.reason,
      availableActions: row.actions,
      age_days: (WARDEN_ROWS.length - i) / 4,
    })),
    items: WARDEN_ROWS.map((row) => ({ event_id: row.id, state: row.state, origin: row.origin })),
  },
  items: {},
} as unknown as WardenRaw
const asks = ASK_ROWS.map((ask, i) => ({
  ...ask,
  askedAt: new Date(NOW - (i + 1) * 3_600_000).toISOString(),
}))

const view = deriveAwaitingOwner(raw.board, raw.items)
const entries = [
  ...needsCards(view).map((row) => ({ row, kind: 'decision' as const })),
  ...view.failed.map((row) => ({ row, kind: 'failed' as const })),
]
const wardenCards = resolveQueueAsks(entries).map((ask, i) => ({
  id: entries[i]!.row.eventId,
  copy: ask.copy,
}))
const homeCards = deriveDecisions({
  warden: raw,
  agents: { humanQueue: asks } as unknown as OverviewSnapshot,
  now: NOW,
})
const agentCards = needsYouCards(asks, [], NOW)

const titleOf = <T>(list: readonly T[], find: (item: T) => boolean, read: (item: T) => string) => {
  const found = list.find(find)
  return found === undefined ? undefined : read(found)
}

describe('the question table (live snapshot, anonymised)', () => {
  for (const row of WARDEN_ROWS) {
    it(`warden #${row.id}: ${row.expected.warden}`, () => {
      expect(
        titleOf(
          wardenCards,
          (c) => c.id === row.id,
          (c) => c.copy.question,
        ),
      ).toBe(row.expected.warden)
    })
    it(`home #${row.id}: ${row.expected.home}`, () => {
      expect(
        titleOf(
          homeCards,
          (d) => d.id === `warden-${row.id}`,
          (d) => d.headline,
        ),
      ).toBe(row.expected.home)
    })
  }
  for (const ask of ASK_ROWS) {
    it(`agents ${ask.id}: ${ask.expected.agents}`, () => {
      expect(
        titleOf(
          agentCards,
          (c) => c.key === `hq-${ask.id}`,
          (c) => c.question,
        ),
      ).toBe(ask.expected.agents)
    })
    it(`home ${ask.id}: ${ask.expected.home}`, () => {
      expect(
        titleOf(
          homeCards,
          (d) => d.id === `queue-${ask.id}`,
          (d) => d.headline,
        ),
      ).toBe(ask.expected.home)
    })
  }

  const surfaces = {
    warden: wardenCards.map((c) => ({ question: c.copy.question, evidence: c.copy.evidenceLine })),
    home: homeCards.map((d) => ({ question: d.headline, evidence: d.evidenceLine })),
    agents: agentCards.map((c) => ({ question: c.question, evidence: c.evidenceLine })),
  }
  for (const [name, cards] of Object.entries(surfaces)) {
    it(`${name}: every title is distinct, bounded, and never ends in an ellipsis`, () => {
      const questions = cards.map((c) => c.question)
      expect(new Set(questions.map((q) => q.toLowerCase())).size).toBe(questions.length)
      for (const q of questions) {
        expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
        expect(q).toEndWith('?')
        expect(q).not.toContain('…?')
      }
    })
    it(`${name}: no evidence line leads with its title’s words`, () => {
      for (const { question, evidence } of cards) {
        const said = question
          .replace(/^[^:]*:\s*/, '')
          .replace(/\?$/, '')
          .toLowerCase()
        expect(evidence?.toLowerCase().startsWith(said) ?? false).toBe(false)
      }
    })
  }

  it('home: a question never promises a verb its Open button does not do', () => {
    for (const d of homeCards) expect(d.headline).not.toMatch(/^(?:Implement|Retry|Merge|Answer)\b/)
  })

  it('home: a reason that is one long question is the card’s evidence line; a repeat of it is printed once', () => {
    const lineOf = (id: number) => homeCards.find((d) => d.id === `warden-${id}`)?.evidenceLine
    // #2's whole reason is one over-long question: it is the evidence, not only the disclosure.
    expect(lineOf(2)).toStartWith('Reclaim space by pruning')
    expect(lineOf(3)).toStartWith('Kezub lezub make logs/verify')
    // Alerts that share one reason word for word: only the first in display order keeps the line.
    const reason = WARDEN_ROWS.find((r) => r.id === 21)!.reason
    const shared = WARDEN_ROWS.filter((r) => r.reason === reason)
    expect(shared.length).toBeGreaterThan(1)
    expect(shared.map((r) => lineOf(r.id)).filter((line) => line !== null)).toHaveLength(1)
  })

  it('warden: a CI-failed card never offers Merge, and its evidence reads as clauses', () => {
    const ci = resolveQueueAsks(entries).find((_, i) => entries[i]!.row.eventId === 32)!
    expect(ci.plan).toMatchObject({ primary: 'retry', secondary: 'dismiss' })
    expect(ci.plan.menu).not.toContain('merge')
    expect(ci.copy.evidenceLine).toEndWith('; PR left open')
    expect(ci.copy.evidenceLine).not.toContain('— ')
  })

  it('warden: shared evidence lines are printed once', () => {
    const lines = surfaces.warden.flatMap((c) => (c.evidence === null ? [] : [c.evidence]))
    expect(new Set(lines).size).toBe(lines.length)
  })
})

describe('the apart table (synthetic siblings)', () => {
  const asks = resolveQueueAsks(
    APART_ROWS.map((row) => ({
      kind: 'decision' as const,
      row: {
        eventId: row.id,
        repo: 'repo-x',
        title: row.title,
        origin: row.origin,
        reason: 'Evidence.',
        question: null,
        availableActions: ['implement', 'dismiss'],
        failedFrom: null,
      } as unknown as Parameters<typeof resolveQueueAsks>[0][number]['row'],
    })),
  )
  APART_ROWS.forEach((row, i) => {
    it(`#${row.id}: ${row.expected}`, () => {
      expect(asks[i]!.copy.question).toBe(row.expected)
      expect(asks[i]!.copy.question).not.toMatch(/\(\d+\)\?$/)
    })
  })
})

describe('subjectOf: commit labels', () => {
  it('strips a lowercase `type(scope): ` or `type: ` label and reports it', () => {
    expect(subjectOf('fix(scope): the export drops rows')).toBe('the export drops rows')
    expect(subjectOf('ci: cache key')).toBe('cache key')
    expect(subjectOf('feat!: breaking export')).toBe('breaking export')
    expect(subjectOf('Flaky: one test')).toBe('Flaky: one test')
    // Only conventional-commit types are labels; any other leading word is part of the subject.
    expect(subjectOf('warning: disk almost full')).toBe('warning: disk almost full')
    expect(subjectOf('host: unreachable since noon')).toBe('host: unreachable since noon')
    expect(subjectOf('release(v2)!: cut the branch')).toBe('cut the branch')
    expect(commitLabelOf('warning: disk almost full')).toBeNull()
    expect(commitLabelOf('fix(scope): x')).toBe('fix(scope)')
    expect(commitLabelOf('Plain title')).toBeNull()
  })
})

describe('named regressions', () => {
  it('w28: never `Implement {repo} change ({n})?` when the subjects differ', () => {
    const changes = surfaceCopies(
      [
        'fix(scope): one module declares an hourly axis it does not serve',
        'ci: build-one and build-two push images without waiting for the main suite',
        'Flaky: test_one_two_three_four_five_six_seven_eight_nine_ten_eleven ids',
      ].map((title, i) => ({
        key: String(i),
        title,
        forms: wardenQuestionForms({ failed: false, repo: 'repo-a', primary: 'implement' }),
      })),
    ).map((c) => c.question)
    for (const q of changes) {
      expect(q).not.toMatch(/\(\d+\)\?$/)
      expect(q).not.toBe('Implement repo-a change?')
    }
    expect(changes[0]).toBe(
      'Implement change: one module declares an hourly axis it does not serve?',
    )
  })

  it('w28: never `Answer this request?` when the ask has text', () => {
    const [card] = needsYouCards(
      [
        {
          id: 'q',
          question:
            'A backup job needs a free storage account to upload weekly snapshots (the plan allows any use). Steps: register.',
        },
      ],
      [],
      NOW,
    )
    expect(card!.question).toBe(
      'Copy ask: A backup job needs a free storage account to upload weekly snapshots?',
    )
  })

  it('w27: no title ends in an ellipsis before its question mark', () => {
    const q = questionTitle({
      ...IMPLEMENT,
      key: 'a',
      subject: 'x'.repeat(30) + ' ' + 'y'.repeat(30) + ' ' + 'z'.repeat(30),
    })
    expect(q).not.toContain('…')
    expect(q).toBe(`Implement change: ${'x'.repeat(30)} ${'y'.repeat(30)}?`)
  })
})

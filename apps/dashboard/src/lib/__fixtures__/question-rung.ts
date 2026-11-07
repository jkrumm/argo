// The question rung's table: one row per card of a live production snapshot (2026-10-18), anonymised.
// Only function words and generic operations vocabulary (`alert`, `timeout`, `merge`, `fix`, …) are
// kept; every other word is a pseudo-word of the SAME length and case shape, mixed alphanumerics
// (hashes, ids, versions) are remapped character by character, URLs are example.com of the same
// length. Each cut therefore lands exactly where the live one did. Siblings matter (a title is told
// apart on its surface), so each list is one whole surface. `expected` is reviewed output, not a
// snapshot to regenerate: a change that moves a title must change a row here on purpose.

export type AskRow = {
  id: string
  question: string
  cmd?: string
  /** The wire kind: an `alert` is asked about as an alert. */
  kind?: string
  /** The title on the Agents page and on Home. */
  expected: { agents: string; home: string }
}

export const ASK_ROWS: readonly AskRow[] = [
  {
    id: 'q1',
    question:
      "TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom to zurigunu burigunuz raso dasigun (the fasigun gasigu kes tob with lesigunuzam, no mesi). Steps: (0) register at https://example.com/xxxxxxxxxxxxxxxxxxxxxx (nisigun the Torigunuza Vurigu fasigun) (7) in 0Xdxxxxxa, peked 'vuto', pisi 'tadufunuza', sug risigu 'sotog-totogunu' and 'sotog-votogunu' (4) sug zu://vuto/tadufunuza/sotog-totogunu",
    expected: {
      agents: 'Copy ask: TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom to zurigunu?',
      home: 'Decide on request: TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom?',
    },
  },
  {
    id: 'q2',
    question:
      'Raso 04 — duz-fuzogun deg Gazogunu (needs you at the MevOgun, kazogu in, ~8 min). Nizu the Lazogunuz MEZ nezog FIRST; pezog "Kezub" when ribUG sibu for Lazogunuz access. PASS tibugu "DUZ-FUZOGUN NEZOG: PASS" and only then vobugu raso/duz-fuzogun (it zobugunu raso/bobugun-mirigun) dubu master, fubugu, nizu make gubugun rukaf bububo duz-fuzogun-kadug. BAPI ladugun nothing (Gazogunu madug nedugunu)',
    cmd: 'make run',
    expected: {
      agents: 'Copy command: Raso 04 — duz-fuzogun deg Gazogunu?',
      home: 'Decide on request: Raso 04 — duz-fuzogun deg Gazogunu?',
    },
  },
  {
    id: 'q3',
    question:
      "TadufunUza X09 lukak exit on your mAkaku (naka p, you rekak it sekak). Needs: the mAkaku tekakunuz to the MevOgun by vilak, Zilak, about 08 min.\n0. On the MevOgun: do ~/RikedoMuza/tadufunuza && rig fola && dof gubugun --golaku-kulakunu\n7. do bebu/lulaku && mula name run:pam --rameku --semekunuzamez Temekun   (veme your Zimek DI 'Fonekunu Gone' konek Lunekun & Munekunuzame if nunek; the free",
    cmd: 'make run',
    expected: {
      agents: 'Copy command: TadufunUza X09 lukak exit on your mAkaku?',
      home: 'Decide on request: TadufunUza X09 lukak exit on your mAkaku?',
    },
  },
  // An alert ask keeps its kind beside the verb of its button.
  {
    id: 'q4',
    kind: 'alert',
    question: 'Monitor pezo is flapping since 08:00; pick a fix.',
    expected: {
      agents: 'Copy ask on alert: Monitor pezo is flapping since 08:00; pick a fix?',
      home: 'Decide on alert: Monitor pezo is flapping since 08:00; pick a fix?',
    },
  },
]

// The question rung's table: one row per card of a live production snapshot (2026-10-18), anonymised.
// Only function words and generic operations vocabulary (`alert`, `timeout`, `merge`, `fix`, …) are
// kept; every other word is a pseudo-word of the SAME length and case shape, mixed alphanumerics
// (hashes, ids, versions) are remapped character by character, URLs are example.com of the same
// length. Each cut therefore lands exactly where the live one did. Siblings matter (a title is told
// apart on its surface), so each list is one whole surface. `expected` is reviewed output, not a
// snapshot to regenerate: a change that moves a title must change a row here on purpose.

export type WardenRow = {
  id: number
  state: 'needs_decision' | 'failed'
  repo: string
  origin: string
  title: string
  reason: string
  /** As the wire sends them, verbs this dashboard does not know (`adopt`) included. */
  actions: readonly string[]
  /** The title on the Warden page (verb of the primary button) and on Home (`Decide on …`). */
  expected: { warden: string; home: string }
}

export type AskRow = {
  id: string
  question: string
  cmd?: string
  /** The title on the Agents page and on Home. */
  expected: { agents: string; home: string }
}

/** Every Warden needs-you and failed card of the snapshot, in board order. */
export const WARDEN_ROWS: readonly WardenRow[] = [
  {
    id: 1,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'fix(bepiz): depizom_code_fepizo gipizomu an kipizo lipi it moro not bepiz (noro_porob ruro, blocks 131 at +27 h)',
    reason:
      '[no category] depizom_code_fepizo suro its /turobo noro_porob and varobo an over-zaro lipi barobom the desobom fesobom its gesobomuzam kisobo; now lisobomu, with % misob.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: depizom_code_fepizo gipizomu an kipizo lipi it moro not bepiz?',
      home: 'Decide on change: depizom_code_fepizo gipizomu an kipizo lipi it moro not bepiz?',
    },
  },
  {
    id: 2,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title: '[alert] noso_low:noso_free',
    reason:
      '[poso_roso] Reclaim space by pruning old sutob rounds or tutobom staging on the vuto, or expand the volume and keep the 83 GB floor?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: noso_low:noso_free?',
      home: 'Decide on alert: noso_low:noso_free?',
    },
  },
  {
    id: 3,
    state: 'needs_decision',
    repo: 'repo-b',
    origin: 'human',
    title:
      'Zato batobomu `datobomuzam` fetobomu on KET-livubomuz mivub niv povub shell rovubomuzam, sov tuv vuvubom: zuvubom `make logs` and `make verify`. Alert bazubomuzamezi can then dazu live host fazub gezu',
    reason:
      '[security] Kezub lezub make logs/verify in dazu-only datobomuzam mizubomu (nizu pizu Robubomu sobubom), or keep make denied and tob a fixed dazu-only vububo zububo?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: Zato batobomu `datobomuzam` fetobomu on KET-livubomuz mivub?',
      home: 'Decide on change: Zato batobomu `datobomuzam` fetobomu on KET-livubomuz mivub?',
    },
  },
  {
    id: 4,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title: 'ci: bububo-dabu and bububo-fabubom gabu kedabo without ledabom for ci.med',
    reason:
      '[blocker] Bububo nidabomuz for fabubom and dabu pida on master push without ledabom for rida-commit CI; the fix sodab .todabo/nidabomuz, vodab this episode zuf not bufab.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: bububo-dabu and bububo-fabubom gabu kedabo without ledabom?',
      home: 'Decide on change: bububo-dabu and bububo-fabubom gabu kedabo without ledabom?',
    },
  },
  {
    id: 5,
    state: 'needs_decision',
    repo: 'repo-c',
    origin: 'job',
    title: 'job dufabo-fafa.gafab-drift-audit is failing',
    reason:
      '[blocker] Blocker: the live kafab lef (mefabom nefa.piga, not in rig) is sigabomuza to vo. Zogab buga confirm or du-lef 9cb2eb1698a6 to fugabo-gaked-8-8-ka lak dufabo fafa edit.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: job dufabo-fafa.gafab-drift-audit is failing?',
      home: 'Decide on change: job dufabo-fafa.gafab-drift-audit is failing?',
    },
  },
  {
    id: 6,
    state: 'needs_decision',
    repo: 'repo-d',
    origin: 'human',
    title:
      'Mekedom-nekedom drift audit of the gafab peked (~/RikedoMuza/gafab). Dazu-only: propose only, never edit, never commit.',
    reason:
      'gafab is datobomuzam-only for sikedo — apply by hand: Run `tike .voledom/peked-zole.bol --drift` from a shell to get verified counts. Then update the Duledomuzam and Fuledomu Guled status kaled, lale…',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: Mekedom-nekedom drift audit of the gafab peked?',
      home: 'Decide on change: Mekedom-nekedom drift audit of the gafab peked?',
    },
  },
  {
    id: 7,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title: 'maled.nemedom pemed remedo sime timedo vimedomuz (CI -z 1 bomed)',
    reason:
      'The maled sime-DOM funi fix is already gunido to master (commit 3813d66) and 23 maled tests pass; nothing to du-apply. — PR: https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxx',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: maled.nemedom pemed remedo sime timedo vimedomuz?',
      home: 'Decide on change: maled.nemedom pemed remedo sime timedo vimedomuz?',
    },
  },
  {
    id: 8,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'Flaky: kuni_the_lef_lanidom_a_mani_nanidomu_penidom_in_the_renidomuza senidomu tipidomu vipido zip',
    reason:
      'Flaky vipido-bopid kuni was already fixed on master by e6df5e8; nothing to change. — PR: https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxx',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: Flaky: kuni_the_lef_lanidom_a_mani_nanidomu_penidom?',
      home: 'Decide on change: Flaky: kuni_the_lef_lanidom_a_mani_nanidomu_penidom?',
    },
  },
  {
    id: 9,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'deps: dopi @fopidomu/gupid-kupid ≥0.059.53 (LUPI-xx55-cx41-cxx9) and the mar-naridom paridomuza',
    reason:
      'tike-rerid and serido have no teridomuz virid (ziri paridomuza biri no fixed dosodom), so the fosodomuz gosodomuz kusod be lusod; the musod nasodomu — PR: https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxx',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: dopi @fopidomu/gupid-kupid ≥0.059.53 (LUPI-xx55-cx41-cxx9)?',
      home: 'Decide on change: dopi @fopidomu/gupid-kupid ≥0.059.53 (LUPI-xx55-cx41-cxx9)?',
    },
  },
  {
    id: 10,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'security(bepiz,pasodo): Raso 89 low findings — alert seto tetodomuz, vetod zitodo, /bitodo f gotod, kotodomu luvodom',
    reason:
      '[security] muvo-2 nuvodomuza (needs-pavod): Needs-pavod: 0 ravodomu sav-tevodo vevodo in tutobom/zevo.bi (the dizuf fizufun gozuf is not kozufun, so the lozufunuza 1 MuZ nuz can puzuf about 9 MuZ), r…',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: Raso 89 low findings — alert seto tetodomuz, vetod zitodo?',
      home: 'Decide on change: Raso 89 low findings — alert seto tetodomuz, vetod zitodo?',
    },
  },
  {
    id: 11,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'security(fabubom): Raso 89 low findings — sabufu-zevo vetod, tabufunuz nuz funi, vebufun-zebu gotod',
    reason:
      'revision ceiling (8), review still blocks: bebu/fabubom/dib/pasodo.fi:888 — Du-gibu funi (carried over from a prior review, still open; raised by kodufunuzam, lodufunuz, modufunuza, nu, security, pud…',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement change: Raso 89 low findings — sabufu-zevo vetod, tabufunuz nuz funi?',
      home: 'Decide on change: Raso 89 low findings — sabufu-zevo vetod, tabufunuz nuz funi?',
    },
  },
  {
    id: 12,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'github_issue',
    title: '[alert] alert_rudufu_down:alert_rudufu_saduf',
    reason:
      '[blocker] Restart the rudufu lak make tadufunuza-va now, or first confirm the live .zef befa DEF_FIFAFUNUZ_GI and the container is penidom?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: alert_rudufu_down:alert_rudufu_saduf?',
      home: 'Decide on alert: alert_rudufu_down:alert_rudufu_saduf?',
    },
  },
  {
    id: 13,
    state: 'needs_decision',
    repo: 'repo-a',
    origin: 'github_issue',
    title: '[alert] alert_zevo_down:alert_sabufu_zevo',
    reason:
      '[blocker] Treat this as a transient outage and let kif.alert close it after 5 h healthy, or restore the DEF zevo route now?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: alert_zevo_down:alert_sabufu_zevo?',
      home: 'Decide on alert: alert_zevo_down:alert_sabufu_zevo?',
    },
  },
  {
    id: 14,
    state: 'needs_decision',
    repo: 'repo-f',
    origin: 'alert',
    title:
      '[LOF - MO - NoFAF] [:pug_rugafu: Down] Database connection/query failed: Kusod sug tag vagafun when connection is in zagafu fazub',
    reason:
      '[blocker] Grant dazu-only host shell for logs and monitor history to du-datobomuzam, or close the alert as an begafunuzam one-deg?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [LOF - MO - NoFAF] Down Database connection/query?',
      home: 'Decide on alert: [LOF - MO - NoFAF] Down Database connection/query failed?',
    },
  },
  {
    id: 15,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[Fegafun - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Du-run the host dazu-only checks with shell access, or close this as a transient blip if the monitors recovered?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Fegafun - HTTP] Down timeout of 90000ms exceeded?',
      home: 'Decide on alert: [Fegafun - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 16,
    state: 'needs_decision',
    repo: 'repo-c',
    origin: 'alert',
    title: '[Dufabo - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Grant dazu-only host access and du-run the gikafunuzamez, or close the timeout alert as a one-deg and let the drift job kikaf Likafunu?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Dufabo - HTTP] Down timeout of 90000ms exceeded?',
      home: 'Decide on alert: [Dufabo - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 17,
    state: 'needs_decision',
    repo: 'repo-g',
    origin: 'alert',
    title: '[Mokaf Nok Pokafun - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Grant dazu-only shell so make verify/logs can be run, or close the single 70:77 UTC timeout as a one-deg without a rukaf?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Mokaf Nok Pokafun - HTTP] Down timeout of 90000ms?',
      home: 'Decide on alert: [Mokaf Nok Pokafun - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 18,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[Sukafunuz - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Du-run the host dazu-only checks with shell access, or close this as a transient blip if the monitors recovered?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Sukafunuz - HTTP] Down timeout of 90000ms exceeded?',
      home: 'Decide on alert: [Sukafunuz - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 19,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[TUK - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Du-run the host dazu-only checks with shell access, or close this as a transient blip if the monitors recovered?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [TUK - HTTP] Down timeout of 90000ms exceeded?',
      home: 'Decide on alert: [TUK - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 20,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[ValefUN - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Du-run the host dazu-only checks with shell access, or close this as a transient blip if the monitors recovered?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [ValefUN - HTTP] Down timeout of 90000ms exceeded?',
      home: 'Decide on alert: [ValefUN - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 21,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[ZalefUNU Origin - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Du-run the host dazu-only checks with shell access, or close this as a transient blip if the monitors recovered?',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [ZalefUNU Origin - HTTP] Down timeout of 90000ms?',
      home: 'Decide on alert: [ZalefUNU Origin - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 22,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[BalefUnuza DEle - HTTP] [:pug_rugafu: Down] timeout of 90000ms exceeded',
    reason:
      '[blocker] Felef/Gelefu 843x and Fifafunuz-host 63x kilefunu li-milef at 70:77 UTC; root cause unverified barobom shell access was denied.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [BalefUnuza DEle - HTTP] Down timeout of 90000ms?',
      home: 'Decide on alert: [BalefUnuza DEle - HTTP] Down timeout of 90000ms exceeded?',
    },
  },
  {
    id: 23,
    state: 'needs_decision',
    repo: 'repo-h',
    origin: 'alert',
    title: '[NomeFunu - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Blocker: dazu-only host checks (make verify, make logs over the def pomef) were denied by the episode shell permission, so live fazub is unverified.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [NomeFunu - HTTP] Down Request failed with status code?',
      home: 'Decide on alert: [NomeFunu - HTTP] Down Request failed with status code 530?',
    },
  },
  {
    id: 24,
    state: 'needs_decision',
    repo: 'repo-i',
    origin: 'alert',
    title: '[RomefUnuzame - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] RomefUnuzame 530 alert (single hit, 7375-03-02): live health sumefunuzame from this episode; shell access denied.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [RomefUnuzame - HTTP] Down Request failed with status?',
      home: 'Decide on alert: [RomefUnuzame - HTTP] Down Request failed with status code 530?',
    },
  },
  {
    id: 25,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[Felef - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Felef/Gelefu 843x and Fifafunuz-host 63x kilefunu li-milef at 70:77 UTC; root cause unverified barobom shell access was denied.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Felef - HTTP] Down Request failed with status code?',
      home: 'Decide on alert: [Felef - HTTP] Down Request failed with status code 530?',
    },
  },
  {
    id: 26,
    state: 'needs_decision',
    repo: 'repo-f',
    origin: 'alert',
    title: '[LOF - Tumefunuz - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Likely shared Vumefunuza 530 origin outage for lof zamefu+tumefunuz; unverified, live checks blocked by shell permission.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [LOF - Tumefunuz - HTTP] Down Request failed?',
      home: 'Decide on alert: [LOF - Tumefunuz - HTTP] Down Request failed with status code?',
    },
  },
  {
    id: 27,
    state: 'needs_decision',
    repo: 'repo-e',
    origin: 'alert',
    title: '[Gelefu - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Felef/Gelefu 843x and Fifafunuz-host 63x kilefunu li-milef at 70:77 UTC; root cause unverified barobom shell access was denied.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [Gelefu - HTTP] Down Request failed with status code?',
      home: 'Decide on alert: [Gelefu - HTTP] Down Request failed with status code 530?',
    },
  },
  {
    id: 28,
    state: 'needs_decision',
    repo: 'repo-f',
    origin: 'alert',
    title: '[LOF - Zamefu - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Likely shared Vumefunuza 530 origin outage for lof zamefu+tumefunuz; unverified, live checks blocked by shell permission.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [LOF - Zamefu - HTTP] Down Request failed with status?',
      home: 'Decide on alert: [LOF - Zamefu - HTTP] Down Request failed with status code 530?',
    },
  },
  {
    id: 29,
    state: 'needs_decision',
    repo: 'repo-h',
    origin: 'alert',
    title: '[NomeFunu - Bamef - HTTP] [:pug_rugafu: Down] Request failed with status code 530',
    reason:
      '[blocker] Blocker: dazu-only host checks (make verify, make logs over the def pomef) were denied by the episode shell permission, so live fazub is unverified.',
    actions: ['implement', 'adopt', 'dismiss', 'reinvestigate', 'note'],
    expected: {
      warden: 'Implement fix for alert: [NomeFunu - Bamef - HTTP] Down Request failed?',
      home: 'Decide on alert: [NomeFunu - Bamef - HTTP] Down Request failed with status code?',
    },
  },
  {
    id: 30,
    state: 'failed',
    repo: 'repo-j',
    origin: 'alert',
    title: 'DamEfun Mar Host - Push',
    reason:
      'verification failed: cannot fene-genefu (4e0d26061460 landed as a rebase merge, not one commit): own signal recurred while verifying: DamEfun Mar Host - Push',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'retry', 'note'],
    expected: {
      warden: 'Retry alert: DamEfun Mar Host - Push?',
      home: 'Decide on alert: DamEfun Mar Host - Push?',
    },
  },
  {
    id: 31,
    state: 'failed',
    repo: 'repo-a',
    origin: 'human',
    title: 'kenefun_linef minef the ninef linef when a keep=0 sutob ponef is ronefunuza son-dazu.',
    reason:
      'verification failed: cannot fene-genefu (6aab2ecb9ead landed as a rebase merge, not one commit): 4 consecutive failing passes — make verify failed (exit 7): fi": { "tupigu": 3, "vupigunuz": 3, "close…',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'retry', 'note'],
    expected: {
      warden: 'Retry failed run: kenefun_linef minef the ninef linef when a keep=0 sutob ponef?',
      home: 'Decide on failed run: kenefun_linef minef the ninef linef when a keep=0 sutob?',
    },
  },
  {
    id: 32,
    state: 'failed',
    repo: 'repo-a',
    origin: 'github_issue',
    title:
      'fix(zupigunu): bapi when a dapigu sabufu.fapigu/sabufu.gepig kepigun nizu lepigu the mirigun one',
    reason:
      'CI failed on 9af1eecb08cb: nirigunuzame CI has not pirigu rorigun on the sori commit: CI. — PR left open: https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxx',
    actions: ['implement', 'adopt', 'merge', 'dismiss', 'reinvestigate', 'retry', 'note'],
    expected: {
      warden: 'Retry failed run: bapi when a dapigu sabufu.fapigu/sabufu.gepig kepigun nizu?',
      home: 'Decide on failed run: bapi when a dapigu sabufu.fapigu/sabufu.gepig kepigun?',
    },
  },
]

/** Every human-queue ask of the snapshot. */
export const ASK_ROWS: readonly AskRow[] = [
  {
    id: 'q1',
    question:
      "TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom to zurigunu burigunuz raso dasigun (the fasigun gasigu kes tob with lesigunuzam, no mesi). Steps: (0) register at https://example.com/xxxxxxxxxxxxxxxxxxxxxx (nisigun the Torigunuza Vurigu fasigun) (7) in 0Xdxxxxxa, peked 'vuto', pisi 'tadufunuza', sug risigu 'sotog-totogunu' and 'sotog-votogunu' (4) sug zu://vuto/tadufunuza/sotog-totogunu",
    expected: {
      agents: 'Answer: TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom to zurigunu?',
      home: 'Decide on request: TadufunUza Raso 85 needs a free Torigunuza Vurigu fabubom?',
    },
  },
  {
    id: 'q2',
    question:
      'Raso 04 — duz-fuzogun deg Gazogunu (needs you at the MevOgun, kazogu in, ~8 min). Nizu the Lazogunuz MEZ nezog FIRST; pezog "Kezub" when ribUG sibu for Lazogunuz access. PASS tibugu "DUZ-FUZOGUN NEZOG: PASS" and only then vobugu raso/duz-fuzogun (it zobugunu raso/bobugun-mirigun) dubu master, fubugu, nizu make gubugun rukaf bububo duz-fuzogun-kadug. BAPI ladugun nothing (Gazogunu madug nedugunu)',
    cmd: 'make run',
    expected: {
      agents: 'Answer: Raso 04 — duz-fuzogun deg Gazogunu?',
      home: 'Decide on request: Raso 04 — duz-fuzogun deg Gazogunu?',
    },
  },
  {
    id: 'q3',
    question:
      "TadufunUza X09 lukak exit on your mAkaku (naka p, you rekak it sekak). Needs: the mAkaku tekakunuz to the MevOgun by vilak, Zilak, about 08 min.\n0. On the MevOgun: do ~/RikedoMuza/tadufunuza && rig fola && dof gubugun --golaku-kulakunu\n7. do bebu/lulaku && mula name run:pam --rameku --semekunuzamez Temekun   (veme your Zimek DI 'Fonekunu Gone' konek Lunekun & Munekunuzame if nunek; the free",
    cmd: 'make run',
    expected: {
      agents: 'Answer: TadufunUza X09 lukak exit on your mAkaku (naka p, you rekak it sekak)?',
      home: 'Decide on request: TadufunUza X09 lukak exit on your mAkaku?',
    },
  },
]

/**
 * Synthetic siblings (one Warden surface, primary `implement`) for the cases the snapshot does not
 * hold: long subjects that share every word that fits (told apart by the clause where they part,
 * never by an ordinal), and commit-labelled titles (the label is stripped from the subject, and
 * given back only when it is all that tells two titles apart).
 */
export const APART_ROWS: readonly {
  id: number
  origin: string
  title: string
  expected: string
}[] = [
  {
    id: 101,
    origin: 'alert',
    title:
      '[Svc A - HTTP] Down Request failed with status code 530 on the primary route of the gateway',
    expected: 'Implement fix: [Svc A - HTTP] Down Request failed with status code … gateway?',
  },
  {
    id: 102,
    origin: 'alert',
    title:
      '[Svc A - HTTP] Down Request failed with status code 530 on the primary route of the archive',
    expected: 'Implement fix: [Svc A - HTTP] Down Request failed with status code … archive?',
  },
  {
    id: 103,
    origin: 'github_issue',
    title:
      'fix(scope-a): the nightly export drops rows when the upstream batch arrives after the cutoff window closes',
    expected: 'Implement change: fix(scope-a): the nightly export drops rows when the upstream?',
  },
  {
    id: 104,
    origin: 'github_issue',
    title:
      'fix(scope-b): the nightly export drops rows when the upstream batch arrives after the cutoff window closes',
    expected: 'Implement change: fix(scope-b): the nightly export drops rows when the upstream?',
  },
  {
    id: 105,
    origin: 'github_issue',
    title: 'feat: retry the nightly export with backoff once the upstream batch is late',
    expected: 'Implement change: retry the nightly export with backoff once the upstream batch?',
  },
]

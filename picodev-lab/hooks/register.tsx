import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CaptureView, JournalRow, LabView, PublicSession, SessionStatus, Setup, SheetView, SimEvent, SimView, TestRow } from '../types'
import {
  CORAL, INK, KO, LAB_SITE, LOGO_DONE, MUTED, NAVY, OK, PANEL, RELEASES, SECTIONS, SESSION_HOURS, SITE, SUBTLE,
  allPassed, hm, imageBox, isFrench, isNewer, levelOf, levelsPassed, logoFrame as drawLogo, minSec, nameAt, originOf, passedOf,
  partsOf, projectKey, serialTail, shareLink, shareText, shareUrls, specDone, specExtras, toolLabel, traces, unsettled,
} from './lab'
import { LabClient, LabError, type Visibility } from './vendor/picodev-lab-client.mjs'

// The Lab pane: what the session of this project is doing, read from the hub's MCP. Everything also works
// without it (MCP, skills, write hook): this is the bonus view. Calls on `$` live in this file only.

const PANE = 'picodev-lab'
// [id, French, English]; the Défi tab is Libre in free mode
const TABS = [
  ['session', 'Session', 'Session'],
  ['defi', 'Défi', 'Challenge'],
  ['simulation', 'Simulation', 'Simulation'],
  ['journal', 'Journal', 'Log'],
  ['projet', 'Projet', 'Project'],
  ['banc', 'Banc réel', 'Real bench'],
] as const
const POLL_MS = 2000 // session_status every 2 s while a session is open; read_simulation only when needed
const FOLLOW = 10 // reads of a run whose tests are still pending or running, at most (as /lab-defi)
const IDLE_MS = 60_000
const LINE = '#1C3352'
const VIS: Record<string, [string, string]> = { private: ['privée', 'private'], link: ['lien', 'link'], public: ['publique', 'public'] }
/** French or English, from the `fr` atom (the visitor's language, isFrench) */
const tr = (fr: boolean) => (f: string, en: string) => (fr ? f : en)

const lab = atom({ plugin: 'picodev-lab', key: 'lab' } as const, null)
const sim = atom({ plugin: 'picodev-lab', key: 'sim' } as const, null)
const status = atom({ plugin: 'picodev-lab', key: 'status' } as const, null)
const setups = atom({ plugin: 'picodev-lab', key: 'setups' } as const, [])
const publics = atom({ plugin: 'picodev-lab', key: 'publics' } as const, [])
const conn = atom({ plugin: 'picodev-lab', key: 'conn' } as const, null)
const vis = atom({ plugin: 'picodev-lab', key: 'vis' } as const, null)
const capture = atom({ plugin: 'picodev-lab', key: 'capture' } as const, null)
const sheet = atom({ plugin: 'picodev-lab', key: 'sheet' } as const, null)
const journal = atom({ plugin: 'picodev-lab', key: 'journal' } as const, [])
const curTab = atom({ plugin: 'picodev-lab', key: 'curTab' } as const, 'session')
const logo = atom({ plugin: 'picodev-lab', key: 'logoFrame' } as const, LOGO_DONE)
const openSecs = atom({ plugin: 'picodev-lab', key: 'open' } as const, {})
const hints = atom({ plugin: 'picodev-lab', key: 'hints' } as const, 0)
const nda = atom({ plugin: 'picodev-lab', key: 'nda' } as const, false)
const note = atom({ plugin: 'picodev-lab', key: 'note' } as const, '')
const updateTo = atom({ plugin: 'picodev-lab', key: 'update' } as const, null)
const autopush = atom({ plugin: 'picodev-lab', key: 'autopush' } as const, true)
const spec = atom({ plugin: 'picodev-lab', key: 'spec' } as const, null)
const specMore = atom({ plugin: 'picodev-lab', key: 'specMore' } as const, null)
const width = atom({ plugin: 'picodev-lab', key: 'width' } as const, 60)
const fr = atom({ plugin: 'picodev-lab', key: 'fr' } as const, true)
const confirm = atom({ plugin: 'picodev-lab', key: 'confirm' } as const, null)
const noSketch = atom({ plugin: 'picodev-lab', key: 'noSketch' } as const, false)
const inVscode = atom({ plugin: 'picodev-lab', key: 'inVscode' } as const, false)

// ponytail: module variables, lost on a reload and found again at the next poll. The agent token stays
// in the client (client.session) and in the session file, never in $.state.
let root = ''
let hub = LAB_SITE
let version = '0.0.0'
let busy = false
let compileSeen = '' // a hub without session_status: a new run is a new compile result
let hasStatus: boolean | null = null // the hub has session_status; null: not asked yet (tools())
let follow = 0 // read_simulation calls since the status last changed
let news = false // the last read_simulation brought events or other results
let logoTimer: { cancel: () => void } | null = null
const told = new Set<string>()

// ── files: the plugin's data directory, as Claude Code names it, or the fallback ──
const dataDirs = async ($: EngineInterface) => {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  // ponytail: CLAUDE_PLUGIN_DATA is not handed to a mod; these are its spellings (marketplace, --plugin-dir)
  return [`${config}/plugins/data/picodev-lab-picodev-lab`, `${config}/plugins/data/picodev-lab-inline`, `${home}/.claude/picodev-lab`]
}
const readJson = async ($: EngineInterface, path: string): Promise<Record<string, unknown> | null> => {
  try {
    const v = JSON.parse(await $.fs.read(path)) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
const firstJson = async ($: EngineInterface, name: string) => {
  for (const d of await dataDirs($)) {
    const v = await readJson($, `${d}/${name}`)
    if (v) return { dir: d, v }
  }
  return null
}
// Python as each system names it: python3 (Linux, macOS), else python or the py launcher (Windows, where
// python3 is often missing or a Store stub exiting 9009); the first that runs is kept for the session
const PYTHONS = [['python3'], ['python'], ['py', '-3']]
let python: string[] | null = null
const labPy = async ($: EngineInterface, args: string[]) => {
  const found = await firstJson($, `sessions/${projectKey(root)}.json`)
  const data = found?.dir ?? (await dataDirs($))[0]!
  let last = ''
  for (const py of python ? [python] : PYTHONS) {
    try {
      const r = await $.process.run([...py, `${$.plugin.root}/scripts/lab.py`, '--data', data, '--project', root, ...args], { timeoutMs: 150_000 }) // a push compiles: hooks.json gives it 120 s
      if (r.exitCode === 9009) continue
      python = py
      return { ok: r.exitCode === 0, text: (r.stdout || r.stderr).trim() }
    } catch (err) {
      last = String(err).slice(0, 80)
    }
  }
  return { ok: false, text: `Python introuvable (python3, python, py) ${last}`.trim() }
}

// ── the hub's MCP, through picodev-lab-client (hooks/vendor, see VERSION) ──
// ponytail: one client per hub, posting through the `$` that made it (as the timers use session.start's).
let client: LabClient | null = null
const hubClient = ($: EngineInterface) => {
  if (client?.url !== `${hub}/mcp`)
    client = new LabClient({
      url: `${hub}/mcp`,
      name: 'picodev-lab',
      version,
      post: (u, b, h) => $.http.fetch(u, { method: 'POST', headers: h, body: b }),
    })
  return client
}
const held = () => client?.session ?? null
/** What the pane says of a failed call: the hub's own text, or that it could not be reached. */
const why = (err: unknown) => (err instanceof LabError && err.kind !== 'transport' ? err.message : 'labo injoignable · lab unreachable')
const isGone = (err: unknown) => err instanceof LabError && err.kind === 'gone'

const say = ($: EngineInterface, text: string) => update($, note, () => text)
const tell = ($: EngineInterface, key: string, text: string) => {
  if (told.has(key)) return
  told.add(key)
  $.ui.toast(text)
}

// ── the loop: the session file, then read_simulation ──
const gone = async ($: EngineInterface) =>
  forget($, tr(await read($, fr))('picodev-lab : la session du labo est terminée', 'picodev-lab: the lab session has ended'))
// the session given up last: not taken up again from the session file, even if `clear` could not delete it
let forgotten = ''
let seen = '' // the session file's session at the last poll (the client drops its own on a "gone" answer)
const forget = async ($: EngineInterface, why: string) => {
  forgotten = seen || forgotten
  await labPy($, ['clear'])
  if (client) client.session = null
  await update($, lab, () => null)
  await update($, sim, () => null)
  await update($, status, () => null)
  await update($, vis, () => null)
  await update($, capture, () => null)
  $.ui.toast(why)
}

/** The newest run's events: from the end, while time does not go back (t restarts with each run). */
const newestRun = (events: SimEvent[]) => {
  let i = events.length - 1
  while (i > 0 && events[i - 1]!.t <= events[i]!.t) i--
  return events.slice(Math.max(0, i))
}

/** The Défi or Simulation card is in sight: the pane shown, on that tab, the card unfolded. */
const watching = async ($: EngineInterface) => {
  const [tab, open] = await Promise.all([read($, curTab), read($, openSecs)])
  const card = { defi: 'defi', simulation: 'sim' }[tab]
  if (!card || !isOpenIn(open, card)) return false
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
  } catch {
    return false
  }
}

const tick = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    const found = await firstJson($, `sessions/${projectKey(root)}.json`)
    const s = found?.v
    const before = await read($, lab)
    if (!s || typeof s.session !== 'string' || typeof s.agent_token !== 'string' || s.session === forgotten) {
      if (client) client.session = null
      if (before) {
        await update($, lab, () => null)
        await update($, sim, () => null)
        await update($, status, () => null)
      }
      return
    }
    seen = s.session
    const origin = originOf(String(s.open_url)) ?? hub
    if (origin !== hub) hasStatus = null
    hub = origin
    const lc = hubClient($)
    lc.session = { session: s.session, agent_token: s.agent_token, open_url: String(s.open_url) }
    const view: LabView = {
      session: s.session,
      setup: String(s.setup),
      mode: s.mode === 'free' ? 'free' : 'challenge',
      open_url: String(s.open_url),
      opened_at: Number(s.opened_at) || 0,
      sketch_dir: typeof s.sketch_dir === 'string' ? s.sketch_dir : undefined,
      last_push: s.last_push as LabView['last_push'],
    }
    if (before?.session !== view.session) {
      told.clear()
      compileSeen = ''
      follow = 0
      news = false
      await update($, sim, () => null)
      await update($, status, () => null)
      await update($, vis, () => null)
      await update($, capture, () => null)
      await update($, hints, () => 0)
      if ((await read($, sheet))?.id !== view.setup) void loadSheet($, view.setup)
      // not in VS Code (the extension is the lab's UI there), unless the visitor asked for the pane there
      const surfaces = await $.session.surfaces().catch(() => [] as const)
      if (!surfaces.includes('vscode') || (await read($, inVscode))) void $.ui.open({ id: PANE, title: 'Picodev Lab', columns: await read($, width) })
    }
    await update($, lab, () => view)

    if (hasStatus === null) {
      try {
        hasStatus = (await lc.tools()).some(t => t.name === 'session_status')
      } catch {
        // asked again next time
      }
    }
    const prev = await read($, sim)
    let isNewRun = false
    if (hasStatus) {
      // status() (session_status) is not reported to the visitor's journal; read_simulation is, so it waits for a change
      let now: SessionStatus
      try {
        now = await lc.status()
      } catch (err) {
        if (isGone(err)) await gone($)
        else await say($, why(err))
        return
      }
      const was = await read($, status)
      await update($, status, () => now)
      if (await read($, note)) await update($, note, () => '')
      isNewRun = !!was && now.run !== was.run
      if (!was || isNewRun || now.level !== was.level || now.owner !== was.owner) follow = 0
      else if (!((unsettled(prev?.results) && follow < FOLLOW) || (news && (await watching($))))) return
      follow++
    }

    let v: {
      state?: { level?: number; running?: boolean; results?: TestRow[] } | null
      compile?: { ok: boolean; log: string } | null
      events?: SimEvent[]
      challenge?: { level: number | null; brief: SimView['brief']; results: TestRow[] | null }
      circuit_modified?: boolean | null
    }
    try {
      v = await lc.read_simulation({ since_ms: isNewRun ? 0 : prev?.lastT ?? 0 })
    } catch (err) {
      if (isGone(err)) await gone($)
      else await say($, why(err))
      return
    }
    if (!hasStatus) {
      // ponytail: without `run`, a new compile result is taken for a new run
      const compileNow = JSON.stringify(v.compile ?? null)
      isNewRun = compileSeen !== '' && compileNow !== compileSeen
      compileSeen = compileNow
    }
    const kept = isNewRun ? [] : prev?.events ?? []
    const fresh = [...kept, ...(v.events ?? [])]
    // without `run`, a since_ms from the previous run may bring both: keep the newest run only
    const events = (hasStatus ? fresh : newestRun(fresh)).slice(-400)
    const next: SimView = {
      hasState: !!v.state,
      running: !!v.state?.running,
      level: v.challenge?.level ?? v.state?.level ?? null,
      brief: v.challenge?.brief ?? null,
      results: v.challenge?.results ?? v.state?.results ?? [],
      compile: v.compile ?? null,
      events,
      // without `run`, a new run starts its time again: ask from 0 next time
      lastT: isNewRun && !hasStatus ? 0 : events[events.length - 1]?.t ?? prev?.lastT ?? 0,
      circuitModified: v.circuit_modified ?? null,
    }
    news = (v.events ?? []).length > 0 || JSON.stringify(next.results) !== JSON.stringify(prev?.results ?? [])
    await update($, sim, () => next)
    if (await read($, note)) await update($, note, () => '')

    // notifications (P3.11)
    const T = tr(await read($, fr))
    const passed = (n: number) => T(`picodev-lab : niveau ${n + 1} réussi, en simulation`, `picodev-lab: level ${n + 1} passed, in simulation`)
    if (prev && next.level !== null) {
      if (allPassed(next.results) && !(prev.level === next.level && allPassed(prev.results))) tell($, `passed:${next.level}`, passed(next.level))
      if (prev.level !== null && next.level > prev.level) tell($, `passed:${prev.level}`, passed(prev.level))
    }
    if (isNewRun && next.compile && !next.compile.ok)
      $.ui.toast(T('picodev-lab : la compilation a échoué (onglet Simulation : demander à Claude de corriger)', 'picodev-lab: the compile failed (Simulation tab: ask Claude to fix it)'))
  } finally {
    // the end of the session, and a capture being recorded, whether the simulation was read or not
    const l = await read($, lab)
    const st = await read($, status)
    // without a browser, expires_at is 10 min away anyway: the band says so, no toast
    const end = st ? (st.owner ? st.expires_at : 0) : l?.opened_at ? l.opened_at + SESSION_HOURS * 3600 : 0
    const left = end - (await $.clock.now()) / 1000
    if (l && end && left < 600)
      tell($, 'ending', tr(await read($, fr))(`picodev-lab : la session se ferme dans ${hm(left)}`, `picodev-lab: the session closes in ${hm(left)}`))
    // the session's capture (the agent's) from session_status: read once when it is done
    // (read_capture is reported to the visitor's journal), again only for a new id
    const sc = st?.capture
    const cap = await read($, capture)
    if (l && held() && sc && (cap?.id !== sc.id || cap.state === 'recording')) {
      const was: CaptureView = cap?.id === sc.id ? cap : { id: sc.id, kind: sc.kind, state: 'recording', channels: [] }
      if (sc.state === 'recording') await update($, capture, () => was)
      else await readCapture($, was)
    }
    busy = false
    await refreshStatus($)
  }
}

const refreshStatus = async ($: EngineInterface) => {
  const [l, s, st, up, F] = await Promise.all([read($, lab), read($, sim), read($, status), read($, updateTo), read($, fr)])
  const T = tr(F)
  const dot = up ? ` · ● ${up}` : ''
  if (!l) return $.ui.status(`lab · ${T('pas de session', 'no session')}${dot}`)
  const away = st && !st.owner ? ` · ○ ${T('navigateur', 'browser')}` : ''
  if (l.mode === 'free') return $.ui.status(`lab · ${l.setup} · ${T('libre', 'free')}${away}${dot}`)
  const lvl = st ? levelOf(st.level, st.levels) : levelOf(s?.level)
  $.ui.status(`lab ${lvl} · ${passedOf(s?.results)}/${s?.results.length ?? 0}${away}${dot}`)
}

// ── what does not change while no session is open: setups, public sessions, the MCP, the plugin ──
const loadIdle = async ($: EngineInterface) => {
  const lc = hubClient($)
  const isFr = await french($)
  await update($, fr, () => isFr)
  const [tools, list] = await Promise.all([lc.tools().catch(() => null), lc.list_setups().catch(() => null)])
  await update($, conn, () => ({ ok: !!tools, tools: tools?.length ?? 0 }))
  if (tools) hasStatus = tools.some(t => t.name === 'session_status')
  if (Array.isArray(list)) {
    // the list's English (list_setups i18n, architecture 0.9.1), field by field, when the visitor is not French
    const each = (m: Setup): Setup => (isFr ? m : { ...m, title: m.i18n?.en?.title ?? m.title, summary: m.i18n?.en?.summary ?? m.summary })
    await update($, setups, () => (list as Setup[]).map(each))
  }
  try {
    const r = await $.http.fetch(`${hub}/hub/sessions/public`)
    if (r.ok) await update($, publics, () => (JSON.parse(r.text) as PublicSession[]).slice(0, 8))
  } catch {
    // no list, no card
  }
  const up = await firstJson($, 'update.json')
  const latest = typeof up?.v.latest === 'string' ? up.v.latest : null
  await update($, updateTo, () => (latest && isNewer(latest, version) ? latest : null))
  const st = await firstJson($, 'settings.json')
  await update($, autopush, () => st?.v.autopush !== false)
  await loadSpec($)
}

const loadSpec = async ($: EngineInterface) => {
  try {
    const text = await $.fs.read(`${root}/spec-projet.md`)
    await update($, spec, () => specDone(text))
    await update($, specMore, () => specExtras(text))
  } catch {
    await update($, spec, () => null)
    await update($, specMore, () => null)
  }
}

// ── actions ──
const openTab = async ($: EngineInterface, id: string) => {
  await update($, curTab, () => id)
  if (id === 'projet') await loadSpec($)
}
/** A card's fold; `dflt` when the visitor has not touched it ('how' is open on a first visit, without a session) */
const isOpenIn = (open: Record<string, boolean>, id: string, dflt = true) => open[id] ?? dflt
const howOpen = (l: LabView | null) => !l
const toggle = async ($: EngineInterface, id: string) => {
  const dflt = id === 'how' ? howOpen(await read($, lab)) : true
  await update($, openSecs, o => ({ ...o, [id]: !isOpenIn(o, id, dflt) }))
}
const resize = async ($: EngineInterface, delta: number) => {
  const cols = await update($, width, w => Math.min(120, Math.max(40, w + delta)))
  await $.ui.open({ id: PANE, title: 'Picodev Lab', columns: cols })
}

const animateLogo = ($: EngineInterface) => {
  logoTimer?.cancel()
  void update($, logo, () => 0)
  logoTimer = $.clock.every(90, () => {
    void update($, logo, f => f + 1).then(f => {
      if (f >= LOGO_DONE) {
        logoTimer?.cancel()
        logoTimer = null
      }
    })
  })
}

// A press hands the work to Claude in plain words (a plugin may not submit a slash command)
// (the text in the visitor's language, so that Claude answers in it)
const ask = ($: EngineInterface, text: string) => $.prompt.submit({ text })
const openSession = async ($: EngineInterface, setup: string, mode: string) =>
  ask(
    $,
    tr(await read($, fr))(
      `Ouvre une session Picodev Lab avec la skill lab du plugin picodev-lab : setup=${setup} mode=${mode === 'free' ? 'libre' : 'defi'}`,
      `Open a Picodev Lab session with the lab skill of the picodev-lab plugin: setup=${setup} mode=${mode === 'free' ? 'libre' : 'defi'}`,
    ),
  )
/** The press that hands Claude the work, in French or English. */
const askT = async ($: EngineInterface, f: string, en: string) => ask($, tr(await read($, fr))(f, en))
const solveLevel = ($: EngineInterface) =>
  askT($, 'Résous le niveau en cours du défi Picodev Lab avec la skill lab-defi du plugin picodev-lab.', 'Solve the current level of the Picodev Lab challenge with the lab-defi skill of the picodev-lab plugin.')
const fixCompile = ($: EngineInterface, log: string) =>
  askT(
    $,
    `Le sketch Picodev Lab ne compile pas. Corrige-le (skill lab-defi du plugin picodev-lab, ou en Libre directement), puis le hook le repoussera. Journal de compilation :\n${log.slice(-3000)}`,
    `The Picodev Lab sketch does not compile. Fix it (lab-defi skill of the picodev-lab plugin, or directly in free mode); the hook will push it again. Compiler log:\n${log.slice(-3000)}`,
  )
const starterSketch = ($: EngineInterface) =>
  askT(
    $,
    "Écris le sketch de départ du banc Picodev Lab dans sketch/ (read_simulation, state.files ; étape 7 de la skill lab du plugin picodev-lab), sans écraser un fichier existant sans me demander.",
    'Write the Picodev Lab bench starter sketch into sketch/ (read_simulation, state.files; step 7 of the lab skill of the picodev-lab plugin), without overwriting an existing file without asking me.',
  )
const meet = ($: EngineInterface) =>
  askT(
    $,
    'Je voudrais un rendez-vous avec Picodev ou leur poser une question : utilise la skill lab-projet du plugin picodev-lab, partie « Rendez-vous / informations ».',
    'I would like a meeting with Picodev or to ask them a question: use the lab-projet skill of the picodev-lab plugin, part « Rendez-vous / informations ».',
  )
const gitInit = async ($: EngineInterface) => {
  const r = await labPy($, ['git', 'init'])
  await say($, r.text)
  await tick($)
}

const setVisibility = async ($: EngineInterface, visibility: Visibility) => {
  if (!held()) return
  let v: { visibility: string; viewer_url: string | null }
  try {
    v = await hubClient($).set_visibility({ visibility })
  } catch (err) {
    return say($, why(err))
  }
  await update($, vis, () => ({ visibility: v.visibility, viewer_url: v.viewer_url }))
  await update($, status, st => st && { ...st, visibility: v.visibility, viewer_url: v.viewer_url })
  await addJournal($, 'set_visibility', true)
}

const endSession = async ($: EngineInterface) => {
  if (!held()) return
  const err = await hubClient($).close_session().then(() => null, (e: unknown) => e)
  await addJournal($, 'close_session', !err)
  if (!err || isGone(err)) await forget($, tr(await read($, fr))('picodev-lab : session terminée', 'picodev-lab: session ended'))
  else await say($, why(err))
}

const pushNow = async ($: EngineInterface) => {
  await say($, tr(await read($, fr))('compilation et envoi…', 'compiling and pushing…'))
  const l = await read($, lab)
  const r = await labPy($, ['push', l?.sketch_dir ?? `${root}/sketch`])
  // the first line is the outcome; a compile error's log follows, kept in the session file (last_push.log)
  await say($, r.text.split('\n')[0] ?? '')
  await update($, noSketch, () => /pas de dossier/.test(r.text))
  await tick($)
}

/** The bench's « Niveau suivant » (next_level, hub v0.6.3): the hub's level changes at the bench's next state, which the poll sees. */
const nextLevel = async ($: EngineInterface) => {
  if (!held()) return
  let v: { level: number; levels: number }
  try {
    v = await hubClient($).next_level()
  } catch (err) {
    await addJournal($, 'next_level', false)
    if (isGone(err)) return gone($)
    return say($, why(err))
  }
  await addJournal($, 'next_level', true)
  await tick($)
  await say($, tr(await read($, fr))(`niveau ${v.level + 1}/${v.levels} demandé au banc`, `level ${v.level + 1}/${v.levels} asked of the bench`))
}

/** The real bench's queue (contract 0.20): join an offer of the session's setup, or leave; the poll's session_status shows the place. */
const queue = async ($: EngineInterface, kind: string | null) => {
  if (!held()) return
  const tool = kind ? 'queue_join' : 'queue_leave'
  try {
    await (kind ? hubClient($).queue_join({ kind }) : hubClient($).queue_leave())
  } catch (err) {
    await addJournal($, tool, false)
    if (isGone(err)) return gone($)
    return say($, why(err))
  }
  await addJournal($, tool, true)
  await tick($)
}

const readCapture = async ($: EngineInterface, was: CaptureView) => {
  let cap: CaptureView
  try {
    const v = await hubClient($).read_capture({ capture: was.id })
    cap =
      v.kind === 'analog'
        ? { id: was.id, kind: 'analog', state: v.state, detail: v.detail, channels: [], analog: v.channels }
        : { id: was.id, kind: 'logic', state: v.state, detail: v.detail, channels: v.channels }
  } catch (err) {
    // the lab unreachable: read at the next poll; the lab's own error: that is the capture's end
    if (err instanceof LabError && err.kind === 'transport') return say($, why(err))
    return update($, capture, () => ({ ...was, state: 'failed', detail: why(err) }))
  }
  await update($, capture, () => cap)
}
/** The hub's chart of a ready capture (read_capture format "png", 4 a minute). */
const readChart = async ($: EngineInterface, id: string) => {
  let png: string | undefined
  try {
    png = (await hubClient($).read_capture({ capture: id, format: 'png' })).images?.[0]?.data
  } catch (err) {
    await addJournal($, 'read_capture', false)
    return say($, why(err))
  }
  await addJournal($, 'read_capture', true)
  await update($, capture, c => (c && c.id === id ? { ...c, png } : c))
}

/** The visitor's language (isFrench): Claude Code's `language` setting, else the POSIX locale. */
const french = async ($: EngineInterface) => {
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return isFrench(settings['language'], locale)
}

/** read_setup: not a session tool, so it also shows a setup before any session. */
const loadSheet = async ($: EngineInterface, id: string) => {
  let v: Awaited<ReturnType<LabClient['read_setup']>>
  try {
    v = await hubClient($).read_setup({ id })
  } catch (err) {
    await addJournal($, 'read_setup', false)
    return say($, why(err))
  }
  await addJournal($, 'read_setup', true)
  // the sheet's English, field by field, when the visitor is not French; a missing field stays French
  const en = (await french($)) ? undefined : (v.i18n?.en as { title?: string; levels?: SheetView['enLevels'] } | undefined)
  const view: SheetView = {
    id,
    title: en?.title ?? v.title,
    parts: partsOf(v.circuit, v.board.kind),
    probes: v.probes.map(p => `${p.label} · ${p.kind === 'scope' ? 'oscilloscope' : en ? 'logic analyzer' : 'analyseur logique'}`),
    png: v.images?.find(i => i.mimeType === 'image/png')?.data ?? null,
    enLevels: en?.levels ?? null,
  }
  await update($, sheet, () => view)
}

const addJournal = ($: EngineInterface, tool: string, ok: boolean) =>
  $.clock.now().then(at => update($, journal, j => [...j, { at, tool, ok } as JournalRow].slice(-50)))

const setAutopush = async ($: EngineInterface) => {
  const on = !(await read($, autopush))
  const r = await labPy($, ['autopush', on ? 'on' : 'off'])
  if (r.ok) await update($, autopush, () => on)
  else await say($, r.text)
}

const upgrade = async ($: EngineInterface) => {
  const T = tr(await read($, fr))
  await say($, T('mise à jour…', 'updating…'))
  try {
    await $.process.run(['claude', 'plugin', 'marketplace', 'update', 'picodev-lab'], { timeoutMs: 120_000 })
    const r = await $.process.run(['claude', 'plugin', 'update', 'picodev-lab@picodev-lab'], { timeoutMs: 120_000 })
    await say($, r.exitCode === 0 ? T('à jour : tapez /reload-plugins pour charger la nouvelle version', 'updated: type /reload-plugins to load the new version') : (r.stderr || r.stdout).trim().slice(0, 160))
  } catch {
    await say($, T('en échec : lancez claude plugin marketplace update picodev-lab', 'failed: run claude plugin marketplace update picodev-lab'))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    root = await $.session.root()
    const manifest = await readJson($, `${$.plugin.root}/.claude-plugin/plugin.json`)
    version = String(manifest?.version ?? version)
    const decl = await readJson($, `${$.plugin.root}/.mcp.json`)
    const servers = decl?.mcpServers as Record<string, { url?: string }> | undefined
    hub = originOf(servers?.['picodev-lab']?.url) ?? hub
    await $.command.register({ name: 'picodev-lab', description: 'Ouvre le panneau Picodev Lab (session, défi, simulation, projet)' })
    await tick($)
    void loadIdle($)
    $.clock.every(POLL_MS, () => tick($))
    $.clock.every(IDLE_MS, () => loadIdle($))
    return ran
  })

  on('command.run', { command: 'picodev-lab' }, async $ => {
    await Promise.all([tick($), loadIdle($)])
    await $.ui.open({ id: PANE, title: 'Picodev Lab', columns: await read($, width), focus: true })
    animateLogo($)
    return { text: 'Panneau Picodev Lab ouvert.' }
  })

  // The journal (P3.8): the agent's calls to the lab, as the browser's own journal shows them
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const m = /^mcp__.*picodev-lab__(\w+)$/.exec(String(e.tool))
    if (m) {
      await addJournal($, m[1]!, (ran as { isError?: boolean }).isError !== true)
      if (m[1] === 'open_session' || m[1] === 'close_session') void tick($)
    }
    return ran
  }).catch(($, e, next) => next(e)) // the journal never stands in a call's way

  // The band above the prompt (P3.9), and P2.4: a push that could not go is said here
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, lab)
    if (!l || e.props.hasSurvey || (e.surface === 'vscode' && !(await read($, inVscode)))) return next(e)
    const [s, v, st, F] = await Promise.all([read($, sim), read($, vis), read($, status), read($, fr)])
    const T = tr(F)
    const { Box, Text, Link } = $.ui.resolve(e)
    const end = st ? st.expires_at : l.opened_at ? l.opened_at + SESSION_HOURS * 3600 : 0
    const left = end - (await $.clock.now()) / 1000
    const failed = l.last_push && !l.last_push.ok ? l.last_push.message : ''
    const lvl = st ? st.level : s?.level
    const level = lvl == null ? '' : `${T('niveau', 'level')} ${levelOf(lvl, st?.levels)}`
    const visibility = st?.visibility ?? v?.visibility
    const browser = st ? st.owner : s?.hasState
    return (
      <Box flexDirection="column">
        <Box gap={2} flexWrap="wrap">
          <Text color={CORAL}>● Lab</Text>
          <Text>
            {l.setup} · {l.mode === 'free' ? T('Libre', 'Free') : T('Défi', 'Challenge')}
          </Text>
          {l.mode === 'challenge' && level !== '' && <Text>{level}</Text>}
          {l.mode === 'challenge' && s && s.results.length > 0 && (
            <Text>
              tests {passedOf(s.results)}/{s.results.length}
            </Text>
          )}
          {!browser && <Link href={l.open_url} label={T('[ en attente du navigateur : ouvrir le banc ]', '[ waiting for the browser: open the bench ]')} />}
          {visibility && <Text color={SUBTLE}>{VIS[visibility]?.[F ? 0 : 1] ?? visibility}</Text>}
          {st && st.viewers > 0 && (
            <Text color={SUBTLE}>
              {st.viewers} {T('spectateur', 'viewer')}
              {st.viewers > 1 ? 's' : ''}
            </Text>
          )}
          {end > 0 && <Text color={SUBTLE}>{hm(left)}</Text>}
        </Box>
        {failed && <Text color={KO}>⚠ {failed}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    // pictures (schema.png, the capture chart) where the surface draws them: the terminal; a link elsewhere
    const Image = e.surface === 'terminal' ? $.ui.resolve(e).Image : null
    const [tab, l, s, st, pubs, cn, vSet, cap, jr, frame, open, nHints, isNda, msg, up, ap, sp, ss, sh, F, pending, noSk] = await Promise.all([
      read($, curTab), read($, lab), read($, sim), read($, setups), read($, publics), read($, conn), read($, vis),
      read($, capture), read($, journal), read($, logo), read($, openSecs), read($, hints), read($, nda), read($, note),
      read($, updateTo), read($, autopush), read($, spec), read($, status), read($, sheet), read($, fr), read($, confirm),
      read($, noSketch),
    ])
    const T = tr(F)
    const more = await read($, specMore)
    // in VS Code, the Picodev Lab extension is the lab's UI (a richer one): this pane steps aside unless asked
    if (e.surface === 'vscode' && !(await read($, inVscode))) {
      return (
        <Box flexDirection="column" backgroundColor={NAVY} gap={1}>
          <Text color={INK} bold>Picodev Lab</Text>
          <Text color={MUTED}>
            {T(
              "Dans VS Code, c'est l'extension Picodev Lab qui montre le labo : sa vue dans la barre d'activité, et le bouton « donner la session à l'agent IA ». Ce panneau sert au terminal.",
              'In VS Code, the Picodev Lab extension shows the lab: its view in the activity bar, and the "give the session to the AI agent" button. This pane is for the terminal.',
            )}
          </Text>
          <Button key="inVscode" label={T('afficher le panneau ici quand même', 'show the pane here anyway')} onPress={() => update($, inVscode, () => true)} />
        </Box>
      )
    }
    // the hub's word when it has session_status; else what set_visibility and read_simulation said (hub v0.4.1)
    const v = ss ? { visibility: ss.visibility, viewer_url: ss.viewer_url } : vSet
    const browser = ss ? ss.owner : !!s?.hasState
    const lvl = ss ? ss.level : s?.level ?? null
    const now = (await $.clock.now()) / 1000
    const cols = Math.max(20, e.props.bodyColumns - 6)
    const isOpen = (id: string) => isOpenIn(open, id, id === 'how' ? howOpen(l) : true)
    const modeName = (m: string) => (m === 'free' ? T('Libre', 'Free') : T('Défi', 'Challenge'))
    const visName = (id: string) => VIS[id]?.[F ? 0 : 1] ?? id

    const row = (k: string, value: JSX.Element | string, color = INK) => (
      <Box justifyContent="space-between">
        <Text color={SUBTLE}>{k}</Text>
        {typeof value === 'string' ? <Text color={color}>{value}</Text> : value}
      </Box>
    )
    const act = (key: string, label: string, onPress: () => unknown) => (
      <Button key={key} plain onPress={onPress}>
        <Text backgroundColor={CORAL} color={PANEL} bold>
          {` ${label} `}
        </Text>
      </Button>
    )
    const btn = (key: string, label: string, onPress: (p: { surface: string }) => unknown) => <Button key={key} label={label} onPress={onPress} />
    const card = (id: string, title: string, body: () => (JSX.Element | false | '' | undefined | null)[], right?: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1}>
        <Box>
          <Text color={SUBTLE}>{isOpen(id) ? '▾ ' : '▸ '}</Text>
          <Button key={`sec:${id}`} plain label={title} onPress={() => toggle($, id)} />
          {right && <Text color={SUBTLE}> · {right}</Text>}
        </Box>
        {isOpen(id) && body()}
      </Box>
    )
    const soon = <Text backgroundColor={MUTED} color={PANEL}>{T(' BIENTÔT ', ' SOON ')}</Text>
    const picture = (png: string, alt: string) => Image && <Image source={{ png }} {...imageBox(png, Math.min(cols - 4, 100))} alt={alt} />
    const benchLink = (l: LabView) => <Link href={l.open_url} label={T('[ ouvrir le banc ]', '[ open the bench ]')} />
    const ask1 = (text: string) => update($, confirm, () => text)
    const cancel = btn('cancel', T('annuler', 'cancel'), () => update($, confirm, () => null))
    // a compile that failed: the lab's (read_simulation), or on the visitor's machine (lab.py, last_push.log)
    const localLog = l?.last_push && !l.last_push.ok ? l.last_push.log : undefined
    const cloudLog = s?.compile && !s.compile.ok ? s.compile.log : undefined
    const failedLog = localLog ?? cloudLog
    const fixBtn = (key: string) => failedLog && act(key, T('demander à Claude de corriger', 'ask Claude to fix it'), () => fixCompile($, failedLog))
    const starter = noSk && (
      <Box flexWrap="wrap" gap={1}>
        <Text color={KO}>{T('pas encore de dossier sketch/ dans ce projet', 'no sketch/ folder in this project yet')}</Text>
        {act('starter', T('écrire le sketch de départ', 'write the starter sketch'), () => starterSketch($))}
      </Box>
    )
    const origin = s?.compile?.origin ?? l?.last_push?.path
    const compiledBy =
      origin === 'agent' ? T('compilé sur votre poste (arduino-cli)', 'compiled on your machine (arduino-cli)') : origin === 'cloud' ? T('compilé par le labo', 'compiled by the lab') : '—'
    const where = (dir: string) => (root && dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) + '/' : dir)
    const clicks = e.surface === 'terminal' && (
      <Text color={SUBTLE}>{T('Les boutons répondent au clic avec le terminal en mode plein écran.', 'Buttons respond to clicks with the terminal in fullscreen mode.')}</Text>
    )

    // ── the setup sheet (read_setup): schema.png and its parts; the circuit is edited by Claude (/lab-montage), not here ──
    const montage = (m: SheetView) =>
      card('montage', `${T('Montage', 'Circuit')} · ${m.title}`, () => [
        m.png && picture(m.png, T(`schéma de ${m.id}`, `diagram of ${m.id}`)),
        ...m.parts.map(p => <Text color={INK}>{p}</Text>),
        ...m.probes.map(p => <Text color={SUBTLE}>{T('mesure', 'probe')} · {p}</Text>),
        l?.setup === m.id && s?.circuitModified && (
          <Text color={CORAL}>{T('circuit modifié dans le banc : le schéma montre celui de départ', 'circuit changed in the bench: the diagram shows the starting one')}</Text>
        ),
        m.png && <Link href={`${hub}/setups/${m.id}/schema.png`} label={T('[ schéma en grand ]', '[ full-size diagram ]')} />,
      ])

    // ── header: the logo (P7) and the update banner (P6) ──
    const header = (
      <Box flexDirection="column">
        {!l && (
          <Box gap={2} alignItems="center">
            <Box flexDirection="column">
              {drawLogo(frame).map(runs => (
                <Text>
                  {runs.map(c => (
                    <Text color={c.fg} backgroundColor={c.bg}>
                      {c.text}
                    </Text>
                  ))}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column">
              {frame >= LOGO_DONE ? (
                <Button key="logoReplay" plain onPress={() => animateLogo($)}>
                  <Text color={INK} bold>
                    picodev
                  </Text>
                </Button>
              ) : (
                <Text color={INK} bold>
                  {nameAt(frame)}▏
                </Text>
              )}
              <Text color={SUBTLE}>
                {T('Lab · banc Arduino simulé', 'Lab · simulated Arduino bench')} · {version}
              </Text>
              {clicks}
            </Box>
          </Box>
        )}
        {up && (
          <Box borderStyle="round" borderColor={CORAL} paddingX={1} gap={1} flexWrap="wrap">
            <Text color={CORAL}>●</Text>
            <Text color={INK}>
              picodev-lab {up} {T('disponible', 'available')}
            </Text>
            <Button key="upgrade" label={T('mettre à jour', 'update')} onPress={() => upgrade($)} />
            <Link href={`${RELEASES}${up}`} label={T('nouveautés', "what's new")} />
          </Box>
        )}
      </Box>
    )

    const tabs = (
      <Box flexWrap="wrap" gap={2}>
        {TABS.map(([id, f, en]) => {
          const title = id === 'defi' && l?.mode === 'free' ? T('Libre', 'Free') : T(f, en)
          return id === tab ? (
            <Text color={INK} underline bold>
              {title}
            </Text>
          ) : (
            <Button key={`tab:${id}`} plain dimColor label={title} onPress={() => openTab($, id)} />
          )
        })}
      </Box>
    )

    // ── how it works, in plain words: open on a first visit (no session), folded once a session is open ──
    const how = card('how', T('Comment ça marche', 'How it works'), () => [
      <Text color={MUTED}>
        {T(
          "1. Choisissez un montage : Libre pour programmer ce que vous voulez, Défi pour des niveaux avec des tests. Claude ouvre la session.",
          '1. Pick a setup: Free to program whatever you like, Challenge for levels with tests. Claude opens the session.',
        )}
      </Text>,
      <Text color={MUTED}>
        {T(
          '2. Ouvrez le lien du banc dans votre navigateur : la carte Arduino y est simulée, rien à brancher.',
          '2. Open the bench link in your browser: the Arduino board is simulated there, nothing to wire.',
        )}
      </Text>,
      <Text color={MUTED}>
        {T(
          "3. Demandez à Claude d'écrire ou de corriger le programme (le sketch). À chaque modification, il est compilé (sur votre poste si arduino-cli est installé, sinon par le labo) et part au banc.",
          '3. Ask Claude to write or fix the program (the sketch). Each change is compiled (on your machine when arduino-cli is installed, else by the lab) and sent to the bench.',
        )}
      </Text>,
      <Text color={MUTED}>
        {T(
          '4. Claude lit ce que fait la simulation et vous explique. /lab-defi résout un niveau avec vous, /lab-montage change le circuit (Libre), /lab-partage montre votre banc, /lab-projet décrit votre propre projet à Picodev.',
          '4. Claude reads what the simulation does and explains. /lab-defi solves a level with you, /lab-montage changes the circuit (Free), /lab-partage shows your bench, /lab-projet describes your own project to Picodev.',
        )}
      </Text>,
      clicks,
    ])

    // ── Session tab ──
    const levels = levelsPassed(lvl, s?.results)
    const elapsed = l ? now - (ss?.created_at ?? l.opened_at) : 0
    const end = ss ? ss.expires_at : l ? l.opened_at + SESSION_HOURS * 3600 : 0
    const pub = l ? pubs.find(p => p.session === l.session) : undefined
    const viewers = ss ? ss.viewers : pub ? pub.viewers : 0
    const visTo = pending?.startsWith('vis:') ? (pending.slice(4) as Visibility) : null
    const VIS_SAYS: Record<string, [string, string]> = {
      private: ['personne ne regarde', 'nobody watches'],
      link: ['qui a le lien spectateur regarde', 'whoever has the viewer link watches'],
      public: ['listée sur lab.picodev.fr, tout le monde peut regarder', 'listed on lab.picodev.fr, anyone can watch'],
    }
    const next = !l
      ? null
      : !browser
        ? [T('ouvrez le banc dans votre navigateur : la simulation y tourne.', 'open the bench in your browser: the simulation runs there.'), benchLink(l)]
        : l.mode === 'challenge'
          ? [
              T("l'onglet Défi montre le niveau et ses tests ; demandez à Claude « /lab-defi » pour le résoudre ensemble.", 'the Challenge tab shows the level and its tests; ask Claude "/lab-defi" to solve it together.'),
              btn('goDefi', T('aller au Défi', 'go to the challenge'), () => openTab($, 'defi')),
            ]
          : [
              T(
                "demandez à Claude d'écrire un sketch (« fais clignoter la LED »), ou « /lab-montage » pour changer le circuit.",
                'ask Claude to write a sketch ("blink the LED"), or "/lab-montage" to change the circuit.',
              ),
              btn('goFree', T('aller à Libre', 'go to Free'), () => openTab($, 'defi')),
            ]
    const sessionTab = l
      ? [
          card('session', 'Session', () => [
            next && (
              <Box flexWrap="wrap" gap={1}>
                <Text color={CORAL}>→ {T('Étape suivante :', 'Next step:')}</Text>
                <Text color={INK}>{next[0]}</Text>
                {next[1]}
              </Box>
            ),
            row(T('montage', 'setup'), `${l.setup} · ${modeName(l.mode)}`),
            row(
              T('navigateur', 'browser'),
              browser ? T('● connecté (propriétaire)', '● connected (owner)') : T('○ en attente : ouvrez le banc', '○ waiting: open the bench'),
              browser ? OK : SUBTLE,
            ),
            row('sketch', l.sketch_dir ? where(l.sketch_dir) : T('pas encore envoyé', 'not pushed yet'), l.sketch_dir ? INK : SUBTLE),
            row(T('dernier envoi', 'last push'), compiledBy, origin ? INK : SUBTLE),
            <Box justifyContent="space-between">
              <Text color={SUBTLE}>{T('visibilité', 'visibility')}</Text>
              <Box gap={1}>
                {(['private', 'link', 'public'] as const).map(id =>
                  v?.visibility === id ? (
                    <Text backgroundColor={INK} color={PANEL}>{` ${visName(id)} `}</Text>
                  ) : (
                    <Button key={`vis:${id}`} label={visName(id)} onPress={() => ask1(`vis:${id}`)} />
                  ),
                )}
              </Box>
            </Box>,
            visTo && (
              <Box flexWrap="wrap" gap={1}>
                <Text color={CORAL}>
                  {T(`Passer en « ${visName(visTo)} » : ${VIS_SAYS[visTo]![0]}.`, `Switch to "${visName(visTo)}": ${VIS_SAYS[visTo]![1]}.`)}
                  {viewers > 0 ? T(` Les ${viewers} spectateurs en place sont coupés.`, ` The ${viewers} current viewers are cut off.`) : ''}
                </Text>
                {act('visYes', T('oui, changer', 'yes, switch'), async () => {
                  await update($, confirm, () => null)
                  await setVisibility($, visTo)
                })}
                {cancel}
              </Box>
            ),
            row(T('spectateurs', 'viewers'), ss || pub ? String(viewers) : '—'),
            row(
              T('fin', 'ends'),
              ss
                ? `${T('dans', 'in')} ${hm(end - now)}${ss.owner ? '' : T(' · navigateur absent', ' · browser away')}`
                : `${T('dans', 'in')} ${hm(end - now)} · ${T('10 min sans navigateur', '10 min without a browser')}`,
            ),
            <Box flexWrap="wrap" gap={1}>
              {benchLink(l)}
              {v?.viewer_url && btn('copyViewer', T('copier le lien spectateur', 'copy the viewer link'), p => $.ui.copy({ text: v.viewer_url ?? '', surface: p.surface as never }))}
              {pending !== 'end' && btn('end', T('terminer', 'end'), () => ask1('end'))}
            </Box>,
            pending === 'end' && (
              <Box flexWrap="wrap" gap={1}>
                <Text color={CORAL}>
                  {T('Terminer la session ? Le banc se ferme, pour vous et les spectateurs.', 'End the session? The bench closes, for you and the viewers.')}
                </Text>
                {act('endYes', T('oui, terminer', 'yes, end it'), async () => {
                  await update($, confirm, () => null)
                  await endSession($)
                })}
                {cancel}
              </Box>
            ),
            !v?.viewer_url && (
              <Text color={SUBTLE}>
                {ss
                  ? T('session privée : pas de lien spectateur', 'private session: no viewer link')
                  : T("le lien spectateur s'obtient en choisissant la visibilité", 'the viewer link comes with choosing the visibility')}
              </Text>
            ),
            // the local git repository (lab.py git init): offered when the sketch's folder is in none
            l.git
              ? row('git', T('un commit local après chaque envoi', 'a local commit after each push'))
              : l.sketch_dir &&
                l.in_repo === false && (
                  <Box flexWrap="wrap" gap={1}>
                    <Text color={SUBTLE}>
                      {T("le dossier du sketch n'est pas dans un dépôt git : un commit par envoi garderait chaque version, sur votre poste seulement", "the sketch's folder is not in a git repository: a commit a push would keep each version, on your machine only")}
                    </Text>
                    {btn('gitInit', T('créer un dépôt git local', 'create a local git repository'), () => gitInit($))}
                  </Box>
                ),
          ]),
          sh?.id === l.setup && montage(sh),
          how,
        ]
      : [
          card('conn', T('Connexion', 'Connection'), () => [
            row(
              T('labo', 'lab'),
              cn ? (cn.ok ? `● ${T('joignable', 'reachable')} · ${hub.replace(/^https?:\/\//, '')}` : T('○ injoignable', '○ unreachable')) : '…',
              cn?.ok ? OK : SUBTLE,
            ),
            row('plugin', `picodev-lab ${version}`),
          ]),
          card('setups', T('Montages', 'Setups'), () => [
            <Text color={SUBTLE}>
              {T(
                "Libre : vous programmez ce que vous voulez. Défi : des niveaux, chacun avec ses tests. BIENTÔT : ce mode n'existe pas encore pour ce montage. Libre et Défi demandent à Claude d'ouvrir la session ; « schéma » montre le montage ici.",
                'Free: program whatever you like. Challenge: levels, each with its tests. SOON: not yet for this setup. Free and Challenge ask Claude to open the session; "diagram" shows the setup here.',
              )}
            </Text>,
            ...(st.length === 0
              ? [<Text color={SUBTLE}>{T("aucun montage disponible pour l'instant", 'no setup available for now')}</Text>]
              : st.map(m => (
                  <Box justifyContent="space-between">
                    <Text color={INK}>{m.title ?? m.id}</Text>
                    <Box gap={1}>
                      {btn(`sheet:${m.id}`, T('schéma', 'diagram'), () => loadSheet($, m.id))}
                      {m.modes.includes('free') ? btn(`free:${m.id}`, T('Libre', 'Free'), () => openSession($, m.id, 'free')) : soon}
                      {m.modes.includes('challenge') ? act(`challenge:${m.id}`, T('Défi', 'Challenge'), () => openSession($, m.id, 'challenge')) : soon}
                    </Box>
                  </Box>
                ))),
          ]),
          sh && montage(sh),
          card('publics', T('Sessions publiques', 'Public sessions'), () =>
            pubs.length === 0
              ? [<Text color={SUBTLE}>{T('aucune en ce moment', 'none right now')}</Text>]
              : pubs.map(p => (
                  <Box justifyContent="space-between">
                    <Text color={INK}>
                      {p.setup} · {p.mode === 'free' ? T('Libre', 'Free') : `${T('Défi niveau', 'Challenge level')} ${(p.level ?? 0) + 1}`} · {hm(now - p.started_at)}
                    </Text>
                    <Link href={`${hub}/w/${p.session}#v=${p.viewer}`} label={T('[ regarder ]', '[ watch ]')} />
                  </Box>
                )),
          ),
          how,
        ]

    // ── Défi tab (Libre in free mode) ──
    const enLevel = sh?.id === l?.setup && s?.brief?.id ? sh?.enLevels?.[s.brief.id] : undefined
    const brief = s?.brief ? { ...s.brief, ...enLevel } : null
    const hintsAll = brief?.hints ?? []
    // as the bench offers « Niveau suivant »: all green, owner connected, not the last level (levels unknown: the hub decides)
    const green = browser && allPassed(s?.results)
    const last = lvl != null && ss?.levels != null && lvl + 1 >= ss.levels
    // the hub's signed link (contract 0.20) when it gives one, else the one built here
    const link = ss?.share?.startsWith('/p/') ? `${hub}${ss.share}` : l ? shareLink(hub, l.setup, l.mode, levels, elapsed) : ''
    const text = l ? shareText(l.mode, levels, elapsed, F) : ''
    const nets = shareUrls(text, link)
    const noSession = <Text color={SUBTLE}>{T("Pas de session : choisissez un montage dans l'onglet Session (Libre ou Défi), ou tapez /lab.", 'No session: pick a setup in the Session tab (Free or Challenge), or type /lab.')}</Text>
    const compileFailed = failedLog && (
      <Box flexWrap="wrap" gap={1}>
        <Text color={KO}>
          {localLog ? T('le sketch ne compile pas sur votre poste : rien n\'est parti au banc', 'the sketch does not compile on your machine: nothing went to the bench') : T('la compilation a échoué', 'the compile failed')}
        </Text>
        {fixBtn('fixDefi')}
      </Box>
    )
    const project = card('cta', T('Et pour votre projet ?', 'And for your own project?'), () => [
      <Text color={MUTED}>
        {T(
          'Un projet de carte ? Décrivez-le, nous vous aidons à le formaliser en spécification. Et la même chose que le labo pour votre carte : compilation reproductible, bancs de test pilotés à distance, agents.',
          'A board in mind? Describe it, we help you formalize it into a specification. And the same as the lab for your board: reproducible builds, remotely driven test benches, agents.',
        )}
      </Text>,
      <Box flexWrap="wrap" gap={1}>
        {act('brief', T('décrire mon projet (spec PDF)', 'describe my project (PDF spec)'), () =>
          askT($, 'Aide-moi à décrire mon projet avec la skill lab-projet du plugin picodev-lab.', 'Help me describe my project with the lab-projet skill of the picodev-lab plugin.'),
        )}
        {btn('meet', T('rendez-vous / informations', 'meeting / information'), () => meet($))}
        <Link href={SITE} label="[ picodev.fr ]" />
      </Box>,
    ])
    const defiTab = !l
      ? [noSession]
      : [
          l.mode === 'challenge' &&
            card('defi', `${T('Défi · niveau', 'Challenge · level')} ${levelOf(lvl, ss?.levels)}`, () => [
              !browser && (
                <Box flexWrap="wrap" gap={1}>
                  <Text color={SUBTLE}>{T('En attente du navigateur :', 'Waiting for the browser:')}</Text>
                  {benchLink(l)}
                </Box>
              ),
              brief?.title && <Text color={INK}>{brief.title}</Text>,
              brief?.brief && <Text color={MUTED}>{brief.brief}</Text>,
              ...(s?.results ?? []).map(t => (
                <Text>
                  <Text color={t.status === 'passed' ? OK : t.status === 'failed' ? KO : SUBTLE}>
                    {t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '…'}{' '}
                  </Text>
                  <Text color={INK}>{t.id}</Text>
                  {t.detail && <Text color={SUBTLE}> · {t.detail}</Text>}
                </Text>
              )),
              ...hintsAll.slice(0, nHints).map((hint, i) => (
                <Text color={MUTED}>
                  {T('indice', 'hint')} {i + 1} : {hint}
                </Text>
              )),
              compileFailed,
              green && last && <Text color={OK}>{T('niveau réussi, terminez dans le banc', 'level passed, finish in the bench')}</Text>,
              <Box flexWrap="wrap" gap={1}>
                {green && !last && act('nextLevel', T('Niveau suivant', 'Next level'), () => nextLevel($))}
                {!green && act('solve', T('résoudre ce niveau avec Claude', 'solve this level with Claude'), () => solveLevel($))}
                {btn('pushTest', T('▶ pousser le sketch tel quel', '▶ push the sketch as it is'), () => pushNow($))}
                {nHints < hintsAll.length && btn('hint', `${T('indice', 'hint')} (${nHints + 1}/${hintsAll.length})`, () => update($, hints, n => n + 1))}
              </Box>,
              starter,
              <Text color={SUBTLE}>
                {T(
                  '« résoudre » demande à Claude la boucle /lab-defi (mesurer, corriger, relire les tests) ; « pousser » envoie le sketch du disque sans le changer.',
                  '"solve" asks Claude for the /lab-defi loop (measure, fix, read the tests again); "push" sends the sketch on disk unchanged.',
                )}
              </Text>,
            ]),
          l.mode === 'free' &&
            card('libre', `${T('Libre', 'Free')} · ${l.setup}`, () => [
              !browser && (
                <Box flexWrap="wrap" gap={1}>
                  <Text color={SUBTLE}>{T('En attente du navigateur :', 'Waiting for the browser:')}</Text>
                  {benchLink(l)}
                </Box>
              ),
              <Text color={MUTED}>
                {T(
                  "Pas de tests ici : demandez à Claude ce que vous voulez (« fais clignoter la LED »). Il écrit le sketch, qui part au banc à chaque modification.",
                  'No tests here: ask Claude for what you want ("blink the LED"). It writes the sketch, which goes to the bench at each change.',
                )}
              </Text>,
              <Text color={MUTED}>
                {T('Changer le circuit (ajouter une LED, un bouton) : /lab-montage, ou le bouton ci-dessous.', 'Change the circuit (add an LED, a button): /lab-montage, or the button below.')}
              </Text>,
              compileFailed,
              <Box flexWrap="wrap" gap={1}>
                {act('pushFree', T('▶ pousser le sketch', '▶ push the sketch'), () => pushNow($))}
                {btn('circuit', T('changer le circuit avec Claude', 'change the circuit with Claude'), () =>
                  askT(
                    $,
                    'Je veux changer le circuit de ma session Picodev Lab : utilise la skill lab-montage du plugin picodev-lab et demande-moi ce que je veux ajouter ou changer.',
                    'I want to change the circuit of my Picodev Lab session: use the lab-montage skill of the picodev-lab plugin and ask me what to add or change.',
                  ),
                )}
              </Box>,
              starter,
            ]),
          (levels > 0 || l.mode === 'free') &&
            card('share', T('Partager', 'Share'), () => [
              <Text color={SUBTLE}>
                {l.mode === 'challenge' ? `${levels} ${T('niveau', 'level')}${levels > 1 ? T('x', 's') : ''} ${T('réussi', 'passed')}${levels > 1 && F ? 's' : ''} · ${minSec(elapsed)} · ` : ''}
                {T('résultat obtenu en simulation, dans votre navigateur', 'result obtained in simulation, in your browser')}
              </Text>,
              row(T('lien', 'link'), link.replace(/^https?:\/\//, '')),
              <Text color={MUTED}>« {text} »</Text>,
              <Box flexWrap="wrap" gap={1}>
                <Link href={nets.linkedin} label="[ LinkedIn ]" />
                <Link href={nets.x} label="[ X ]" />
                {btn('copyShare', T('copier le lien', 'copy the link'), p => $.ui.copy({ text: link, surface: p.surface as never }))}
              </Box>,
            ]),
          levels > 0 && project,
        ]

    // ── Simulation tab ──
    const waves = traces(s?.events ?? [], Math.max(8, cols - 8))
    const serial = serialTail(s?.events ?? [], 3)
    const simTab = !l
      ? [noSession]
      : [
          card('sim', 'Simulation', () => [
            row(
              'compilation',
              s?.compile
                ? `${s.compile.ok ? 'ok' : T('erreurs', 'errors')}${s.compile.origin ? ` · ${s.compile.origin === 'agent' ? T('sur votre poste', 'on your machine') : T('par le labo', 'by the lab')}` : ''}`
                : s?.running
                  ? T('en cours', 'running')
                  : '—',
              s?.compile ? (s.compile.ok ? OK : KO) : SUBTLE,
            ),
            localLog && <Text color={KO}>{T('sur votre poste, rien envoyé :', 'on your machine, nothing sent:')}</Text>,
            failedLog && <Text color={KO}>{failedLog.trim().split('\n').slice(-6).join('\n')}</Text>,
            fixBtn('fixCompile'),
            ...waves.map(w => (
              <Text>
                <Text color={SUBTLE}>{w.pin.padEnd(5)}</Text>
                <Text color={w.pin === waves[0]?.pin ? '#8FB0E8' : CORAL}>{w.wave}</Text>
              </Text>
            )),
            waves.length === 0 && <Text color={SUBTLE}>{T('pas encore de traces', 'no traces yet')}</Text>,
            serial.length > 0 && (
              <Text color={MUTED}>
                {T('série', 'serial')} · {serial.join(' · ')}
              </Text>
            ),
          ]),
          card('capture', 'Capture', () => {
            // only the session's capture, the agent's: the pane starts none (it would replace the agent's)
            if (!cap)
              return [
                <Text color={SUBTLE}>
                  {T(
                    "Pas encore de capture. Celle de l'agent s'affiche ici quand il en lance une : demandez à Claude, par exemple « capture D2 pendant 1 s ».",
                    'No capture yet. The agent\'s shows here when it starts one: ask Claude, for example "capture D2 for 1 s".',
                  )}
                </Text>,
              ]
            const kind = cap.kind === 'analog' ? T('Analogique', 'Analog') : T('Logique', 'Logic')
            const hz = (ms?: number) => (ms ? ` · ${(1000 / ms).toFixed(1)} Hz` : '')
            if (cap.state === 'recording') return [<Text color={SUBTLE}>{kind} · {T('enregistrement…', 'recording…')}</Text>]
            if (cap.state === 'failed')
              return [
                <Text color={KO}>
                  {kind} · {T('la capture a échoué.', 'the capture failed.')}
                  {cap.detail ? ` ${cap.detail}` : ''}
                </Text>,
              ]
            return [
              <Box gap={1}>
                <Text color={INK} bold>{kind}</Text>
                {!cap.png && btn('chart', T('chronogramme', 'timing chart'), () => readChart($, cap.id))}
              </Box>,
              ...(cap.kind === 'logic'
                ? cap.channels.map(c => (
                    <Text>
                      <Text color={SUBTLE}>{(c.label ?? `D${c.pin}`).padEnd(6)}</Text>
                      <Text color={INK}>
                        {c.edges} {T('fronts', 'edges')}
                        {hz(c.period_ms)}
                        {c.duty !== undefined ? ` · ${T('rapport', 'duty')} ${Math.round(c.duty * 100)} %` : ''}
                        {c.period_ms === undefined && c.high_ms !== undefined
                          ? ` · ${T('haut', 'high')} ${c.high_ms.toFixed(1)} ms · ${T('bas', 'low')} ${(c.low_ms ?? 0).toFixed(1)} ms`
                          : ''}
                      </Text>
                    </Text>
                  ))
                : (cap.analog ?? []).map(c => {
                    const volts = (x: number | null) => (x === null ? '—' : `${x.toFixed(2)} V`)
                    return (
                      <Text>
                        <Text color={SUBTLE}>{c.label.padEnd(6)}</Text>
                        <Text color={INK}>
                          min {volts(c.min_v)} · max {volts(c.max_v)} · {T('moy', 'mean')} {volts(c.mean_v)}
                          {hz(c.period_ms)}
                        </Text>
                      </Text>
                    )
                  })),
              cap.png &&
                (picture(cap.png, T('chronogramme de la capture', 'timing chart of the capture')) || (
                  <Text color={SUBTLE}>{T('chronogramme reçu : il se voit dans le terminal (ou demandez-le à Claude)', 'chart received: it shows in the terminal (or ask Claude for it)')}</Text>
                )),
              <Text color={SUBTLE}>
                {T("mesures en simulation · pour le détail, demandez à Claude, ou ouvrez l'analyseur du banc", "measured in simulation · for the detail, ask Claude, or open the bench's analyzer")}
              </Text>,
            ]
          }),
        ]

    // ── Journal tab ──
    const journalTab = [
      card('journal-all', `${T("Journal de l'agent", "Agent's log")} · ${jr.length} ${T('appel', 'call')}${jr.length > 1 ? 's' : ''}`, () => [
        ...jr.slice(-Math.max(5, (e.viewport?.rows ?? 30) - 14)).map(j => (
          <Text>
            <Text color={SUBTLE}>{new Date(j.at).toTimeString().slice(0, 8)} </Text>
            <Text color={j.ok ? INK : KO}>{toolLabel(j.tool, F)}</Text>
          </Text>
        )),
        jr.length === 0 && <Text color={SUBTLE}>{T('aucun appel au labo dans cette session', 'no call to the lab in this session')}</Text>,
        l?.last_push && (
          <Text color={l.last_push.ok ? MUTED : KO}>
            {T('envoi auto', 'auto push')} · {new Date(l.last_push.at * 1000).toTimeString().slice(0, 8)} · {l.last_push.message}
          </Text>
        ),
      ]),
    ]

    // ── Projet tab ──
    const done = sp ?? []
    const current = SECTIONS.find(([id]) => !done.includes(id))?.[0]
    const projetTab = [
      card('about', T('Vous avez un projet ?', 'Got a project?'), () => [
        <Text color={MUTED}>
          {T(
            "Une carte électronique, un objet connecté, un montage à fiabiliser : décrivez-le ici, avec vos mots, et nous vous aidons à le formaliser. Claude vous pose les questions de nos ingénieurs, une à la fois, et rédige la spécification : ce que fait le produit, son alimentation, son format, son environnement, sa production. Ce qui reste flou est noté « à préciser ».",
            'A circuit board, a connected device, a setup to make reliable: describe it here, in your own words, and we help you formalize it. Claude asks our engineers\' questions, one at a time, and writes the specification: what the product does, its power, its size, its environment, its production. What is still unclear is marked "to be specified".',
          )}
        </Text>,
        <Text color={SUBTLE}>
          {T(
            "La spec reste sur votre poste (spec-projet.md, et un PDF). Si vous le voulez, envoyez-la à Picodev : nous la relisons et revenons vers vous pour la suite (étude, prototype, production).",
            'The spec stays on your machine (spec-projet.md, and a PDF). If you want, send it to Picodev: we read it and get back to you about what comes next (study, prototype, production).',
          )}
        </Text>,
      ]),
      card('spec', T('Spécification', 'Specification'), () => [
        sp === null && <Text color={SUBTLE}>{T('pas encore de spec-projet.md dans ce projet', 'no spec-projet.md in this project yet')}</Text>,
        ...SECTIONS.map(([id, , short, en]) => (
          <Text>
            <Text color={done.includes(id) ? OK : id === current ? CORAL : SUBTLE}>{done.includes(id) ? '✓' : id === current ? '●' : '○'} </Text>
            <Text color={done.includes(id) || id === current ? INK : SUBTLE}>{T(short, en)}</Text>
            {id === current && sp !== null && <Text color={SUBTLE}> · {T('en cours', 'in progress')}</Text>}
          </Text>
        )),
        row(T('fichier', 'file'), 'spec-projet.md'),
        more && more.figures > 0 && row(T('illustrations', 'illustrations'), String(more.figures)),
        more && row(T('coordonnées dans le document', 'contact details in the document'), more.contact ? T('oui', 'yes') : T('non', 'no')),
        more && more.figures > 0 && <Text color={SUBTLE}>{T("Illustrations d'après diagram-design (Cathryn Lavery, MIT)", 'Illustrations after diagram-design (Cathryn Lavery, MIT)')}</Text>,
        sp === null &&
          act('briefStart', T('décrire mon projet', 'describe my project'), () =>
            askT($, 'Aide-moi à décrire mon projet avec la skill lab-projet du plugin picodev-lab.', 'Help me describe my project with the lab-projet skill of the picodev-lab plugin.'),
          ),
        sp !== null &&
          done.length < SECTIONS.length &&
          act('briefResume', T('reprendre la spec', 'resume the spec'), () =>
            askT(
              $,
              'Reprends la description de mon projet là où elle en est dans spec-projet.md, avec la skill lab-projet du plugin picodev-lab.',
              'Resume the description of my project where spec-projet.md left it, with the lab-projet skill of the picodev-lab plugin.',
            ),
          ),
      ], `${done.length} ${T('rubrique', 'section')}${done.length > 1 ? 's' : ''} ${T('sur', 'of')} 8`),
      card('send', T('Envoyer à Picodev', 'Send to Picodev'), () => [
        row('contact', T('nom, société, e-mail (Claude vous les demande)', 'name, company, e-mail (Claude asks you)')),
        <Box justifyContent="space-between">
          <Text color={SUBTLE}>NDA</Text>
          <Box gap={1}>
            {isNda ? btn('ndaNo', T('non', 'no'), () => update($, nda, () => false)) : <Text backgroundColor={INK} color={PANEL}>{T(' non ', ' no ')}</Text>}
            {isNda ? (
              <Text backgroundColor={INK} color={PANEL}>{T(' oui : coordonnées seules ', ' yes: contact details only ')}</Text>
            ) : (
              btn('ndaYes', T('oui : coordonnées seules', 'yes: contact details only'), () => update($, nda, () => true))
            )}
          </Box>
        </Box>,
        <Box flexWrap="wrap" gap={1}>
          {btn('preview', T('aperçu du PDF', 'PDF preview'), () =>
            askT($, "Produis l'aperçu PDF de spec-projet.md avec la skill lab-projet du plugin picodev-lab (rien n'est envoyé).", 'Make the PDF preview of spec-projet.md with the lab-projet skill of the picodev-lab plugin (nothing is sent).'),
          )}
          {done.length > 0 ? (
            act('sendSpec', T('envoyer la spec', 'send the spec'), () =>
              askT(
                $,
                `Je veux envoyer ma spec à Picodev${isNda ? ' avec NDA (coordonnées seules)' : ''} : suis la skill lab-projet du plugin picodev-lab, montre-moi ce qui part et le texte de consentement, et attends mon oui.`,
                `I want to send my spec to Picodev${isNda ? ' under NDA (contact details only)' : ''}: follow the lab-projet skill of the picodev-lab plugin, show me what goes and the consent text, and wait for my yes.`,
              ),
            )
          ) : (
            <Text color={SUBTLE}>{T('envoyer la spec : une rubrique écrite au moins', 'send the spec: at least one section written')}</Text>
          )}
        </Box>,
        <Text color={SUBTLE}>{T("rédigée avec l'assistance d'une IA · relue par nos ingénieurs", 'written with the help of an AI · read by our engineers')}</Text>,
      ]),
      card('direct', T('Ou directement', 'Or directly'), () => [
        <Box flexWrap="wrap" gap={1}>
          {btn('meet2', T('rendez-vous / informations', 'meeting / information'), () => meet($))}
          <Link href={SITE} label="[ picodev.fr ]" />
          <Link href={LAB_SITE} label="[ lab.picodev.fr ]" />
        </Box>,
      ]),
    ]

    // ── Banc réel tab (contract 0.20): the setup's offers (list_setups), the place in the queue (session_status) ──
    const q = ss?.queue
    const offers = (l ? st.filter(m => m.id === l.setup) : st).flatMap(m => (m.benches ?? []).map(b => ({ setup: m, b })))
    const placeRow = !l
      ? null
      : !ss
        ? row(T('file', 'queue'), '—', SUBTLE)
        : !q
          ? row(T('file', 'queue'), T('ce labo ne la donne pas encore', 'this lab does not give it yet'), SUBTLE)
          : q.state === 'turn'
            ? row(
                T('votre tour', 'your turn'),
                `${q.bench ?? q.kind ?? ''}${q.ends_at ? ` · ${T('reste', 'left')} ${hm(q.ends_at - now)}` : ''}`,
                OK,
              )
            : q.state === 'waiting'
              ? row(
                  T('file', 'queue'),
                  `${q.kind ?? ''} · ${T('place', 'place')} ${q.position ?? '?'}${q.waiting ? `/${q.waiting}` : ''}${q.eta_s ? ` · ${T('environ', 'about')} ${hm(q.eta_s)}` : ''}`,
                  CORAL,
                )
              : row(T('file', 'queue'), T('pas dans la file', 'not queued'), SUBTLE)
    const canJoin = !!l && q?.state === 'none'
    const bancTab = [
      card('banc', T('Banc réel', 'Real bench'), () => [
        <Text color={SUBTLE}>
          {T(
            "Votre programme sur une vraie carte du labo, à tour de rôle : rejoignez la file d'une offre, le banc vous donne la main pour un temps limité. La vidéo se regarde dans le navigateur, sur la page du banc.",
            'Your program on a real board in the lab, in turns: join the queue of an offer, the bench hands you control for a limited time. The video is watched in the browser, on the bench page.',
          )}
        </Text>,
        ...(offers.length === 0
          ? [<Text color={SUBTLE}>{l ? T("pas de banc réel pour ce montage", 'no real bench for this setup') : T("aucun banc réel pour l'instant", 'no real bench for now')}</Text>]
          : offers.map(({ setup, b }) => (
              <Box justifyContent="space-between">
                <Text color={INK}>
                  {l ? '' : `${setup.title ?? setup.id} · `}
                  {b.kind}
                  <Text color={SUBTLE}>
                    {b.status === 'soon'
                      ? T(' · bientôt', ' · soon')
                      : ` · ${b.free}/${b.benches} ${T('libre', 'free')}${b.free > 1 && F ? 's' : ''} · ${b.waiting} ${T('en attente', 'waiting')}`}
                  </Text>
                </Text>
                {b.status === 'soon' ? soon : canJoin && act(`join:${b.kind}`, T('rejoindre la file', 'join the queue'), () => queue($, b.kind))}
              </Box>
            ))),
        placeRow,
        l && (
          <Box flexWrap="wrap" gap={1}>
            {benchLink(l)}
            {q && q.state !== 'none' && btn('leave', q.state === 'turn' ? T('rendre le banc', 'give the bench back') : T('quitter la file', 'leave the queue'), () => queue($, null))}
          </Box>
        ),
        !l && <Text color={SUBTLE}>{T("Ouvrez une session (onglet Session) pour rejoindre la file d'un banc.", "Open a session (Session tab) to join a bench's queue.")}</Text>,
      ]),
    ]

    const body = { session: sessionTab, defi: defiTab, simulation: simTab, journal: journalTab, projet: projetTab, banc: bancTab }[tab] ?? sessionTab

    const footer = (
      <Box flexDirection="column">
        {msg && <Text color={MUTED}>{msg}</Text>}
        <Box gap={2} flexWrap="wrap">
          <Button key="autopush" plain onPress={() => setAutopush($)}>
            <Text color={SUBTLE}>{T('envoi auto du sketch ', 'auto push of the sketch ')}</Text>
            <Text color={ap ? OK : SUBTLE}>{ap ? T('● activé', '● on') : T('○ coupé', '○ off')}</Text>
          </Button>
          <Button key="refresh" plain dimColor label={T('↻ actualiser', '↻ refresh')} onPress={() => Promise.all([tick($), loadIdle($)])} />
          {tab !== 'projet' && <Button key="yourProject" plain dimColor label={T('votre projet ?', 'your project?')} onPress={() => openTab($, 'projet')} />}
          <Button key="narrow" plain dimColor label={T('◂ plus étroit', '◂ narrower')} onPress={() => resize($, -8)} />
          <Button key="wide" plain dimColor label={T('plus large ▸', 'wider ▸')} onPress={() => resize($, 8)} />
        </Box>
        {/* the Velxio credit on the Session tab only, as the VS Code view */}
        {tab === 'session' && <Text color={SUBTLE}>{T('simulation dans le navigateur', 'simulation in the browser')} · Velxio (AGPLv3)</Text>}
        {tab === 'projet' && <Text color={SUBTLE}>{T("rien n'est envoyé sans votre accord", 'nothing is sent without your consent')}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={NAVY} gap={1}>
        {header}
        {tabs}
        {body}
        {footer}
      </Box>
    )
  })
}

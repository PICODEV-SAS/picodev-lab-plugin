// Pure helpers and data of the Lab pane: no `$` here (it never crosses an import).

// ── look: the lab's palette, dark side ──
export const NAVY = '#071A30'
export const PANEL = '#0A2440'
export const CORAL = '#E7746F'
export const INK = '#FFFFFF'
export const MUTED = '#C9D3E0'
export const SUBTLE = '#9FB0C4'
export const OK = '#7FD1A3'
export const KO = '#F3A6A2'

export const SESSION_HOURS = 4
export const SITE = 'https://picodev.fr'
export const LAB_SITE = 'https://lab.picodev.fr'
export const RELEASES = 'https://github.com/PICODEV-SAS/picodev-lab-plugin/releases/tag/v'

/** Same rule as scripts/lab.py: every character but a letter or digit becomes '-'. */
export const projectKey = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-')

export const originOf = (url: string | undefined) => /^(https?:\/\/[^/?#]+)/.exec(url ?? '')?.[1] ?? null

// ── durations and counts ──
export const hm = (s: number) => {
  const m = Math.max(0, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
export const minSec = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`)

export type TestRow = { id: string; status: string; detail?: string }
export const passedOf = (results: TestRow[] | null | undefined) => (results ?? []).filter(r => r.status === 'passed').length
export const allPassed = (results: TestRow[] | null | undefined) => !!results?.length && results.every(r => r.status === 'passed')
/** Tests still to settle: the run is not over for them. */
export const unsettled = (results: TestRow[] | null | undefined) => !!results?.some(r => r.status === 'pending' || r.status === 'running')
/** "2/5", "2" without the count, "…" before the first state (level from 0, shown from 1). */
export const levelOf = (level: number | null | undefined, levels?: number | null) =>
  level == null ? '…' : levels ? `${level + 1}/${levels}` : String(level + 1)
/** Levels passed: the current level's index, plus one when all its tests are green. */
export const levelsPassed = (level: number | null | undefined, results: TestRow[] | null | undefined) =>
  level == null ? 0 : level + (allPassed(results) ? 1 : 0)

// ── sharing (P5.3): the hub's /p/ page and each network's own compose page, as the site's end screen ──
export const shareLink = (origin: string, setup: string, mode: string, levels: number, seconds: number) =>
  `${origin}/p/${setup}.${mode}.${Math.min(99, Math.max(0, levels))}.${Math.min(86400, Math.max(0, Math.round(seconds)))}`
export const shareText = (mode: string, levels: number, seconds: number, fr = true) =>
  fr
    ? mode === 'challenge'
      ? `J'ai réussi ${levels} niveau${levels > 1 ? 'x' : ''} d'un défi Arduino en ${minSec(seconds)} sur le banc simulé de Picodev Lab, piloté par mon agent.`
      : `J'ai programmé un Arduino sur le banc simulé de Picodev Lab, piloté par mon agent.`
    : mode === 'challenge'
      ? `I passed ${levels} level${levels > 1 ? 's' : ''} of an Arduino challenge in ${minSec(seconds)} on Picodev Lab's simulated bench, driven by my agent.`
      : `I programmed an Arduino on Picodev Lab's simulated bench, driven by my agent.`
export const shareUrls = (text: string, link: string) => ({
  linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(link),
  x: 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(link),
})

// ── the project brief (P5.1): the 8 headings, as scripts/lab.py reads them ──
export const SECTIONS = [
  ['envelope', 'Contexte du projet', 'contexte', 'context'],
  ['fonctionPrincipale', 'Fonction principale', 'fonction principale', 'main function'],
  ['fonctions', 'Modules et fonctions', 'modules et fonctions', 'modules and functions'],
  ['alimentation', 'Alimentation', 'alimentation', 'power'],
  ['format', 'Format et encombrement', 'format', 'form factor'],
  ['environnement', 'Environnement', 'environnement', 'environment'],
  ['production', 'Production', 'production', 'production'],
  ['preferences', 'Préférences techniques', 'préférences', 'technical preferences'],
] as const

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Which of the 8 sections hold something other than "À préciser". */
const FIGURE = /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/ // ![caption](spec-figures/x.png): an illustration (architecture 0.16)
/** The illustrations and the contact section of spec-projet.md, for the Projet tab. */
export const specExtras = (text: string) => {
  const lines = text.split('\n')
  return {
    figures: lines.filter(l => FIGURE.test(l)).length,
    contact: lines.some(l => l.startsWith('## ') && /^(coordonnees|contact)/.test(fold(l.slice(3)))),
  }
}
export const specDone = (text: string): string[] => {
  const body: Record<string, string> = {}
  let cur: string | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const head = fold(line.slice(3))
      cur = SECTIONS.find(([id, label]) => head.startsWith(fold(label)) || head === id.toLowerCase())?.[0]
      if (cur) body[cur] = ''
    } else if (cur && !line.startsWith('# ') && !FIGURE.test(line)) body[cur] += line + '\n'
  }
  return SECTIONS.map(([id]) => id).filter(id => {
    const t = (body[id] ?? '').trim()
    return t !== '' && fold(t) !== 'a preciser'
  })
}

// ── traces (P3.7): a pin's level over the events' time window, one column a step ──
export type SimEvent = { t: number; k: string; pin?: number | string; v: unknown }
export const traces = (events: SimEvent[], cols: number): { pin: string; wave: string }[] => {
  const pins = events.filter(e => e.k === 'pin' && e.pin !== undefined)
  if (!pins.length || cols < 4) return []
  const t0 = pins[0]!.t
  const span = Math.max(1, pins[pins.length - 1]!.t - t0)
  const names = [...new Set(pins.map(e => String(e.pin)))].sort((a, b) => Number(a) - Number(b))
  return names.slice(0, 6).map(pin => {
    const own = pins.filter(e => String(e.pin) === pin)
    let i = 0
    let level = Number(own[0]?.v) ? 1 : 0
    let wave = ''
    for (let c = 0; c < cols; c++) {
      const until = t0 + (span * (c + 1)) / cols
      while (i < own.length && own[i]!.t <= until) level = Number(own[i++]!.v) ? 1 : 0
      wave += level ? '▔' : '▁'
    }
    return { pin: `D${pin}`, wave }
  })
}
export const serialTail = (events: SimEvent[], n: number) =>
  events
    .filter(e => e.k === 'serial')
    .map(e => String(e.v).trim())
    .filter(Boolean)
    .slice(-n)

// ── the setup sheet (read_setup, lab v0.8): each part by what its pins are wired to ──
type End = { componentId: string; pinName: string }
export type CircuitLite = {
  components: { type: string; id: string; properties?: Record<string, unknown> }[]
  wires: { start: End; end: End }[]
}
/** "servo servo-arm · V+ 5V · PWM D9", "resistor r-led (220) · 1 D6 · 2 led-state.A": the board's pins named as on the board. */
export const partsOf = (c: CircuitLite, board: string): string[] =>
  c.components.map(k => {
    const props = Object.values(k.properties ?? {}).map(String)
    const links = c.wires.flatMap(w => (w.start.componentId === k.id ? [[w.start, w.end]] : w.end.componentId === k.id ? [[w.end, w.start]] : []))
    const to = ({ componentId, pinName }: End) => (componentId === board ? (/^\d+$/.test(pinName) ? `D${pinName}` : pinName) : `${componentId}.${pinName}`)
    return [`${k.type.replace(/^wokwi-/, '')} ${k.id}${props.length ? ` (${props.join(', ')})` : ''}`, ...links.map(([own, other]) => `${own!.pinName} ${to(other!)}`)].join(' · ')
  })

// ── language: the sheets are in French, their English under i18n.en ──
/** French unless the visitor's language says otherwise: Claude Code's `language` setting, else the POSIX locale
 * (LC_ALL, LC_MESSAGES, LANG). No signal (unset, C, POSIX): French, the sheets' own language. */
export const isFrench = (setting: unknown, locale: string | undefined) => {
  const s = (typeof setting === 'string' && setting.trim()) || locale || ''
  return !s || /^(C|POSIX)([._@]|$)/.test(s) || /^fr([_.@-]|ench|an[cç]ais|$)/i.test(s)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** A PNG's size, from its IHDR (the first 24 bytes); null when it is not a PNG. */
export const pngSize = (b64: string) => {
  const b: number[] = []
  for (let i = 0; i + 4 <= Math.min(32, b64.length); i += 4) {
    const n = [0, 1, 2, 3].reduce((a, j) => a * 64 + Math.max(0, B64.indexOf(b64[i + j]!)), 0)
    b.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  if (b.length < 24 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  const u32 = (o: number) => b[o]! * 2 ** 24 + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
  return { width: u32(16), height: u32(20) }
}
/** The Image box: `columns` wide, rows from the picture's ratio (a cell about twice as tall as wide), 1 to 255 each. */
export const imageBox = (b64: string, columns: number) => {
  const cols = Math.max(1, Math.min(255, Math.round(columns)))
  const s = pngSize(b64)
  const rows = s && s.width > 0 ? Math.round((cols * s.height) / s.width / 2) : Math.round(cols / 4)
  return { columns: cols, rows: Math.max(1, Math.min(255, rows)) }
}

// ── the journal: the lab's tools in plain words [French, English]; an unknown tool keeps its name ──
const TOOLS: Record<string, [string, string]> = {
  list_setups: ['liste des montages', 'list of setups'],
  read_setup: ['fiche du montage', 'setup sheet'],
  open_session: ['ouverture de la session', 'session opened'],
  close_session: ['fin de la session', 'session closed'],
  session_status: ['état de la session', 'session status'],
  read_simulation: ['lecture de la simulation', 'simulation read'],
  push_to_editor: ['sketch envoyé (compilé par le labo)', 'sketch pushed (compiled by the lab)'],
  push_program: ['programme envoyé (compilé sur votre poste)', 'program pushed (compiled on your machine)'],
  push_circuit: ['circuit changé', 'circuit changed'],
  set_visibility: ['visibilité changée', 'visibility changed'],
  next_level: ['niveau suivant', 'next level'],
  queue_join: ['file du banc réel : entrée', 'real bench queue: joined'],
  queue_leave: ['file du banc réel : sortie', 'real bench queue: left'],
  queue_status: ['file du banc réel', 'real bench queue'],
  decode_capture: ['décodage de la capture', 'capture decoded'],
  capture_logic: ['capture logique lancée', 'logic capture started'],
  capture_analog: ['capture analogique lancée', 'analog capture started'],
  read_capture: ['lecture de la capture', 'capture read'],
  spec_draft: ['spec : rubrique suivante', 'spec: next section'],
  brief_submit: ['spec envoyée à Picodev', 'spec sent to Picodev'],
  request_meeting: ['demande à Picodev', 'request to Picodev'],
}
export const toolLabel = (tool: string, fr: boolean) => TOOLS[tool]?.[fr ? 0 : 1] ?? tool

// ── version ──
const vt = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) ?? []).slice(1).map(Number)
export const isNewer = (latest: string, current: string) => {
  const [a, b] = [vt(latest), vt(current)]
  if (a.length !== 3 || b.length !== 3) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

// ── the logo (P7): the Picodev pictogram of identity v2, inverse on navy, in half blocks ──
// 14 x 20 pixels, one character = two pixels stacked. '#' card, ' ' trace of the p, 'o' coral pad, '.' none.
const PIC = [
  '##########....',
  '###########...',
  '## # # #####..',
  '## # # ######.',
  '## # # #######',
  '##############',
  '##############',
  '######     ###',
  '#####  ###  ##',
  '#####  ###  ##',
  '#####  ###  ##',
  '#####  ###  ##',
  '#####      ###',
  '#####  #######',
  '#####  #######',
  '####oooo######',
  '####o##o######',
  '####oooo######',
  '##############',
  '.############.',
]
// The trace of the p, in drawing order: the loop clockwise from its left, then the leg down.
const ang = ([x, y]: [number, number]) => (Math.atan2(y - 10, x - 8.2) - Math.PI + 4 * Math.PI) % (2 * Math.PI)
const TRACE: [number, number][] = PIC.flatMap((r, y) => [...r].flatMap((c, x): [number, number][] => (c === ' ' && y >= 6 ? [[x, y]] : [])))
TRACE.sort((a, b) => Number(a[1] > 12) - Number(b[1] > 12) || (a[1] > 12 ? a[1] - b[1] : ang(a) - ang(b)))

export const RISE = 10
const PAD = 3
export const LOGO_DONE = RISE + TRACE.length + PAD + 12
export const NAME = 'picodev'

export type Cell = { text: string; fg?: string; bg?: string }

/** Frame `f` of the intro: rows of runs of one color pair. The card rises row by row, the p is traced, the pad lights. */
export const logoFrame = (f: number): Cell[][] => {
  const drawn = new Set(TRACE.slice(0, Math.max(0, f - RISE)).map(p => p.join()))
  const pad = f >= RISE + TRACE.length + 1
  const col = (x: number, y: number) => {
    const c = PIC[y]![x]
    if (c === '.') return undefined
    if (c === ' ' && (y < 6 || drawn.has(`${x},${y}`))) return PANEL
    if (c === 'o' && pad) return CORAL
    return INK
  }
  const rows: Cell[][] = []
  for (let k = 0; k < 10; k++) {
    if (k >= Math.min(10, f)) {
      rows.push([{ text: ' '.repeat(14) }])
      continue
    }
    const runs: Cell[] = []
    for (let x = 0; x < 14; x++) {
      const t = col(x, 2 * k)
      const b = col(x, 2 * k + 1)
      // a missing pixel shows the terminal's own background
      const cell: Cell = t && b ? { text: '▀', fg: t, bg: b } : t ? { text: '▀', fg: t } : b ? { text: '▄', fg: b } : { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }
  return rows
}
/** How much of the name is written at frame `f`. */
export const nameAt = (f: number) => NAME.slice(0, Math.max(0, Math.min(NAME.length, f - RISE - TRACE.length - PAD)))

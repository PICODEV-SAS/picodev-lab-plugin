import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { imageBox, isFrench, partsOf, pngSize } from '../hooks/lab'

const PANE = {
  component: 'Pane',
  requestId: 'picodev-lab',
  props: { title: 'Picodev Lab', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const BAND = { component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} } } as const

const NOW = Date.parse('2026-10-14T10:00:00')
const SESSION = {
  session: 'abc',
  agent_token: 'secret-token',
  open_url: 'https://lab.picodev.fr/bench/setup-a/challenge?s=abc#o=owner',
  setup: 'setup-a',
  mode: 'challenge',
  opened_at: NOW / 1000 - 600,
}
const SIM = {
  state: { level: 1, running: true, results: [] },
  compile: { ok: true, log: '' },
  events: [
    { t: 10, k: 'pin', pin: 2, v: 1 },
    { t: 20, k: 'pin', pin: 6, v: 1 },
    { t: 30, k: 'serial', v: 'Arm: press' },
  ],
  challenge: {
    level: 1,
    brief: { id: 'n2', title: 'La LED suit le bouton', brief: 'Allume la LED D6 quand D2 est appuyé.', hints: ['millis()', 'pas de delay'] },
    results: [
      { id: 'bouton_lu', status: 'passed' },
      { id: 'delai_inferieur_5ms', status: 'failed', detail: '480 ms mesurés' },
    ],
  },
}

// session_status of hub v0.4.2: no viewer link guessed, no opened_at
const STATUS = {
  setup: 'setup-a',
  mode: 'challenge',
  owner: true,
  visibility: 'link',
  viewer_url: 'https://lab.picodev.fr/w/abc#v=viewer',
  viewers: 2,
  created_at: NOW / 1000 - 900,
  expires_at: NOW / 1000 - 900 + 4 * 3600,
  run: 1,
  level: 1,
  levels: 5,
}

const answer = (value: unknown, isError = false, png?: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
        ...(png ? [{ type: 'image', mimeType: 'image/png', data: png }] : []),
      ],
      isError,
    },
  })

// a 16 x 9 PNG, as schema.png and the capture chart come: image contents beside the JSON (lab v0.8)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAE0lEQVR4nGPgUnEgCTGMahgUGgAx5D3hRBnXVgAAAABJRU5ErkJggg=='
const SHEET = {
  schema: 1,
  id: 'setup-a',
  title: 'Setup A · bras servo',
  summary: '',
  board: { kind: 'arduino-nano', fqbn: 'arduino:avr:nano' },
  files: [],
  libraries: [],
  circuit: {
    components: [
      { type: 'wokwi-servo', id: 'servo-arm', properties: {} },
      { type: 'wokwi-resistor', id: 'r-led', properties: { value: '220' } },
    ],
    wires: [
      { id: 'w1', start: { componentId: 'arduino-nano', pinName: '5V' }, end: { componentId: 'servo-arm', pinName: 'V+' } },
      { id: 'w2', start: { componentId: 'servo-arm', pinName: 'PWM' }, end: { componentId: 'arduino-nano', pinName: '9' } },
      { id: 'w3', start: { componentId: 'r-led', pinName: '2' }, end: { componentId: 'led-state', pinName: 'A' } },
    ],
  },
  probes: [{ pin: 9, label: 'D9', kind: 'scope' }],
  levels: [],
  // no brief in English for n2: it stays French
  i18n: { en: { title: 'Setup A · servo arm', levels: { n2: { title: 'The LED follows the button', hints: ['use millis()', 'no delay'] } } } },
}
const ANALOG = {
  capture: 'cap1',
  kind: 'analog',
  state: 'ready',
  duration_ms: 1000,
  rate_hz: 10000,
  channels: [{ pin: 9, label: 'D9', min_v: 0, max_v: 5, mean_v: 0.188, period_ms: 20 }],
  next: null,
}

const LOGIC = {
  capture: 'agent1',
  kind: 'logic',
  state: 'ready',
  duration_ms: 1000,
  channels: [{ pin: 9, label: 'D9', edges: 100, period_ms: 20, duty: 0.075 }],
  edges: [],
  next: null,
  truncated: false,
}

// The engine beneath the plugin: files, the hub, processes, answered from memory
const stub = (
  on: On,
  opts: { session?: object | null; clock?: boolean; status?: Record<string, unknown>; gone?: boolean; sim?: object; nextError?: string; lang?: string; language?: string; clearFails?: boolean; noPython3?: boolean; files?: Record<string, string> } = {},
) => {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const runs: string[][] = []
  let session = opts.session === undefined ? SESSION : opts.session
  if (opts.clock !== false) on('clock.now', () => ({ value: NOW }))
  on('env.get', (_$, e) => ({ value: /^(LC_|LANG)/.test(e.name) ? opts.lang : '/home/v' }))
  on('settings.read', () => ({ value: opts.language ? { language: opts.language } : {} }))
  on('session.root', () => ({ value: '/home/v/proj' }))
  on('fs.read', (_$, e) =>
    e.path.includes('/sessions/') && session ? { value: JSON.stringify(session) }
      : opts.files?.[e.path] !== undefined ? { value: opts.files[e.path]! } : { deny: 'ENOENT' },
  )
  on('http.fetch', (_$, e) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (e.url.endsWith('/hub/sessions/public')) return { value: { status: 200, ok: true, headers, text: '[]' } }
    const msg = JSON.parse(String(e.init?.body)) as { method: string; params: { name: string; arguments: Record<string, unknown> } }
    if (msg.method === 'tools/list')
      return {
        value: {
          status: 200,
          ok: true,
          headers,
          text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: ['list_setups', 'read_simulation', ...(opts.status ? ['session_status'] : ['close_session'])].map(name => ({ name })) } }),
        },
      }
    calls.push({ tool: msg.params.name, args: msg.params.arguments })
    const text =
      opts.gone && msg.params.name === 'session_status'
        ? answer('Error executing tool session_status: Unknown or ended session: open another one with open_session.', true)
        : msg.params.name === 'read_simulation'
        ? answer(opts.sim ?? SIM)
        : msg.params.name === 'next_level'
          ? opts.nextError
            ? answer(`Error executing tool next_level: ${opts.nextError}`, true)
            : answer({ level: 2, levels: 5 })
        : msg.params.name === 'read_setup'
          ? answer(SHEET, false, PNG)
        : msg.params.name === 'read_capture'
          ? msg.params.arguments.capture !== 'cap1'
            ? answer(msg.params.arguments.capture === 'bad' ? { capture: 'bad', kind: 'logic', state: 'failed', detail: 'simulation stopped', channels: [] } : LOGIC)
          : msg.params.arguments.format === 'png'
            ? answer({ ...ANALOG, channels: ANALOG.channels }, false, PNG)
            : answer({ ...ANALOG, samples: [[0], [5000]] })
        : msg.params.name === 'session_status' && opts.status
          ? answer(opts.status)
        : msg.params.name === 'list_setups'
          ? // as the hub answers a list: one content block per item, the list in structuredContent
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: { content: [{ type: 'text', text: '{"id": "setup-a"}' }], isError: false, structuredContent: { result: [{ id: 'setup-a', title: 'Setup A · bras servo', modes: ['free', 'challenge'], i18n: { en: { title: 'Setup A · servo arm' } } }, { id: 'setup-b', title: 'Setup B · hélice', modes: ['free'] }] } },
            })
          : msg.params.name === 'close_session'
            ? answer({ state: 'ended' })
            : answer('{}')
    return { value: { status: 200, ok: true, headers, text } }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    if (opts.noPython3 && e.argv[0] === 'python3') return { value: { exitCode: 9009, stdout: '', stderr: 'Python was not found', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv.includes('clear') && !opts.clearFails) session = null
    return { value: { exitCode: opts.clearFails && e.argv.includes('clear') ? 1 : 0, stdout: 'ok', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(String((e as { text?: unknown }).text ?? e)), { value: undefined }))
  on('ui.render', () => h('Text', {}, 'engine')) // the engine's own drawing, beneath the plugin (the band it hands back)
  on('ui.panes', () => ({ value: [{ id: 'picodev-lab', title: 'Picodev Lab', isShown: true, isFocused: false, isPlaced: true }] }))
  const asked: string[] = []
  on('prompt.submit', (_$, e) => (asked.push(e.text), { text: e.text }))
  return { calls, runs, asked, toasts }
}

test('no session: setups to open, by handing the skill to Claude', async ($, on) => {
  stub(on, { session: null })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'picodev-lab', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: /joignable/ })).toBeDefined()
    expect(await ui.find({ key: 'sec:how' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2\. Ouvrez le lien du banc/ })).toBeDefined() // open on a first visit
    expect(await ui.find({ key: 'challenge:setup-a' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Velxio \(AGPLv3\)/ })).toBeDefined()
    expect(await ui.find({ key: 'end' })).toBeUndefined()
    await ui.unmount()
  }
})

test('in VS Code: a short pane pointing to the extension, the full one on request', async ($, on) => {
  stub(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'vscode', ...PANE })
  expect(await ui.find({ type: 'Text', text: /extension Picodev Lab/ })).toBeDefined()
  expect(await ui.find({ key: 'tab:defi' })).toBeUndefined()
  await ui.press({ key: 'inVscode' })
  expect(await ui.find({ key: 'tab:defi' })).toBeDefined()
  await ui.unmount()
})

test('a session: its card, the challenge, the band, and the token kept out of view', async ($, on) => {
  const { calls, runs } = stub(on)
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(calls.find(c => c.tool === 'read_simulation')?.args.agent_token).toBe('secret-token')
  expect(await ui.find({ type: 'Text', text: /connecté \(propriétaire\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /secret-token/ })).toBeUndefined()

  await ui.press({ key: 'tab:defi' })
  expect(await ui.find({ type: 'Text', text: /La LED suit le bouton/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /480 ms mesurés/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Velxio/ })).toBeUndefined() // the credit: Session tab only
  expect(await ui.find({ key: 'nextLevel' })).toBeUndefined() // a test still red
  expect(await ui.find({ type: 'Text', text: /indice 1/ })).toBeUndefined()
  await ui.press({ key: 'hint' })
  expect(await ui.find({ type: 'Text', text: /indice 1 : millis/ })).toBeDefined()
  // one level passed: the share card with the hub's /p/ link
  expect(await ui.find({ type: 'Text', text: /\/p\/setup-a\.challenge\.1\.600/ })).toBeDefined()

  const band = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /tests 1\/2/ })).toBeDefined()
  await band.unmount()
  const quiet = await $.ui.mount({ plugin: 'picodev-lab', surface: 'vscode', ...BAND }) // the extension's UI there
  expect(await quiet.find({ type: 'Text', text: /tests 1\/2/ })).toBeUndefined()
  await quiet.unmount()

  await ui.press({ key: 'tab:session' })
  await ui.press({ key: 'end' })
  expect(calls.some(c => c.tool === 'close_session')).toBe(false) // asked first
  expect(await ui.find({ type: 'Text', text: /Terminer la session \?/ })).toBeDefined()
  await ui.press({ key: 'endYes' })
  expect(calls.some(c => c.tool === 'close_session')).toBe(true)
  expect(runs.some(r => r.includes('clear'))).toBe(true)
  expect(await ui.find({ key: 'end' })).toBeUndefined()
  await ui.unmount()
})

test('Projet tab: the illustrations, the contact section and the diagram-design credit', async ($, on) => {
  const spec = '# Air\n\n## Contexte du projet\nUne PME.\n![Mise en situation](spec-figures/usage.png)\n\n## Coordonnées\nAna\n'
  stub(on, { session: null, files: { '/spec-projet.md': spec } /* the root is empty here: session.start has not run */ })
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:projet' })
  expect(await ui.find({ type: 'Text', text: /Illustrations d'après diagram-design \(Cathryn Lavery, MIT\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /coordonnées dans le document/ })).toBeDefined()
  await ui.unmount()
})

test('Projet tab: « rendez-vous / informations » asks lab-projet for a meeting or a question', async ($, on) => {
  const { asked } = stub(on, { session: null })
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab:projet' })
  await ui.press({ key: 'meet2' })
  expect(asked.some(t => /lab-projet/.test(t) && /question/.test(t) && /Rendez-vous \/ informations/.test(t))).toBe(true)
  await ui.unmount()
})

test('the logo: a click on the name plays the intro again, the pad lights at the end', async ($, on) => {
  stub(on, { session: null, clock: false })
  const clock = mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'logoReplay' })
  expect(await ui.find({ key: 'logoReplay' })).toBeUndefined()
  await clock.advance(90 * 80)
  expect(await ui.find({ key: 'logoReplay' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Lab · banc Arduino simulé/ })).toBeDefined()
  await ui.unmount()
})

test('session_status: the card from the hub, read_simulation only when the run changes or a card in sight moves', async ($, on) => {
  const status = { ...STATUS }
  const { calls } = stub(on, { status })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  const reads = () => calls.filter(c => c.tool === 'read_simulation')
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect(calls.filter(c => c.tool === 'session_status').length).toBeGreaterThan(0)
  expect(reads().length).toBe(1) // tests settled, Session tab: nothing to read again
  expect(await ui.find({ type: 'Text', text: /connecté \(propriétaire\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2$/ })).toBeDefined() // viewers
  expect(await ui.find({ type: 'Text', text: /dans 3 h 45/ })).toBeDefined()
  expect(await ui.find({ key: 'copyViewer' })).toBeDefined()
  expect(calls.some(c => c.tool === 'set_visibility')).toBe(false)

  const band = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /niveau 2\/5/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /2 spectateurs/ })).toBeDefined()
  await band.unmount()

  // a new run: read again, from the start of its time
  status.run = 2
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(2)
  expect(reads()[1]!.args.since_ms).toBe(0)
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(2)

  // the Défi card in sight while the simulation brings events: it follows them
  await ui.press({ key: 'tab:defi' })
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(3)

  // the browser gone
  status.owner = false
  await ui.press({ key: 'tab:session' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /en attente : ouvrez le banc/ })).toBeDefined()
  await ui.unmount()
})

test('a session the hub no longer knows (LabError gone): forgotten, no simulation read', async ($, on) => {
  const { calls, runs } = stub(on, { status: { ...STATUS }, gone: true })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(calls.some(c => c.tool === 'session_status')).toBe(true)
  expect(calls.some(c => c.tool === 'read_simulation')).toBe(false)
  expect(runs.some(r => r.includes('clear'))).toBe(true)
  expect(await ui.find({ key: 'end' })).toBeUndefined()
  await ui.unmount()
})

test('a gone session whose file cannot be cleared: said once, not taken up again at each poll', async ($, on) => {
  const { runs, toasts } = stub(on, { status: { ...STATUS }, gone: true, clearFails: true, noPython3: true })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  for (let i = 0; i < 3; i++) await ui.press({ key: 'refresh' })
  expect(toasts.filter(x => /terminée|ended/.test(x)).length).toBe(1)
  expect(runs.some(r => r[0] === 'python' && r.includes('clear'))).toBe(true) // python3 missing (Windows): python next
  await ui.unmount()
})

test('the sheet helpers: parts by their wires, the picture box from the PNG header', async () => {
  expect(partsOf(SHEET.circuit, 'arduino-nano')).toEqual(['servo servo-arm · V+ 5V · PWM D9', 'resistor r-led (220) · 2 led-state.A'])
  expect(pngSize(PNG)).toEqual({ width: 16, height: 9 })
  expect(pngSize('bm90IGEgcG5n')).toBe(null)
  expect(imageBox(PNG, 64)).toEqual({ columns: 64, rows: 18 })
  expect(imageBox('', 40)).toEqual({ columns: 40, rows: 10 })
})

test('the Montage card: read_setup once a session is open, the schema on the terminal, a link elsewhere', async ($, on) => {
  const { calls } = stub(on, { status: { ...STATUS } })
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'picodev-lab', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    expect(calls.find(c => c.tool === 'read_setup')?.args).toEqual({ id: 'setup-a' })
    expect(await ui.find({ type: 'Text', text: /servo servo-arm · V\+ 5V · PWM D9/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /D9 · oscilloscope/ })).toBeDefined()
    expect(Boolean(await ui.find({ type: 'Image' }))).toBe(surface === 'terminal')
    expect(await ui.find({ type: 'Link', text: /schéma en grand/ })).toBeDefined()
    await ui.unmount()
  }
  expect(calls.filter(c => c.tool === 'read_setup').length).toBe(1) // kept across mounts, asked again for another setup
})

test('the analog capture: measures per pin, the chart only when asked', async ($, on) => {
  const status: Record<string, unknown> = { ...STATUS, capture: { id: 'cap1', kind: 'analog', state: 'ready' } }
  const { calls } = stub(on, { status })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:simulation' })
  expect(await ui.find({ type: 'Text', text: /min 0\.00 V · max 5\.00 V · moy 0\.19 V · 50\.0 Hz/ })).toBeDefined()
  expect(calls.some(c => c.args.format === 'png')).toBe(false)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.press({ key: 'chart' })
  expect(calls.find(c => c.args.format === 'png')?.args.capture).toBe('cap1')
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ key: 'chart' })).toBeUndefined()
  await ui.unmount()
})

test("the agent's capture: shown from session_status, read_capture once when it turns ready, again for a new id", async ($, on) => {
  const status: Record<string, unknown> = { ...STATUS, capture: null }
  const { calls } = stub(on, { status })
  mock.store(on)
  const reads = () => calls.filter(c => c.tool === 'read_capture')
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:simulation' })
  expect(await ui.find({ type: 'Text', text: /Pas encore de capture/ })).toBeDefined()
  expect(await ui.find({ key: 'capture' })).toBeUndefined() // the pane starts none: it would replace the agent's

  status.capture = { id: 'agent1', kind: 'logic', state: 'recording' }
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /Logique · enregistrement…/ })).toBeDefined()

  status.capture = { id: 'agent1', kind: 'logic', state: 'ready' }
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(1)
  expect(reads()[0]!.args).toEqual({ session: 'abc', agent_token: 'secret-token', capture: 'agent1' })
  expect(await ui.find({ type: 'Text', text: /100 fronts · 50\.0 Hz · rapport 8 %/ })).toBeDefined()
  expect(calls.some(c => c.tool === 'capture_logic' || c.tool === 'capture_analog')).toBe(false)

  // a new one, failed: read once for its detail
  status.capture = { id: 'bad', kind: 'logic', state: 'failed' }
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect(reads().length).toBe(2)
  expect(await ui.find({ type: 'Text', text: /Logique · la capture a échoué\. simulation stopped/ })).toBeDefined()
  await ui.unmount()
})

test('Niveau suivant: offered when the level is all green and not the last, next_level with the session', async ($, on) => {
  const passed = { ...SIM, challenge: { ...SIM.challenge, results: SIM.challenge.results.map(r => ({ ...r, status: 'passed' })) } }
  const status = { ...STATUS }
  const { calls } = stub(on, { status, sim: passed })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:defi' })
  await ui.press({ key: 'nextLevel' })
  expect(calls.find(c => c.tool === 'next_level')?.args).toEqual({ session: 'abc', agent_token: 'secret-token' })
  expect(await ui.find({ type: 'Text', text: /niveau 3\/5 demandé au banc/ })).toBeDefined()

  // the last level: no button, the bench's « Terminer » is the visitor's
  status.level = 4
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'nextLevel' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /niveau réussi, terminez dans le banc/ })).toBeDefined()
  await ui.unmount()
})

test("Niveau suivant refused by the hub: its text, as other tools' errors", async ($, on) => {
  const passed = { ...SIM, challenge: { ...SIM.challenge, results: SIM.challenge.results.map(r => ({ ...r, status: 'passed' })) } }
  stub(on, { status: { ...STATUS }, sim: passed, nextError: 'tests du niveau pas tous réussis' })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:defi' })
  await ui.press({ key: 'nextLevel' })
  expect(await ui.find({ type: 'Text', text: /tests du niveau pas tous réussis/ })).toBeDefined()
  await ui.unmount()
})

test('isFrench: the language setting first, then the locale; no signal is French', async () => {
  expect(isFrench(undefined, 'fr_FR.UTF-8')).toBe(true)
  expect(isFrench(undefined, undefined)).toBe(true)
  expect(isFrench(undefined, 'C.UTF-8')).toBe(true)
  expect(isFrench(undefined, 'en_US.UTF-8')).toBe(false)
  expect(isFrench('français', 'en_US.UTF-8')).toBe(true)
  expect(isFrench('english', 'fr_FR.UTF-8')).toBe(false)
})

for (const [lang, title, hint, montage] of [
  ['en_US.UTF-8', /The LED follows the button/, /hint 1 : use millis/, /Circuit · Setup A · servo arm/],
  ['fr_FR.UTF-8', /La LED suit le bouton/, /indice 1 : millis/, /Montage · Setup A · bras servo/],
] as const)
  test(`the challenge in ${lang}: the sheet's English (i18n.en) when not French, field by field`, async ($, on) => {
    stub(on, { status: { ...STATUS }, lang })
    mock.store(on)
    const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ text: montage })).toBeDefined()
    await ui.press({ key: 'tab:defi' })
    expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Allume la LED D6/ })).toBeDefined() // no English brief: the French one
    await ui.press({ key: 'hint' })
    expect(await ui.find({ type: 'Text', text: hint })).toBeDefined()
    await ui.unmount()
  })

test('the Montages list in English when not French (list_setups i18n), an untranslated title stays French', async ($, on) => {
  stub(on, { session: null, lang: 'en_US.UTF-8' })
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /^Setup A · servo arm$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Setup B · hélice$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /bras servo/ })).toBeUndefined()
  await ui.unmount()
})

test('free mode: the tab is Libre, a push button and the way to /lab-montage', async ($, on) => {
  const { runs, asked } = stub(on, { session: { ...SESSION, mode: 'free' }, status: { ...STATUS, mode: 'free' } })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /Étape suivante/ })).toBeDefined()
  await ui.press({ key: 'goFree' })
  expect(await ui.find({ type: 'Text', text: /^Libre$/ })).toBeDefined() // the tab's name
  await ui.press({ key: 'pushFree' })
  expect(runs.some(r => r.includes('push'))).toBe(true)
  await ui.press({ key: 'circuit' })
  expect(asked.some(t => /lab-montage/.test(t))).toBe(true)
  await ui.unmount()
})

test('a compile error: « ask Claude to fix it » hands the log over; « solve » asks for /lab-defi', async ($, on) => {
  const failed = { ...SIM, compile: { ok: false, log: "sketch.ino:3: error: 'ledPin' was not declared", origin: 'agent' } }
  const { asked } = stub(on, { status: { ...STATUS }, sim: failed })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'tab:simulation' })
  expect(await ui.find({ type: 'Text', text: /erreurs · sur votre poste/ })).toBeDefined()
  await ui.press({ key: 'fixCompile' })
  expect(asked.some(t => /ne compile pas/.test(t) && /ledPin/.test(t))).toBe(true)
  await ui.press({ key: 'tab:defi' })
  await ui.press({ key: 'solve' })
  expect(asked.some(t => /lab-defi/.test(t))).toBe(true)
  await ui.unmount()
})

test('visibility: asked first, with the viewers it cuts off', async ($, on) => {
  const { calls } = stub(on, { status: { ...STATUS } })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'vis:private' })
  expect(calls.some(c => c.tool === 'set_visibility')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /Les 2 spectateurs en place sont coupés/ })).toBeDefined()
  await ui.press({ key: 'visYes' })
  expect(calls.find(c => c.tool === 'set_visibility')?.args.visibility).toBe('private')
  await ui.unmount()
})

test('in English for a non-French visitor: tabs, cards, the journal in plain words', async ($, on) => {
  stub(on, { status: { ...STATUS }, lang: 'en_US.UTF-8' })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'picodev-lab', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /Next step:/ })).toBeDefined()
  expect((await ui.find({ key: 'tab:defi' }))?.props.label).toBe('Challenge')
  await ui.press({ key: 'tab:journal' })
  expect(await ui.find({ type: 'Text', text: /setup sheet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /read_setup/ })).toBeUndefined()
  await ui.unmount()
})

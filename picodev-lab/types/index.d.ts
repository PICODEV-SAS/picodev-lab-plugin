/** The project's lab session as the pane shows it: the session file without its agent token. */
export type LabView = {
  session: string
  setup: string
  mode: 'free' | 'challenge'
  open_url: string
  /** written by lab.py at save; only for a hub without session_status, which gives created_at */
  opened_at: number
  sketch_dir?: string
  /** path: compiled on the visitor's machine (agent) or by the lab (cloud); log: the local compiler's errors */
  last_push?: { at: number; ok: boolean; message: string; path?: 'agent' | 'cloud'; log?: string }
  /** the sketch's folder is in a git repository (null: git missing); git: the visitor opted into a commit a push */
  in_repo?: boolean | null
  git?: boolean
}
export type TestRow = { id: string; status: string; detail?: string }
export type SimEvent = { t: number; k: string; pin?: number | string; v: unknown }
/** What read_simulation said, events kept across polls. */
export type SimView = {
  hasState: boolean
  running: boolean
  level: number | null
  brief: { id?: string; title?: string; brief?: string; hints?: string[] } | null
  results: TestRow[]
  compile: { ok: boolean; log: string; origin?: 'agent' | 'cloud' } | null
  events: SimEvent[]
  lastT: number
  /** the browser's circuit differs from the sheet's (hub v0.8); null when unknown */
  circuitModified?: boolean | null
}
/** session_status (hub v0.4.2, capture v0.6.1): the session without its events, polled every 2 s. Times in Unix seconds. */
export type SessionStatus = {
  setup: string
  mode: string
  owner: boolean
  visibility: string
  viewer_url: string | null
  viewers: number
  created_at: number
  expires_at: number
  run: number
  level: number | null
  levels: number | null
  /** hub v0.6.1: the session's capture (the agent's); null without one */
  capture?: { id: string; kind: 'logic' | 'analog'; state: 'recording' | 'ready' | 'failed' } | null
}
export type Setup = { id: string; title?: string; summary?: string; modes: string[]; i18n?: { en?: { title?: string; summary?: string } } }
export type PublicSession = { session: string; viewer: string; setup: string; mode: string; level?: number; started_at: number; viewers: number }
export type Channel = { pin: number; label?: string; edges: number; period_ms?: number; duty?: number; high_ms?: number; low_ms?: number }
export type AnalogChannel = { pin: number; label: string; min_v: number | null; max_v: number | null; mean_v: number | null; period_ms?: number }
export type CaptureView = {
  id: string
  kind: 'logic' | 'analog'
  state: string
  detail?: string
  channels: Channel[]
  analog?: AnalogChannel[]
  /** the chart (read_capture format "png"), base64, once asked */
  png?: string
}
/** read_setup, as the Montage card shows it: one line a part, one a probe, and schema.png (base64) */
export type SheetView = {
  id: string
  title: string
  parts: string[]
  probes: string[]
  png: string | null
  /** i18n.en's levels by id when the visitor is not French (title, brief, hints); null in French */
  enLevels: Record<string, { title?: string; brief?: string; hints?: string[] }> | null
}
export type JournalRow = { at: number; tool: string; ok: boolean }

declare module 'claude-code' {
  interface PluginState {
    'picodev-lab': {
      lab: LabView | null
      sim: SimView | null
      /** null before the first answer, and with a hub without session_status */
      status: SessionStatus | null
      setups: Setup[]
      publics: PublicSession[]
      /** the hub's MCP: reachable, and how many tools */
      conn: { ok: boolean; tools: number } | null
      /** the visitor reads French (isFrench); the pane is in English otherwise */
      fr: boolean
      /** an action waiting for the visitor's yes: 'end', 'vis:<visibility>' */
      confirm: string | null
      /** the last push found no sketch folder: offer the starter sketch */
      noSketch: boolean
      /** the full pane in VS Code, asked by the visitor (else the extension is the lab's UI there) */
      inVscode: boolean
      vis: { visibility: string; viewer_url: string | null } | null
      capture: CaptureView | null
      /** the sheet of the session's setup, or of the setup asked from the Montages card */
      sheet: SheetView | null
      journal: JournalRow[]
      curTab: string
      logoFrame: number
      open: Record<string, boolean>
      hints: number
      nda: boolean
      note: string
      /** newest release seen by the update check, when newer than this one */
      update: string | null
      autopush: boolean
      /** ids of the sections of spec-projet.md already written; null without the file */
      spec: string[] | null
      /** spec-projet.md's illustrations (figure lines) and whether it has a contact section */
      specMore: { figures: number; contact: boolean } | null
      width: number
    }
  }
}

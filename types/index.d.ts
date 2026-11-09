export type EvalGateStage = {
  index: number | null
  label: string | null
  class: string | null
  model: string | null
  effort: string | null
  phase?: string | null
}

export type EvalGate = {
  decision: 'pass' | 'deny'
  fingerprint: string | null
  maxOpus: number | null
  sessionModel: string | null
  at?: string | null
  phases?: string[]
  stages: EvalGateStage[]
}

export type EvalLaunch = {
  toolUseId: string
  fingerprint: string | null
  at: number
  refused: boolean
  pending: boolean
  gate: EvalGate | null
  gateTries: number
  baseline: EvalBaseline
  launchReadings?: MeterReadings | null
}

export type EvalSent = { model: string; effort: string | null }

export type EvalUsage = {
  family: string | null
  effort: string | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
  long?: boolean
}

export type EvalBaseline = { model: string | null; effort: string | null }

export type SavedRange = { mid: number; lo: number; hi: number; pm: number }

export type SavedBucket = { mu: number; sigma: number }

export type SavedTransition = {
  from: string
  to: string
  source: 'identical' | 'measured' | 'chained' | 'prior'
  via?: string
  pairs: number
  tau: number
  output: SavedBucket
  fresh: SavedBucket
  read: SavedBucket
}

export type Saved = {
  status: 'estimated' | 'none' | 'unknown'
  why: 'no-baseline' | 'no-agents' | null
  running: boolean
  subscription: boolean | null
  baseline: { family: string; effort: string } | null
  dollars: SavedRange | null
  actualDollars: number | null
  baselineDollars: number | null
  tokens: { saved: number; outputSaved: number } | null
  limits: {
    five_hour: SavedRange | null
    seven_day: SavedRange | null
    readings: { five_hour: number; seven_day: number }
    implausible?: MeterWindow[]
  } | null
  used?: { five_hour: number | null; seven_day: number | null }
  agents: { agentId: string; dollars: number | null; five_hour: number | null }[]
  groups?: { key: string; dollars: number | null; five_hour: number | null; used: number; total: number }[]
  coverage: { used: number; total: number; unpriced: number; noRatio: string[] }
  sources: {
    measuredPairs: number
    chained: { from: string; to: string; via: string }[]
    priors: { from: string; to: string }[]
  }
  transitions: SavedTransition[]
}

export type MeterWindow = 'five_hour' | 'seven_day'

export type MeterInterval = { d: number; u: number; c: number; at: number }

export type MeterTokens = Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>

export type MeterReading = { pct: number; resetsAt: string | null }

export type MeterReadings = Record<MeterWindow, MeterReading | null>

export type EvalMeter = {
  subscription: boolean | null
  acc: Record<MeterWindow, MeterTokens>
  last: MeterReadings
  mine: Record<MeterWindow, MeterInterval[]>
  others: Record<MeterWindow, MeterInterval[]>
}

export type EvalAgent = {
  agentId: string
  label: string
  askedModel: string | null
  ranModel: string | null
  at: number
  done: boolean
  sent: EvalSent[]
  usage: Record<string, EvalUsage>
}

export type EvalRun = {
  key: string
  toolUseId: string | null
  runId: string | null
  taskId: string | null
  name: string | null
  at: number
  status: string
  endedAt: number | null
  launched: boolean
  fingerprint: string | null
  gate: EvalGate | null
  agents: EvalAgent[]
  peakOpus: number
  limit: number
  baseline: EvalBaseline
  launchReadings?: MeterReadings | null
  saved: Saved | null
  hidden?: boolean
}

export type EvalAgentView = {
  agentId: string
  label: string
  ok: boolean
  reason: string | null
  done: boolean
  approved: string | null
  ran: string
  approvedModel: string | null
  approvedEffort: string | null
  ranModel: string
  ranEffort: string | null
  phase: string | null
}

export type EvalPhaseView = {
  key: string
  title: string
  state: 'not started' | 'did not run' | 'running' | 'done'
  total: number
  done: number
  red: number
  ok: boolean
  open: boolean
  counts: { opus: number; sonnet: number; haiku: number }
  agentIds: string[]
  agents: EvalAgentView[]
}

export type EvalState = {
  v: number
  limit: number
  launches: Record<string, EvalLaunch>
  runs: Record<string, EvalRun>
  early: Record<string, { sent: EvalSent[]; done: boolean; usage: Record<string, EvalUsage> }>
  ui: { run: string | null; folds?: Record<string, boolean>; focus?: string | null; list?: { stoppedOpen?: boolean } }
  main: EvalBaseline
  meter: EvalMeter
}

export type TallyRun = {
  key: string
  status: string
  baseline: { family: string; effort: string } | null
  agents: { agentId: string; pieces: Omit<EvalUsage, 'requests'>[] }[]
  windows: Record<MeterWindow, string | null>
  withheld?: MeterWindow[]
  at: number
}

export type TallyOverall = (
  | (Omit<Saved, 'agents' | 'groups'> & { count: number; counted: Record<MeterWindow, number> })
  | { status: 'none'; count: number; running: boolean; baseline: { family: string; effort: string } | null }
  | { status: 'unknown'; count: number; running: boolean }
) & { windows: Record<MeterWindow, string | null>; at: number }

export type TallyState = {
  v: number
  sid?: string | null
  runs: Record<string, TallyRun>
  overall?: TallyOverall
}

export type ContextState = {
  tokens: number | null
  window: number
  compact: number | null
  asked: number
  misses: number
}

declare module 'claude-code' {
  interface PluginState {
    ultraguard: { eval: Shaped<EvalState>; context: Shaped<ContextState>; tally: Shaped<TallyState> }
  }
}

export type EvalGateStage = {
  index: number | null
  label: string | null
  class: string | null
  model: string | null
  effort: string | null
}

export type EvalGate = {
  decision: 'pass' | 'deny'
  fingerprint: string | null
  maxOpus: number | null
  sessionModel: string | null
  at?: string | null
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
  } | null
  agents: { agentId: string; dollars: number | null; five_hour: number | null }[]
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

export type EvalMeter = {
  subscription: boolean | null
  acc: Record<MeterWindow, MeterTokens>
  last: Record<MeterWindow, { pct: number; resetsAt: string | null } | null>
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
}

export type EvalState = {
  v: number
  limit: number
  launches: Record<string, EvalLaunch>
  runs: Record<string, EvalRun>
  early: Record<string, { sent: EvalSent[]; done: boolean; usage: Record<string, EvalUsage> }>
  ui: { run: string | null }
  main: EvalBaseline
  meter: EvalMeter
}

declare module 'claude-code' {
  interface PluginState {
    ultraguard: { eval: Shaped<EvalState> }
  }
}

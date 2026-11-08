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
}

export type EvalSent = { model: string; effort: string | null }

export type EvalAgent = {
  agentId: string
  label: string
  askedModel: string | null
  ranModel: string | null
  at: number
  done: boolean
  sent: EvalSent[]
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
}

export type EvalAgentView = {
  agentId: string
  label: string
  ok: boolean
  reason: string | null
  done: boolean
  approved: string | null
  ran: string
}

export type EvalState = {
  v: number
  limit: number
  launches: Record<string, EvalLaunch>
  runs: Record<string, EvalRun>
  early: Record<string, { sent: EvalSent[]; done: boolean }>
  ui: { run: string | null }
}

declare module 'claude-code' {
  interface PluginState {
    tierguard: { eval: Shaped<EvalState> }
  }
}

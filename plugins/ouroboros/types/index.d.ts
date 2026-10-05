export type FrictionKind = 'denied' | 'error' | 'correction' | 'interrupt'

export type Friction = {
  at: number
  turn: number
  kind: FrictionKind
  tool?: string
  detail: string
}

export type GeneRecord = { id: string; title: string; why: string; acceptedAt: number }

export type GateCheck = { name: string; isPassed: boolean; tail: string }

export type MutationStatus = 'diagnosing' | 'mutating' | 'gating' | 'ready' | 'failed' | 'barren'

export type Mutation = {
  status: MutationStatus
  startedAt: number
  id?: string
  title?: string
  why?: string
  spec?: string
  lab?: string
  agentId?: string
  source?: string
  test?: string
  gate?: GateCheck[]
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    ouroboros: {
      friction: Friction[]
      genome: GeneRecord[]
      mutation: Mutation | null
      evolvedAt: number
    }
  }
}

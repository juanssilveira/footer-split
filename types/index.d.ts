// Mirrors the fields of the engine's SessionMeasureInput that the footer reads.
export type Usage = {
  context: { percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

// What /toggle set per item; an item left out follows its thresholds.
export type Modes = Record<string, 'hidden' | 'shown'>

// Which side of the footer /align put the usage on.
export type Align = 'left' | 'right'

declare module 'claude-code' {
  interface PluginState {
    footersplit: { measured: Usage | null; modes: Modes | null; align: Align | null }
  }
}

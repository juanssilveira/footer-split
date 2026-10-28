// Mirrors the fields of the engine's SessionMeasureInput that the footer reads.
export type Usage = {
  context: { percent?: number }
  rateLimits: { kind: string; percentUsed: number }[]
  cost?: { usd: number }
}

// What /toggle set per item; an item left out follows its thresholds.
export type Modes = Record<string, 'hidden' | 'shown'>

declare module 'claude-code' {
  interface PluginState {
    footersplit: { measured: Usage | null; modes: Modes | null }
  }
}

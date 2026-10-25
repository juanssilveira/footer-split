// Mirrors the fields of the engine's SessionMeasureInput that the footer reads.
export type Usage = {
  context: { percent?: number }
  rateLimits: { kind: string; percentUsed: number }[]
  cost?: { usd: number }
}

declare module 'claude-code' {
  interface PluginState {
    'footer-split': { measured: Usage | null; hideCost: boolean }
  }
}

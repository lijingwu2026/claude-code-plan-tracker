import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'

import { SESSION, world } from './fixtures'
import type { World } from './fixtures'

const USAGE: TurnUsage = { model: 'claude-sonnet-5-5', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }

/** One request through the chain: every chunk it streamed, and the response it returned (a stream's return value is read by hand: `for await` drops it). */
const request = async ($: Engine, w: World, agentId?: string) => {
  w.responseUsage = USAGE

  const stream = $.turn.step({ turnId: 't1', index: 0, model: USAGE.model, messageCount: 3, ...(agentId === undefined ? {} : { agentId }) })
  const chunks: unknown[] = []
  let next = await stream.next()

  while (!next.done) {
    chunks.push(next.value)
    next = await stream.next()
  }

  return { chunks, response: next.value }
}

describe('turn.step through the plugin', () => {
  for (const agentId of [undefined, 'agent-1']) {
    test(`${agentId === undefined ? 'the main thread' : 'a subagent'}: the plugin adds no chunk and returns the response as the engine gave it`, async ($, on) => {
      const w = world(on)

      await $.session.start(SESSION)

      const { chunks, response } = await request($, w, agentId)

      expect(chunks).toEqual([])
      expect(response).toEqual({ turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE })
    })
  }
})

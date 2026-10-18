import { describe, expect as kitExpect, test as base } from 'claude-code/testing'

import { OPTIONS } from './fixtures'

export { describe }

/**
 * The kit's `expect` with `toBeCloseTo(expected, digits = 9)` besides, which the kit lacks: a sum of prices is a float.
 */
export const expect = Object.assign(
  (received: unknown, message?: string) => ({
    ...kitExpect(received, message),
    toBeCloseTo: (expected: number, digits = 9) =>
      kitExpect(typeof received === 'number' && Math.abs(received - expected) < 10 ** -digits, `${String(received)} is not within 1e-${digits} of ${expected}`).toBe(true),
  }),
  kitExpect,
)

/** `test` with the settings the suite runs under (a board command and a name): the plugin reads them as `options`. */
export const test = ((name: string, ...rest: unknown[]) =>
  rest.length === 1
    ? (base as Function)(name, { options: OPTIONS }, rest[0])
    : (base as Function)(name, { options: OPTIONS, ...(rest[0] as object) }, rest[1])) as unknown as typeof base

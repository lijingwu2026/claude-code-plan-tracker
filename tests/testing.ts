import { describe, expect, test as base } from 'claude-code/testing'

import { OPTIONS } from './fixtures'

export { describe, expect }

/** `test` with the settings the suite runs under (a board command, a usage command, a name): the plugin reads them as `options`. */
export const test = ((name: string, ...rest: unknown[]) =>
  rest.length === 1
    ? (base as Function)(name, { options: OPTIONS }, rest[0])
    : (base as Function)(name, { options: OPTIONS, ...(rest[0] as object) }, rest[1])) as unknown as typeof base

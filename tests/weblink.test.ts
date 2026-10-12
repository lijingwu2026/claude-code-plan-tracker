import { describe, expect, test } from './testing'
import type { Engine } from 'claude-code/testing'

import * as board from '../hooks/board'
import type { PlanBoard, PlanRow } from '../types'
import type { Node } from './fixtures'
import { BOARD, HOME, PANE_ID, SESSION, openCard, paneProps, textOf, world } from './fixtures'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', columns = 160) =>
  $.ui.mount({ plugin: 'plan-tracker', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(columns), viewport: { columns: columns + 60, rows: 50, isFullscreen: true } })

const URL = 'https://claude.ai/artifact/x'

/** An old row: a claude.ai page stored as its deliverable, before the tracker refused links there. */
const ROW: PlanRow = { task: 'old row', status: 'Done', updated: null, deliverable: URL, change: 'the design page' }

const boardOf = (...rows: PlanRow[]): PlanBoard => ({ ...BOARD, plans: [{ ...BOARD.plans[0]!, rows }] })

/** Every element of a tree, the root first. */
const walk = (node: Node | string | undefined): Node[] => (node === undefined || typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])

const everything = async (pane: Awaited<ReturnType<typeof mountPane>>) => JSON.stringify(walk((await pane.drawn()) as Node))

describe('a deliverable that is a web link', () => {
  test('it is a link as it is, never a file path: no file:// link, whatever the home folder', () => {
    expect(board.isWebLink(URL)).toBe(true)
    expect(board.isWebLink('  http://example.com/page ')).toBe(true)
    expect(board.isWebLink('knowledge/https-notes.md')).toBe(false)
    expect(board.isWebLink('https:/claude.ai/x')).toBe(false)
    expect(board.deliverableHref(URL, HOME)).toBe(URL)
    expect(board.deliverableHref(URL, undefined)).toBe(URL)
    expect(board.deliverableHref(' http://example.com/page ', HOME)).toBe('http://example.com/page')
    // a link with a space in it is not one a surface can open
    expect(board.deliverableHref('https://example.com/a b', HOME)).toBeNull()
    // a path is as it was
    expect(board.deliverableHref('knowledge/a.md', HOME)).toStartWith('file://')
  })

  test('its type in the table is link, not the extension of its last piece', () => {
    expect(board.typeOf(URL)).toBe('link')
    expect(board.typeOf('https://example.com/report.html')).toBe('link')
    expect(board.typeOf('knowledge/report.html')).toBe('.html')
  })

  test('terminal table: the row shows the URL as it is, and nothing in the drawing is a file link to it', async ($, on) => {
    world(on, { fixture: boardOf(ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'terminal')

    expect(await everything(pane)).not.toContain('file://')
    expect(textOf(await pane.find({ key: 'deliverables' }))).toContain(URL)
    expect(textOf(await pane.find({ key: 'deliverables' }))).toContain('link')
    expect(textOf(await pane.find({ key: 'deliverables' }))).not.toContain("Couldn't find")
    await pane.unmount()
  })

  test('desktop table: a Markdown link to the URL that the surface opens itself: no file:// link, and no press the mod answers', async ($, on) => {
    world(on, { fixture: boardOf(ROW) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const link = (await pane.find({ type: 'Markdown', key: 'deliverable:0' })) as Node

    expect(String(link.props.text)).toBe(`[${URL}](${URL})`)
    expect(await everything(pane)).not.toContain('file://')
    // a Markdown with no `onLinkPress` has nothing a press can reach: the surface opens the link
    await expect(pane.press({ key: 'deliverable:0', link: { href: URL } })).rejects.toThrow()
    await pane.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface} task page: the Deliverable row is a link to the URL, with no file:// link and no "Couldn't find" text`, async ($, on) => {
      world(on, { fixture: boardOf(ROW) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 96)

      await openCard(pane, 0)

      const row = await pane.find({ key: 'field:deliverable' })

      if (surface === 'desktop') {
        const link = (await pane.find({ type: 'Markdown', key: 'detail:deliverable' })) as Node

        expect(String(link.props.text)).toBe(`[${URL}](${URL})`)
        await expect(pane.press({ key: 'detail:deliverable', link: { href: URL } })).rejects.toThrow()
      } else {
        expect((await pane.findAll({ type: 'Link' })).map(node => String(node.props.href))).toContain(URL)
      }

      expect(await everything(pane)).not.toContain('file://')
      expect(textOf(row)).not.toContain("Couldn't find")
      await pane.unmount()
    })

    test(`${surface}: a web link has no diff to open: no Diff › button and no change link, though the row has a change text`, async ($, on) => {
      world(on, { fixture: boardOf(ROW) })
      await $.session.start(SESSION)
      const pane = await mountPane($, surface, 96)

      expect(await pane.find({ key: 'change:0' })).toBeUndefined()
      await openCard(pane, 0)
      expect(await pane.find({ key: 'detail:change' })).toBeUndefined()
      await pane.unmount()
    })
  }

  test('a file deliverable is as it was: a file:// link, its own type', async ($, on) => {
    world(on, { fixture: boardOf({ ...ROW, deliverable: 'knowledge/a.md', change: undefined } as PlanRow) })
    await $.session.start(SESSION)
    const pane = await mountPane($, 'desktop')
    const link = (await pane.find({ type: 'Markdown', key: 'deliverable:0' })) as Node

    expect(String(link.props.text)).toMatch(/^\[knowledge\/a\.md\]\(file:\/\/.+knowledge\/a\.md\)$/)
    expect(textOf(await pane.find({ key: 'deliverables' }))).toContain('.md')
    await pane.unmount()
  })
})

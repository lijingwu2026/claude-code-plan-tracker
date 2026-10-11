/** The two drawings of the mod, as trees: the band above the prompt and the pane. */
import type { BoxProps, ButtonProps, ClientProps, ElementConstructor, LinkProps, MarkdownProps, RenderElement, RenderSurface, SvgProps, TextProps } from 'claude-code'

import type { PlanEntry, PlanRow } from '../types'
import {
  BAND_MASCOT_SPACE,
  BAND_SPRITE_CELLS,
  BAND_SPRITE_PX,
  BAR_PX,
  CARD_BAR_CELLS,
  CARD_SPRITE_CELLS,
  HEX,
  barSvg,
  countOf,
  filledOf,
  BORDER_COLUMNS,
  BOARD_LABEL,
  CARD_SPRITE_PX,
  TRACK_COLOR,
  spriteSvg,
  spriteSvgAnimated,
  CHIPS,
  TYPE_CHIP,
  FILE_LABEL,
  LINK_COLOR,
  MASCOT,
  MASCOT_COLUMNS,
  NEEDS_YOU_COLOR,
  SIDE_BY_SIDE_FROM,
  STYLE,
  bandFit,
  bandLine,
  cardRows,
  checkerOf,
  cardView,
  countText,
  STATE_COLUMNS,
  STATE_STYLE,
  deliverableGroups,
  deliverableHref,
  planLineOf,
  planStateOf,
  progressOf,
  statusWords,
  usageLineOf,
  whoLineOf,
  chipCols,
  displayWidth,
  fullCard,
  markerOf,
  noteLinesOf,
  isBlocked,
  executorOf,
  isYou,
  isRunning,
  laneWidth,
  lanesOf,
  SHOW_LESS,
  mascotAt,
  moreButton,
  overflowLabel,
  revealLeft,
  piecesOf,
  rainbowAt,
  scopeOf,
  shortPath,
  truncate,
  wrap,
  worstStatus,
} from './board'
import type { CardRow } from './card'
import type { Card, Chip, Deliverable, DeliverableGroup, Lane, LaneKey, Pose, Progress } from './board'

/** The elements both drawings use; every surface's table has them. */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
  Markdown: ElementConstructor<MarkdownProps>
  /** Absent on a surface with no `Client` (vscode, mobile): a card is then Buttons. */
  Client?: ElementConstructor<ClientProps>
  /** Only the remote surfaces (desktop, vscode, mobile) draw it. */
  Svg?: ElementConstructor<SvgProps>
}

/** Whether what the hooks below drew is more than an empty Box or Text. */
export function holdsSomething(drawn: RenderElement | null | undefined): boolean {
  if (!drawn) {
    return false
  }

  return (drawn.type !== 'Box' && drawn.type !== 'Text') || drawn.children === undefined || drawn.children.length > 0
}

/**
 * The fill of a revealed card: the theme's inverse-text color, which is the color its text is drawn on, so it follows a light
 * or a dark theme and nothing underneath shows through.
 */
const FILL = 'inverseText'

/** The desktop's card bar: a fixed 8 cells whatever the total, filled in proportion to done/total. */
const deskBar = (bar: Progress, color: string) => {
  const filled = filledOf(bar.done, bar.total, CARD_BAR_CELLS)

  return { filled, empty: CARD_BAR_CELLS - filled, color, track: TRACK_COLOR }
}

/** The fields of a card row's tag: its chip, or none. */
const tagFields = (word: string, pad: number): Pick<CardRow, 'tag' | 'tagPad' | 'tagBg' | 'tagFg' | 'tagBold'> => {
  const chip: Chip | undefined = CHIPS[word]

  return word === '' || chip === undefined
    ? { tag: '', tagPad: 0, tagBg: '', tagFg: '', tagBold: false }
    : { tag: word, tagPad: pad, tagBg: chip.bg, tagFg: chip.fg, tagBold: chip.bold === true }
}

/** `text` padded with spaces on the right to `cols` columns. */
const padTo = (text: string, cols: number) => `${text}${' '.repeat(Math.max(0, cols - displayWidth(text)))}`

type BandArgs = {
  /** The plan the band draws (as finished when a PLAN-DONE with 0 left named it). */
  plan: PlanEntry
  plans: readonly PlanEntry[]
  /** Columns the row has after the mascot and its space. */
  columns: number
  /** What the hooks below drew, drawn under ours when it holds something. */
  below: RenderElement | undefined
  /** Whether the plan list shows under the row. */
  isOpen: boolean
  /** Whether the board is showing the plan file: the right end is then the way back to the board. */
  isFile: boolean
  /** With a frame the filled cells are the rainbow at that frame instead of the success color. */
  frame: number | null
  pose: string
  /** The card sprite's pose the desktop draws instead of `pose`'s block characters. */
  spritePose?: Pose
  /** The desktop's sprite switches its poses by itself (a plan with a row In Progress), with no redraw. */
  isMoving?: boolean
  /** The desktop's proportional font: the mascot is drawn one Box per cell. */
  isProportional?: boolean
  /** Rows the engine lets the band show whole (`e.props.maxRows`); a terminal band that does not fit them with its frame is drawn without it. */
  maxRows?: number
  onBar: () => void
  onMenu: () => void
  onPick: (anchor: string) => void
  onFile: () => void
  onBoard: () => void
}

/** Columns the band's frame takes from the row: two border columns and one padding column each side. */
const FRAME_COLUMNS = 4

/**
 * The band: ONE row inside a dim round frame, `<mascot> ● <name> ▾  <bar> n/m ........ Plan file ›`, then the plan list when it is open, then
 * whatever the hooks below drew. A Button takes no color, so the colored parts are Text inside a plain Button: "name ▾"
 * opens the list, the bar and the count toggle the board, "Plan file ›" opens the board on the plan file (and is "‹ Board"
 * while it shows it).
 */
export function drawBand(kit: Kit, args: BandArgs): RenderElement {
  const { Box, Text, Button } = kit
  const { plan, plans, columns, below, isOpen, isFile, frame, pose, spritePose, isMoving = false, isProportional = false, maxRows = Number.POSITIVE_INFINITY, onBar, onMenu, onPick, onFile, onBoard } = args
  const line = bandLine(plan, columns)
  const { color: stateColor } = STATE_STYLE[line.state]
  const hasChoice = plans.length > 1
  const { color: dotColor, ...dotDim } = STYLE[worstStatus(plan)]
  // The list is as wide as the column. The name is cut first (to 4 columns at the least); if even then the state word has no room, it is dropped whole.
  const listColumns = columns + BAND_MASCOT_SPACE
  const countCols = Math.max(0, ...plans.map(one => displayWidth(countText(one))))
  const nameRoom = (hasState: boolean) => listColumns - 2 - 2 - countCols - (hasState ? STATE_COLUMNS + 2 : 0)
  const hasListState = nameRoom(true) >= 4
  const names = plans.map(one => truncate(one.name, Math.max(1, nameRoom(hasListState))))
  const nameCols = Math.max(0, ...names.map(displayWidth))

  const option = (one: PlanEntry, at: number) => {
    const isOn = one.anchor === plan.anchor
    const lead = `${isOn ? '▸' : ' '} ${padTo(names[at] ?? '', nameCols)}  `
    const word = hasListState ? padTo(planStateOf(one), STATE_COLUMNS) : ''
    const tail = `${hasListState ? '  ' : ''}${countText(one)}`

    return (
      <Button plain key={`band:plan:${one.anchor}`} label={`${lead}${word}${tail}`} onPress={() => onPick(one.anchor)}>
        <Text {...(isOn ? { bold: true } : {})}>{lead}</Text>
        {hasListState ? <Text color={STATE_STYLE[planStateOf(one)].color} {...(isOn ? { bold: true } : {})}>{word}</Text> : null}
        <Text {...(isOn ? { bold: true } : {})}>{tail}</Text>
      </Button>
    )
  }

  const fileLabel = isFile ? BOARD_LABEL : FILE_LABEL
  const fileButton = isFile ? (
    <Button plain key="band:board" label={BOARD_LABEL} onPress={onBoard} />
  ) : (
    <Button plain key="band:file" label={FILE_LABEL} onPress={onFile} />
  )

  const filledCells = (count: number) =>
    Array.from({ length: count }, (_, at) => <Text color={frame === null ? STYLE.Done.color : rainbowAt(at, frame)}>▰</Text>)

  // The desktop: a Button holds only strings and Text, so a picture (the mascot, the bar) cannot be pressed. A region
  // that posts `{ band: 'toggle' }` is laid over each such part (and the dot and the gap), so the whole band is a target. The
  // name's and the plan file's buttons are drawn as before, and a region never covers them.
  const Client = isProportional ? kit.Client : undefined

  const zone = (key: string, child: RenderElement, grow = false) =>
    Client === undefined ? (
      child
    ) : (
      <Box key={`band:zone:${key}`} position="relative" flexShrink={grow ? 1 : 0} {...(grow ? { flexGrow: 1 } : {})}>
        {child}
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <Client key={`band:zone:${key}:region`} module="./band.tsx" width="100%" height="100%" />
        </Box>
      </Box>
    )

  if (isProportional) {
    return (
      <Box flexDirection="column">
        <Box key="band:frame" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Box key="bar" flexDirection="row">
          {kit.Svg !== undefined
            ? zone(
                'mascot',
                <Box width={BAND_SPRITE_CELLS} flexShrink={0} alignSelf="center">
                  <kit.Svg
                    source={(isMoving ? spriteSvgAnimated(MASCOT, 'claude') : spriteSvg(spritePose ?? MASCOT[0], 'claude')).source}
                    alt="Claude Code's mascot"
                    width={BAND_SPRITE_PX.width}
                    height={BAND_SPRITE_PX.height}
                    {...(isMoving ? { isInteractive: true } : {})}
                  />
                </Box>,
              )
            : null}
          {zone('dot', <Text color={dotColor} {...dotDim}>●{' '}</Text>)}
          {hasChoice ? (
            <Button plain key="band:plans" label={`${line.name} ▾`} onPress={onMenu}>
              <Text bold>{line.name}</Text>
              <Text> ▾</Text>
            </Button>
          ) : (
            zone('name', <Text bold>{line.name}</Text>)
          )}
          {zone(
            'gap',
            <Box flexDirection="row">
              <Text> </Text>
              <Text color={stateColor}>{line.state}</Text>
              <Text>{'  '}</Text>
            </Box>,
          )}
          {kit.Svg === undefined
            ? null
            : zone(
                'bar',
                // The glyphs draw as slanted dashes in a proportional font: a thin rounded bar of one fixed width.
                <Box key="band:solid" flexShrink={0} alignSelf="center" marginRight={1}>
                  <kit.Svg
                    source={barSvg(
                      countOf(plan).total === 0 ? 0 : countOf(plan).done / countOf(plan).total,
                      HEX.success ?? '#3C9D5A',
                      frame === null ? undefined : Array.from({ length: Math.max(1, line.filled) }, (_, at) => rainbowAt(at, frame)),
                    )}
                    alt={`${line.count} done`}
                    width={BAR_PX.width}
                    height={BAR_PX.height}
                  />
                </Box>,
              )}
          <Button plain key="band:bar" label={` ${line.count}`} onPress={onBar}>
            <Text>{` ${line.count}`}</Text>
          </Button>
          {zone('rest', <Box minWidth={2} />, true)}
          {fileButton}
        </Box>
        </Box>
        {isOpen && hasChoice ? (
          <Box key="band:list" flexDirection="column">
            {plans.map(option)}
          </Box>
        ) : null}
        {holdsSomething(below) ? below : null}
      </Box>
    )
  }

  // The terminal: the mascot, the dot and (with one plan) the name are one Button; the bar, the count and the gap up to
  // "Plan file ›" are another. Both toggle the board; the name's menu and the plan file keep their own buttons. The parts
  // are fitted to the frame's inside (`bandFit`), so the row never runs past the column a docked pane leaves it.
  // A pane open inline can leave the band two rows: then the frame (its two border rows) goes and the band is the one row it was before it.
  const framedFit = bandFit(plan, columns - FRAME_COLUMNS, hasChoice, displayWidth(fileLabel))
  const isFramed = maxRows >= (framedFit.isStacked ? 4 : 3)
  const frameColumns = isFramed ? FRAME_COLUMNS : 0
  const fit = isFramed ? framedFit : bandFit(plan, columns, hasChoice, displayWidth(fileLabel))
  const headText = `${pose} ● ${hasChoice ? '' : fit.name}`
  const nameWidth = hasChoice ? displayWidth(`${fit.name} ▾`) : 0
  const bar = fit.filled + fit.empty
  const barText = ` ${fit.hasState ? `${fit.state}  ` : ''}${bar > 0 ? `${'▰'.repeat(fit.filled)}${'▱'.repeat(fit.empty)} ` : ''}${fit.count}`
  const used = displayWidth(headText) + nameWidth + displayWidth(barText) + (fit.hasFile ? displayWidth(fileLabel) : 0)
  const filler = ' '.repeat(Math.max(0, columns + BAND_MASCOT_SPACE - frameColumns - used - (fit.hasFile ? 2 : 0)))

  const progress = (
    <Button plain key="band:bar" label={`${barText}${fit.isStacked ? '' : filler}`} onPress={onBar}>
      <Text>{' '}</Text>
      {fit.hasState ? <Text color={stateColor}>{fit.state}</Text> : null}
      {fit.hasState ? <Text>{'  '}</Text> : null}
      {bar > 0 ? filledCells(fit.filled) : null}
      {bar > 0 ? <Text dimColor>{'▱'.repeat(fit.empty)}</Text> : null}
      {bar > 0 ? <Text>{' '}</Text> : null}
      <Text>{`${fit.count}${fit.isStacked ? '' : filler}`}</Text>
    </Button>
  )

  return (
    <Box flexDirection="column">
      <Box key={isFramed ? 'band:frame' : 'band:plain'} flexDirection="column" {...(isFramed ? { borderStyle: 'round' as const, borderDimColor: true, paddingX: 1 } : {})}>
        <Box key="bar" flexDirection="row">
          <Button plain key="band:head" label={headText} onPress={onBar}>
            <Text color="claude">{`${pose} `}</Text>
            <Text color={dotColor} {...dotDim}>
              ●{' '}
            </Text>
            {hasChoice ? null : <Text bold>{fit.name}</Text>}
          </Button>
          {hasChoice ? (
            <Button plain key="band:plans" label={`${fit.name} ▾`} onPress={onMenu}>
              <Text bold>{fit.name}</Text>
              <Text> ▾</Text>
            </Button>
          ) : null}
          {fit.isStacked ? <Box flexGrow={1} minWidth={0} /> : progress}
          {fit.isStacked ? null : <Box flexGrow={1} minWidth={1} />}
          {fit.hasFile ? fileButton : null}
        </Box>
        {fit.isStacked ? (
          <Box key="bar:2" flexDirection="row">
            {progress}
            <Box flexGrow={1} minWidth={0} />
          </Box>
        ) : null}
      </Box>
      {isOpen && hasChoice ? (
        <Box key="band:list" flexDirection="column">
          {plans.map(option)}
        </Box>
      ) : null}
      {holdsSomething(below) ? below : null}
    </Box>
  )
}

/** What the pane shows besides the board: the plan file's text, or why there is none. */
export type FileView = { text: string } | { error: string }

type PaneArgs = {
  plans: readonly PlanEntry[]
  plan: PlanEntry
  /** `e.props.bodyColumns` */
  columns: number
  message: string | null
  /** The index in `plan.rows` of the card whose page replaces the board; null shows the board. */
  detail: number | null
  /** The plan file view replaces the board (and the page): its text, or why it cannot be read. */
  file: FileView | null
  /** The time the plan line counts "so far" to (`Date.now()`); a parameter so a test can pin it. */
  now: number
  /** Rows the pane shows (`scroll.bodyRows`); undefined when the surface does not say. */
  bodyRows?: number
  /** The person's home directory, which a `~/` deliverable is under; undefined when not known. */
  home: string | undefined
  /** The animation frame the mascot is drawn at. */
  frame: number
  /** Whether the plan dropdown shows its list. */
  isOpen: boolean
  /** The lanes of the plan that show all their cards. */
  expanded: readonly LaneKey[]
  /** Whether the surface draws a `Client` (terminal, desktop): a card is then one, else Buttons. */
  hasClient: boolean
  /** The surface drawing: the desktop app has a proportional font, so it is laid out with flex, not padded with spaces. */
  surface: RenderSurface
  /** A press on a deliverable's link on the desktop: the deliverable's path as the tracker wrote it. */
  onOpenPath: (path: string) => void
  onMenu: () => void
  onPick: (anchor: string) => void
  onCard: (index: number) => void
  onBack: () => void
  onFile: () => void
  onLane: (key: LaneKey) => void
}

/** The pane: the plan dropdown, "Plan file ›" and the plan line on top, then the four lanes and the deliverables (or one card's page, or the plan file). */
export function drawPane(kit: Kit, args: PaneArgs): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  // Only the terminal and the desktop draw a Client; another surface's table has the name but drops the element.
  const Client = args.hasClient ? kit.Client : undefined
  const { plans, plan, columns, message, detail, file, home, frame, isOpen, expanded } = args
  const { onMenu, onPick, onCard, onBack, onFile, onLane, onOpenPath, bodyRows } = args
  const isProportional = args.surface === 'desktop'
  // A Client's props: the terminal's stay as they were.
  const proportional = isProportional ? ({ isProportional: true } as const) : {}
  // The desktop leaves a row between cards, which a proportional layout has room for; the terminal's rows are dear.
  const gapRows = args.surface === 'desktop' ? 1 : 0
  const isSideBySide = columns >= SIDE_BY_SIDE_FROM
  const width = isSideBySide ? laneWidth(columns, lanesOf(plan, expanded).length) : columns

  const { color: dotColor, ...dotDim } = STYLE[worstStatus(plan)]
  const hasChoice = plans.length > 1
  const state = planStateOf(plan)
  const planLine = planLineOf(plan, args.now, columns)
  // The state word is never cut: the name is shortened to leave it room (two gaps and the word besides the count).
  const headName = truncate(plan.name, Math.max(8, columns - 20 - displayWidth(countText(plan)) - 2 - displayWidth(state)))

  const header = (
    <Box key="menu" flexDirection="row">
      <Text color={dotColor} {...dotDim}>
        ●{' '}
      </Text>
      {hasChoice ? (
        <Button plain key="menu:name" label={headName} onPress={onMenu}>
          <Text bold>{headName}</Text>
        </Button>
      ) : (
        <Text bold>{headName}</Text>
      )}
      <Text>{'  '}</Text>
      <Text color={STATE_STYLE[state].color}>{state}</Text>
      <Text>{'  '}</Text>
      <Text color="suggestion">{countText(plan)}</Text>
      {hasChoice ? <Button plain key="menu:arrow" label={isOpen ? ' ▴' : ' ▾'} onPress={onMenu} /> : null}
      <Box flexGrow={1} minWidth={2} />
      <Button plain key="plan-file" label={FILE_LABEL} onPress={onFile} />
    </Box>
  )

  const names = plans.map(one => truncate(one.name, Math.max(8, columns - 8 - STATE_COLUMNS - 2 - displayWidth(countText(one)))))
  const nameCols = Math.max(0, ...names.map(displayWidth))

  const option = (one: PlanEntry, at: number) => {
    const isOn = one.anchor === plan.anchor
    const text = `${isOn ? '▶' : ' '} ${padTo(names[at] ?? '', nameCols)}`

    return (
      <Box flexDirection="row">
        <Button plain key={`plan:${one.anchor}`} label={text} onPress={() => onPick(one.anchor)}>
          <Text {...(isOn ? { bold: true, inverse: true } : {})}>{text}</Text>
        </Button>
        <Text color={STATE_STYLE[planStateOf(one)].color} {...(isOn ? { inverse: true } : {})}>{`  ${padTo(planStateOf(one), STATE_COLUMNS)}`}</Text>
        <Text color="suggestion" {...(isOn ? { inverse: true } : {})}>{` ${countText(one)}`}</Text>
      </Box>
    )
  }

  // A card is its own bordered Box (the border takes 2 columns): every line of it is a Button, so a press anywhere opens
  // its page. An In Progress card has the mascot beside its two lines; a Blocked card is red all through (border, text,
  // tag) with the mascot frozen on one pose; the tag is right-aligned on the last line.
  // The card is a keyed Box, so it is a hover scope. Only the Buttons are pressable, and a Button inverts under the
  // pointer, so the mascot is plain Text beside the Button of its row and never sits under that bar. A card whose name is
  // cut holds a hidden absolute Box over itself that its hover reveals: the name whole and the executor.
  const card = ({ row, index }: Card) => {
    const view = cardView(row, width)
    const isDoing = isRunning(row)
    const isStuck = isBlocked(row)
    const { color } = STYLE[row.status]
    const press = () => onCard(index)
    const art = isStuck ? MASCOT[0] : mascotAt(frame)
    // A proportional font draws block glyphs at its own shapes: the desktop draws the mascot as a picture beside the card's region.
    const Svg = isProportional ? kit.Svg : undefined
    const useSprite = Svg !== undefined && view.mascot && Client !== undefined
    const markerColor = isStuck ? 'error' : NEEDS_YOU_COLOR

    const parsed: CardRow[] = view.lines.map((line, at) => {
      const isBar = at === view.barAt
      const marker = !isBar && at === 0 && view.marker !== '' && line.startsWith(view.marker) ? view.marker : ''

      return {
        art: view.mascot && !useSprite ? `${art[at] ?? ' '.repeat(MASCOT_COLUMNS)} ` : '',
        artColor: isStuck ? 'error' : 'claude',
        marker,
        markerColor,
        name: isBar ? ` ${view.bar?.count ?? ''}` : line.slice(marker.length),
        isRed: isStuck,
        isBold: isDoing && !isBar,
        ...(isBar && view.bar !== undefined ? { bar: isProportional ? deskBar(view.bar, color) : { filled: view.bar.filled, empty: view.bar.empty, color, track: TRACK_COLOR } } : {}),
        ...tagFields(at === view.tagAt ? view.tag : '', view.pad),
      }
    })

    // With a Client the rows are drawn by `card.tsx` in one region that posts a click and inverts under no pointer.
    const lineRows = Client
      ? [
          useSprite && Svg !== undefined ? (
            <Box key={`card:${index}:sprite`} flexDirection="row" alignItems="center">
              <Box width={CARD_SPRITE_CELLS} flexShrink={0}>
                <Svg
                  source={(isDoing ? spriteSvgAnimated(MASCOT, 'claude') : spriteSvg(art, isStuck ? 'error' : 'claude')).source}
                  alt="Claude Code's mascot"
                  width={CARD_SPRITE_PX.width}
                  height={CARD_SPRITE_PX.height}
                  {...(isDoing ? { isInteractive: true } : {})}
                />
              </Box>
              <Client
                key={`card:${index}`}
                module="./card.tsx"
                width={Math.max(1, width - BORDER_COLUMNS - CARD_SPRITE_CELLS)}
                height={parsed.length}
                props={{ index, rows: parsed, ...proportional }}
              />
            </Box>
          ) : (
            <Client
              key={`card:${index}`}
              module="./card.tsx"
              width={Math.max(1, width - BORDER_COLUMNS)}
              height={parsed.length}
              props={{ index, rows: parsed, ...proportional }}
            />
          ),
        ]
      : parsed.map((one, at) => {
          const key = at === 0 ? `card:${index}` : `card:${index}:${at}`
          const picture = view.mascot ? <Text color={one.artColor}>{one.art}</Text> : null
          const button =
            view.lines[at] === '' && one.tag === '' ? null : (
              <Button plain key={key} label={`${view.lines[at] ?? ''}${one.tag === '' ? '' : ` ${one.tag} `}`} onPress={press}>
                {one.marker === '' ? null : (
                  <Text bold color={one.markerColor}>
                    {one.marker}
                  </Text>
                )}
                {one.bar === undefined ? null : (
                  <Text color={one.bar.color}>{'▰'.repeat(one.bar.filled)}</Text>
                )}
                {one.bar === undefined ? null : <Text dimColor>{'▱'.repeat(one.bar.empty)}</Text>}
                <Text {...(isStuck ? { color: 'error' } : {})} {...(isDoing && one.bar === undefined ? { bold: true } : {})}>
                  {one.name}
                </Text>
                {one.tag === '' ? null : (
                  <Text>
                    {' '.repeat(one.tagPad)}
                    <Text color={one.tagFg} backgroundColor={one.tagBg} {...(one.tagBold ? { bold: true } : {})}>{` ${one.tag} `}</Text>
                  </Text>
                )}
              </Button>
            )

          return view.mascot ? (
            <Box key={`card:${index}:row${at}`} flexDirection="row">
              {picture}
              {button}
            </Box>
          ) : (
            button
          )
        })

    return (
      <Box
        key={`cardbox:${index}`}
        hover={isProportional ? { scope: scopeOf(plan.anchor, index), borderStyle: 'bold', borderDimColor: false } : { scope: scopeOf(plan.anchor, index) }}
        width={width}
        flexDirection="column"
        borderStyle="round"
        borderColor={color}
        borderDimColor={!isDoing && !isStuck}
        paddingX={1}
      >
        {lineRows}
      </Box>
    )
  }

  // Drawn last in its lane, so no card of the lane paints over it, at the card's own corner: the lane has no border or
  // padding, so `top` is the rows above the card (the header and the cards before it) and `left` is 0.
  const revealed = (row: PlanRow, index: number, top: number) => {
    // A card with the mascot is covered only right of it, so the mascot stays in view and keeps moving.
    const left = revealLeft(row, width)
    const full = fullCard(row, width, left)
    const inner = Math.max(1, width - left - BORDER_COLUMNS)
    const isStuck = isBlocked(row)
    const marker = markerOf(row)
    const rows: CardRow[] = [
      ...full.lines.map((line, at) => {
        const lead = at === 0 && marker !== '' && line.startsWith(marker) ? marker : ''

        return {
          art: '',
          artColor: 'claude',
          marker: lead,
          markerColor: isStuck ? 'error' : NEEDS_YOU_COLOR,
          name: isProportional ? line.slice(lead.length) : padTo(line.slice(lead.length), inner - lead.length),
          isRed: isStuck,
          isBold: false,
          ...tagFields('', 0),
        }
      }),
      ...(full.tag === ''
        ? []
        : [
            {
              art: '',
              artColor: 'claude',
              marker: '',
              markerColor: '',
              name: '',
              isRed: isStuck,
              isBold: false,
              ...tagFields(full.tag, full.pad),
            },
          ]),
    ]
    const text = (label: string, extra: { bold?: boolean; color?: string; dimColor?: boolean } = {}) => (
      <Text wrap="truncate" backgroundColor={FILL} {...(extra.color === undefined ? { color: isStuck ? 'error' : 'text' } : { color: extra.color })} {...(extra.bold === true ? { bold: true } : {})} {...(extra.dimColor === true ? { dimColor: true } : {})}>
        {label}
      </Text>
    )

    return (
      <Box
        position="absolute"
        top={top}
        left={left}
        width={width - left}
        display="none"
        hover={{ display: 'flex', scope: scopeOf(plan.anchor, index) }}
        flexDirection="column"
        borderStyle="bold"
        borderColor={STYLE[row.status].color}
        backgroundColor={FILL}
        paddingX={1}
      >
        {Client ? (
          // The box covers the card's own click region, so it posts the same `{ open }` itself.
          <Client key={`reveal:${index}`} module="./card.tsx" width={inner} height={rows.length} props={{ index, rows, fill: FILL, ...proportional }} />
        ) : (
          <Box flexDirection="column">
            {full.lines.map((line, at) => {
              const lead = at === 0 && marker !== '' && line.startsWith(marker) ? marker : ''

              return (
                <Box flexDirection="row">
                  {lead === '' ? null : text(lead, { bold: true, color: isStuck ? 'error' : NEEDS_YOU_COLOR })}
                  {text(padTo(line.slice(lead.length), inner - lead.length))}
                </Box>
              )
            })}
            {full.tag === '' ? null : (
              <Box flexDirection="row">
                {text(' '.repeat(full.pad))}
                <Text color={CHIPS[full.tag]?.fg ?? 'text'} backgroundColor={CHIPS[full.tag]?.bg ?? FILL} {...(CHIPS[full.tag]?.bold === true ? { bold: true } : {})}>{` ${full.tag} `}</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  }

  // The header row of an expanded lane has "Show less ▴" at its right end; a Button draws its own `[ ]`, two columns more.
  const lessLabel = moreButton(SHOW_LESS)
  const lessColumns = displayWidth(lessLabel) + 4

  /** The hidden boxes of the lane's cut cards, each with the rows above its card. */
  const reveals = (one: Lane) => {
    let top = 1 + gapRows
    const out: RenderElement[] = []

    for (const { row, index } of one.cards) {
      if (cardView(row, width).isCut) {
        out.push(revealed(row, index, top))
      }

      top += cardRows(row, width) + gapRows
    }

    return out
  }

  /**
   * The desktop's lane: each card and its hidden box share one relative slot, so the box is `top: 0` of its own card
   * (proportional rows are not one text row high, so a summed `top` drifts down the lane). The slots are stacked in
   * reverse order, so every slot is later in the tree than the cards below it and the box paints over them.
   */
  const slots = (one: Lane) =>
    one.cards.length === 0 ? null : (
      <Box key={`cards:${one.key}`} flexDirection="column-reverse" width={width} gap={gapRows}>
        {[...one.cards].reverse().map(entry => (
          <Box key={`slot:${entry.index}`} position="relative" flexDirection="column" width={width}>
            {card(entry)}
            {cardView(entry.row, width).isCut ? revealed(entry.row, entry.index, 0) : null}
          </Box>
        ))}
      </Box>
    )

  const lane = (one: Lane) => {
    const isOpen = one.moreLabel === SHOW_LESS
    const hasLess = isOpen && width >= lessColumns + 12
    // The header's button folds the lane; the one at the bottom is kept only when the lane is taller than the pane shows
    // (the header has then scrolled away), or when the pane does not say how many rows it shows.
    const laneRows = 1 + one.cards.reduce((all, { row }) => all + cardRows(row, width) + gapRows, 0) + (one.cards.length === 0 ? 1 : 0) + 1
    const hasBottom = one.moreLabel !== '' && !(hasLess && bodyRows !== undefined && laneRows <= bodyRows)

    return (
      <Box key={`lane:${one.key}`} flexDirection="column" width={width} {...(gapRows === 0 ? {} : { gap: gapRows })}>
        {hasLess ? (
          <Box flexDirection="row">
            <Text bold color={one.color} wrap="truncate">
              {truncate(one.header, width - lessColumns - 1)}
            </Text>
            <Box flexGrow={1} minWidth={1} />
            <Button key={`lane:${one.key}:less`} label={lessLabel} onPress={() => onLane(one.key)} />
          </Box>
        ) : (
          <Text bold color={one.color} wrap="truncate">
            {truncate(one.header, width)}
          </Text>
        )}
        {one.cards.length === 0 ? <Text dimColor>—</Text> : null}
        {isProportional ? slots(one) : one.cards.map(card)}
        {!hasBottom ? null : (
          <Button key={`lane:${one.key}:more`} label={overflowLabel(one, width)} onPress={() => onLane(one.key)} />
        )}
        {isProportional ? null : reveals(one)}
      </Box>
    )
  }

  const row = detail === null ? undefined : plan.rows[detail]
  const groups = deliverableGroups(plan)

  if (file !== null) {
    return (
      <Box flexDirection="column">
        {message === null ? null : <Text dimColor>{message}</Text>}
        <Box key="file" flexDirection="column">
          <Button key="back" label="‹ Back" onPress={onBack} />
          <Text dimColor wrap="truncate">
            {shortPath(plan.plan_file, columns)}
          </Text>
          {'error' in file ? (
            <Text color="error" wrap="wrap">
              {file.error}
            </Text>
          ) : (
            <Box marginTop={1}>
              <Markdown text={file.text} />
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {message === null ? null : <Text dimColor>{message}</Text>}
      {row === undefined ? (
        <Box key="strip" flexDirection="column">
          {header}
          {isOpen && hasChoice ? (
            <Box key="menu:list" flexDirection="column" marginLeft={1}>
              {plans.map(option)}
            </Box>
          ) : null}
          {planLine === '' ? null : (
            <Box key="plan-line">
              <Text dimColor wrap="truncate">
                {planLine}
              </Text>
            </Box>
          )}
          <Box key="divider" marginTop={1}>
            <Text dimColor wrap="truncate">
              {'─'.repeat(columns)}
            </Text>
          </Box>
        </Box>
      ) : null}
      {row === undefined ? (
        <Box key="kanban" flexDirection={isSideBySide ? 'row' : 'column'} gap={1} marginTop={1}>
          {lanesOf(plan, expanded).map(lane)}
        </Box>
      ) : (
        drawDetail(kit, { row, columns, home, onBack, isProportional, onOpenPath })
      )}
      {row === undefined && groups.length > 0 ? drawDeliverables(kit, { groups, columns, home, isProportional, onOpenPath }) : null}
    </Box>
  )
}

type DeliverablesArgs = {
  groups: readonly DeliverableGroup[]
  columns: number
  home: string | undefined
  isProportional: boolean
  onOpenPath: (path: string) => void
}

/**
 * A markdown link to `href` with `label` as its text: the label's markdown characters are escaped and the href's
 * parentheses percent-encoded, so a path with `_`, `[` or `(` stays one link.
 */
const markdownLink = (label: string, href: string) =>
  `[${label.replace(/[\\`*_[\]<>~&]/g, '\\$&')}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`

/** Columns between two cells of the terminal table. */
const TABLE_GAP = 2

/** The narrowest path column the terminal table keeps before it drops the task column. */
const MIN_PATH_COLUMNS = 12

/** The narrowest the terminal's CHANGE column is kept at; a narrower one is dropped. */
const MIN_CHANGE_COLUMNS = 8

/** The desktop pane width from which the deliverables table has a CHANGE column. */
const DESKTOP_CHANGE_FROM = 100

/**
 * `Deliverables N`, then a table of Type, Deliverable, Change and Task (Change goes first when the pane is narrow) with a dim header and no ruled lines, grouped by type (the
 * type as a grey chip on the first row of its group). The path is a link that opens it; the task is dim. On the desktop the
 * whole path wraps (nothing is cut to the column count) and is a `Markdown` link: a `Link` opens only `https:` on a remote
 * surface, so a press is answered here and the plugin opens the file.
 */
function drawDeliverables(kit: Kit, { groups, columns, home, isProportional, onOpenPath }: DeliverablesArgs): RenderElement {
  const { Box, Text, Link, Markdown } = kit
  const rows = groups.flatMap(group => group.items.map((item, at) => ({ item, type: at === 0 ? group.type : '' })))
  const typeCols = Math.max(4, ...groups.map(group => displayWidth(group.type))) + 2

  const chip = (type: string) => (
    <Text color={TYPE_CHIP.fg} backgroundColor={TYPE_CHIP.bg}>{` ${type} `}</Text>
  )

  // The desktop drops CHANGE on a narrow pane, before TASK.
  const hasChange = isProportional && columns >= DESKTOP_CHANGE_FROM

  const desktopRow = ({ item, type }: { item: Deliverable; type: string }, at: number) => {
    const href = deliverableHref(item.path, home)

    return (
      <Box key={`deliverable:${at}:item`} flexDirection="row" gap={1}>
        <Box width={typeCols} flexShrink={0}>
          {type === '' ? null : chip(type)}
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {href === null ? (
            <Text wrap="wrap">{item.path}</Text>
          ) : (
            <Markdown key={`deliverable:${at}`} text={markdownLink(item.path, href)} onLinkPress={() => onOpenPath(item.path)} />
          )}
        </Box>
        {hasChange ? (
          <Box width="28%" flexShrink={0}>
            <Text dimColor wrap="wrap">{item.change ?? '—'}</Text>
          </Box>
        ) : null}
        <Box width={hasChange ? '24%' : '38%'} flexShrink={0}>
          <Text dimColor wrap="wrap">{item.task}</Text>
        </Box>
      </Box>
    )
  }

  const pathNatural = Math.max(0, ...rows.map(({ item }) => displayWidth(item.path)))
  const changeNatural = Math.max(displayWidth('CHANGE'), ...rows.map(({ item }) => displayWidth(item.change ?? '—')))
  const taskNatural = Math.max(0, ...rows.map(({ item }) => displayWidth(item.task)))
  const avail = columns - typeCols - TABLE_GAP
  let pathCols = avail
  let changeCols = 0
  let taskCols = 0

  if (pathNatural + changeNatural + taskNatural + 2 * TABLE_GAP <= avail) {
    pathCols = pathNatural
    changeCols = changeNatural
    taskCols = taskNatural
  } else {
    // CHANGE is the first to go: with it the path keeps its minimum, or the table is the old Type, Deliverable, Task.
    taskCols = Math.min(taskNatural, Math.floor(avail * 0.25))
    changeCols = Math.min(changeNatural, Math.floor(avail * 0.3))
    pathCols = avail - 2 * TABLE_GAP - changeCols - taskCols

    if (pathCols < MIN_PATH_COLUMNS || changeCols < MIN_CHANGE_COLUMNS) {
      changeCols = 0

      if (pathNatural + TABLE_GAP + taskNatural <= avail) {
        pathCols = pathNatural
        taskCols = taskNatural
      } else {
        taskCols = Math.min(taskNatural, Math.floor((avail - TABLE_GAP) * 0.4))
        pathCols = avail - TABLE_GAP - taskCols

        if (pathCols < MIN_PATH_COLUMNS) {
          pathCols = avail
          taskCols = 0
        }
      }
    }
  }

  const gap = ' '.repeat(TABLE_GAP)

  const line = ({ item, type }: { item: Deliverable; type: string }) => {
    const href = deliverableHref(item.path, home)
    const label = truncate(item.path, pathCols)
    const change = changeCols === 0 ? '' : padTo(truncate(item.change ?? '—', changeCols), changeCols)
    const task = taskCols === 0 ? '' : truncate(item.task, taskCols)
    const tail = `${changeCols === 0 ? '' : `${gap}${change}`}${taskCols === 0 ? '' : `${gap}${task}`}`

    return (
      <Text wrap="truncate">
        {type === '' ? ' '.repeat(typeCols) : chip(type)}
        {type === '' ? '' : ' '.repeat(typeCols - chipCols(type))}
        {gap}
        {href === null ? label : (
          <Text color={LINK_COLOR}>
            <Link href={href} label={label} />
          </Text>
        )}
        {tail === '' ? null : <Text dimColor>{`${' '.repeat(pathCols - displayWidth(label))}${tail}`}</Text>}
      </Text>
    )
  }

  const header = (
    <Text dimColor wrap="truncate">
      {`${padTo('TYPE', typeCols)}${gap}${taskCols === 0 && changeCols === 0 ? 'DELIVERABLE' : `${padTo('DELIVERABLE', pathCols)}${changeCols === 0 ? '' : `${gap}${padTo('CHANGE', changeCols)}`}${taskCols === 0 ? '' : `${gap}TASK`}`}`}
    </Text>
  )

  return (
    <Box key="deliverables" flexDirection="column" marginTop={1}>
      <Text bold>{`Deliverables ${rows.length}`}</Text>
      {isProportional ? (
        <Box key="deliverables:head" flexDirection="row" gap={1}>
          <Box width={typeCols} flexShrink={0}>
            <Text dimColor>TYPE</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor>DELIVERABLE</Text>
          </Box>
          {hasChange ? (
            <Box width="28%" flexShrink={0}>
              <Text dimColor>CHANGE</Text>
            </Box>
          ) : null}
          <Box width={hasChange ? '24%' : '38%'} flexShrink={0}>
            <Text dimColor>TASK</Text>
          </Box>
        </Box>
      ) : (
        header
      )}
      {isProportional ? rows.map(desktopRow) : rows.map(line)}
    </Box>
  )
}

type DetailArgs = Pick<PaneArgs, 'columns' | 'home' | 'onBack' | 'onOpenPath'> & { row: PlanRow; isProportional: boolean }



/** A piece of a line: text, its colour, and the file link it opens, if any. */
type Part = { text: string; color?: string; bold?: boolean; dim?: true; href?: string | null; /** Drawn as this chip: the text padded one space each side. */ chip?: Chip; /** Drawn as a solid bar of Boxes (the desktop). */ bar?: { fraction: number; color: string } }

/** Columns a desktop line wraps at: none, since its Text wraps itself. */
const UNWRAPPED_COLUMNS = 100_000

/**
 * One task's page, compact like the Agent map: the task behind a square in its status color; one dim status line (`Waiting
 * for your check · Sonnet subagent`, the tier a chip); one dim line of `working time · tokens · cost` (and `high effort` when
 * the work ran at one), left out for a row with no usage; the progress bar when the row has progress; "Latest note" (the
 * reason, on a Blocked row) with its date and one bulleted point per line, its file paths links; "Deliverable" with the path as
 * a link and the change in dim text; and `Checked by <who>` once the row is Done. Nothing is drawn for what the tracker does
 * not record. On the desktop the note's points hang under their bullet and the path is a `Markdown` link.
 */
function drawDetail(kit: Kit, { row, columns, home, onBack, isProportional, onOpenPath }: DetailArgs): RenderElement {
  const { Box, Text, Button, Link, Markdown } = kit
  const { color, ...dim } = STYLE[row.status]
  const stuck = isBlocked(row)
  const valueWidth = isProportional ? UNWRAPPED_COLUMNS : Math.max(1, columns)
  const who = whoLineOf(row)
  const checker = checkerOf(row)
  const noteLines = noteLinesOf(row.note ?? '', valueWidth)
  const bar = progressOf(row)
  // Nothing is shown before the row started, nor for a row written before the tracker kept usage: never a guessed window.
  // Her own tasks show no usage: the numbers are Claude's session, which does not measure her work.
  const usage = usageLineOf(row.started === undefined || isYou(executorOf(row)) ? undefined : row.usage)
  const deliverable = row.deliverable === undefined || row.deliverable === '' ? undefined : row.deliverable
  const href = deliverable === undefined ? null : deliverableHref(deliverable, home)

  const part = (one: Part, at: number) => {
    if (one.bar !== undefined) {
      return (
        <Box key={`part:${at}`} flexShrink={0} alignSelf="center">
          {kit.Svg === undefined ? null : <kit.Svg source={barSvg(one.bar.fraction, one.bar.color)} alt="progress" width={BAR_PX.width} height={BAR_PX.height} />}
        </Box>
      )
    }

    if (one.chip !== undefined) {
      return (
        <Text key={`part:${at}`} color={one.chip.fg} backgroundColor={one.chip.bg} {...(one.chip.bold === true ? { bold: true } : {})}>{` ${one.text} `}</Text>
      )
    }

    return (
      <Text key={`part:${at}`} {...(one.color === undefined ? {} : { color: one.color })} {...(one.bold === true ? { bold: true } : {})} {...(one.dim === true ? { dimColor: true } : {})}>
        {one.href === undefined || one.href === null ? one.text : <Link href={one.href} label={one.text} />}
      </Text>
    )
  }

  // The status line: the status in its colour, then who, the tier as a chip.
  const statusLine: Part[] = [
    { text: row.statusText ?? statusWords(row), color, bold: stuck, ...(dim.dimColor === true ? { dim: true as const } : {}) },
    ...(who === undefined
      ? []
      : [
          { text: ' · ', dim: true as const },
          ...(who.executor === 'you'
            ? [{ text: 'you', chip: CHIPS.you }]
            : [...(who.tier === undefined || CHIPS[who.tier] === undefined ? [] : [{ text: who.tier, chip: CHIPS[who.tier] }]), { text: ` ${who.executor}`, dim: true as const }]),
        ]),
  ]
  const barLine: Part[] | undefined =
    bar === undefined
      ? undefined
      : isProportional
        ? [{ text: '', bar: { fraction: bar.done / bar.total, color: HEX[color] ?? HEX.inactive ?? '#8A8A85' } }, { text: ` ${bar.count}` }]
        : [{ text: '▰'.repeat(bar.filled), color }, { text: '▱'.repeat(bar.empty), dim: true }, { text: ` ${bar.count}` }]
  const noteParts = noteLines.map((line): Part[] =>
    piecesOf(line.text).map((piece): Part => ({
      text: piece.text,
      ...(line.dim === true ? { dim: true as const } : {}),
      ...(line.needsYou === true ? { color: NEEDS_YOU_COLOR, bold: true } : {}),
      ...(line.tag === true ? { bold: true, ...(stuck ? { color: 'error' } : {}) } : {}),
      ...(piece.path === undefined ? {} : { color: LINK_COLOR, href: deliverableHref(piece.path, home) }),
    })),
  )

  const heading = (key: string, text: string, isRed = false) => (
    <Box key={key} marginTop={1}>
      <Text bold {...(isRed ? { color: 'error' } : {})}>
        {text}
      </Text>
    </Box>
  )

  // The desktop's line: a bullet is its own Text beside a Box that wraps the point, so a long point hangs under its text.
  const desktopLine = (parts: Part[], at: number) => {
    const isBullet = parts[0]?.text.startsWith('• ') === true
    const shown = isBullet ? parts.map((one, i) => (i === 0 ? { ...one, text: one.text.slice(2) } : one)).filter(one => one.text !== '') : parts
    const text = <Text wrap="wrap">{shown.map(part)}</Text>

    return isBullet ? (
      <Box key={`note:${at}`} flexDirection="row">
        <Text>•</Text>
        <Box marginLeft={1} flexGrow={1} flexShrink={1}>
          {text}
        </Box>
      </Box>
    ) : (
      <Box key={`note:${at}`}>{text}</Box>
    )
  }

  return (
    <Box key="detail" flexDirection="column" marginTop={1}>
      <Button key="back" label="‹ Back" onPress={onBack} />
      <Box key="detail:title" flexDirection="row" marginTop={1}>
        <Text color={color} {...dim}>
          ■{' '}
        </Text>
        <Text bold wrap="wrap">
          {row.task}
        </Text>
      </Box>
      <Box key="detail:status">
        <Text dimColor wrap="wrap">
          {statusLine.map(part)}
        </Text>
      </Box>
      {usage === undefined ? null : (
        <Box key="detail:usage">
          <Text dimColor wrap="wrap">
            {usage}
          </Text>
        </Box>
      )}
      {barLine === undefined ? null : (
        <Box key="detail:progress" flexDirection="row">
          {barLine.map(part)}
        </Box>
      )}
      {noteLines.length === 0 ? null : (
        <Box key="detail:note" flexDirection="column">
          {heading('note:heading', stuck ? 'Blocked because' : 'Latest note', stuck)}
          {isProportional
            ? noteParts.map(desktopLine)
            : noteParts.map((parts, at) => (
                <Box key={`note:${at}`} flexDirection="row">
                  {parts.map(part)}
                </Box>
              ))}
        </Box>
      )}
      {deliverable === undefined ? null : (
        <Box key="detail:deliverable-section" flexDirection="column">
          {heading('deliverable:heading', 'Deliverable')}
          {isProportional && href !== null ? (
            <Markdown key="detail:deliverable" text={markdownLink(deliverable, href)} onLinkPress={() => onOpenPath(deliverable)} />
          ) : (
            wrap(deliverable, valueWidth).map((line, at) => (
              <Box key={`deliverable:${at}`} flexDirection="row">
                {part({ text: line, color: LINK_COLOR, href }, 0)}
              </Box>
            ))
          )}
          {row.change === undefined || row.change === '' ? null : (
            <Text key="deliverable:change" dimColor wrap="wrap">
              {row.change}
            </Text>
          )}
        </Box>
      )}
      {row.status === 'Done' && checker !== undefined ? (
        <Box key="detail:checked" marginTop={1}>
          <Text dimColor wrap="wrap">{`Checked by ${checker}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

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
  isInsideProject,
  planStatsOf,
  notStartedText,
  planStateOf,
  progressOf,
  statusWords,
  usageStatsOf,
  fitStats,
  statLines,
  STAT_GAP,
  DELIVERABLES_SHOWN,
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
import type { Card, Chip, Deliverable, DeliverableGroup, Lane, LaneKey, Pose, Progress, Stat } from './board'

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

type PlanListArgs = {
  plans: readonly PlanEntry[]
  /** The open plan: its row is marked ▶ and drawn inverse. */
  plan: PlanEntry
  /** The columns the list may take, its one margin column included. */
  columns: number
  /** The list Box's key. */
  listKey: string
  /** What a row's Button key starts with; the anchor follows. */
  pickKey: string
  onPick: (anchor: string) => void
}

/**
 * The plan list both the board's dropdown and the band's open: one row per plan (`▶` for the open one, the name, its state word
 * in the state's color, n/m), the open row inverse and bold. The name is cut first (to 1 column at the least); if even then the
 * state word has no room, it is dropped whole.
 */
function drawPlanList(kit: Kit, { plans, plan, columns, listKey, pickKey, onPick }: PlanListArgs): RenderElement {
  const { Box, Text, Button } = kit
  const room = columns - 1
  const countCols = Math.max(0, ...plans.map(one => displayWidth(countText(one))))
  const nameRoom = (hasState: boolean) => room - 2 - 1 - countCols - (hasState ? STATE_COLUMNS + 2 : 0)
  const hasState = nameRoom(true) >= 4
  const names = plans.map(one => truncate(one.name, Math.max(1, nameRoom(hasState))))
  const nameCols = Math.max(0, ...names.map(displayWidth))

  const option = (one: PlanEntry, at: number) => {
    const isOn = one.anchor === plan.anchor
    const text = `${isOn ? '▶' : ' '} ${padTo(names[at] ?? '', nameCols)}`

    return (
      <Box flexDirection="row">
        <Button plain key={`${pickKey}${one.anchor}`} label={text} onPress={() => onPick(one.anchor)}>
          <Text {...(isOn ? { bold: true, inverse: true } : {})}>{text}</Text>
        </Button>
        {hasState ? <Text color={STATE_STYLE[planStateOf(one)].color} {...(isOn ? { inverse: true } : {})}>{`  ${padTo(planStateOf(one), STATE_COLUMNS)}`}</Text> : null}
        <Text color="suggestion" {...(isOn ? { inverse: true } : {})}>{` ${countText(one)}`}</Text>
      </Box>
    )
  }

  return (
    <Box key={listKey} flexDirection="column" marginLeft={1}>
      {plans.map(option)}
    </Box>
  )
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
        {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns: columns + BAND_MASCOT_SPACE, listKey: 'band:list', pickKey: 'band:plan:', onPick }) : null}
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
      {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns: columns + BAND_MASCOT_SPACE, listKey: 'band:list', pickKey: 'band:plan:', onPick }) : null}
      {holdsSomething(below) ? below : null}
    </Box>
  )
}

type StatsArgs = {
  stats: readonly Stat[]
  isProportional: boolean
  boxKey: string
}

/**
 * A row of stats, each a bold value over a small dim label. The terminal has no font size: two lines of text, the values bold
 * and the labels dim under them, each stat in a column as wide as the wider of the two. The desktop has no size prop either: a
 * Box per stat, the value bold in the normal colour against its dim label.
 */
function drawStats(kit: Kit, { stats, isProportional, boxKey }: StatsArgs): RenderElement {
  const { Box, Text } = kit

  if (isProportional) {
    return (
      <Box key={boxKey} flexDirection="row" gap={STAT_GAP} marginTop={1}>
        {stats.map(stat => (
          <Box key={`${boxKey}:${stat.label}`} flexDirection="column" flexShrink={0}>
            <Text bold wrap="truncate">
              {stat.value}
            </Text>
            <Text dimColor wrap="truncate">
              {stat.label}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }

  const { values, labels } = statLines(stats)

  return (
    <Box key={boxKey} flexDirection="column">
      <Text bold wrap="truncate">
        {values}
      </Text>
      <Text dimColor wrap="truncate">
        {labels}
      </Text>
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
  const { onMenu, onPick, onCard, onBack, onFile, onLane, bodyRows } = args
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
  const stats = planStatsOf(plan, args.now, columns)
  const notStarted = notStartedText(plan)
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
          {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns, listKey: 'menu:list', pickKey: 'plan:', onPick }) : null}
          {stats.length > 0 ? (
            drawStats(kit, { stats, isProportional, boxKey: 'plan-stats' })
          ) : notStarted === '' ? null : (
            <Box key="plan-stats">
              <Text dimColor wrap="truncate">
                {notStarted}
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
        drawDetail(kit, { row, columns, home, onBack, isProportional })
      )}
      {row === undefined && groups.length > 0 ? drawDeliverables(kit, { groups, columns, home, isProportional, isOpen: expanded.includes('Deliverables'), onLane: () => onLane('Deliverables') }) : null}
    </Box>
  )
}

type DeliverablesArgs = {
  groups: readonly DeliverableGroup[]
  columns: number
  home: string | undefined
  isProportional: boolean
  /** Whether every row shows, not only the first `DELIVERABLES_SHOWN`. */
  isOpen: boolean
  /** The overflow button's press. */
  onLane: () => void
}

/**
 * A markdown link to `href` with `label` as its text: the label's markdown characters are escaped and the href's
 * parentheses percent-encoded, so a path with `_`, `[` or `(` stays one link.
 */
const markdownLink = (label: string, href: string) =>
  `[${label.replace(/[\\`*_[\]<>~&]/g, '\\$&')}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`

/** Columns between two cells of the terminal table. */
const TABLE_GAP = 2

/** The narrowest path column the terminal table keeps before it drops the change column. */
const MIN_PATH_COLUMNS = 12

/** The narrowest the terminal's CHANGE column is kept at; a narrower one is dropped. */
const MIN_CHANGE_COLUMNS = 8

/** The desktop pane width from which the deliverables table has a CHANGE column. */
const DESKTOP_CHANGE_FROM = 100

/** A no-break space: the desktop's type chip is padded with it, so the Text cannot wrap between the padding and the word. */
const NBSP = ' '

/**
 * `Deliverables`, then a table of Type, Deliverable and Change with a dim header and no ruled lines, grouped by type (the
 * type as a grey chip on the first row of its group). The path is a link that opens it; the change is dim. On the desktop the
 * whole path wraps (nothing is cut to the column count) and is a `Markdown` link: a `Link` opens only `https:` on a remote
 * surface, and a path inside the project root has no `onLinkPress` (the desktop opens it itself); one outside it has it, so the plugin answers the press and opens it.
 */
function drawDeliverables(kit: Kit, { groups, columns, home, isProportional, isOpen, onLane }: DeliverablesArgs): RenderElement {
  const { Box, Text, Markdown, Button } = kit
  const all = groups.flatMap(group => group.items.map((item, at) => ({ item, type: at === 0 ? group.type : '' })))
  const hidden = Math.max(0, all.length - DELIVERABLES_SHOWN)
  const rows = isOpen ? all : all.slice(0, DELIVERABLES_SHOWN)
  const typeCols = Math.max(4, ...groups.map(group => displayWidth(group.type))) + 2

  const chip = (type: string, padding = ' ') => (
    <Text color={TYPE_CHIP.fg} backgroundColor={TYPE_CHIP.bg}>{`${padding}${type}${padding}`}</Text>
  )

  const hasChange = isProportional && columns >= DESKTOP_CHANGE_FROM

  const desktopRow = ({ item, type }: { item: Deliverable; type: string }, at: number) => {
    const href = deliverableHref(item.path, home)
    const typeCell = (
      <Box key={`deliverable:${at}:type`} width={typeCols + 2} flexShrink={0}>
        {type === '' ? null : chip(type, NBSP)}
      </Box>
    )
    const pathCell = (
      <Box key={`deliverable:${at}:path`} flexGrow={1} flexShrink={1}>
        {href === null ? <Text wrap="wrap">{item.path}</Text> : <Markdown key={`deliverable:${at}`} text={markdownLink(item.path, href)} {...(isInsideProject(item.path, home) ? {} : { onLinkPress: () => undefined })} />}
      </Box>
    )

    // A proportional font sets ' .tsx ' wider than its cells: with a breaking space the Text wraps and the word falls a line below its path.
    if (!hasChange) {
      return (
        <Box key={`deliverable:${at}:item`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="flex-start">
            {typeCell}
            {pathCell}
          </Box>
          {item.change === undefined || item.change === '' ? null : (
            <Box marginLeft={typeCols + 3}>
              <Text dimColor wrap="wrap">{item.change}</Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box key={`deliverable:${at}:item`} flexDirection="row" gap={1} alignItems="flex-start">
        {typeCell}
        {pathCell}
        <Box width="34%" flexShrink={0}>
          <Text dimColor wrap="wrap">{item.change ?? '—'}</Text>
        </Box>
      </Box>
    )
  }

  const pathNatural = Math.max(0, ...all.map(({ item }) => displayWidth(item.path)))
  const changeNatural = Math.max(displayWidth('CHANGE'), ...all.map(({ item }) => displayWidth(item.change ?? '—')))
  const avail = columns - typeCols - TABLE_GAP
  let pathCols = avail
  let changeCols = 0

  if (pathNatural + changeNatural + TABLE_GAP <= avail) {
    pathCols = pathNatural
    changeCols = changeNatural
  } else {
    // The path keeps its whole width up to two thirds of the table, CHANGE the rest; CHANGE is the first to go.
    pathCols = Math.min(pathNatural, Math.floor(avail * 0.65))
    changeCols = avail - TABLE_GAP - pathCols

    if (pathCols < MIN_PATH_COLUMNS || changeCols < MIN_CHANGE_COLUMNS) {
      changeCols = 0
      pathCols = avail
    }
  }

  const gap = ' '.repeat(TABLE_GAP)

  const line = ({ item, type }: { item: Deliverable; type: string }) => {
    const href = deliverableHref(item.path, home)
    const label = truncate(item.path, pathCols)
    const change = changeCols === 0 ? '' : padTo(truncate(item.change ?? '—', changeCols), changeCols)

    return (
      <Text wrap="truncate">
        {type === '' ? ' '.repeat(typeCols) : chip(type)}
        {type === '' ? '' : ' '.repeat(typeCols - chipCols(type))}
        {gap}
        {/* Not a Link: a terminal without OSC 8 support draws a Link as its text and then the URL, so the path would show twice and the columns shift. */}
        {href === null ? label : <Text color={LINK_COLOR}>{label}</Text>}
        {changeCols === 0 ? null : <Text dimColor>{`${' '.repeat(pathCols - displayWidth(label))}${gap}${change}`}</Text>}
      </Text>
    )
  }

  // Too narrow for three columns: each deliverable is a block, its path first and its change dim and wrapped under it.
  const indent = typeCols + TABLE_GAP

  const stacked = (one: { item: Deliverable; type: string }, at: number) => (
    <Box key={`deliverable:${at}:item`} flexDirection="column">
      {line(one)}
      {wrap(one.item.change ?? '', Math.max(1, columns - indent)).filter(text => text !== '').map(text => (
        <Text dimColor wrap="truncate">{`${' '.repeat(indent)}${text}`}</Text>
      ))}
    </Box>
  )

  const header = (
    <Text dimColor wrap="truncate">
      {`${padTo('TYPE', typeCols)}${gap}${changeCols === 0 ? 'DELIVERABLE' : `${padTo('DELIVERABLE', pathCols)}${gap}${padTo('CHANGE', changeCols)}`}`}
    </Text>
  )

  const isStacked = isProportional ? !hasChange : changeCols === 0
  const fold =
    hidden === 0 ? null : (
      <Button key="lane:Deliverables:more" label={overflowLabel({ moreLabel: isOpen ? SHOW_LESS : `+${hidden} more`, more: hidden }, columns)} onPress={onLane} />
    )

  return (
    <Box key="deliverables" flexDirection="column" marginTop={1}>
      <Text bold>Deliverables</Text>
      {isStacked ? null : isProportional ? (
        <Box key="deliverables:head" flexDirection="row" gap={1}>
          <Box width={typeCols + 2} flexShrink={0}>
            <Text dimColor>TYPE</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor>DELIVERABLE</Text>
          </Box>
          <Box width="34%" flexShrink={0}>
            <Text dimColor>CHANGE</Text>
          </Box>
        </Box>
      ) : (
        header
      )}
      {isProportional ? rows.map(desktopRow) : isStacked ? rows.map(stacked) : rows.map(line)}
      {fold}
    </Box>
  )
}

type DetailArgs = Pick<PaneArgs, 'columns' | 'home' | 'onBack'> & { row: PlanRow; isProportional: boolean }



/** Columns of the table's label cell, at the most (the longest label is "Blocked because"). */
const LABEL_COLUMNS = 15

/** The narrowest value cell the table keeps before the label cell shrinks. */
const MIN_VALUE_COLUMNS = 12

/** A piece of a cell's line: text, its colour, and the file link it opens, if any. */
type Part = { text: string; color?: string; bold?: boolean; dim?: true; href?: string | null; /** Drawn as this chip: the text padded one space each side. */ chip?: Chip; /** Drawn as a solid bar of Boxes (the desktop). */ bar?: { fraction: number; color: string } }

/** One row of the table: the label and its lines, each a list of parts. */
type TableRow = { key: string; label: string; isRed?: boolean; lines: Part[][]; /** The deliverable's path as the tracker wrote it: on the desktop a `Markdown` link above `lines`. */ path?: string }

/** Columns a desktop cell wraps at: none, since its Box wraps the text itself. */
const UNWRAPPED_COLUMNS = 100_000

const widthOf = (parts: readonly Part[]) => parts.reduce((all, part) => all + displayWidth(part.text) + (part.chip === undefined ? 0 : 2), 0)

/** A cell of words with the chips `you`, `Opus`, `Sonnet` and `Haiku` kept: `main session · Sonnet`. */
const chipParts = (words: string): Part[] =>
  words.split(' · ').flatMap((word, at): Part[] => [...(at === 0 ? [] : [{ text: ' · ' }]), CHIPS[word] === undefined ? { text: word } : { text: word, chip: CHIPS[word] }])

/**
 * One task's page: the task behind a square in its status color; a row of stats (working time, tokens, est. cost, and the effort when the
 * work ran at one: bold values over dim labels), left out for a row with no usage and for her own rows; then a bordered table of labelled
 * rows, each left out when the tracker records nothing for it: Goal, Status (in words and its color), Done by (the tier a chip
 * and the executor, or the you chip), Checked by (once the row is Done), Progress (a bar), "Latest note" (the reason, on a
 * Blocked row; its date, then one bulleted point per line, its file paths links) and Deliverable (the path as a link, the
 * change in dim text under it). The frame is box characters on the terminal: a label cell and a value cell, a rule between rows;
 * values wrap inside their cell. On the desktop each row is a round-bordered Box, a label Box of fixed width and a value Box that
 * wraps its text; the path is a `Markdown` link.
 */
function drawDetail(kit: Kit, { row, columns, home, onBack, isProportional }: DetailArgs): RenderElement {
  const { Box, Text, Button } = kit
  const { color, ...dim } = STYLE[row.status]
  const stuck = isBlocked(row)
  // `│ ` label ` │ ` value ` │`: seven columns of frame and padding.
  const labelWidth = Math.max(4, Math.min(LABEL_COLUMNS, columns - 7 - MIN_VALUE_COLUMNS))
  const valueWidth = isProportional ? UNWRAPPED_COLUMNS : Math.max(1, columns - 7 - labelWidth)
  const who = whoLineOf(row)
  const checker = checkerOf(row)
  const noteLines = noteLinesOf(row.note ?? '', valueWidth)
  const bar = progressOf(row)
  // Nothing is shown before the row started, nor for a row written before the tracker kept usage: never a guessed window.
  // Her own tasks show no usage: the numbers are Claude's session, which does not measure her work.
  const usage = usageStatsOf(row.started === undefined || isYou(executorOf(row)) ? undefined : row.usage)
  const deliverable = row.deliverable === undefined || row.deliverable === '' ? undefined : row.deliverable
  const plain = (text: string): Part[][] => wrap(text, valueWidth).map(line => [{ text: line }])
  // The chips stay when the cell holds the line whole; a narrower cell wraps the plain words instead.
  const chipped = (words: string): Part[][] => (widthOf(chipParts(words)) <= valueWidth ? [chipParts(words)] : plain(words))
  const doneBy: Part[] =
    who === undefined ? [] : who.executor === 'you' ? [{ text: 'you', chip: CHIPS.you }] : [...(who.tier === undefined || CHIPS[who.tier] === undefined ? [] : [{ text: who.tier, chip: CHIPS[who.tier] }]), { text: ` ${who.executor}` }]
  const whoLines: Part[][] = widthOf(doneBy) <= valueWidth ? [doneBy] : plain(who?.executor === 'you' ? 'you' : `${who?.tier ?? ''} ${who?.executor ?? ''}`.trim())
  const barParts: Part[] | undefined =
    bar === undefined
      ? undefined
      : isProportional
        ? [{ text: '', bar: { fraction: bar.done / bar.total, color: HEX[color] ?? HEX.inactive ?? '#8A8A85' } }, { text: ` ${bar.count}` }]
        : [{ text: '▰'.repeat(bar.filled), color }, { text: '▱'.repeat(bar.empty), dim: true }, { text: ` ${bar.count}` }]
  const changeLines: Part[][] = row.change === undefined || row.change === '' ? [] : wrap(row.change, valueWidth).map((text): Part[] => [{ text, dim: true }])

  const rows: TableRow[] = [
    ...(row.goal === undefined || row.goal === '' ? [] : [{ key: 'goal', label: 'Goal', lines: plain(row.goal) }]),
    {
      key: 'status',
      label: 'Status',
      lines: wrap(row.statusText ?? statusWords(row), valueWidth).map((text): Part[] => [{ text, color, bold: stuck, ...(dim.dimColor === true ? { dim: true as const } : {}) }]),
    },
    ...(who === undefined ? [] : [{ key: 'who', label: 'Done by', lines: whoLines }]),
    ...(row.status === 'Done' && checker !== undefined ? [{ key: 'checker', label: 'Checked by', lines: chipped(checker) }] : []),
    ...(barParts === undefined ? [] : [{ key: 'progress', label: 'Progress', lines: [barParts] }]),
    ...(noteLines.length === 0
      ? []
      : [
          {
            key: 'note',
            label: stuck ? 'Blocked because' : 'Latest note',
            isRed: stuck,
            lines: noteLines.map(line =>
              piecesOf(line.text).map((piece): Part => ({
                text: piece.text,
                ...(line.dim === true ? { dim: true as const } : {}),
                ...(line.needsYou === true ? { color: NEEDS_YOU_COLOR, bold: true } : {}),
                ...(line.tag === true ? { bold: true, ...(stuck ? { color: 'error' } : {}) } : {}),
                ...(piece.path === undefined ? {} : { color: LINK_COLOR, href: deliverableHref(piece.path, home) }),
              })),
            ),
          },
        ]),
    ...(deliverable === undefined
      ? []
      : [
          {
            key: 'deliverable',
            label: 'Deliverable',
            path: deliverable,
            lines: [
              ...(isProportional && deliverableHref(deliverable, home) !== null ? [] : wrap(deliverable, valueWidth).map((text): Part[] => [{ text, color: LINK_COLOR, href: deliverableHref(deliverable, home) }])),
              ...changeLines,
            ],
          },
        ]),
  ]

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
      {usage === undefined ? null : drawStats(kit, { stats: fitStats(usage, columns), isProportional, boxKey: 'detail:usage' })}
      {drawTable(kit, { rows, columns, home, isProportional })}
    </Box>
  )
}

type TableArgs = Pick<DetailArgs, 'columns' | 'home' | 'isProportional'> & { rows: readonly TableRow[] }

/** The bordered table of label and value rows: box characters on the terminal, one round-bordered Box per row on the desktop. */
function drawTable(kit: Kit, { rows, columns, home, isProportional }: TableArgs): RenderElement {
  const { Box, Text, Link, Markdown } = kit
  const labelWidth = Math.max(4, Math.min(LABEL_COLUMNS, columns - 7 - MIN_VALUE_COLUMNS))
  const valueWidth = isProportional ? UNWRAPPED_COLUMNS : Math.max(1, columns - 7 - labelWidth)

  const part = (one: Part) => {
    if (one.bar !== undefined) {
      return (
        <Box flexShrink={0} alignSelf="center">
          {kit.Svg === undefined ? null : <kit.Svg source={barSvg(one.bar.fraction, one.bar.color)} alt="progress" width={BAR_PX.width} height={BAR_PX.height} />}
        </Box>
      )
    }

    if (one.chip !== undefined) {
      return (
        <Text color={one.chip.fg} backgroundColor={one.chip.bg} {...(one.chip.bold === true ? { bold: true } : {})}>{` ${one.text} `}</Text>
      )
    }

    return (
      <Text {...(one.color === undefined ? {} : { color: one.color })} {...(one.bold === true ? { bold: true } : {})} {...(one.dim === true ? { dimColor: true } : {})}>
        {one.href === undefined || one.href === null ? one.text : <Link href={one.href} label={one.text} />}
      </Text>
    )
  }

  const rule = (key: string, left: string, mid: string, right: string) => (
    <Text key={key} dimColor wrap="truncate">
      {`${left}${'─'.repeat(labelWidth + 2)}${mid}${'─'.repeat(valueWidth + 2)}${right}`}
    </Text>
  )

  const tableRow = (one: TableRow) => {
    const height = one.lines.length

    return (
      <Box key={`field:${one.key}`} flexDirection="column">
        {Array.from({ length: height }, (_, at) => {
          const parts = one.lines[at] ?? []

          return (
            <Box key={`field:${one.key}:${at}`} flexDirection="row">
              <Text dimColor>│ </Text>
              <Text bold {...(one.isRed === true ? { color: 'error' } : {})}>
                {at === 0 ? padTo(truncate(one.label, labelWidth), labelWidth) : ' '.repeat(labelWidth)}
              </Text>
              <Text dimColor> │ </Text>
              {parts.map(part)}
              <Text>{' '.repeat(Math.max(0, valueWidth - widthOf(parts)))}</Text>
              <Text dimColor> │</Text>
            </Box>
          )
        })}
      </Box>
    )
  }

  // The desktop's row: a round Box, the label in a Box of fixed width, the value in a Box that wraps. A bullet is its own Text
  // beside a Box that wraps the point, so a long point hangs under its text.
  const labelBox = Math.max(4, Math.min(LABEL_COLUMNS, columns - 6 - MIN_VALUE_COLUMNS))

  const valueLine = (parts: Part[], at: number) => {
    const isBullet = parts[0]?.text.startsWith('• ') === true
    const shown = isBullet ? parts.map((one, i) => (i === 0 ? { ...one, text: one.text.slice(2) } : one)).filter(one => one.text !== '') : parts
    // A solid bar is a Box, which a Text cannot hold: such a line is a row of its parts.
    const text = shown.some(one => one.bar !== undefined) ? <Box flexDirection="row">{shown.map(part)}</Box> : <Text wrap="wrap">{shown.map(part)}</Text>

    return isBullet ? (
      <Box key={`value:${at}`} flexDirection="row">
        <Text>•</Text>
        <Box marginLeft={1} flexGrow={1} flexShrink={1}>
          {text}
        </Box>
      </Box>
    ) : (
      <Box key={`value:${at}`}>{text}</Box>
    )
  }

  const field = (one: TableRow) => {
    const href = one.path === undefined ? null : deliverableHref(one.path, home)
    const path = one.path

    return (
      <Box key={`field:${one.key}`} flexDirection="row" borderStyle="round" borderDimColor paddingX={1}>
        <Box width={labelBox} flexShrink={0}>
          <Text bold {...(one.isRed === true ? { color: 'error' } : {})}>
            {one.label}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} flexDirection="column">
          {path !== undefined && href !== null ? <Markdown key="detail:deliverable" text={markdownLink(path, href)} {...(isInsideProject(path, home) ? {} : { onLinkPress: () => undefined })} /> : null}
          {one.lines.map(valueLine)}
        </Box>
      </Box>
    )
  }

  return isProportional ? (
    <Box key="detail:fields" flexDirection="column" marginTop={1}>
      {rows.map(field)}
    </Box>
  ) : (
    <Box key="detail:fields" flexDirection="column" marginTop={1}>
      {rule('rule:top', '╭', '┬', '╮')}
      {rows.flatMap((one, at) => (at === 0 ? [tableRow(one)] : [rule(`rule:${at}`, '├', '┼', '┤'), tableRow(one)]))}
      {rule('rule:bottom', '╰', '┴', '╯')}
    </Box>
  )
}

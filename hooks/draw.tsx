/** The two drawings of the mod, as trees: the band above the prompt and the pane. */
import type { BoxProps, ButtonProps, ClientProps, ElementConstructor, InputProps, LinkProps, MarkdownProps, RenderElement, RenderSurface, SvgProps, TextProps } from 'claude-code'

import type { PlanEntry, PlanMatch, PlanRow } from '../types'
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
  chipOf,
  planStateText,
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
  fileHref,
  planStatsOf,
  notStartedText,
  recapLabel,
  planStateOf,
  progressOf,
  statusWords,
  usageStatsOf,
  fitStats,
  statLines,
  STAT_GAP,
  whoLineOf,
  displayWidth,
  noteLinesOf,
  isBlocked,
  executorOf,
  isYou,
  isRunning,
  isStalled,
  LANE_GAP,
  laneWidth,
  lanesOf,
  SHOW_LESS,
  mascotAt,
  moreButton,
  overflowLabel,
  piecesOf,
  rainbowAt,
  shortPath,
  sinceText,
  truncate,
  wrap,
  worstStatus,
} from './board'
import type { CardRow } from './card'
import type { Card, Chip, Lane, LaneKey, PlanState, Pose, Progress, Stat } from './board'

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
  /** The list's search field; absent on mobile, which draws no field. */
  Input?: ElementConstructor<InputProps>
}

/** Whether what the hooks below drew is more than an empty Box or Text. */
export function holdsSomething(drawn: RenderElement | null | undefined): boolean {
  if (!drawn) {
    return false
  }

  return (drawn.type !== 'Box' && drawn.type !== 'Text') || drawn.children === undefined || drawn.children.length > 0
}

/** The surfaces with a proportional font, laid out with flex rather than padded with spaces: the desktop app and vscode. */
export const isProportionalSurface = (surface: string): boolean => surface === 'desktop' || surface === 'vscode'

/** vscode's card button: the card's text is not pressable there (no Client), so this opens the card's page. */
export const CARD_OPEN_LABEL = 'Open ›'

/** vscode lays the lanes side by side from this many columns: its proportional text fits a lane in a quarter of a narrower row. */
export const QUIET_SIDE_BY_SIDE_FROM = 60

/** The kit's Button, drawn dim when `isQuiet`: vscode draws a plain Button as a filled chip, a dim one as a quiet outline. */
export function quietButton(kit: Kit, isQuiet: boolean): Kit['Button'] {
  return isQuiet ? props => kit.Button({ ...props, dimColor: true }) : kit.Button
}

/** The kit with Ink's rule for rows when `isQuiet`: vscode wraps a row by default, so a row too wide drops its end to a new line instead of cutting the text set to cut. */
export function inkRows(kit: Kit, isQuiet: boolean): Kit {
  return isQuiet ? { ...kit, Box: props => kit.Box({ flexWrap: 'nowrap', ...props }) } : kit
}

/**
 * Characters of proportional text that fit one column vscode reports. Cursor counts its columns by the width of "─", which is wide
 * in its font: a pane of about 880 px reported 66 columns (about 13.3 px each), while ordinary text runs about 6.6 px a character,
 * so about 2.0 characters fit a column. 1.8 leaves room for bold.
 */
export const VSCODE_CHARS_PER_COLUMN = 1.8

/** The characters vscode's text has room for in `columns` reported columns: the budget its cuts by count use. */
export const vscodeChars = (columns: number): number => Math.floor(columns * VSCODE_CHARS_PER_COLUMN)

/** Characters per `ch` of width in vscode's text, kept under the measured ~1.33 so a wide name (or a CJK one, 2 per character) still fits
 * its box: a plan list's name column sized in plain characters left a gap of about a third of the name before the state column. */
export const VSCODE_CHARS_PER_CH = 1.2

/** Characters the band's frame takes on vscode: its padding of 1 ch each side (ch is about one character there; the borders are 1 px). */
const QUIET_FRAME_CHARS = 2

/** A no-break space: vscode collapses or drops plain spaces at the ends of a text. */
const NBSP = ' '

/** Two no-break spaces: the gap a link's text keeps. */
const GAP = `${NBSP}${NBSP}`

/** Markdown's special characters escaped, so a name is drawn as written. */
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>~&]/g, '\\$&')

/** The address of a vscode band link: the mod answers it by the Markdown's key (`ui.press`), and `.invalid` opens nowhere. */
const bandHref = (key: string) => `https://plan-tracker.invalid/${key.split(':').join('/')}`

/** The desktop's card bar: a fixed 8 cells whatever the total, filled in proportion to done/total. */
const deskBar = (bar: Progress, color: string) => {
  const filled = filledOf(bar.done, bar.total, CARD_BAR_CELLS)

  return { filled, empty: CARD_BAR_CELLS - filled, color, track: TRACK_COLOR }
}

/** The fields of a card row's tag: its chip (the grey one of `stalled` and its time too), or none. */
const tagFields = (word: string, pad: number): Pick<CardRow, 'tag' | 'tagPad' | 'tagBg' | 'tagFg' | 'tagBold'> => {
  const chip: Chip | undefined = chipOf(word)

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
  /** The time a state word's `since` is compared with, to say today's time as a clock time and another day's with its day (`Date.now()`); a parameter so a test can pin it. */
  now: number
  /** The card sprite's pose the desktop draws instead of `pose`'s block characters. */
  spritePose?: Pose
  /** The desktop's sprite switches its poses by itself (a plan with a row In Progress), with no redraw. */
  isMoving?: boolean
  /** The desktop's proportional font: the mascot is drawn one Box per cell. */
  isProportional?: boolean
  /** Whether the surface draws a `Client` (terminal, desktop); a proportional surface without one (vscode) has links for its click targets. */
  hasClient?: boolean
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
  /** `Date.now()`, for the state words' times. */
  now: number
  /** The list Box's key. */
  listKey: string
  /** What a row's Button key starts with; the anchor follows. */
  pickKey: string
  onPick: (anchor: string) => void
  isQuiet: boolean
}

/**
 * One row of a plan list: a plan of the session, or a plan of the board command's list. `state` picks the color; `stateText` is the word drawn
 * (`Idle since 19:40`). `time` is when a listed plan was last updated (`19:40` today, `Oct 9 20:08` another day); a plan of the session has none.
 */
export type ListItem = { anchor: string; name: string; state: PlanState; stateText: string; count: string; time?: string }

/**
 * What the plan list draws of a plan of the session: the only part of the session's other plans the pane reads. The render hook
 * compares these (not the whole plans) to tell whether a new answer of the tracker changes what it draws.
 */
export const listedOf = (plan: PlanEntry, now: number): ListItem => ({ anchor: plan.anchor, name: plan.name, state: planStateOf(plan), stateText: planStateText(plan, now), count: countText(plan) })

type RowsArgs = {
  items: readonly ListItem[]
  /** The anchor of the open plan: its row is marked ▶ and drawn inverse; null for a list with no open plan. */
  activeAnchor: string | null
  columns: number
  listKey: string
  pickKey: string
  onPick: (anchor: string) => void
  /** vscode: each name is a quiet Button with its label only, and the columns are set apart by margins, not spaces. */
  isQuiet?: boolean
}

/**
 * The rows of a plan list: one per plan (`▶` for the open one, the name, its state text in the state's style, n/m, and a listed plan's
 * time, dim), the open row inverse and bold. The state column is as wide as the widest text (`Stalled since Oct 11 19:23` is wider than
 * `In progress`); with times the count column is padded so they line up. The name is cut first (to 1 column at the least); if even then the
 * state text and the time have no room, they are dropped whole.
 */
function drawListRows(kit: Kit, { items, activeAnchor, columns, listKey, pickKey, onPick, isQuiet = false }: RowsArgs): RenderElement {
  const { Box, Text } = kit
  const Button = quietButton(kit, isQuiet)
  // vscode's columns hold about two characters each: the names are cut to the characters it fits.
  const room = (isQuiet ? vscodeChars(columns) : columns) - 1
  const countCols = Math.max(0, ...items.map(one => displayWidth(one.count)))
  const stateCols = Math.max(STATE_COLUMNS, ...items.map(one => displayWidth(one.stateText)))
  const timeCols = Math.max(0, ...items.map(one => displayWidth(one.time ?? '')))
  const nameRoom = (hasState: boolean) => room - 2 - 1 - countCols - (hasState ? stateCols + 2 + (timeCols > 0 ? timeCols + 2 : 0) : 0)
  const hasState = nameRoom(true) >= 4
  const names = items.map(one => truncate(one.name, Math.max(1, nameRoom(hasState))))
  const nameCols = Math.max(0, ...names.map(displayWidth))

  const option = (one: ListItem, at: number) => {
    const isOn = one.anchor === activeAnchor
    const text = `${isOn ? '▶' : ' '} ${padTo(names[at] ?? '', nameCols)}`

    // vscode draws a Button's label alone (its children flattened, so the open row cannot be inverse) and drops a Text's trailing
    // spaces: the open row is marked by the ▶ in its label alone, and each column is a Box of one fixed width in ch (about a character
    // there), the name's holding its longest name, the ▶ and the Button's border, so the columns line up row to row.
    if (isQuiet) {
      const label = `${isOn ? `▶${NBSP}` : ''}${names[at] ?? ''}`

      return (
        <Box flexDirection="row">
          <Box width={Math.ceil(nameCols / VSCODE_CHARS_PER_CH) + 5} flexShrink={0}>
            <Button plain key={`${pickKey}${one.anchor}`} label={label} onPress={() => onPick(one.anchor)} />
          </Box>
          {hasState ? (
            <Box marginLeft={2} width={stateCols} flexShrink={0}>
              <Text {...STATE_STYLE[one.state]}>{one.stateText}</Text>
            </Box>
          ) : null}
          <Box marginLeft={1} width={countCols} flexShrink={0}>
            <Text color="suggestion">{one.count}</Text>
          </Box>
          {hasState && one.time !== undefined ? (
            <Box marginLeft={2} flexShrink={0}>
              <Text dimColor>{one.time}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        <Button plain key={`${pickKey}${one.anchor}`} label={text} onPress={() => onPick(one.anchor)}>
          <Text {...(isOn ? { bold: true, inverse: true } : {})}>{text}</Text>
        </Button>
        {hasState ? <Text {...STATE_STYLE[one.state]} {...(isOn ? { inverse: true } : {})}>{`  ${padTo(one.stateText, stateCols)}`}</Text> : null}
        <Text color="suggestion" {...(isOn ? { inverse: true } : {})}>{` ${timeCols > 0 ? padTo(one.count, countCols) : one.count}`}</Text>
        {hasState && one.time !== undefined ? <Text dimColor>{`  ${one.time}`}</Text> : null}
      </Box>
    )
  }

  return (
    <Box key={listKey} flexDirection="column" marginLeft={1}>
      {items.map(option)}
    </Box>
  )
}

/** The plan list both the board's dropdown and the band's open: every plan of the session, the open one marked. */
function drawPlanList(kit: Kit, { plans, plan, columns, now, listKey, pickKey, onPick, isQuiet }: PlanListArgs): RenderElement {
  return drawListRows(kit, {
    items: plans.map(one => listedOf(one, now)),
    activeAnchor: plan.anchor,
    columns,
    listKey,
    pickKey,
    onPick,
    isQuiet,
  })
}

/** A plan of the board command's list as a row of it: the bare state word, `n/m` and when it was last updated (`sinceText`). */
export const listedMatchOf = (one: PlanMatch, now: number): ListItem => {
  const time = one.updated === undefined ? undefined : sinceText(one.updated, now)

  return { anchor: one.anchor, name: one.name, state: one.state, stateText: one.state, count: `${one.done}/${one.total}`, ...(time === undefined ? {} : { time }) }
}

type PickerArgs = {
  /** The rows the search leaves, in the board command's order (latest first). */
  rows: readonly ListItem[]
  /** The search field's text. */
  search: string
  /** The line drawn when no row is left. */
  empty: string
  /** `e.props.bodyColumns` */
  columns: number
  /** The surface drawing: vscode gets Ink's rows and quiet label-only Buttons. */
  surface: RenderSurface
  onPick: (anchor: string) => void
  onInput: (value: string) => void
  onSubmit: (value: string) => void
}

/**
 * What the pane shows while it lists the plans: the search field (`Search plans`), then the rows the search leaves as the plan list draws
 * them, with no plan open (a press picks one: keys `match:<anchor>`), or the `empty` line when none is left. A surface with no `Input`
 * (mobile) has the rows alone.
 */
export function drawPicker(given: Kit, { rows, search, empty, columns, surface, onPick, onInput, onSubmit }: PickerArgs): RenderElement {
  // vscode: proportional with no Client.
  const isQuiet = surface === 'vscode'
  const kit = inkRows(given, isQuiet)
  const { Box, Text, Input } = kit

  return (
    <Box key="matches" flexDirection="column">
      {Input === undefined ? null : <Input key="search" placeholder="Search plans" value={search} autoFocus onInput={onInput} onSubmit={onSubmit} />}
      {rows.length === 0
        ? <Text dimColor>{empty}</Text>
        : drawListRows(kit, { items: rows, activeAnchor: null, columns, listKey: 'matches:list', pickKey: 'match:', onPick, isQuiet })}
    </Box>
  )
}

/** Columns the band's frame takes from the row: two border columns and one padding column each side. */
const FRAME_COLUMNS = 4

type QuietBandArgs = {
  plan: PlanEntry
  hasChoice: boolean
  /** Columns the row has after the mascot and its space, the frame included. */
  columns: number
  now: number
  isFile: boolean
  frame: number | null
  spritePose?: Pose
  isMoving: boolean
  onBar: () => void
  onMenu: () => void
  onFile: () => void
  onBoard: () => void
}

/**
 * vscode's band row: no part of it can be an invisible click area there (no Client; Svg and Box take no press), so the click
 * targets are pressable Markdown links (underlined, no border). The mascot, the dot (coloured), then with one plan `<name>  <state>  n/m` as
 * one target keyed `band:head` (the board); with two plans or more `<name> ▾` keyed `band:plans` (the plan list) and `<state>  n/m` keyed
 * `band:bar` (the board); then the bar (a picture, no press) and "Plan file ›". The texts are cut by count to the room `bandFit` leaves, and
 * each sits in a Box one row high that hides what overflows, so it is never two lines. A press is answered by its key (`actionFor`).
 */
function drawQuietBandRow(kit: Kit, a: QuietBandArgs): RenderElement {
  const { Box, Text, Markdown } = kit
  const Button = quietButton(kit, true)
  const { color: dotColor, ...dotDim } = STYLE[worstStatus(a.plan)]
  const fileLabel = a.isFile ? BOARD_LABEL : FILE_LABEL
  // The whole row in characters, less the mascot's Box (its width in ch) and the frame: `columns` counts the mascot's space in reported columns.
  const chars = vscodeChars(a.columns + BAND_MASCOT_SPACE) - BAND_SPRITE_CELLS - QUIET_FRAME_CHARS
  const fit = bandFit(a.plan, chars, a.hasChoice, displayWidth(fileLabel), a.now)
  const tail = `${fit.hasState ? `${fit.stateText}${GAP}` : ''}${fit.count}`
  const targets = a.hasChoice
    ? [
        { key: 'band:plans', text: `${fit.name} ▾`, press: a.onMenu },
        { key: 'band:bar', text: tail, press: a.onBar },
      ]
    : [{ key: 'band:head', text: `${fit.name}${GAP}${tail}`, press: a.onBar }]
  const { done, total } = countOf(a.plan)

  const target = ({ key, text, press }: { key: string; text: string; press: () => void }) => {
    const href = bandHref(key)

    return (
      <Box key={`${key}:box`} height={1} overflow="hidden" flexShrink={1} minWidth={0} marginRight={1}>
        <Markdown key={key} text={`[${escapeMarkdown(text)}](${href})`} pressableLinks={[href]} onLinkPress={press} />
      </Box>
    )
  }

  // Centered: the bar picture is shorter than a line and would otherwise sit at the row's top.
  return (
    <Box key="bar" flexDirection="row" alignItems="center">
      {kit.Svg === undefined ? null : (
        <Box key="band:part:mascot" width={BAND_SPRITE_CELLS} flexShrink={0}>
          <kit.Svg
            source={(a.isMoving ? spriteSvgAnimated(MASCOT, 'claude') : spriteSvg(a.spritePose ?? MASCOT[0], 'claude')).source}
            alt="Claude Code's mascot"
            width={BAND_SPRITE_PX.width}
            height={BAND_SPRITE_PX.height}
          />
        </Box>
      )}
      <Box key="band:part:dot" flexShrink={0}>
        <Box marginRight={1}>
          <Text color={dotColor} {...dotDim}>●</Text>
        </Box>
      </Box>
      {targets.map(target)}
      {kit.Svg === undefined ? null : (
        <Box key="band:solid" flexShrink={0} marginRight={1}>
          <kit.Svg
            source={barSvg(
              total === 0 ? 0 : done / total,
              HEX.success ?? '#3C9D5A',
              a.frame === null ? undefined : Array.from({ length: Math.max(1, fit.filled) }, (_, at) => rainbowAt(at, a.frame ?? 0)),
            )}
            alt={`${fit.count} done`}
            width={BAR_PX.width}
            height={BAR_PX.height}
          />
        </Box>
      )}
      <Box key="band:part:rest" flexGrow={1} flexShrink={1} minWidth={2} />
      {a.isFile ? (
        <Button plain key="band:board" label={BOARD_LABEL} onPress={a.onBoard} />
      ) : (
        <Button plain key="band:file" label={FILE_LABEL} onPress={a.onFile} />
      )}
    </Box>
  )
}

/**
 * The band: ONE row inside a dim round frame, `<mascot> ● <name> ▾  <bar> n/m ........ Plan file ›`, then the plan list when it is open, then
 * whatever the hooks below drew. A Button takes no color, so the colored parts are Text inside a plain Button: "name ▾"
 * opens the list, the bar and the count toggle the board, "Plan file ›" opens the board on the plan file (and is "‹ Board"
 * while it shows it).
 */
export function drawBand(given: Kit, args: BandArgs): RenderElement {
  const kit = inkRows(given, args.isProportional === true && args.hasClient !== true)
  const { Box, Text } = kit
  const { plan, plans, columns, below, isOpen, isFile, frame, pose, now, spritePose, isMoving = false, isProportional = false, hasClient = false, maxRows = Number.POSITIVE_INFINITY, onBar, onMenu, onPick, onFile, onBoard } = args
  // vscode (proportional, no Client) draws its native button as a filled chip; dim, it is a quiet outline.
  const isQuiet = isProportional && !hasClient
  const Button = quietButton(kit, isQuiet)
  const line = bandLine(plan, columns, now)
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

  const zone = (key: string, child: RenderElement, fit: 'fixed' | 'grow' | 'shrink' = 'fixed') => {
    const flex = fit === 'grow' ? { flexGrow: 1, flexShrink: 1 } : fit === 'shrink' ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }

    return Client === undefined ? (
      child
    ) : (
      <Box key={`band:zone:${key}`} position="relative" {...flex}>
        {child}
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <Client key={`band:zone:${key}:region`} module="./band.tsx" width="100%" height="100%" />
        </Box>
      </Box>
    )
  }

  if (isQuiet) {
    return (
      <Box flexDirection="column">
        <Box key="band:frame" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {drawQuietBandRow(kit, {
            plan,
            hasChoice,
            columns,
            now,
            isFile,
            frame,
            ...(spritePose === undefined ? {} : { spritePose }),
            isMoving,
            onBar,
            onMenu,
            onFile,
            onBoard,
          })}
        </Box>
        {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns: columns + BAND_MASCOT_SPACE, now, listKey: 'band:list', pickKey: 'band:plan:', onPick, isQuiet }) : null}
        {holdsSomething(below) ? below : null}
      </Box>
    )
  }

  if (isProportional) {
    // The name is whole: the row's Text cuts it by the room the panel leaves, not by a count of characters.
    const name = <Text bold wrap="truncate">{plan.name}</Text>

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
            <Box key="band:name" flexShrink={1} minWidth={0}>
              <Button plain key="band:plans" label={`${plan.name} ▾`} onPress={onMenu}>
                {name}
                <Text> ▾</Text>
              </Button>
            </Box>
          ) : (
            zone('name', name, 'shrink')
          )}
          {zone(
            'gap',
            <Box flexDirection="row">
              <Text> </Text>
              <Text color={stateColor}>{line.stateText}</Text>
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
          {zone('rest', <Box minWidth={2} />, 'grow')}
          {fileButton}
        </Box>
        </Box>
        {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns: columns + BAND_MASCOT_SPACE, now, listKey: 'band:list', pickKey: 'band:plan:', onPick, isQuiet }) : null}
        {holdsSomething(below) ? below : null}
      </Box>
    )
  }

  // The terminal: the mascot, the dot and (with one plan) the name are one Button; the bar, the count and the gap up to
  // "Plan file ›" are another. Both toggle the board; the name's menu and the plan file keep their own buttons. The parts
  // are fitted to the frame's inside (`bandFit`), so the row never runs past the column a docked pane leaves it.
  // A pane open inline can leave the band two rows: then the frame (its two border rows) goes and the band is the one row it was before it.
  const framedFit = bandFit(plan, columns - FRAME_COLUMNS, hasChoice, displayWidth(fileLabel), now)
  const isFramed = maxRows >= (framedFit.isStacked ? 4 : 3)
  const frameColumns = isFramed ? FRAME_COLUMNS : 0
  const fit = isFramed ? framedFit : bandFit(plan, columns, hasChoice, displayWidth(fileLabel), now)
  const headText = `${pose} ● ${hasChoice ? '' : fit.name}`
  const nameWidth = hasChoice ? displayWidth(`${fit.name} ▾`) : 0
  const bar = fit.filled + fit.empty
  const barText = ` ${fit.hasState ? `${fit.stateText}  ` : ''}${bar > 0 ? `${'▰'.repeat(fit.filled)}${'▱'.repeat(fit.empty)} ` : ''}${fit.count}`
  const used = displayWidth(headText) + nameWidth + displayWidth(barText) + (fit.hasFile ? displayWidth(fileLabel) : 0)
  const filler = ' '.repeat(Math.max(0, columns + BAND_MASCOT_SPACE - frameColumns - used - (fit.hasFile ? 2 : 0)))

  const progress = (
    <Button plain key="band:bar" label={`${barText}${fit.isStacked ? '' : filler}`} onPress={onBar}>
      <Text>{' '}</Text>
      {fit.hasState ? <Text color={stateColor}>{fit.stateText}</Text> : null}
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
      {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns: columns + BAND_MASCOT_SPACE, now, listKey: 'band:list', pickKey: 'band:plan:', onPick, isQuiet }) : null}
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
  /** The time a shown time (`updated`, a state word's `since`, a stalled mark) is compared with, to say today's as a clock time and another day's with its day (`Date.now()`); a parameter so a test can pin it. */
  now: number
  /** Rows the pane shows (`scroll.bodyRows`); undefined when the surface does not say. */
  bodyRows?: number
  /** The person's home directory, which a `~/` path in a note is under; undefined when not known. */
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

/** Columns of plan name the pane's header keeps beside "Plan file ›"; a narrower room puts that button on a row of its own. */
const MIN_HEAD_NAME = 8

/** The pane: the plan dropdown, "Plan file ›" and the plan line on top, then the four lanes (or one card's page, or the plan file). */
export function drawPane(given: Kit, args: PaneArgs): RenderElement {
  const kit = inkRows(given, isProportionalSurface(args.surface) && args.hasClient !== true)
  const { Box, Text, Markdown } = kit
  // Only the terminal and the desktop draw a Client; another surface's table has the name but drops the element.
  const Client = args.hasClient ? kit.Client : undefined
  const { plans, plan, columns, message, detail, file, home, frame, isOpen, expanded, now } = args
  const { onMenu, onPick, onCard, onBack, onFile, onLane, bodyRows } = args
  const isProportional = isProportionalSurface(args.surface)
  // vscode: proportional with no Client. Its buttons are quiet outlines, and its lanes sit side by side from a narrower pane, sized by share.
  const isQuiet = isProportional && Client === undefined
  const Button = quietButton(kit, isQuiet)
  // A Client's props: the terminal's stay as they were.
  const proportional = isProportional ? ({ isProportional: true } as const) : {}
  // A proportional layout leaves a row between cards, which it has room for; the terminal's rows are dear.
  const gapRows = isProportional ? 1 : 0
  const isSideBySide = columns >= (isQuiet ? QUIET_SIDE_BY_SIDE_FROM : SIDE_BY_SIDE_FROM)
  const laneCount = lanesOf(plan, expanded).length
  const width = isSideBySide ? laneWidth(columns, laneCount) : columns
  // The width a lane is drawn at: vscode's lanes share the row (24% each of four, 19% each of five with the Other lane), whatever its column count says.
  const laneBoxWidth = isQuiet && isSideBySide ? `${Math.floor(96 / laneCount)}%` : width
  // vscode's card is left to fill its lane: a width of 100% is the inside, and its border and padding would run into the gap.
  const cardBoxWidth = isQuiet && isSideBySide ? undefined : width

  const { color: dotColor, ...dotDim } = STYLE[worstStatus(plan)]
  const hasChoice = plans.length > 1
  const state = planStateOf(plan)
  // The state text (`Idle since 19:40`) is drawn in the bare state's color; its width is what the header gives it.
  const stateText = planStateText(plan, now)
  const stats = planStatsOf(plan, columns)
  const notStarted = notStartedText(plan)
  // The state text and n/m are never cut: the name is shortened to leave them room. Beside "Plan file ›" the name has the old
  // budget (two gaps and the ▾ besides the three; at least MIN_HEAD_NAME columns, else it would be cut to nothing). A name that
  // does not fit beside it moves "Plan file ›" to a row of its own, and the first row gives the name what the other three leave.
  // vscode's columns hold about two characters each: its header is fitted to the characters it fits.
  const headColumns = isQuiet ? vscodeChars(columns) : columns
  const countWidth = displayWidth(countText(plan))
  const beside = headColumns - 20 - countWidth - 2 - displayWidth(stateText)
  const isFileBelow = beside < Math.min(MIN_HEAD_NAME, displayWidth(plan.name))
  const headName = truncate(plan.name, isFileBelow ? Math.max(2, headColumns - 6 - countWidth - displayWidth(stateText) - (hasChoice ? 2 : 0) - 1) : beside)

  // vscode drops a Text's trailing spaces and draws a Button's label alone: the gaps are margins, the name's Button its label only, and the
  // state and the count never shrink (else "In / progress"). The other surfaces draw the spaces as before.
  const headRow = isQuiet ? (
    <Box key={isFileBelow ? 'menu:row' : 'menu'} flexDirection="row">
      <Box key="menu:dot" marginRight={1} flexShrink={0}>
        <Text color={dotColor} {...dotDim}>●</Text>
      </Box>
      {hasChoice ? <Button plain key="menu:name" label={headName} onPress={onMenu} /> : <Text bold wrap="truncate">{headName}</Text>}
      <Box key="menu:state" marginLeft={2} flexShrink={0}>
        <Text color={STATE_STYLE[state].color}>{stateText}</Text>
      </Box>
      <Box key="menu:count" marginLeft={2} flexShrink={0}>
        <Text color="suggestion">{countText(plan)}</Text>
      </Box>
      {hasChoice ? (
        // vscode drops the label's leading space: a margin keeps the button off the count.
        <Box key="menu:arrow:box" marginLeft={1} flexShrink={0}>
          <Button plain key="menu:arrow" label={isOpen ? '▴' : '▾'} onPress={onMenu} />
        </Box>
      ) : null}
      {isFileBelow ? null : <Box flexGrow={1} minWidth={2} />}
      {isFileBelow ? null : <Button plain key="plan-file" label={FILE_LABEL} onPress={onFile} />}
    </Box>
  ) : (
    <Box key={isFileBelow ? 'menu:row' : 'menu'} flexDirection="row">
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
      <Text color={STATE_STYLE[state].color}>{stateText}</Text>
      <Text>{'  '}</Text>
      <Text color="suggestion">{countText(plan)}</Text>
      {hasChoice ? <Button plain key="menu:arrow" label={isOpen ? ' ▴' : ' ▾'} onPress={onMenu} /> : null}
      {isFileBelow ? null : <Box flexGrow={1} minWidth={2} />}
      {isFileBelow ? null : <Button plain key="plan-file" label={FILE_LABEL} onPress={onFile} />}
    </Box>
  )

  const header = isFileBelow ? (
    <Box key="menu" flexDirection="column">
      {headRow}
      <Box flexDirection="row">
        <Box flexGrow={1} />
        <Button plain key="plan-file" label={FILE_LABEL} onPress={onFile} />
      </Box>
    </Box>
  ) : (
    headRow
  )

  // A card is its own bordered Box (the border takes 2 columns): every line of it is a Button, so a press anywhere opens
  // its page. An In Progress card has the mascot beside its two lines; a Blocked card is red all through (border, text,
  // tag) with the mascot frozen on one pose; the tag is right-aligned on the last line.
  // Only the Buttons are pressable, and a Button inverts under the pointer, so the mascot is plain Text beside the Button of
  // its row and never sits under that bar. The card shows its task name whole, wrapped; there is no hover box.
  const card = ({ row, index }: Card) => {
    const view = cardView(row, width, now)
    const isDoing = isRunning(row)
    const isStuck = isBlocked(row)
    const { color } = STYLE[row.status]
    const press = () => onCard(index)
    const art = isStuck || isStalled(row) ? MASCOT[0] : mascotAt(frame)
    // A proportional font draws block glyphs at its own shapes: the desktop draws the mascot as a picture beside the card's region.
    const Svg = isProportional ? kit.Svg : undefined
    const useSprite = Svg !== undefined && view.mascot && (Client !== undefined || isQuiet)
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

    const sprite =
      useSprite && Svg !== undefined ? (
        <Box width={CARD_SPRITE_CELLS} flexShrink={0}>
          <Svg
            source={(isDoing && !isStalled(row) ? spriteSvgAnimated(MASCOT, 'claude') : spriteSvg(art, isStuck ? 'error' : 'claude')).source}
            alt="Claude Code's mascot"
            width={CARD_SPRITE_PX.width}
            height={CARD_SPRITE_PX.height}
            {...(isDoing && !isStalled(row) ? { isInteractive: true } : {})}
          />
        </Box>
      ) : null

    // vscode (proportional, no Client): the task name as the desktop's card draws it (bold while running, red when blocked), the bar under
    // it, and a last row with a quiet "Open ›" button (its key `card:<anchor>:N`) before the tag.
    const linkBody = () => {
      const barRow = parsed[view.barAt]
      const tagRow = parsed[view.tagAt]
      const chip =
        tagRow === undefined || tagRow.tag === '' ? null : (
          <Box key={`card:${index}:tag`} marginLeft={1} flexShrink={0}>
            <Text color={tagRow.tagFg} backgroundColor={tagRow.tagBg} {...(tagRow.tagBold ? { bold: true } : {})}>{`${NBSP}${tagRow.tag}${NBSP}`}</Text>
          </Box>
        )

      return (
        <Box key={`card:${index}:body`} flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="wrap">
            {view.marker === '' ? null : <Text bold color={markerColor}>{view.marker}</Text>}
            <Text {...(isStuck ? { color: 'error' } : {})} {...(isDoing ? { bold: true } : {})}>{row.task}</Text>
          </Text>
          {barRow?.bar === undefined ? null : (
            <Box flexDirection="row">
              {barRow.bar.filled === 0 ? null : <Box width={barRow.bar.filled} height={1} flexShrink={0} backgroundColor={barRow.bar.color} />}
              {barRow.bar.empty === 0 ? null : <Box width={barRow.bar.empty} height={1} flexShrink={0} backgroundColor={barRow.bar.track} />}
              <Text>{barRow.name}</Text>
            </Box>
          )}
          <Box flexDirection="row">
            <Box flexGrow={1} />
            <Button plain key={`card:${plan.anchor}:${index}`} label={CARD_OPEN_LABEL} onPress={press} />
            {chip}
          </Box>
        </Box>
      )
    }

    // With a Client the rows are drawn by `card.tsx` in one region that posts a click and inverts under no pointer.
    const lineRows = Client
      ? [
          sprite !== null ? (
            <Box key={`card:${index}:sprite`} flexDirection="row" alignItems="center">
              {sprite}
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
      : isQuiet
        ? [
            sprite !== null ? (
              <Box key={`card:${index}:sprite`} flexDirection="row" alignItems="center">
                {sprite}
                {linkBody()}
              </Box>
            ) : (
              linkBody()
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
        {...(isProportional ? { hover: { borderStyle: 'bold', borderDimColor: false } } : {})}
        width={cardBoxWidth}
        flexDirection="column"
        borderStyle="round"
        // vscode writes the border as one `border: 1px solid var(--app-warning-foreground)`, a variable Cursor sets from
        // `--vscode-menu-foreground`; where that is undefined the whole border is dropped. The Verify card's outline is a hex there.
        borderColor={isQuiet && color === 'warning' ? (HEX.warning ?? color) : color}
        borderDimColor={!isDoing && !isStuck}
        paddingX={1}
      >
        {lineRows}
      </Box>
    )
  }

  // The header row of an expanded lane has "Show less ▴" at its right end; a Button draws its own `[ ]`, two columns more.
  const lessLabel = moreButton(SHOW_LESS)
  const lessColumns = displayWidth(lessLabel) + 4
  // vscode sizes a lane by share, not by the cells this counts: its overflow Button is always the short form, whole.
  const laneLabel = (one: Lane) => (isQuiet ? (one.moreLabel === SHOW_LESS ? lessLabel : `+${one.more} more ▾`) : overflowLabel(one, width))
  // A lane header is cut to the characters its lane fits: on vscode about two to a column ("In Progress 2 · 1 blocked", not "In Progress 2 …").
  const headerRoom = (cols: number) => (isQuiet ? vscodeChars(cols) : cols)

  const lane = (one: Lane) => {
    const isOpen = one.moreLabel === SHOW_LESS
    const hasLess = isOpen && width >= lessColumns + 12
    // The header's button folds the lane; the one at the bottom is kept only when the lane is taller than the pane shows
    // (the header has then scrolled away), or when the pane does not say how many rows it shows.
    const laneRows = 1 + one.cards.reduce((all, { row }) => all + cardRows(row, width, now) + gapRows, 0) + (one.cards.length === 0 ? 1 : 0) + 1
    const hasBottom = one.moreLabel !== '' && !(hasLess && bodyRows !== undefined && laneRows <= bodyRows)

    return (
      <Box key={`lane:${one.key}`} flexDirection="column" width={laneBoxWidth} {...(gapRows === 0 ? {} : { gap: gapRows })}>
        {hasLess ? (
          <Box flexDirection="row">
            <Text bold color={one.color} wrap="truncate">
              {truncate(one.header, headerRoom(width - lessColumns - 1))}
            </Text>
            <Box flexGrow={1} minWidth={1} />
            <Button key={`lane:${one.key}:less`} label={lessLabel} onPress={() => onLane(one.key)} />
          </Box>
        ) : (
          <Text bold color={one.color} wrap="truncate">
            {truncate(one.header, headerRoom(width))}
          </Text>
        )}
        {one.cards.length === 0 ? <Text dimColor>—</Text> : null}
        {one.cards.map(card)}
        {!hasBottom ? null : (
          <Button key={`lane:${one.key}:more`} label={laneLabel(one)} onPress={() => onLane(one.key)} />
        )}
      </Box>
    )
  }

  const row = detail === null ? undefined : plan.rows[detail]

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
          {isOpen && hasChoice ? drawPlanList(kit, { plans, plan, columns, now, listKey: 'menu:list', pickKey: 'plan:', onPick, isQuiet }) : null}
          {stats.length > 0 ? (
            drawStats(kit, { stats, isProportional, boxKey: 'plan-stats' })
          ) : notStarted === '' ? null : (
            <Box key="plan-stats">
              <Text dimColor wrap="truncate">
                {notStarted}
              </Text>
            </Box>
          )}
          {plan.recap === undefined ? null : (
            <Box key="recap" flexDirection="column" marginTop={1}>
              <Text dimColor wrap="truncate">
                {recapLabel(plan, now)}
              </Text>
              <Text wrap="wrap">{plan.recap}</Text>
            </Box>
          )}
          {/* A row of ─ is `columns` cells long, but a proportional font draws ─ wider than a cell and the Text is cut to "…": the desktop gets the Markdown rule, which the surface draws as wide as the pane. */}
          <Box key="divider" marginTop={1} {...(isProportional ? { flexDirection: 'column' as const, width: '100%' } : {})}>
            {isProportional ? (
              <Markdown text="---" dimColor />
            ) : (
              <Text dimColor wrap="truncate">
                {'─'.repeat(columns)}
              </Text>
            )}
          </Box>
        </Box>
      ) : null}
      {row === undefined ? (
        <Box key="kanban" flexDirection={isSideBySide ? 'row' : 'column'} gap={isSideBySide ? LANE_GAP : 1} marginTop={1}>
          {lanesOf(plan, expanded).map(lane)}
        </Box>
      ) : (
        drawDetail(kit, { row, columns, home, onBack, isProportional, isQuiet, now })
      )}
    </Box>
  )
}

type DetailArgs = Pick<PaneArgs, 'columns' | 'home' | 'onBack' | 'now'> & { row: PlanRow; isProportional: boolean; /** vscode: margins for spaces, quiet Buttons, note paths as plain text (a `file://` Link is dead there). */ isQuiet: boolean }

/** Columns of the table's label cell, at the most (the longest label is "Blocked because"). */
const LABEL_COLUMNS = 15

/** The narrowest value cell the table keeps before the label cell shrinks. */
const MIN_VALUE_COLUMNS = 12

/** A piece of a cell's line: text, its colour, and the file link it opens, if any. */
type Part = { text: string; color?: string; bold?: boolean; dim?: true; href?: string | null; /** Drawn as this chip: the text padded one space each side. */ chip?: Chip; /** Drawn as a solid bar of Boxes (the desktop). */ bar?: { fraction: number; color: string } }

/** One row of the table: the label and its lines, each a list of parts. */
type TableRow = { key: string; label: string; isRed?: boolean; lines: Part[][] }

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
 * Blocked row; its date, then one bulleted point per line, its file paths links).
 * The frame is box characters on the terminal: a label cell and a value cell, a rule between rows;
 * values wrap inside their cell. On the desktop each row is a round-bordered Box, a label Box of fixed width and a value Box that
 * wraps its text.
 */
function drawDetail(kit: Kit, { row, columns, home, onBack, isProportional, isQuiet, now }: DetailArgs): RenderElement {
  const { Box, Text } = kit
  const Button = quietButton(kit, isQuiet)
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

  const rows: TableRow[] = [
    ...(row.goal === undefined || row.goal === '' ? [] : [{ key: 'goal', label: 'Goal', lines: plain(row.goal) }]),
    {
      key: 'status',
      label: 'Status',
      lines: wrap(row.statusText ?? statusWords(row, now), valueWidth).map((text): Part[] => [{ text, color, bold: stuck, ...(dim.dimColor === true ? { dim: true as const } : {}) }]),
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
                ...(piece.path === undefined || isQuiet ? {} : { color: LINK_COLOR, href: fileHref(piece.path, home) }),
              })),
            ),
          },
        ]),
  ]

  return (
    <Box key="detail" flexDirection="column" marginTop={1}>
      <Button key="back" label="‹ Back" onPress={onBack} />
      <Box key="detail:title" flexDirection="row" marginTop={1}>
        {isQuiet ? (
          <Box marginRight={1} flexShrink={0}>
            <Text color={color} {...dim}>■</Text>
          </Box>
        ) : (
          <Text color={color} {...dim}>
            ■{' '}
          </Text>
        )}
        <Text bold wrap="wrap">
          {row.task}
        </Text>
      </Box>
      {usage === undefined ? null : drawStats(kit, { stats: fitStats(usage, columns), isProportional, boxKey: 'detail:usage' })}
      {drawTable(kit, { rows, columns, isProportional })}
    </Box>
  )
}

type TableArgs = Pick<DetailArgs, 'columns' | 'isProportional'> & { rows: readonly TableRow[] }

/** The bordered table of label and value rows: box characters on the terminal, one round-bordered Box per row on the desktop. */
function drawTable(kit: Kit, { rows, columns, isProportional }: TableArgs): RenderElement {
  const { Box, Text, Link } = kit
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

  const field = (one: TableRow) => (
    <Box key={`field:${one.key}`} flexDirection="row" borderStyle="round" borderDimColor paddingX={1}>
      <Box width={labelBox} flexShrink={0}>
        <Text bold {...(one.isRed === true ? { color: 'error' } : {})}>
          {one.label}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        {one.lines.map(valueLine)}
      </Box>
    </Box>
  )

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

/**
 * The surface module of a card: the card's text rows, drawn in a Client region. A Button inverts under the pointer; a
 * Client does not, so the card is clickable (a left button down and up inside the region posts `{ open }` to the
 * plugin) without a bar over its rows or its mascot. A click also gives the region the keyboard, and Enter posts the same.
 */
import type { ClientModule } from 'claude-code'

/** One text row of a card, as plain data. */
export type CardRow = {
  /** The mascot's row of block characters and its space, or ''. */
  art: string
  artColor: string
  /** The marker (`⚑ Blocked · `, `◆ needs you · `) and its colour. */
  marker: string
  markerColor: string
  name: string
  isRed: boolean
  isBold: boolean
  /** The progress bar that starts the row (`name` is then its count), or undefined: filled cells in `color`, the empty ones dim. */
  bar?: { filled: number; empty: number; color: string; track: string }
  /** The word of the tag's chip, or ''; `tagPad` spaces go before it (the terminal aligns it right; a proportional font does it with a Box). */
  tag: string
  tagPad: number
  tagBg: string
  tagFg: string
  tagBold: boolean
}

/**
 * `isProportional` is a surface with a proportional font (the desktop app): the tag cannot be aligned with spaces there, so a row is
 * the name in a Box that grows, then the tag.
 */
export type CardProps = { index: number; rows: CardRow[]; isProportional?: boolean }

/** The local state: whether the left button went down in the card and has not come up yet. */
type State = { isDown: boolean }

const Card: ClientModule<CardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const open = () => surface.post({ open: props.index })
  const colour = (row: CardRow) => (row.isRed ? { color: 'error' } : {})

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      surface.setState({ isDown: true })
    }

    if (event.type === 'up') {
      const wasDown = surface.state?.isDown === true
      // A click is the left button coming up in the card where it went down: letting go outside cancels it. A region
      // not yet laid out reports 0 cells, and then nothing is outside.
      const isInside = surface.columns === 0 || surface.rows === 0 || (event.x >= 0 && event.y >= 0 && event.x < surface.columns && event.y < surface.rows)

      surface.setState({ isDown: false })

      if (wasDown && event.button === 'left' && isInside) {
        open()
      }
    }
  })
  surface.onKey(event => {
    if (event.key === 'return') {
      open()
    }
  })

  const chip = (row: CardRow) => (
    <Text color={row.tagFg} backgroundColor={row.tagBg} {...(row.tagBold ? { bold: true } : {})}>{` ${row.tag} `}</Text>
  )

  const name = (row: CardRow) =>
    row.bar === undefined
      ? row.name
      : [
          <Text color={row.bar.color}>{'▰'.repeat(row.bar.filled)}</Text>,
          <Text dimColor>{'▱'.repeat(row.bar.empty)}</Text>,
          row.name,
        ]

  return (
    <Box flexDirection="column">
      {props.rows.map(row => (
        <Box flexDirection="row">
          {row.art === '' ? null : <Text color={row.artColor}>{row.art}</Text>}
          {row.marker === '' ? null : (
            <Text bold color={row.markerColor}>
              {row.marker}
            </Text>
          )}
          {props.isProportional === true ? (
            <Box flexGrow={1} flexDirection="row">
              {
                // The glyphs of a bar draw as slanted dashes in a proportional font: a solid bar of two Boxes instead.
                row.bar === undefined ? null : (
                  <Box flexShrink={0} flexDirection="row">
                    {row.bar.filled === 0 ? null : <Box width={row.bar.filled} height={1} backgroundColor={row.bar.color} />}
                    {row.bar.empty === 0 ? null : <Box width={row.bar.empty} height={1} backgroundColor={row.bar.track} />}
                  </Box>
                )
              }
              <Text {...colour(row)} {...(row.isBold ? { bold: true } : {})}>
                {row.name}
              </Text>
            </Box>
          ) : (
            <Text {...colour(row)} {...(row.isBold ? { bold: true } : {})}>
              {name(row)}
            </Text>
          )}
          {row.tag === '' ? null : props.isProportional === true ? (
            <Box marginLeft={1} flexShrink={0}>
              {chip(row)}
            </Box>
          ) : (
            <Text>
              {' '.repeat(row.tagPad)}
              {chip(row)}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Card

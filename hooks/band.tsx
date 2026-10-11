/**
 * The desktop band's pressable overlay: an empty region laid over a part of the band that no Button can hold (the mascot and
 * the bar are pictures). A left button down and up inside it posts `{ band: 'toggle' }` to the plugin, which toggles the
 * board, as a press on the band does on the terminal. The posts reach the plugin by the instance, not by a button handle.
 */
import type { ClientModule } from 'claude-code'

type State = { isDown: boolean }

const BandZone: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box } = surface.elements

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      surface.setState({ isDown: true })
    }

    if (event.type === 'up') {
      const wasDown = surface.state?.isDown === true

      surface.setState({ isDown: false })

      if (wasDown && event.button === 'left') {
        surface.post({ band: 'toggle' })
      }
    }
  })

  return <Box />
}

export default BandZone

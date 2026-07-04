export interface GamepadSummary {
  index: number
  id: string
  buttons: number
}

export interface PressedGamepadButton {
  gamepadIndex: number
  gamepadId: string
  buttonIndex: number
}

export function listConnectedGamepads(): GamepadSummary[] {
  return navigator.getGamepads()
    .filter((gamepad): gamepad is Gamepad => Boolean(gamepad))
    .map((gamepad) => ({ index: gamepad.index, id: gamepad.id, buttons: gamepad.buttons.length }))
}

export function readButtonPressed(gamepadIndex: number | undefined, buttonIndex: number, gamepadId?: string): boolean {
  const byIndex = gamepadIndex === undefined ? null : navigator.getGamepads()[gamepadIndex]
  if (byIndex && (byIndex.id === gamepadId || !gamepadId)) return Boolean(byIndex.buttons[buttonIndex]?.pressed)

  if (!gamepadId) return false
  const byId = navigator.getGamepads().find((gamepad): gamepad is Gamepad => Boolean(gamepad && gamepad.id === gamepadId))
  return Boolean(byId?.buttons[buttonIndex]?.pressed)
}

export function findFirstPressedButton(previous: Map<string, boolean>): PressedGamepadButton | null {
  for (const gamepad of navigator.getGamepads()) {
    if (!gamepad) continue
    for (let buttonIndex = 0; buttonIndex < gamepad.buttons.length; buttonIndex += 1) {
      const key = `${gamepad.index}:${buttonIndex}`
      const pressed = gamepad.buttons[buttonIndex]?.pressed ?? false
      const wasPressed = previous.get(key) ?? false
      previous.set(key, pressed)
      if (pressed && !wasPressed) {
        return { gamepadIndex: gamepad.index, gamepadId: gamepad.id, buttonIndex }
      }
    }
  }
  return null
}

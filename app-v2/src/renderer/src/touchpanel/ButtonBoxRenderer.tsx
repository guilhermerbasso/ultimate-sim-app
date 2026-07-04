import type { CSSProperties, ReactElement } from 'react'
import type { ButtonBoxButton, ButtonBoxPanel } from '../../../shared/touch-panel'
import { materialClass } from './keyMaterials'
import { KeyFace } from './KeyFace'

// Self-contained RGB button-box renderer. Deliberately does NOT import the CSS
// (the editor / window root own that) so the component stays import-clean for the
// node test environment. It draws a CSS-grid of neon keys; every visual property
// is driven by the per-button model. Labels/icons are auto-fit (KeyFace + FitText),
// so a label can NEVER overflow or render too small for its key.

export interface ButtonBoxRendererProps {
  panel: ButtonBoxPanel
  /** When set, clicking a key fires this (fullscreen runtime). */
  onPress?: (button: ButtonBoxButton, index: number) => void
  /** When set, clicking a key selects it instead of firing (editor mode). */
  onSelect?: (button: ButtonBoxButton, index: number) => void
  selectedId?: string | null
  /** Disable pointer interaction (static preview). */
  interactive?: boolean
}

function buttonStyle(button: ButtonBoxButton): CSSProperties {
  return {
    color: button.textColor,
    borderColor: button.borderColor,
    borderWidth: `${button.borderWidth}px`,
    // Colour tokens consumed by the material CSS (.bb-mat-*).
    ['--bb-body' as string]: button.bodyColor,
    ['--bb-border' as string]: button.borderColor,
    ['--bb-glow' as string]: button.borderColor,
    // Pressed/active look. Falls back to the button's own body/text colour so the
    // existing neon brightness pulse still reads when no custom active colour is set.
    ['--bb-active-bg' as string]: button.activeColor ?? button.bodyColor,
    ['--bb-active-fg' as string]: button.activeTextColor ?? button.textColor
  }
}

export function ButtonBoxKey({
  button,
  index,
  selected,
  interactive,
  onPress,
  onSelect
}: {
  button: ButtonBoxButton
  index: number
  selected: boolean
  interactive: boolean
  onPress?: (button: ButtonBoxButton, index: number) => void
  onSelect?: (button: ButtonBoxButton, index: number) => void
}): ReactElement {
  const isEmpty = !button.label && !button.image && !button.icon && button.action.kind === 'none'
  const className = ['bb-btn', materialClass(button.material), isEmpty ? 'is-empty' : '', selected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ')
  const hasContent = !!button.label || !!button.icon
  return (
    <button
      type="button"
      className={className}
      style={buttonStyle(button)}
      disabled={!interactive}
      aria-label={button.label || `Botão ${index + 1}`}
      onClick={() => {
        if (onSelect) onSelect(button, index)
        else if (onPress) onPress(button, index)
      }}
    >
      {button.image ? <img className="bb-btn-image" src={button.image} alt="" /> : null}
      {button.image ? (
        button.label ? (
          <KeyFace
            label={button.label}
            textColor={button.textColor}
            iconColor={button.borderColor}
            bottomLabel
            maxFont={button.fontSize}
          />
        ) : null
      ) : hasContent ? (
        <KeyFace
          label={button.label}
          icon={button.icon}
          textColor={button.textColor}
          iconColor={button.borderColor}
          maxFont={button.fontSize}
        />
      ) : null}
    </button>
  )
}

export function ButtonBoxRenderer({
  panel,
  onPress,
  onSelect,
  selectedId = null,
  interactive = true
}: ButtonBoxRendererProps): ReactElement {
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${panel.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${Math.max(1, panel.rows)}, minmax(0, 1fr))`,
    gridAutoRows: 'minmax(0, 1fr)',
    gap: `${panel.gap}px`,
    padding: `${panel.gap}px`,
    background: panel.background
  }
  return (
    <div className="bb-stage" style={{ background: panel.background }}>
      <div className="bb-grid" style={gridStyle}>
        {panel.buttons.map((button, index) => (
          <ButtonBoxKey
            key={button.id}
            button={button}
            index={index}
            selected={selectedId === button.id}
            interactive={interactive}
            onPress={onPress}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

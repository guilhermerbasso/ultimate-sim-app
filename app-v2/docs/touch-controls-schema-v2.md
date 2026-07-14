# Touch Controls schema v2

`ButtonBoxPanel.schemaVersion` is `2`. Files without a version (or with version `1`) migrate on load and are rewritten by `TouchPanelManager` only after successful parsing.

## Migration guarantee

Legacy `button.action` becomes an explicit `momentary` control, regardless of its old cosmetic material. This preserves the old one-press behavior. Existing colors, labels, icons, actions, and cells are retained; short legacy grids are padded with non-action value tiles and oversized grids grow rows when possible. Invalid/future schemas are rejected with actionable errors.

## Control semantics

- `momentary`: fires on pointer/key down; keyboard `hold` emits begin and release/cancel phases; configured or keyboard `repeat` stops on up/cancel.
- `latching-toggle`: toggles local ON/OFF state and dispatches the exact corresponding `onAction` or `offAction`.
- `two-position-rocker`: fixed negative and positive hit zones/actions; optionally repeats while held.
- `guarded-two-step`: first activation only opens the guard; only a second activation can dispatch. The guard auto-closes.
- `rotary`: fixed decrement and increment zones/actions with detent repeat.
- `selector`: 2–12 uniquely identified choices; previous/next wraps and dispatches only the newly selected choice.
- `status-led`: read-only status/LED display; it cannot contain an action.
- `value-tile`: read-only value/unit display; it cannot contain an action.

Materials and shapes are visual-only and independent from `control.kind`.

## Expression state destination contract

A control may reference existing expression definitions at exactly these destinations:

- `active`
- `pressed`
- `disabled`
- `warning`
- `value`

Each binding is `{ source: "expression", expressionId }`. The renderer consumes `expr:getResults` / `expr:results`; it does not persist definitions or evaluate formulas. The deterministic integration id is:

```text
touch-control:<panelId>:<controlId>:<destination>
```

This is exported by `touchControlStateDestinationId()` for expression/output integration work.

## Safety boundaries

Imports accept only strict action/control shapes, hex colors, bounded text/timing, and small base64 raster images. External/file/javascript URLs, SVG payloads, arbitrary CSS, arbitrary zones, unknown state destinations, and gamepad actions are rejected. The fullscreen preload uses exact channels only.

Browser-streamed true holds remain disabled until the streaming transport provides an authenticated begin/end/cancel path. The local Electron runtime supports true keyboard holds and has unmount plus main-process timeout release safeguards.
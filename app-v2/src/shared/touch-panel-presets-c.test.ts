import { describe, expect, it } from "vitest";
import {
  buttonControlActions,
  KEY_MATERIALS,
  summarizeButtonBoxPanel,
  type ButtonAction,
} from "./touch-panel";
import { TOUCH_PRESETS_C } from "./touch-panel-presets-c";

const VALID_ACTION_KINDS: ButtonAction["kind"][] = [
  "none",
  "iracing",
  "keyboard",
  "app",
];

describe("touch panel presets C", () => {
  it("ships the six high-fidelity touch-control panels with unique ids", () => {
    expect(TOUCH_PRESETS_C).toHaveLength(6);
    const ids = TOUCH_PRESETS_C.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every panel has valid materials, buttons and actions", () => {
    for (const panel of TOUCH_PRESETS_C) {
      expect(panel.buttons.length, panel.id).toBeGreaterThan(0);
      expect(panel.buttons.length, `${panel.id} fills its grid`).toBe(
        panel.columns * panel.rows,
      );
      for (const button of panel.buttons) {
        expect(KEY_MATERIALS).toContain(button.material);
        for (const action of buttonControlActions(button.control)) expect(VALID_ACTION_KINDS).toContain(action.kind);
      }
    }
  });

  it("summarizes every high-fidelity panel", () => {
    for (const panel of TOUCH_PRESETS_C) {
      expect(summarizeButtonBoxPanel(panel)).toMatchObject({
        id: panel.id,
        name: panel.name,
        columns: panel.columns,
        rows: panel.rows,
        buttonCount: panel.buttons.length,
      });
    }
  });
});

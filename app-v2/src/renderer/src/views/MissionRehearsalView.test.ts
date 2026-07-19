// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  DEFAULT_MISSION_REHEARSAL_MANIFEST,
  advanceMissionRun,
  createMissionRun,
  serializeMissionManifest,
  type MissionScenarioManifest
} from '../../../shared/mission-rehearsal'
import {
  MISSION_REHEARSAL_DRAFT_KEY,
  missionResumeStorageKey,
  saveMissionResume
} from '../../../shared/mission-rehearsal-storage'
import { tt } from '../i18n'
import MissionRehearsalView from './MissionRehearsalView'

function manifestClone(): MissionScenarioManifest {
  return JSON.parse(JSON.stringify(DEFAULT_MISSION_REHEARSAL_MANIFEST)) as MissionScenarioManifest
}

function renderView(showToast = vi.fn()): void {
  render(React.createElement(MissionRehearsalView, {
    connectedDevice: null,
    mapping: null,
    config: null,
    setConnectedDevice: vi.fn(),
    refreshDeviceState: async () => {},
    showToast,
    language: 'en'
  }))
}

function completedRun(manifest: MissionScenarioManifest) {
  let run = createMissionRun(manifest, 'race-engineer', {
    id: 'run-ui-finalize',
    now: 1_000
  })
  run = advanceMissionRun(manifest, run, 'confirm-neutralized-pace', 1_100)
  run = advanceMissionRun(manifest, run, 'prepare-wet-stop', 1_200)
  return advanceMissionRun(manifest, run, 'fallback-protocol', 1_300)
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('MissionRehearsalView active-run isolation', () => {
  it('locks authoring, history, and global reset while a resumable run is active', async () => {
    const manifest = manifestClone()
    const run = createMissionRun(manifest, 'race-engineer', {
      id: 'run-ui-isolation',
      now: 1_000
    })
    saveMissionResume(window.localStorage, manifest, run, 1_100)

    renderView()

    const authorTab = await screen.findByRole('tab', { name: 'Author' })
    const debriefTab = screen.getByRole('tab', { name: 'Debrief' })
    await waitFor(() => expect((authorTab as HTMLButtonElement).disabled).toBe(true))

    expect((debriefTab as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reset all rehearsal data' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect((screen.getByRole('button', { name: 'Reset active run' }) as HTMLButtonElement).disabled)
      .toBe(false)
    expect(screen.getByText(tt('en', 'mission.tabs.lockedDuringRun'))).toBeTruthy()
    expect(screen.queryByLabelText('Scenario manifest JSON')).toBeNull()
  })

  it('keeps an unarchived completed resume locked and offers a retry path', async () => {
    const manifest = manifestClone()
    saveMissionResume(window.localStorage, manifest, completedRun(manifest), 1_400)

    renderView()

    const retry = await screen.findByRole('button', { name: 'Retry history archive' })
    const authorTab = screen.getByRole('tab', { name: 'Author' }) as HTMLButtonElement
    expect(authorTab.disabled).toBe(true)

    fireEvent.click(retry)

    await waitFor(() => expect(authorTab.disabled).toBe(false))
    expect(await screen.findByRole('heading', { name: 'Mission debrief' })).toBeTruthy()
  })

  it('offers only roles that can complete a rehearsal', async () => {
    renderView()

    const roleSelect = await screen.findByRole('combobox', { name: 'Rehearsal role' })
    const options = within(roleSelect).getAllByRole('option').map((option) => option.textContent)

    expect(options).toEqual(['Race engineer', 'Crew chief', 'Driver'])
    expect(options).not.toContain('Observer')
  })

  it('rechecks the active-run lock after an asynchronous manifest read', async () => {
    const replacement = manifestClone()
    replacement.title = 'Imported replacement'
    const showToast = vi.fn()
    let resolveText!: (value: string) => void
    const pendingText = new Promise<string>((resolve) => {
      resolveText = resolve
    })
    renderView(showToast)

    fireEvent.click(await screen.findByRole('tab', { name: 'Author' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [{ text: () => pendingText }]
      }
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start rehearsal' }))
    await waitFor(() => {
      expect((screen.getByRole('tab', { name: 'Author' }) as HTMLButtonElement).disabled).toBe(true)
    })

    await act(async () => {
      resolveText(serializeMissionManifest(replacement, 2_000))
      await pendingText
    })

    await waitFor(() => {
      expect(window.localStorage.getItem(MISSION_REHEARSAL_DRAFT_KEY)).toBeNull()
    })
    expect(window.localStorage.getItem(missionResumeStorageKey(manifestClone()))).not.toBeNull()
    expect(showToast).toHaveBeenCalledWith(tt('en', 'mission.toast.activeRunLocked'), 'info')
  })
})

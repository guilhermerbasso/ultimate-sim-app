// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APP_NAVIGATE_EVENT,
  consumeEditorTarget,
  navigateToEditor,
  navigateToView,
  type AppNavigateDetail
} from './app-navigation'

let navigationDetails: AppNavigateDetail[] = []

function handleNavigate(event: Event): void {
  navigationDetails.push((event as CustomEvent<AppNavigateDetail>).detail)
}

describe('app navigation', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    navigationDetails = []
    window.addEventListener(APP_NAVIGATE_EVENT, handleNavigate)
  })

  afterEach(() => {
    window.removeEventListener(APP_NAVIGATE_EVENT, handleNavigate)
  })

  it('dispatches one navigation event with the exact non-empty view ID', () => {
    navigateToView('touch-controls')

    expect(navigationDetails).toEqual([{ viewId: 'touch-controls' }])
    expect(window.sessionStorage.length).toBe(0)
  })

  it('does not dispatch navigation for an empty view ID', () => {
    navigateToView('')

    expect(navigationDetails).toEqual([])
    expect(window.sessionStorage.length).toBe(0)
  })

  it('stores, dispatches, and consumes an exact dashboard target once', () => {
    navigateToEditor('dashboard', 'dash-user')

    expect(navigationDetails).toEqual([{
      viewId: 'dashboards',
      editorTarget: {
        surface: 'dashboard',
        targetId: 'dash-user'
      }
    }])
    expect(window.sessionStorage.length).toBe(1)
    expect(consumeEditorTarget('dashboard')).toBe('dash-user')
    expect(consumeEditorTarget('dashboard')).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('does not store or dispatch an empty editor target ID', () => {
    navigateToEditor('dashboard', '')

    expect(navigationDetails).toEqual([])
    expect(window.sessionStorage.length).toBe(0)
  })

  it('preserves a dashboard target for the matching consumer after a surface mismatch', () => {
    navigateToEditor('dashboard', 'dash-user')

    expect(consumeEditorTarget('overlay')).toBeNull()
    expect(window.sessionStorage.length).toBe(1)
    expect(consumeEditorTarget('dashboard')).toBe('dash-user')
    expect(window.sessionStorage.length).toBe(0)
  })
})

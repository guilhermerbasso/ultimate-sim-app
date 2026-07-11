import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings
} from '../../../shared/settings'
import {
  DEFAULT_UNIT_SYSTEM,
  isUnitSystem,
  type UnitSystem
} from '../../../shared/units'

export const APP_SETTINGS_CHANGED_CHANNEL = 'app:settingsChanged'
const APP_SETTINGS_CHANGED_DOM_EVENT = 'usa:settings-changed'

interface UnitSystemContextValue {
  unitSystem: UnitSystem
}

const UnitSystemContext = createContext<UnitSystemContextValue>({
  unitSystem: DEFAULT_UNIT_SYSTEM
})

export function UnitSystemProvider({
  children,
  initialUnitSystem
}: {
  children?: ReactNode
  initialUnitSystem?: UnitSystem
}): ReactElement {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initialUnitSystem ?? DEFAULT_APP_SETTINGS.unitSystem)

  useEffect(() => {
    // When an explicit initialUnitSystem is provided the caller owns the value
    // (e.g. inert previews or tests). Skip IPC so no channel traffic occurs.
    if (initialUnitSystem !== undefined) return
    let mounted = true
    const apply = (settings: Partial<AppSettings> | null | undefined): void => {
      if (mounted && isUnitSystem(settings?.unitSystem)) setUnitSystem(settings.unitSystem)
    }

    void window.ipc.invoke<AppSettings>('app:getSettings').then(apply).catch(() => {})
    const unsubscribe = window.ipc.subscribe<AppSettings>(APP_SETTINGS_CHANGED_CHANNEL, apply)
    const onDomSettings = (event: Event): void => {
      apply((event as CustomEvent<AppSettings>).detail)
    }
    window.addEventListener(APP_SETTINGS_CHANGED_DOM_EVENT, onDomSettings)

    return () => {
      mounted = false
      unsubscribe()
      window.removeEventListener(APP_SETTINGS_CHANGED_DOM_EVENT, onDomSettings)
    }
  }, [])

  const value = useMemo(() => ({ unitSystem }), [unitSystem])
  return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>
}

export function useUnitSystem(): UnitSystem {
  return useContext(UnitSystemContext).unitSystem
}

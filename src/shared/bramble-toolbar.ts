export type BrambleToolbarAction = 'open' | 'install' | 'busy'

export function resolveBrambleToolbarAction(state: { installed: boolean; loading: boolean }): BrambleToolbarAction {
  if (state.loading) return 'busy'
  return state.installed ? 'open' : 'install'
}

export function dispatchBrambleToolbarAction(
  state: { installed: boolean; loading: boolean },
  handlers: { open: () => void | Promise<void>; install: () => void | Promise<void> }
): void | Promise<void> {
  const action = resolveBrambleToolbarAction(state)
  if (action === 'busy') return
  return handlers[action]()
}

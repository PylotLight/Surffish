import { useState, type FormEvent } from 'react'
import { DEFAULT_CUSTOM_SEARCH_ENGINES, MAX_CUSTOM_SEARCH_ENGINES, makeSearchEngineId, normalizeSearchKeyword, validateCustomSearchEngine, type CustomSearchEngine } from '../../../../shared/search-keywords'
import { useSearchKeywords } from '../useSearchKeywords'
import { SettingsGroup, SettingsRow } from './SettingsControls'

interface Draft {
  id: string | null
  name: string
  keyword: string
  urlTemplate: string
}

const EMPTY_DRAFT: Draft = { id: null, name: '', keyword: '', urlTemplate: 'https://' }

/** Settings → General: custom search engines reachable as `keyword query` or `!keyword`. */
export function SearchKeywordsSettings(): React.JSX.Element {
  const engines = useSearchKeywords()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  function startDraft(next: Draft): void {
    setMessage('')
    setIsError(false)
    setDraft(next)
  }

  async function save(next: CustomSearchEngine[], done: string): Promise<boolean> {
    try {
      const result = await window.api.browser.searchKeywords.set(next)
      setIsError(!result.ok)
      setMessage(result.ok ? done : result.error)
      return result.ok
    } catch (error) {
      setIsError(true)
      // ipcRenderer.invoke prefixes "Error invoking remote method …: Error: ".
      setMessage((error instanceof Error ? error.message : String(error)).replace(/^.*Error: /, ''))
      return false
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!draft) return
    const others = engines.filter((engine) => engine.id !== draft.id)
    const candidate = { name: draft.name.trim(), keyword: normalizeSearchKeyword(draft.keyword), urlTemplate: draft.urlTemplate.trim() }
    const error = validateCustomSearchEngine(candidate, others)
    if (error) {
      setIsError(true)
      setMessage(error)
      return
    }
    const next = draft.id
      ? engines.map((engine) => (engine.id === draft.id ? { ...engine, ...candidate } : engine))
      : [...engines, { id: makeSearchEngineId(candidate.name, engines), ...candidate }]
    if (await save(next, draft.id ? 'Saved.' : `Added. Type “${candidate.keyword} ” or “!${candidate.keyword}” in the address bar.`)) setDraft(null)
  }

  function remove(id: string): void {
    void save(engines.filter((engine) => engine.id !== id), 'Removed.')
  }

  return (
    <SettingsGroup title="Search keywords" aside={!draft && engines.length < MAX_CUSTOM_SEARCH_ENGINES ? <button className="settings-action secondary" type="button" onClick={() => startDraft({ ...EMPTY_DRAFT })}>Add</button> : undefined}>
      <SettingsRow label="Keyword search" hint="Type a keyword and a space (“yt lofi”), or a !bang anywhere (“lofi !yt”), to search that site from the address bar or the command palette.">
        <button className="settings-action secondary" type="button" onClick={() => void save(DEFAULT_CUSTOM_SEARCH_ENGINES.map((engine) => ({ ...engine })), 'Restored the default keywords.')}>Restore defaults</button>
      </SettingsRow>
      <div className="search-keyword-list" role="list" aria-label="Search keywords">
        {engines.length === 0 && <p className="settings-message">No search keywords.</p>}
        {engines.map((engine) => (
          <div className="search-keyword-row" role="listitem" key={engine.id}>
            <span>{engine.name}</span>
            <span className="keyword-suggestion-chip">{engine.keyword}</span>
            <code title={engine.urlTemplate}>{engine.urlTemplate}</code>
            <span className="search-keyword-actions">
              <button className="settings-action secondary" type="button" aria-label={`Edit ${engine.name}`} onClick={() => startDraft({ id: engine.id, name: engine.name, keyword: engine.keyword, urlTemplate: engine.urlTemplate })}>Edit</button>
              <button className="settings-action secondary" type="button" aria-label={`Remove ${engine.name}`} onClick={() => remove(engine.id)}>Remove</button>
            </span>
          </div>
        ))}
      </div>
      {draft && (
        <form className="search-keyword-form" onSubmit={(event) => void submit(event)} aria-label={draft.id ? 'Edit search engine' : 'Add search engine'}>
          <input className="settings-input" type="text" value={draft.name} maxLength={60} placeholder="Name" aria-label="Name" autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <input className="settings-input" type="text" value={draft.keyword} maxLength={24} placeholder="Keyword" aria-label="Keyword" spellCheck={false} autoCapitalize="none" onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} />
          <input className="settings-input" type="url" value={draft.urlTemplate} maxLength={2048} placeholder="https://example.com/search?q=%s" aria-label="URL with %s in place of the query" spellCheck={false} onChange={(event) => setDraft({ ...draft, urlTemplate: event.target.value })} />
          <div className="search-keyword-form-actions">
            {message && <p className={`settings-message${isError ? ' is-error' : ''}`} role="status">{message}</p>}
            {!message && <p className="settings-message">Use %s where the search terms go. https only.</p>}
            <button className="settings-action secondary" type="button" onClick={() => setDraft(null)}>Cancel</button>
            <button className="settings-action primary" type="submit">{draft.id ? 'Save' : 'Add'}</button>
          </div>
        </form>
      )}
      {!draft && message && <p className={`settings-message${isError ? ' is-error' : ''}`} role="status">{message}</p>}
    </SettingsGroup>
  )
}

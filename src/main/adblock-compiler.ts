// Utility process (utilityProcess.fork from src/main/adblock.ts): compiles downloaded filter lists
// into a serialized engine and exits. Compiling uBO's default lists takes ~0.5 s of CPU and leaves a
// few hundred MB of short-lived garbage; here neither touches the main process, whose UI thread
// stays free and whose heap never grows for it. Main deserializes the bytes, like a cached start.
// One message in ({ texts, resources }), one out ({ ok: true, bytes } or { ok: false, error }).
import { compileFilterEngine, type DownloadedFilterLists } from './adblock-filters.ts'

process.parentPort.once('message', (event) => {
  try {
    const lists = event.data as Pick<DownloadedFilterLists, 'texts' | 'resources'>
    if (!Array.isArray(lists?.texts) || typeof lists.resources !== 'string') throw new Error('bad compile request')
    const bytes = compileFilterEngine(lists).serialize()
    process.parentPort.postMessage({ ok: true, bytes })
  } catch (error) {
    process.parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

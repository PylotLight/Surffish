import readabilitySource from '@mozilla/readability/Readability.js?raw'
import { buildExtractScript } from '../shared/reader'

/** Readability.parse() for one page, as an isolated-world script. Imported lazily: it is ~90 KB of source only Reader view needs. */
export const EXTRACT_SCRIPT = buildExtractScript(readabilitySource)

/**
 * The Phonon voice catalog (gradium/phonon-voices, Apache-2.0: 102 voices for Phonon 31M, 37 of them
 * English). Its `voices.jsonl` (one JSON line per voice: voice_id, name, language, locale, gender,
 * age, description, filename) is fetched once at a pinned commit and checked against its sha256;
 * each voice file (~256 KB) is fetched the first time it is picked and checked against the hash
 * below (the repo's LFS sha256 at that commit). Only English voices are offered: the model is
 * Phonon 31M English. Pure; loaded with the read-aloud module and the settings/player chunks only.
 */

export const VOICES_COMMIT = '0ee17205f254b5abc43b266c8a0f215565c352f7'
export const VOICES_REPO = `https://huggingface.co/gradium/phonon-voices/resolve/${VOICES_COMMIT}`
export const VOICE_CATALOG_URL = `${VOICES_REPO}/voices.jsonl`
export const VOICE_CATALOG_SHA256 = '874f34998ce581b94f2b8912aa015639f52b5fd62eba3ba11e1b64dcaed7d802'
export const VOICE_CATALOG_BYTES = 33407
export const VOICE_FILE_BYTES = 256136

/** sha256 of every English voice file at VOICES_COMMIT (LFS oids from the repo tree). */
export const ENGLISH_VOICE_SHA256: Readonly<Record<string, string>> = {
  'NbpkqMVS3CJeq2j8': '97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23',
  'NIWIOv5vTi5eRMj8': '444378eb06b7c492b86e8fc7d13e4db1a3c0cf3e68891a960bf6f0a41a13ef35',
  'vjFyp2BcCyTlUmYb': '958ea94da14f46dd48c7f64adac11ed2ad2aa45f7ccd165dfebab5272664402e',
  '4SZHfMpw-p46Ywgs': '6b3da6e2d796a20c51af892c482bd6509fb88267a221aff83c870843dee2a123',
  'bXwrkHhURL1VFJdG': 'a879938aa9a2df0a8220bdadef88137929f71e887bd91e7db205bd5fa11661d2',
  'nGzMHMPAWGaJFHOo': 'a0c3dcb91b2247eca56536be9ae8e8becc1c807b1136c5fe101552d6a155b24a',
  'LMDIYE0Oa377Qh6Z': '45c582673cb20edb04ddcca2b5a8865ddfb0a82599efadb269021e87d20fbdd4',
  '40QrMVgAxFiUnP9f': '0de1098d1051686a138d068e83ff09deb5053328bc74ec9541a1fdb90bfc24da',
  '0zLApsZfVLLNaEGl': 'dc1341c8937af5534e6bbcc5c0fc5e7c10312229b59061228074f93683fe2261',
  '_6Aslh2DxfmnRLmP': 'beae9e4030efce0a935fcb0f807dc0784d598bcaa87ad4aacb047436b1eaa411',
  'qIxlZ7Ei8KvWlyQH': '6e04b84d3ae8751b22bca0a4f63936f9cb648f4f2182b2d0788071ea1c0b68a1',
  'd9XCyhjo4JhkHF1d': 'eab20e4f159b48cfbc01b1885804e24f681f80e7a64f909182763a4e3361bee8',
  '6PWnV0Nq4wu7RVBT': '56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844',
  'GgfEkEJtxZR7gnpy': 'eb3cd47418349e618408c16bea7153988b3ad04b41a6033039dd474a9a4dcd23',
  'uem82D50GRv2Dwma': 'd41a8f01d6e33450f1ce062d332914da10beee99e585dab531750706f187c48a',
  'y9bQqIDnyxwqK01t': '21eade9d83b2e66b9364e1b6cd999a3a6704c000a71f27f34e05ace5cdfd58bb',
  'gDT1nz7Ie36ZhL-C': '1980ab3c35fa98a25b5f3b5e643fd852e14ca8a12a4a26b06aaf1abf2a8c68b1',
  'm9MxpY6IUGXtWp76': 'a906ebf17e43fded12b3d6bd077abb2df33bc86eff51c1beeb82e5d416527db3',
  'X6NceqF285Gr04gb': '4de75497fff3030168e8aa6dca23ffeb332b1bc8c25d0bf3507ceadac953ae9c',
  'YyKcxPG7iIgS3jsK': '3169d74b47a54d1eb15e4c243f56393abe9fe90c7e1c308ecf96ee67618b152a',
  'zUCxzrOrugTSis03': 'ff1d0735b8b45710462b1d1f846da040f970c6eb62c7c2f36dbfb8e5bde74f1e',
  'JOW0vchyswkQUMDS': 'cc9ac1107b0ffce282374a19beb7bfa95847724e6b7afbac991b4ae4277d5e6d',
  'dME3IWyZBvmh1n1q': '09ab315c7f4b72b4d71e66cb756184cedfb1f14d222d096e115bf95bfe7b29dc',
  'Zn7g6NxLqXlJb7Qi': 'baea0ea9506f3237a5ebfc61afb7c72dbd189c5603b199ef42fbb00dbda379e0',
  'gfP44RlHwr2kEwk7': 'bcc207a73b7885e45b49ab633d3377a10158292e3a7cef9cd6764ad107f1cb9b',
  'xPDpsV3F592srkjA': 'a09f615b0084980ebc4076d71550bf73ccd8d4df076bbbee4a9beb523a1379d9',
  'nOykTmcH9ydsGGIc': '2ff2db91e70648623df8d42c0dcd7c336b2f14cb4362d602a20f292a4d862154',
  'lX3LavMNdlIbgEHH': 'd3f9429205e5906dcd3c78edaf7c9d5148c7e389e34c82c86f72f154adb5d923',
  'dGyGDKo2osj7h3s7': '83900e020c14946426614c6553c5a138ba6277e1aaa69832223bd0f0f8b73893',
  'cXoIXJ2llS8S0WOW': 'a05944e4c69d61d10d66f689175ba0b081930df2d77b22f04d00ac40d3d69ecb',
  'GXaSqMEmOg12OIYb': 'bfa37bac98aefbb9de80f792c47d01a0f9e3b94e73776169040c249c8b722759',
  'xO8xQo3BrB8FuI6J': '63ab4b15427844a804480a1603774262e8903dee33cb279e2749860dbfaedd10',
  'cYtsRSxV5q9IMehn': 'b30fa847686ec1eb6be8c5bea4b6a5c5076ea66c3ff053cf98210a155d8aad1e',
  'gSgG5Tor0GPEnqzC': 'a83430cc022b85c83753f859f9e44f406651646dab994fced8ef7a9a88005971',
  'NIWoEurJHMJjyUTe': 'bc8a8fcb95bb4f32d2d4376aa69d81b186b3ba2f8e9b6cb6a403b2b194590e85',
  'y2eiKxtQo2B67deU': 'b3cea6789aeb58822af16ba08c4e5105d7febb840dcb67b47f426c19d1a8f209',
  'QXNr0SvkukLB4wPq': 'f390c09f5e279c0f2171995a534b92f5ca5c83443906879da68fc27445f89d89',
}

export type VoiceAccent = 'model' | 'us' | 'uk' | 'characters' | 'other'

export const VOICE_ACCENT_LABELS: Record<VoiceAccent, string> = {
  model: 'Model voice',
  us: 'American English',
  uk: 'British English',
  characters: 'Characters',
  other: 'Other English'
}

const ACCENT_ORDER: readonly VoiceAccent[] = ['model', 'us', 'uk', 'other', 'characters']

/** A voice the picker can offer (no hashes: those stay in main). */
export interface CatalogVoice {
  id: string
  name: string
  accent: VoiceAccent
  /** 'female' / 'male' / '' (character voices give none). */
  gender: string
  age: string
  description: string
}

/** A catalog voice main can fetch: where it is and what it must hash to. */
export interface CatalogVoiceFile extends CatalogVoice {
  /** Path under the model folder (voices/<id>.safetensors). */
  file: string
  url: string
  bytes: number
  sha256: string
}

export const MODEL_VOICE: CatalogVoice = { id: 'default', name: 'Default', accent: 'model', gender: '', age: '', description: 'The voice that ships with Phonon 31M.' }

function accentOf(locale: string): VoiceAccent {
  if (locale === 'en-us') return 'us'
  if (locale === 'en-gb') return 'uk'
  if (locale === 'characters') return 'characters'
  return 'other'
}

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/**
 * English voices from voices.jsonl, sorted by accent then name. A line that isn't JSON, isn't
 * English, has an odd id or file name, or (with `hashes`) has no known hash is skipped.
 */
export function parseVoiceCatalog(jsonl: string, options: { base: string; hashes: Readonly<Record<string, string>>; bytes?: number }): CatalogVoiceFile[] {
  const seen = new Set<string>()
  const voices: CatalogVoiceFile[] = []
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) continue
      raw = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const id = typeof raw.voice_id === 'string' ? raw.voice_id : ''
    if (!/^[\w-]{1,40}$/.test(id) || id === 'default' || seen.has(id)) continue
    if (raw.language !== 'en') continue
    if (raw.filename !== `voices/${id}.safetensors`) continue
    const sha256 = options.hashes[id]
    if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) continue
    seen.add(id)
    voices.push({
      id,
      name: text(raw.name, 60) || id,
      accent: accentOf(text(raw.locale, 20).toLowerCase()),
      gender: text(raw.gender, 20).toLowerCase(),
      age: text(raw.age, 30),
      description: text(raw.description, 300),
      file: `voices/${id}.safetensors`,
      url: `${options.base.replace(/\/+$/, '')}/voices/${id}.safetensors`,
      bytes: options.bytes ?? VOICE_FILE_BYTES,
      sha256
    })
  }
  return sortVoices(voices)
}

export function sortVoices<T extends CatalogVoice>(voices: T[]): T[] {
  return voices.sort((a, b) => ACCENT_ORDER.indexOf(a.accent) - ACCENT_ORDER.indexOf(b.accent) || a.name.localeCompare(b.name))
}

/** Just what the picker needs (renderers never see URLs or hashes). */
export function publicVoice(voice: CatalogVoice): CatalogVoice {
  return { id: voice.id, name: voice.name, accent: voice.accent, gender: voice.gender, age: voice.age, description: voice.description }
}

/** Search box: every word must appear in the name, accent, gender, age or description. */
export function filterVoices<T extends CatalogVoice>(voices: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...voices]
  return voices.filter((voice) => {
    const haystack = `${voice.name} ${VOICE_ACCENT_LABELS[voice.accent]} ${voice.accent} ${voice.gender} ${voice.age} ${voice.description}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Voices grouped for <optgroup>s, in accent order, empty groups dropped. */
export function groupVoices<T extends CatalogVoice>(voices: readonly T[]): Array<{ accent: VoiceAccent; label: string; voices: T[] }> {
  return ACCENT_ORDER.map((accent) => ({ accent, label: VOICE_ACCENT_LABELS[accent], voices: voices.filter((voice) => voice.accent === accent) })).filter((group) => group.voices.length > 0)
}

/** "Zoey · female, Adult". */
export function voiceSummary(voice: CatalogVoice): string {
  const detail = [voice.gender, voice.age].filter(Boolean).join(', ')
  return detail ? `${voice.name} · ${detail}` : voice.name
}

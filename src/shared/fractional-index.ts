/**
 * Fractional index keys: strings that sort in list order, so an item can be placed between two
 * others without renumbering its siblings. The bookmark tree and Spaces store their order this way
 * in surffish.db: moving one bookmark rewrites one row (and one change-log op), and two devices
 * that reorder different items merge cleanly.
 *
 * Keys use the base-62 digits below, compare with plain `<` (which matches SQLite's default BINARY
 * collation for ASCII), and never end in '0', so there is always room before any key.
 * After David Greenspan's "Implementing Fractional Indexing" (the variant without an integer part).
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/
/** Keys from another device or an old build longer than this are regenerated, not kept. */
const MAX_KEY_LENGTH = 256

export function isFractionalKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_KEY_LENGTH && VALID_KEY.test(value)
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n += 1
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA]! + midpoint(a.slice(1), null)
}

/** A key after `a` for appending: bump the first digit that isn't the last one (61 appends per character). */
function after(a: string): string {
  for (let index = 0; index < a.length; index += 1) {
    const digit = DIGITS.indexOf(a[index]!)
    if (digit < DIGITS.length - 1) return a.slice(0, index) + DIGITS[digit + 1]!
  }
  return `${a}V`
}

/** A key strictly between `a` and `b` (null = open end). Throws if `a >= b`. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isFractionalKey(a)) throw new Error(`Invalid fractional key: ${a}`)
  if (b !== null && !isFractionalKey(b)) throw new Error(`Invalid fractional key: ${b}`)
  if (a !== null && b !== null && a >= b) throw new Error(`${a} is not before ${b}`)
  if (a !== null && b === null) return after(a)
  return midpoint(a ?? '', b)
}

/** `count` keys between `a` and `b`, in order, split evenly so they stay short (bulk inserts, imports). */
export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  if (count <= 0) return []
  const middle = keyBetween(a, b)
  const leftCount = Math.floor((count - 1) / 2)
  return [...keysBetween(a, middle, leftCount), middle, ...keysBetween(middle, b, count - 1 - leftCount)]
}

/**
 * Positions for `order` (ids in list order) that reuse as many of the `previous` keys as possible.
 * The longest run of previous keys that is still in increasing order is kept; every other item
 * gets a new key between its kept neighbours. So moving or inserting one item changes one key,
 * and removing items changes none. If keys ever grow past the length limit (thousands of appends
 * to one folder), the whole list is respaced once.
 */
export function assignPositions(order: readonly string[], previous: ReadonlyMap<string, string>): Map<string, string> {
  const keys = order.map((id) => {
    const key = previous.get(id)
    return isFractionalKey(key) ? key : null
  })
  const keep = longestIncreasing(keys)
  const result = new Map<string, string>()
  let index = 0
  while (index < order.length) {
    if (keep.has(index)) {
      result.set(order[index]!, keys[index]!)
      index += 1
      continue
    }
    const start = index
    while (index < order.length && !keep.has(index)) index += 1
    const before = start > 0 ? result.get(order[start - 1]!)! : null
    const next = index < order.length ? keys[index]! : null
    const fresh = keysBetween(before, next, index - start)
    for (let offset = 0; offset < fresh.length; offset += 1) result.set(order[start + offset]!, fresh[offset]!)
  }
  if ([...result.values()].some((key) => key.length > MAX_KEY_LENGTH)) {
    const spaced = keysBetween(null, null, order.length)
    return new Map(order.map((id, position) => [id, spaced[position]!]))
  }
  return result
}

/** Indexes of a longest strictly increasing subsequence of the non-null keys (O(n log n)). */
function longestIncreasing(keys: ReadonlyArray<string | null>): Set<number> {
  const tails: number[] = []
  const parent = new Array<number>(keys.length).fill(-1)
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    if (key === null || key === undefined) continue
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (keys[tails[mid]!]! < key) low = mid + 1
      else high = mid
    }
    if (low > 0) parent[index] = tails[low - 1]!
    tails[low] = index
  }
  const kept = new Set<number>()
  let current = tails.length > 0 ? tails[tails.length - 1]! : -1
  while (current >= 0) {
    kept.add(current)
    current = parent[current]!
  }
  return kept
}

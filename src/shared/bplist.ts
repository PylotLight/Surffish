/**
 * Minimal binary property list ("bplist00") reader, enough for Safari's Bookmarks.plist:
 * dicts, arrays, sets, strings, numbers, booleans, dates (as JS ms), data (Uint8Array) and UIDs.
 * Bounded against malformed input: object references are checked and recursion is capped.
 */

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

const MAX_DEPTH = 256;
const MAC_EPOCH_MS = Date.UTC(2001, 0, 1);

export function isBinaryPlist(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 40 &&
    String.fromCharCode(...bytes.subarray(0, 6)) === "bplist"
  );
}

export function parseBinaryPlist(input: Uint8Array): PlistValue {
  if (!isBinaryPlist(input)) throw new Error("Not a binary property list.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const trailer = input.length - 32;
  const offsetSize = view.getUint8(trailer + 6);
  const refSize = view.getUint8(trailer + 7);
  const objectCount = readUint(view, trailer + 8, 8);
  const topObject = readUint(view, trailer + 16, 8);
  const offsetTable = readUint(view, trailer + 24, 8);
  if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8)
    throw new Error("Corrupt property list trailer.");
  if (
    objectCount < 1 ||
    topObject >= objectCount ||
    offsetTable + objectCount * offsetSize > trailer
  )
    throw new Error("Corrupt property list offsets.");

  const offsetOf = (ref: number): number => {
    if (ref < 0 || ref >= objectCount)
      throw new Error("Corrupt property list reference.");
    const offset = readUint(view, offsetTable + ref * offsetSize, offsetSize);
    if (offset < 8 || offset >= offsetTable)
      throw new Error("Corrupt property list object offset.");
    return offset;
  };

  const lengthAt = (
    offset: number,
    info: number,
  ): { length: number; start: number } => {
    if (info !== 0x0f) return { length: info, start: offset + 1 };
    const marker = view.getUint8(offset + 1);
    if (marker >> 4 !== 0x1) throw new Error("Corrupt property list length.");
    const bytes = 1 << (marker & 0x0f);
    return {
      length: readUint(view, offset + 2, bytes),
      start: offset + 2 + bytes,
    };
  };

  const parseObject = (ref: number, depth: number): PlistValue => {
    if (depth > MAX_DEPTH)
      throw new Error("Property list is nested too deeply.");
    const offset = offsetOf(ref);
    const marker = view.getUint8(offset);
    const type = marker >> 4;
    const info = marker & 0x0f;
    switch (type) {
      case 0x0:
        if (info === 0x08) return false;
        if (info === 0x09) return true;
        return null;
      case 0x1: {
        const bytes = 1 << info;
        if (bytes === 8) {
          const value = view.getBigInt64(offset + 1);
          return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
            value <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(value)
            : value;
        }
        if (bytes === 16) return view.getBigInt64(offset + 9);
        return readUint(view, offset + 1, bytes);
      }
      case 0x2:
        return info === 2
          ? view.getFloat32(offset + 1)
          : view.getFloat64(offset + 1);
      case 0x3:
        return new Date(MAC_EPOCH_MS + view.getFloat64(offset + 1) * 1000);
      case 0x4: {
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length, offsetTable);
        return input.slice(start, start + length);
      }
      case 0x5: {
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length, offsetTable);
        return new TextDecoder("latin1").decode(
          input.subarray(start, start + length),
        );
      }
      case 0x6: {
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length * 2, offsetTable);
        let text = "";
        for (let index = 0; index < length; index++)
          text += String.fromCharCode(view.getUint16(start + index * 2));
        return text;
      }
      case 0x7: {
        // UTF-8 string (newer plists).
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length, offsetTable);
        return new TextDecoder().decode(input.subarray(start, start + length));
      }
      case 0x8:
        return readUint(view, offset + 1, info + 1);
      case 0xa:
      case 0xc: {
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length * refSize, offsetTable);
        const items: PlistValue[] = [];
        for (let index = 0; index < length; index++)
          items.push(
            parseObject(
              readUint(view, start + index * refSize, refSize),
              depth + 1,
            ),
          );
        return items;
      }
      case 0xd: {
        const { length, start } = lengthAt(offset, info);
        checkRange(start, length * refSize * 2, offsetTable);
        const dict: { [key: string]: PlistValue } = Object.create(null) as {
          [key: string]: PlistValue;
        };
        for (let index = 0; index < length; index++) {
          const key = parseObject(
            readUint(view, start + index * refSize, refSize),
            depth + 1,
          );
          const value = parseObject(
            readUint(view, start + (length + index) * refSize, refSize),
            depth + 1,
          );
          if (typeof key === "string") dict[key] = value;
        }
        return dict;
      }
      default:
        throw new Error(
          `Unsupported property list object type 0x${type.toString(16)}.`,
        );
    }
  };

  return parseObject(topObject, 0);
}

function checkRange(start: number, length: number, end: number): void {
  if (length < 0 || start + length > end)
    throw new Error("Corrupt property list object length.");
}

function readUint(view: DataView, offset: number, bytes: number): number {
  if (offset + bytes > view.byteLength)
    throw new Error("Corrupt property list (read past end).");
  let value = 0;
  for (let index = 0; index < bytes; index++)
    value = value * 256 + view.getUint8(offset + index);
  return value;
}

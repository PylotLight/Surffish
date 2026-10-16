import { describe, expect, test } from 'bun:test'
import {
  clockGreeting, clockScaleFromLegacySize, clockShift, formatClockDate, formatClockTime, formatZoneDifference, isClockDateFormat, isClockTimeFormat, isClockWeight,
  relativeClockDay, usesTwelveHour, zoneDifferenceMinutes
} from './new-tab-clock'

// Friday 16 October 2026, 23:05:07 in Melbourne (AEDT, UTC+11).
const FIXED = new Date('2026-10-16T12:05:07Z')
const MEL = 'Australia/Melbourne'
const base = { timeZone: MEL, timeFormat: '24h' as const, showSeconds: false, showAmPm: true }

describe('formatClockTime', () => {
  test('24-hour keeps the leading zero, the original look', () => {
    expect(formatClockTime(FIXED, base, 'en-AU')).toBe('23:05')
    expect(formatClockTime(new Date('2026-10-15T22:05:07Z'), base, 'en-AU')).toBe('09:05')
    expect(formatClockTime(FIXED, { ...base, showSeconds: true }, 'en-AU')).toBe('23:05:07')
  })
  test('24-hour never shows 24:xx at midnight', () => {
    expect(formatClockTime(new Date('2026-10-16T13:00:00Z'), base, 'en-US')).toBe('00:00')
  })
  test('12-hour with and without AM/PM', () => {
    expect(formatClockTime(FIXED, { ...base, timeFormat: '12h' }, 'en-US')).toBe('11:05 PM')
    expect(formatClockTime(FIXED, { ...base, timeFormat: '12h', showSeconds: true }, 'en-US')).toBe('11:05:07 PM')
    expect(formatClockTime(FIXED, { ...base, timeFormat: '12h', showAmPm: false }, 'en-US')).toBe('11:05')
    expect(formatClockTime(new Date('2026-10-15T22:05:07Z'), { ...base, timeFormat: '12h', showAmPm: false }, 'en-US')).toBe('9:05')
    expect(formatClockTime(new Date('2026-10-16T13:00:00Z'), { ...base, timeFormat: '12h' }, 'en-US')).toBe('12:00 AM')
  })
  test('AM/PM can be dropped in a locale that leads with it', () => {
    const hidden = formatClockTime(FIXED, { ...base, timeFormat: '12h', showAmPm: false }, 'ko-KR')
    expect(hidden).toBe('11:05')
  })
  test('AM/PM setting is ignored on a 24-hour clock', () => {
    expect(formatClockTime(FIXED, { ...base, showAmPm: false }, 'en-US')).toBe('23:05')
  })
  test('auto follows the locale', () => {
    expect(usesTwelveHour('auto', 'en-US')).toBe(true)
    expect(usesTwelveHour('auto', 'de-DE')).toBe(false)
    expect(usesTwelveHour('24h', 'en-US')).toBe(false)
    expect(usesTwelveHour('12h', 'de-DE')).toBe(true)
    expect(formatClockTime(FIXED, { ...base, timeFormat: 'auto' }, 'en-US')).toBe('11:05 PM')
    expect(formatClockTime(FIXED, { ...base, timeFormat: 'auto' }, 'de-DE')).toBe('23:05')
  })
  test('other zones', () => {
    expect(formatClockTime(FIXED, { ...base, timeZone: 'Europe/London' }, 'en-GB')).toBe('13:05')
    expect(formatClockTime(FIXED, { ...base, timeZone: 'Pacific/Auckland' }, 'en-GB')).toBe('01:05')
  })
})

describe('formatClockDate', () => {
  test('each style', () => {
    expect(formatClockDate(FIXED, MEL, 'long', 'en-AU')).toBe('Friday 16 October')
    expect(formatClockDate(FIXED, MEL, 'short', 'en-AU')).toBe('Fri, 16 Oct')
    expect(formatClockDate(FIXED, MEL, 'numeric', 'en-AU')).toBe('16/10/2026')
    expect(formatClockDate(FIXED, MEL, 'numeric', 'en-US')).toBe('10/16/2026')
    expect(formatClockDate(FIXED, MEL, 'iso', 'en-US')).toBe('2026-10-16')
    expect(formatClockDate(FIXED, 'Pacific/Auckland', 'iso')).toBe('2026-10-17')
    expect(formatClockDate(FIXED, 'Pacific/Auckland', 'long', 'en-AU')).toBe('Saturday 17 October')
  })
})

describe('world clock difference and day', () => {
  test('hours ahead/behind the main clock, DST-aware', () => {
    expect(zoneDifferenceMinutes(FIXED, 'Pacific/Auckland', MEL)).toBe(120)
    expect(zoneDifferenceMinutes(FIXED, 'Europe/London', MEL)).toBe(-600)
    expect(zoneDifferenceMinutes(FIXED, 'Asia/Kolkata', MEL)).toBe(-330)
    expect(zoneDifferenceMinutes(FIXED, MEL, MEL)).toBe(0)
    // July: Melbourne on AEST (+10), London on BST (+1) → 9 h.
    expect(zoneDifferenceMinutes(new Date('2026-07-01T00:00:00Z'), 'Europe/London', MEL)).toBe(-540)
  })
  test('formats the difference', () => {
    expect(formatZoneDifference(120)).toBe('+2h')
    expect(formatZoneDifference(-600)).toBe('\u221210h')
    expect(formatZoneDifference(-330)).toBe('\u22125h 30m')
    expect(formatZoneDifference(45)).toBe('+45m')
    expect(formatZoneDifference(0)).toBe('Same time')
  })
  test('tomorrow / yesterday only when the day differs', () => {
    expect(relativeClockDay(FIXED, 'Pacific/Auckland', MEL)).toBe('Tomorrow')
    expect(relativeClockDay(FIXED, 'Europe/London', MEL)).toBeNull()
    expect(relativeClockDay(new Date('2026-10-15T14:30:00Z'), 'America/Los_Angeles', MEL)).toBe('Yesterday')
    // Across a month and year end.
    expect(relativeClockDay(new Date('2026-12-31T12:00:00Z'), 'Pacific/Kiritimati', 'UTC')).toBe('Tomorrow')
  })
})

describe('greeting and guards', () => {
  test('greeting by hour in the main zone', () => {
    expect(clockGreeting(FIXED, MEL)).toBe('Good evening')
    expect(clockGreeting(new Date('2026-10-15T22:05:00Z'), MEL)).toBe('Good morning')
    expect(clockGreeting(new Date('2026-10-16T03:00:00Z'), MEL)).toBe('Good afternoon')
    expect(clockGreeting(new Date('2026-10-16T17:30:00Z'), MEL)).toBe('Good evening')
  })
  test('type guards', () => {
    expect(isClockTimeFormat('12h')).toBe(true)
    expect(isClockTimeFormat('12')).toBe(false)
    expect(isClockDateFormat('iso')).toBe(true)
    expect(isClockWeight('bold')).toBe(true)
  })
  test('legacy S/M/L/XL sizes map onto the size slider (M = 100 %)', () => {
    expect(['s', 'm', 'l', 'xl'].map(clockScaleFromLegacySize)).toEqual([75, 100, 145, 220])
    expect(clockScaleFromLegacySize('xxl')).toBeNull()
    expect(clockScaleFromLegacySize('toString')).toBeNull()
    expect(clockScaleFromLegacySize(3)).toBeNull()
  })
  test('clock position: a share of the free space, never negative or past it', () => {
    expect(clockShift(0, 400)).toBe(0)
    expect(clockShift(50, 400)).toBe(200)
    expect(clockShift(100, 400)).toBe(400)
    expect(clockShift(150, 400)).toBe(400)
    expect(clockShift(100, -80)).toBe(0)
  })
})

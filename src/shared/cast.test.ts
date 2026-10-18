import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CAST_SETTINGS,
  castContentType,
  castPosition,
  castStatusFromPlayer,
  chooseCastMedia,
  formatCastTime,
  isCastableNetworkHit,
  isLoopbackMediaUrl,
  mergeCastDevices,
  parseCastSettings,
  type PageMediaElement,
  type PageMediaProbe
} from './cast'

const video = (patch: Partial<PageMediaElement> = {}): PageMediaElement => ({
  kind: 'video', src: 'https://cdn.example/movie.mp4', currentTime: 30, duration: 600, paused: false, width: 1280, height: 720, poster: '', visible: true, ...patch
})
const probe = (patch: Partial<PageMediaProbe> = {}): PageMediaProbe => ({ pageUrl: 'https://site.example/watch', title: 'A film', elements: [], network: [], ...patch })

describe('cast settings', () => {
  test('on by default; bad values keep the fallback', () => {
    expect(parseCastSettings(null)).toEqual(DEFAULT_CAST_SETTINGS)
    expect(parseCastSettings({ enabled: 'no' }).enabled).toBe(true)
    expect(parseCastSettings({ enabled: false }).enabled).toBe(false)
  })
})

describe('content types', () => {
  test('from the URL path, ignoring the query', () => {
    expect(castContentType('https://x/a/stream.m3u8?token=1')).toMatchObject({ contentType: 'application/x-mpegurl', manifest: true })
    expect(castContentType('https://x/manifest.mpd')?.contentType).toBe('application/dash+xml')
    expect(castContentType('https://x/v.webm')?.contentType).toBe('video/webm')
    expect(castContentType('https://x/song.mp3', 'audio')?.contentType).toBe('audio/mpeg')
    expect(castContentType('https://x/play?id=3')?.contentType).toBe('video/mp4')
    expect(castContentType('blob:https://x/uuid')).toBeNull()
    expect(castContentType('data:video/mp4;base64,AA')).toBeNull()
  })
  test('network recorder filter', () => {
    expect(isCastableNetworkHit('https://x/v.mp4', 'media')).toBe(true)
    expect(isCastableNetworkHit('https://x/master.m3u8', 'xhr')).toBe(true)
    expect(isCastableNetworkHit('https://x/api.json', 'xhr')).toBe(false)
    expect(isCastableNetworkHit('blob:https://x/1', 'media')).toBe(false)
  })
  test('loopback hosts', () => {
    expect(isLoopbackMediaUrl('http://127.0.0.1:8080/v.mp4')).toBe(true)
    expect(isLoopbackMediaUrl('http://localhost/v.mp4')).toBe(true)
    expect(isLoopbackMediaUrl('http://[::1]/v.mp4')).toBe(true)
    expect(isLoopbackMediaUrl('http://192.168.1.5/v.mp4')).toBe(false)
  })
})

describe('chooseCastMedia', () => {
  test('the playing, visible, biggest video wins', () => {
    const choice = chooseCastMedia(probe({ elements: [video({ src: 'https://cdn.example/ad.mp4', width: 300, height: 250, paused: true }), video()] }))
    expect(choice).toMatchObject({ castable: true, url: 'https://cdn.example/movie.mp4', contentType: 'video/mp4', startTime: 30, elementIndex: 1, title: 'A film', live: false })
  })
  test('MSE (blob:) players use a manifest the tab fetched, newest first', () => {
    const choice = chooseCastMedia(probe({
      elements: [video({ src: 'blob:https://site.example/1' })],
      network: [{ url: 'https://cdn.example/old.m3u8', resourceType: 'xhr' }, { url: 'https://cdn.example/master.m3u8', resourceType: 'xhr' }]
    }))
    expect(choice).toMatchObject({ castable: true, url: 'https://cdn.example/master.m3u8', contentType: 'application/x-mpegurl', elementIndex: 0 })
  })
  test('MSE without a manifest points at Mirror tab', () => {
    expect(chooseCastMedia(probe({ elements: [video({ src: 'blob:https://www.youtube.com/abc' })] }))).toMatchObject({ castable: false, reason: 'mse' })
  })
  test('live streams start at the live edge', () => {
    expect(chooseCastMedia(probe({ elements: [video({ src: 'https://x/live.m3u8', duration: null })] }))).toMatchObject({ castable: true, live: true })
  })
  test('loopback media is refused, posters must be web URLs', () => {
    expect(chooseCastMedia(probe({ elements: [video({ src: 'http://127.0.0.1:9000/v.mp4' })] }))).toMatchObject({ castable: false, reason: 'local-network' })
    expect(chooseCastMedia(probe({ elements: [video({ poster: 'data:image/png;base64,AA' })] }))).toMatchObject({ castable: true, posterUrl: null })
    expect(chooseCastMedia(probe({ elements: [video({ poster: 'https://x/p.jpg' })] }))).toMatchObject({ posterUrl: 'https://x/p.jpg' })
  })
  test('no elements: a media request the tab made, else nothing', () => {
    expect(chooseCastMedia(probe({ network: [{ url: 'https://x/a.mp3', resourceType: 'media' }] }))).toMatchObject({ castable: true, url: 'https://x/a.mp3', elementIndex: -1, startTime: 0 })
    expect(chooseCastMedia(probe())).toMatchObject({ castable: false, reason: 'none' })
  })
})

describe('session helpers', () => {
  test('position extrapolates only while playing, capped at the duration', () => {
    expect(castPosition({ currentTime: 10, updatedAt: 1_000, status: 'playing', duration: 600 }, 4_000)).toBe(13)
    expect(castPosition({ currentTime: 10, updatedAt: 1_000, status: 'paused', duration: 600 }, 4_000)).toBe(10)
    expect(castPosition({ currentTime: 599, updatedAt: 0, status: 'playing', duration: 600 }, 10_000)).toBe(600)
  })
  test('time format', () => {
    expect(formatCastTime(0)).toBe('0:00')
    expect(formatCastTime(75.9)).toBe('1:15')
    expect(formatCastTime(3_725)).toBe('1:02:05')
    expect(formatCastTime(Number.NaN)).toBe('0:00')
  })
  test('player states', () => {
    expect(castStatusFromPlayer('PLAYING', null)).toBe('playing')
    expect(castStatusFromPlayer('IDLE', 'FINISHED')).toBe('ended')
    expect(castStatusFromPlayer('IDLE', 'ERROR')).toBe('error')
    expect(castStatusFromPlayer('IDLE', null)).toBe('idle')
  })
  test('devices merge by id, sorted by name', () => {
    const a = { id: 'a', name: 'Kitchen', model: '', host: '1.1.1.1', port: 8009 }
    const b = { id: 'b', name: 'Bedroom', model: '', host: '1.1.1.2', port: 8009 }
    expect(mergeCastDevices([a], [b, { ...a, host: '1.1.1.9' }])).toEqual([b, { ...a, host: '1.1.1.9' }])
  })
})

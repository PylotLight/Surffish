# Read Aloud

Experimental, off by default: **Settings → Integrations → Read Aloud → Enable Read Aloud**. Surffish
reads the article on a page (Reader view's Readability extraction), a selection, or the page from a
point, out loud with [Phonon 31M](https://huggingface.co/gradium/phonon-31m-en) (Apache-2.0), an
on-device text-to-speech model running as WebAssembly inside Surffish. Text never leaves the
computer.

## Using it

| Where | What |
|---|---|
| Page right-click → **Read Aloud** | **Read Page**, **Read from Here** (from the clicked point, or the selection's start, to the end of the article), **Read Selection**; **Pause/Resume** and **Stop** while reading |
| Reader view | **Listen** button in its toolbar, the same submenu on right-click |
| Reading List row right-click → **Listen** | Opens the saved offline Reader copy (the live page when there is none) and reads it |
| ⇧⌘U (Ctrl+Shift+U) | Play / pause; reads the page when nothing is playing (View menu, only while Read Aloud is on) |
| ⌘K | Read Aloud, Read Selection Aloud, Pause/Resume, Stop |
| Toolbar | A player button appears while reading: play/pause, skip, stop, speed, voice |

The sentence being spoken is highlighted, in Reader view and on the live page. On the live page the
highlight uses the CSS Custom Highlight API from an isolated world: the page's DOM is never changed,
and a sentence that can't be matched to the page's text is simply not highlighted. The page scrolls
to an off-screen sentence unless it was scrolled by hand in the last few seconds.

Not yet: PDFs (the built-in viewer's text isn't reachable from the page), see follow-ups in the PR.

## Settings (one Voice section, doubling as a tester)

- **Engine**: Phonon (default), the system voices, or a local OpenAI-compatible `/v1/audio/speech`
  server (loopback addresses only, e.g. `ptts-openai-server`).
- **Voice**: Phonon's own voice plus the 37 English voices of
  [gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices) (pinned commit, each ~256 KB,
  hash-checked, downloaded when first picked). A **Recommended** group at the top (Harper, Everly,
  Preston, Bryony, Edwin, Hugh) helps choosing; search filters by name, accent, gender or description.
- **Speed** 0.75–3×: Phonon's `duration_delta` covers about 0.87–1.25×, the rest is a pitch-preserving
  WSOLA time stretch (no chipmunk voice at 2–3×).
- **Expressiveness** (temperature), **Vary each read** (a new seed per reading), **Read numbers, dates
  & times naturally** (Phonon's text rewrites).
- **Advanced**: device (**CPU** by default; WebGPU or Auto), CPU threads (**2** by default), the
  checkpoint's other conditioners.
- **Play** speaks the sample with these settings and shows load time, time to first audio, real-time
  factor, device and threads.

## Downloads and memory

Turning it on downloads the official `phonon-tts` npm package and the q8 model (~71 MB) into
`<profile>/read-aloud`, pinned and checked against sha256/sha512 hashes, never bundled. Turning it off
keeps the files until **Delete download**.

Phonon runs in a hidden, never-shown window on its own in-memory session (custom
`surffish-tts://` scheme, cross-origin isolated for wasm threads, no network but its own files). It
opens on the first reading or voice test and **closes 3 minutes after the last one**, which frees
the model (about 400 MB resident for the engine's renderer process in the Linux smoke with the real
model); the next reading reopens it transparently (about 1 s to load). While it runs, generation
stays at most 1–3 sentences and 12 s of audio ahead, nothing ticks while paused, and when a reading
ends the AudioContext is closed and the Media Session released.

Launch cost: with the feature off, main only parses a small gate (`read-aloud-feature.ts`,
`shared/read-aloud-gate.ts`); settings/IPC (`read-aloud-settings.ts`), playback and downloads
(`read-aloud.ts`), the toolbar control and the Settings tab are all lazy chunks.

## Debugging

`SURFFISH_DEBUG_READ_ALOUD=1` (or a dev build) logs one `[read aloud] phonon {…}` line per reading
with load time, first audio, threads and device.

Smoke: `bun run build && bun run test:electron-read-aloud` (fixtures);
`READ_ALOUD_SMOKE_PHONON=1` downloads the real model and checks real speech.

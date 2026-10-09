// Dev runner wrapper: `bun run dev`.
// Spawns electron-vite as a child and owns shutdown. Why the wrapper?
// Electron/Chromium probes terminal capabilities on startup (device attributes,
// cursor position, background color). The terminal answers by injecting reply
// bytes (e.g. `^[[?62;22c`, `^[[9;1R`, `^[[11;rgb:...`) into stdin. Those bytes
// sit in the pty input queue, and after ^C the shell reads them as keystrokes
// — the garbage prompt in your terminal. On child exit we therefore drain any
// pending stdin bytes before returning the terminal to the shell.
//
// Run with: bun scripts/dev.ts [-- ...electron-vite args]
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin =
  process.platform === 'win32'
    ? join(root, 'node_modules', '.bin', 'electron-vite.cmd')
    : join(root, 'node_modules', '.bin', 'electron-vite')

const child: ChildProcess = spawn(bin, ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32'
})

child.on('error', (err) => {
  console.error(`[dev] failed to start electron-vite: ${err.message}`)
  process.exit(1)
})

let shuttingDown = false
function forward(signal: NodeJS.Signals): void {
  if (shuttingDown) return
  shuttingDown = true
  // The child likely received the signal from the terminal too; kill() is a no-op then.
  try {
    child.kill(signal)
  } catch {
    // ignore — child already gone
  }
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))

/** Discard leftover terminal-reply bytes queued in stdin. No-op without a TTY. */
async function drainStdin(): Promise<void> {
  const { stdin } = process
  if (!stdin.isTTY) return
  await new Promise<void>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      stdin.removeListener('data', swallow)
      stdin.pause()
      try {
        stdin.setRawMode(false)
      } catch {
        // ignore — already restored
      }
      resolve()
    }
    const swallow = (): void => {
      // More bytes arrived — give stragglers a short grace window, then stop.
      clearTimeout(timer)
      timer = setTimeout(finish, 80)
    }
    timer = setTimeout(finish, 250)
    try {
      // Raw mode so escape bytes can't trigger signals while we discard them.
      stdin.setRawMode(true)
    } catch {
      // ignore — drain in cooked mode instead
    }
    stdin.resume()
    stdin.on('data', swallow)
  })
}

child.on('exit', (code) => {
  void drainStdin().then(() => {
    // Leave the cursor visible and attributes reset for the next prompt.
    process.stdout.write('\x1b[?25h\x1b[0m')
    process.exit(code ?? 0)
  })
})

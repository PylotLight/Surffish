import { connect, type TLSSocket } from "node:tls";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  CastFrameReader,
  NS_CONNECTION,
  NS_HEARTBEAT,
  NS_RECEIVER,
  PLATFORM_RECEIVER_ID,
  frameCastMessage,
  parseCastJson,
  parseReceiverStatus,
  type CastApplication,
  type CastMessage,
  type CastReceiverStatus,
} from "../shared/cast-protocol";

/**
 * One CASTV2 connection to a Chromecast: TLS to port 8009 (the device's certificate is self-signed
 * by Google's device CA; Surffish doesn't do Cast device authentication, so it isn't checked, like
 * every non-Chrome sender), virtual connections per destination, a 5 s PING heartbeat, and JSON
 * requests matched to replies by requestId.
 *
 * Events: 'message' (CastMessage, json | null), 'receiver-status' (CastReceiverStatus), 'close'
 * (reason string). Pure transport; src/main/cast.ts drives the apps.
 */

const HEARTBEAT_MS = 5_000;
/** No PONG (or anything) for this long and the device is gone. */
const DEAD_MS = 16_000;
const CONNECT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CastClient extends EventEmitter {
  readonly senderId = `sender-surffish-${randomBytes(4).toString("hex")}`;
  private socket: TLSSocket | null = null;
  private reader = new CastFrameReader();
  private readonly connected = new Set<string>();
  private readonly pending = new Map<number, Pending>();
  private requestId = Math.floor(Math.random() * 1_000) + 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private closed = false;

  constructor(
    readonly host: string,
    readonly port: number,
  ) {
    super();
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({
        host: this.host,
        port: this.port,
        rejectUnauthorized: false,
        timeout: CONNECT_TIMEOUT_MS,
      });
      this.socket = socket;
      let settled = false;
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.close(error.message);
      };
      socket.once("secureConnect", () => {
        settled = true;
        socket.setTimeout(0);
        socket.setNoDelay(true);
        this.lastHeard = Date.now();
        this.connect(PLATFORM_RECEIVER_ID);
        this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
        this.heartbeat.unref?.();
        resolve();
      });
      socket.once("timeout", () =>
        fail(new Error(`Couldn’t reach the Chromecast at ${this.host}`)),
      );
      socket.on("error", (error) => fail(error));
      socket.on("close", () => this.close("connection closed"));
      socket.on("data", (chunk: Buffer) => this.onData(chunk));
    });
  }

  get isOpen(): boolean {
    return this.socket !== null && !this.closed;
  }

  private beat(): void {
    if (Date.now() - this.lastHeard > DEAD_MS) {
      this.close("the Chromecast stopped answering");
      return;
    }
    this.send(PLATFORM_RECEIVER_ID, NS_HEARTBEAT, { type: "PING" });
  }

  private onData(chunk: Buffer): void {
    let messages: CastMessage[];
    try {
      messages = this.reader.push(chunk);
    } catch (error) {
      this.close(error instanceof Error ? error.message : String(error));
      return;
    }
    for (const message of messages) {
      this.lastHeard = Date.now();
      if (
        message.destinationId !== this.senderId &&
        message.destinationId !== "*"
      )
        continue;
      const json = parseCastJson(message);
      if (message.namespace === NS_HEARTBEAT) {
        if (json?.type === "PING")
          this.send(message.sourceId, NS_HEARTBEAT, { type: "PONG" });
        continue;
      }
      if (message.namespace === NS_CONNECTION && json?.type === "CLOSE") {
        this.connected.delete(message.sourceId);
        this.emit("connection-closed", message.sourceId);
        continue;
      }
      const id = typeof json?.requestId === "number" ? json.requestId : null;
      if (id !== null && id !== 0) {
        const waiting = this.pending.get(id);
        if (waiting) {
          this.pending.delete(id);
          clearTimeout(waiting.timer);
          waiting.resolve(json!);
        }
      }
      if (message.namespace === NS_RECEIVER && json) {
        const status = parseReceiverStatus(json);
        if (status) this.emit("receiver-status", status);
      }
      this.emit("message", message, json);
    }
  }

  /** Opens the virtual connection to `destination` (receiver-0 or an app's transportId). */
  connect(destination: string): void {
    if (this.connected.has(destination)) return;
    this.connected.add(destination);
    this.send(destination, NS_CONNECTION, {
      type: "CONNECT",
      userAgent: "Surffish",
      connType: 0,
      origin: {},
      senderInfo: {
        sdkType: 2,
        version: "1.0",
        browserVersion: process.versions.chrome ?? "",
        platform: 4,
        connectionType: 1,
      },
    });
  }

  send(
    destination: string,
    namespace: string,
    payload: Record<string, unknown>,
  ): void {
    const socket = this.socket;
    if (!socket || this.closed) return;
    socket.write(
      frameCastMessage({
        sourceId: this.senderId,
        destinationId: destination,
        namespace,
        data: JSON.stringify(payload),
      }),
    );
  }

  /** Sends with a fresh requestId and resolves with the reply that carries it. */
  request(
    destination: string,
    namespace: string,
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (!this.isOpen)
      return Promise.reject(new Error("Not connected to the Chromecast"));
    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `The Chromecast didn’t answer ${String(payload.type ?? "the request")}`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send(destination, namespace, { ...payload, requestId: id });
    });
  }

  async receiverStatus(): Promise<CastReceiverStatus> {
    const reply = await this.request(PLATFORM_RECEIVER_ID, NS_RECEIVER, {
      type: "GET_STATUS",
    });
    const status = parseReceiverStatus(reply);
    if (!status) throw new Error("Unexpected receiver reply");
    return status;
  }

  /**
   * LAUNCH `appId` (or reuse it when it already runs) and connect to it. The device replies with a
   * RECEIVER_STATUS listing the app's transportId once it has started.
   */
  async launch(appId: string): Promise<CastApplication> {
    const reply = await this.request(
      PLATFORM_RECEIVER_ID,
      NS_RECEIVER,
      { type: "LAUNCH", appId, language: "en-US", supportedAppTypes: ["WEB"] },
      20_000,
    );
    if (reply.type === "LAUNCH_ERROR")
      throw new Error(
        `The Chromecast couldn’t start the player (${String(reply.reason ?? "launch error")})`,
      );
    let app = parseReceiverStatus(reply)?.applications.find(
      (candidate) => candidate.appId === appId,
    );
    // Some firmware answers LAUNCH before the app has a transport; ask until it does.
    for (let attempt = 0; !app?.transportId && attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      app = (await this.receiverStatus()).applications.find(
        (candidate) => candidate.appId === appId,
      );
    }
    if (!app?.transportId)
      throw new Error("The Chromecast didn’t start the player");
    this.connect(app.transportId);
    return app;
  }

  stopApp(sessionId: string): void {
    this.send(PLATFORM_RECEIVER_ID, NS_RECEIVER, {
      type: "STOP",
      sessionId,
      requestId: this.requestId++,
    });
  }

  setVolume(volume: { level?: number; muted?: boolean }): void {
    this.send(PLATFORM_RECEIVER_ID, NS_RECEIVER, {
      type: "SET_VOLUME",
      volume,
      requestId: this.requestId++,
    });
  }

  close(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(reason));
      this.pending.delete(id);
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      for (const destination of this.connected) {
        try {
          socket.write(
            frameCastMessage({
              sourceId: this.senderId,
              destinationId: destination,
              namespace: NS_CONNECTION,
              data: JSON.stringify({ type: "CLOSE" }),
            }),
          );
        } catch {
          /* closing anyway */
        }
      }
      socket.end();
      setTimeout(() => socket.destroy(), 500).unref?.();
    }
    this.connected.clear();
    this.emit("close", reason);
  }
}

import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";

export const DISCORD_CLIENT_ID = "1551493388745048126";

const HANDSHAKE_OP = 0;
const FRAME_OP = 1;
const CLOSE_OP = 2;
const PING_OP = 3;
const PONG_OP = 4;

export interface DiscordActivityInput {
  details?: string;
  state?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

export function getIpcPath(index: number): string {
  if (process.platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }
  const prefix =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    "/tmp";
  return path.join(prefix, `discord-ipc-${index}`);
}

export function makeNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildFrame(op: number, payload: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(payload), "utf-8");
  const frame = Buffer.alloc(8 + data.length);
  frame.writeUInt32LE(op, 0);
  frame.writeUInt32LE(data.length, 4);
  data.copy(frame, 8);
  return frame;
}

export function buildActivity(activity: DiscordActivityInput) {
  const rich: Record<string, unknown> = {
    type: 2,
    instance: true,
  };
  if (activity.details) rich.details = activity.details;
  if (activity.state) rich.state = activity.state;
  if (activity.startTimestamp || activity.endTimestamp) {
    rich.timestamps = {
      ...(activity.startTimestamp ? { start: activity.startTimestamp } : {}),
      ...(activity.endTimestamp ? { end: activity.endTimestamp } : {}),
    };
  }
  if (activity.largeImage) {
    rich.assets = {
      large_image: activity.largeImage,
      ...(activity.largeText ? { large_text: activity.largeText } : {}),
      ...(activity.smallImage ? { small_image: activity.smallImage } : {}),
      ...(activity.smallText ? { small_text: activity.smallText } : {}),
    };
  }
  if (activity.buttonLabel && activity.buttonUrl) {
    rich.buttons = [{ label: activity.buttonLabel, url: activity.buttonUrl }];
  }
  return rich;
}

export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private readBuffer = Buffer.alloc(0);
  private lastActivity: DiscordActivityInput | null = null;
  private pipeIndex = 0;

  setActivity(activity: DiscordActivityInput): void {
    this.lastActivity = activity;
    if (this.socket && !this.socket.destroyed) {
      this.sendActivity(activity);
      return;
    }
    this.connect();
  }

  clearActivity(): void {
    this.lastActivity = null;
    if (this.socket && !this.socket.destroyed) {
      const payload = {
        cmd: "SET_ACTIVITY",
        args: {
          pid: process.pid,
          activity: buildActivity({}),
        },
        nonce: makeNonce(),
      };
      try {
        this.socket.write(buildFrame(FRAME_OP, payload));
      } catch {}
    } else {
      this.disconnect();
    }
  }

  private connect(): void {
    const currentIndex = this.pipeIndex;
    const ipcPath = getIpcPath(currentIndex);
    this.pipeIndex = (currentIndex + 1) % 10;

    const socket = net.connect({ path: ipcPath as never }, () => {
      socket.write(
        buildFrame(HANDSHAKE_OP, {
          v: 1,
          client_id: DISCORD_CLIENT_ID,
        }),
      );
    });

    this.socket = socket;
    this.readBuffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.processFrames(socket);
    });

    socket.on("error", () => {
      this.disconnect();
    });

    socket.on("close", () => {
      this.disconnect();
    });
  }

  private processFrames(socket: net.Socket): void {
    while (this.readBuffer.length >= 8) {
      const op = this.readBuffer.readUInt32LE(0);
      const len = this.readBuffer.readUInt32LE(4);
      if (this.readBuffer.length < 8 + len) break;
      const raw = this.readBuffer.subarray(8, 8 + len).toString("utf-8");
      this.readBuffer = this.readBuffer.subarray(8 + len);

      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {}

      if (op === FRAME_OP && payload) {
        this.handleFrame(socket, payload);
      }
    }
  }

  private handleFrame(socket: net.Socket, payload: Record<string, unknown>): void {
    const cmd = payload["cmd"];
    if (cmd === "PING") {
      try {
        socket.write(buildFrame(PONG_OP, { cmd: "PONG", data: payload["data"] ?? null }));
      } catch {}
      return;
    }
    if (cmd === "DISPATCH") {
      this.sendActivity(this.lastActivity ?? {});
      return;
    }
  }

  private sendActivity(activity: DiscordActivityInput): void {
    if (!this.socket || this.socket.destroyed) return;
    const payload = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: buildActivity(activity),
      },
      nonce: makeNonce(),
    };
    try {
      this.socket.write(buildFrame(FRAME_OP, payload));
    } catch {}
  }

  private disconnect(): void {
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      try {
        sock.destroy();
      } catch {}
    }
    this.readBuffer = Buffer.alloc(0);
  }
}

export const discordRpcClient = new DiscordRpcClient();
// The few parts of the `ws` package (present through the dev tooling) the fake relay uses.
declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket {
    readonly readyState: number;
    send(data: string | Uint8Array): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(ev: 'message', fn: (data: Buffer, isBinary: boolean) => void): this;
    on(ev: 'close', fn: (code: number, reason: Buffer) => void): this;
    on(ev: 'error', fn: (error: Error) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer: true; maxPayload?: number });
    readonly clients: Set<WebSocket>;
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, done: (ws: WebSocket) => void): void;
    close(): void;
  }
}

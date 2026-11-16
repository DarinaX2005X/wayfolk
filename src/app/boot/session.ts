/**
 * The rule for entering an immersive session, kept apart from IWSDK so that it can be
 * tested without a browser: which session to ask for, what to fall back to, and which
 * scene mode the answer means (PLAN "Режимы Void и Room").
 *
 *   enter('void' | 'room')   immersive-ar, no required features -> the asked mode
 *                            else immersive-vr -> 'void' (Room needs passthrough)
 *                            else stays 'desk' and rejects with 'xr-unavailable'
 *   setMode('void' | 'room') inside a session switches the look without leaving it;
 *                            in a VR session Room is not possible and the mode stays 'void'
 *
 * Optional features (plane detection, anchors) stay in the request; a person who says no
 * to the system question about room data loses nothing but the planes.
 */

export type XRSessionKind = 'immersive-ar' | 'immersive-vr';
export type SceneMode = 'desk' | 'void' | 'room';
export type ImmersiveMode = Exclude<SceneMode, 'desk'>;

export const XR_UNAVAILABLE = 'xr-unavailable';

/** Thrown (as a rejection) by enter when no immersive session could be started. */
export class XRUnavailableError extends Error {
  readonly code = XR_UNAVAILABLE;
  constructor() {
    super(XR_UNAVAILABLE);
    this.name = 'XRUnavailableError';
  }
}

export type SessionPort = {
  /** The kind of the session that is running now, or null. */
  active(): XRSessionKind | null;
  /** Whether the browser reports this kind as supported. Must not throw. */
  supported(kind: XRSessionKind): Promise<boolean>;
  /** Asks for a session. Resolves true once it is running, false when refused. Must not throw. */
  request(kind: XRSessionKind): Promise<boolean>;
  /** Ends the running session, if any. */
  end(): void;
  /** Called with the scene mode whenever it changes. */
  setMode(mode: SceneMode): void;
};

/** Scene mode for a running session that someone asked to see as `wanted`. */
export function modeFor(kind: XRSessionKind, wanted: ImmersiveMode): ImmersiveMode {
  // Passthrough exists only in AR. A VR session is always the Void.
  return kind === 'immersive-ar' ? wanted : 'void';
}

export type SessionFlow = {
  enter(mode?: ImmersiveMode): Promise<void>;
  /** Changes the look inside a running session; returns the mode it ended up in. */
  setMode(mode: ImmersiveMode): ImmersiveMode | 'desk';
  exit(): void;
  /** The mode the person last asked for; a session started from outside uses it too. */
  wanted(): ImmersiveMode;
  /** Whether Room is possible in the running session. */
  roomPossible(): boolean;
  /** To be called when a session starts, whoever started it. */
  started(kind: XRSessionKind): void;
  /** To be called when the session ends, whoever ended it. */
  ended(): void;
};

export function createSessionFlow(port: SessionPort): SessionFlow {
  let wanted: ImmersiveMode = 'void';
  let entering: Promise<void> | null = null;

  const started = (kind: XRSessionKind): void => {
    port.setMode(modeFor(kind, wanted));
  };

  const run = async (): Promise<void> => {
    const running = port.active();
    if (running) {
      // Already inside: only the look can change.
      started(running);
      return;
    }
    for (const kind of ['immersive-ar', 'immersive-vr'] as const) {
      if (!(await port.supported(kind))) continue;
      if (await port.request(kind)) {
        started(kind);
        return;
      }
    }
    port.setMode('desk');
    throw new XRUnavailableError();
  };

  return {
    enter(mode: ImmersiveMode = 'void'): Promise<void> {
      wanted = mode;
      // Two calls in a row share one request: a second prompt would cancel the first.
      entering ??= run().finally(() => {
        entering = null;
      });
      return entering;
    },
    setMode(mode) {
      wanted = mode;
      const running = port.active();
      if (!running) return 'desk';
      const next = modeFor(running, mode);
      port.setMode(next);
      return next;
    },
    exit(): void {
      port.end();
    },
    wanted: () => wanted,
    roomPossible: () => port.active() === 'immersive-ar',
    started,
    ended(): void {
      port.setMode('desk');
    },
  };
}

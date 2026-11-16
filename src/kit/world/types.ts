/**
 * Public shapes of the world kit (PLAN "Набор ремесла"). Every view object has a `root`
 * to hang into the seated frame and an `update(t)` the kit system calls every frame with
 * kit time: the picture is a function of what was recorded and of `t`.
 */
import type { Object3D, Vector3 } from '@iwsdk/core';
import type { AgentRole, CheckedItem, EnvelopeSpec, ObjectSpec, Plot, Station } from '../../agents/types';
import type { BenchItem } from '../../tokens/tokens';
import type { Grabbable } from './grabbable';

export type { Grabbable } from './grabbable';
export type { Sky } from './sky';
export type { LightRig } from './light';

export type Updates = { update(t: number): void };

export type BenchKey = { id: string; label: string; at: 'far-left' | 'far-right'; onSelect?: () => void };
export type Bench = Updates & {
  root: Object3D;
  /** Place of a bench object in the seated frame (top of the slab under it). */
  slot(name: BenchItem): Vector3;
  /** 'side' moves the voice stone, the mode cap and the settings tile to a column at the right edge. */
  setService(mode: 'default' | 'side'): void;
  readonly service: 'default' | 'side';
  /** Puts an object at its slot and keeps it there (it follows setService). */
  attach(name: BenchItem, obj: Object3D): void;
  /** A bone key 9 × 4.4 cm in a far corner; `userData.onSelect` carries the handler. */
  addKey(key: BenchKey): Object3D;
  removeKey(id: string): void;
  key(id: string): Object3D | null;
};

export type EnvelopeState = 'rest' | 'held' | 'open';
export type Envelope = Grabbable &
  Updates & {
    root: Object3D;
    spec: EnvelopeSpec;
    setState(state: EnvelopeState): void;
    readonly state: EnvelopeState;
  };

export type InboxBlock = Updates & {
  root: Object3D;
  setPin(up: boolean): void;
  readonly pinUp: boolean;
  offer(envelopes: EnvelopeSpec[]): void;
  /** Fans the envelopes out of the slot (the block was selected). */
  setFan(on: boolean): void;
  /** Takes an envelope out: its handle stays where it is in the world, the caller moves it. */
  take(id: string): Envelope | null;
  putBack(id: string): void;
  envelope(id: string): Envelope | null;
  envelopes(): Envelope[];
};

export type ModeSwitch = Updates & { root: Object3D; setMode(mode: 'void' | 'room'): void; readonly mode: 'void' | 'room' };
export type VoiceStoneState = 'idle' | 'listening' | 'thinking' | 'dim';
export type VoiceStone = Updates & { root: Object3D; setState(state: VoiceStoneState, level?: number): void; readonly state: VoiceStoneState; nudge(): void };

export type SlipMark = 'stamp' | 'second-stamp' | 'check' | 'hole' | 'corner';
export type Slip = Grabbable &
  Updates & {
    root: Object3D;
    item: CheckedItem;
    /** 0 folded in the tray, 1 open sheet 18 × 16 cm. */
    setOpen(k: number): void;
    readonly open: number;
    /** Opens (220 ms) or folds (160 ms) by itself: the reveal of 01.3 calls this. */
    unfold(on: boolean): void;
    mark(mark: SlipMark): void;
    readonly marks: ReadonlySet<SlipMark>;
    /** Large text: the open sheet grows down to 18 × 22 cm. */
    setLarge(on: boolean): void;
    /** Centre of the open face where the SlipSheet panel (01.3) goes, facing +z of the sheet. */
    sheet: Object3D;
    /** The two caption lines of the folded slip. */
    caption: [string, string];
  };

export type Tray = Updates & {
  root: Object3D;
  kind: 'sent-back' | 'fool';
  add(slip: Slip): void;
  remove(slip: Slip): void;
  readonly count: number;
  slips(): Slip[];
  /** Only the fool tray: its own stamp head comes down on the slip. */
  stamp(slip: Slip): void;
};

export type StationState = 'pending' | 'active' | 'waiting' | 'asking' | 'error' | 'done';
export type PathView = Updates & {
  root: Object3D;
  setPlan(stations: Station[], opts?: { radius?: number; from?: number; to?: number; start?: Vector3 }): void;
  /** Sets the state of a station; returns the point where its board hangs (bottom of the board, top of the rod). */
  setStation(id: string, state: StationState, progress?: number): Vector3;
  retract(): void;
  parking(i: number): Vector3;
  spot(stationId: string, i: number): Vector3;
  lane(angleDeg: number): Vector3;
  /** Azimuth of a station in degrees. */
  angle(stationId: string): number;
  /** Top of a station's stake. */
  stake(stationId: string): Vector3;
  stations(): Station[];
};

export type MechanismKind = 'cutter' | 'gate' | 'assembly' | 'solver' | 'scale';
export type MechanismPulse = 'cut' | 'pass' | 'stamp' | 'lay' | 'count' | 'weigh';
export type Mechanism = Updates & {
  root: Object3D;
  kind: MechanismKind;
  pulse(p: MechanismPulse): void;
  setState(state: 'idle' | 'busy' | 'error'): void;
  readonly state: 'idle' | 'busy' | 'error';
};

export type PairVerdict = 'contradiction' | 'explained' | 'unsure' | 'unjudged';
export type PairTags = Updates & {
  root: Object3D;
  set(pairs: { key: string }[]): void;
  mark(key: string, verdict: PairVerdict): void;
  /** Sends the contradiction tags off to the project object; returns their keys. */
  release(): string[];
  /** Where the pair lies (for the ask card and the thread). */
  point(key: string): Vector3 | null;
};

export type CarryKind = 'page' | 'cards' | 'spool' | 'slips' | 'pencil';
export type Instrument = {
  readonly id: number;
  readonly role: AgentRole;
  readonly callId: string | null;
  /** Walks there along the shelf; returns the time it takes in ms. */
  moveTo(point: Vector3): number;
  carry(kind: CarryKind | null, label?: string): void;
  work(on: boolean): void;
  sit(on: boolean): void;
  hop(): void;
  fail(): void;
  fold(): void;
  /** The ring burns while a call is open: null puts it out (the answer came). */
  setCall(callId: string | null): void;
  /** What the lens looks at (null: along the way). */
  face(point: Vector3 | null): void;
  /** Under the person's pointer the lens turns to the person. */
  hover(on: boolean): void;
  /** Where it stands now (seated frame). */
  position(target?: Vector3): Vector3;
  readonly state: 'folded' | 'standing' | 'moving' | 'working' | 'sitting' | 'failed' | 'waiting';
};
export type InstrumentPool = Updates & {
  root: Object3D;
  spawn(role: AgentRole, callId?: string): Instrument;
  byCall(callId: string): Instrument | null;
  all(): Instrument[];
  /** How many rings burn now: equal to the open calls. */
  lit(): number;
};

export type SectorState = 'outline' | 'laying' | 'closed' | 'bordered' | 'stale';
export type SectorView = Updates & {
  root: Object3D;
  readonly slot: number;
  readonly seed: number;
  setOutline(on: boolean): void;
  setGrid(planned: number): void;
  layTile(i: number): void;
  layRow(from: number, to: number): void;
  close(n: number): void;
  addCourse(n: number): void;
  clear(ms?: number): void;
  setState(state: SectorState): void;
  readonly state: SectorState;
  /** Tile number of a hit (instance id, face index or point). Units: tile j covers units j·perTile… */
  tileIndexAt(hit: { point?: Vector3; faceIndex?: number | null; instanceId?: number; object?: Object3D }): number;
  tilePosition(i: number, target?: Vector3): Vector3;
  readonly perTile: number;
  readonly tiles: number;
  readonly grid: { rows: number; cols: number };
};

export type ObjectState = 'growing' | 'ready' | 'selected' | 'stale';
export type ObjectFlag = 'pages' | 'deadline' | 'guest' | 'question' | 'none';
export type ProjectObject = Updates & {
  root: Object3D;
  spec: ObjectSpec;
  setState(state: ObjectState, on?: boolean): void;
  setFlag(flag: ObjectFlag | 'stale', urgent?: boolean): void;
  setButtons(buttons: { id: string; label: string }[]): void;
  /** Four points at the base for bone buttons. */
  buttonPoints(): Vector3[];
  /** The paper tag of the work sheet, 6 × 9 cm. */
  tag: Object3D;
  readonly height: number;
};

export type IslandView = Updates & {
  root: Object3D;
  setPlots(plots: Plot[]): void;
  rotateTo(deg: number, ms?: number): void;
  readonly rotation: number;
  sector(slot: number): SectorView | null;
  object(slot: number): ProjectObject | null;
};

export type FanEssay = { id: string; initials: string; total: number; max: number; review: boolean; similar: boolean; name?: string; tooShort?: boolean };
export type NotebookFan = Updates & {
  root: Object3D;
  raise(ids: string[], on: boolean): void;
  reorder(ids: string[]): void;
  open(id: string | null): void;
  hover(id: string | null): void;
  notebook(id: string): Object3D | null;
};

export type ThreadState = 'open' | 'taut' | 'kept' | 'dismissed' | 'resolved' | 'reopened' | 'added' | 'new';
export type ThreadView = Updates & {
  root: Object3D;
  set(o: { a: Vector3; b: Vector3; label: string; state: ThreadState; note?: string }): void;
  readonly state: ThreadState;
  bead: Object3D;
  setPull(k: number): void;
};

export type Gesture = 'carry' | 'pull' | 'pinch' | 'lift';
export type GhostHand = Updates & { root: Object3D; show(gesture: Gesture, from: Vector3, to?: Vector3): void; hide(): void };

export type { BenchItem };

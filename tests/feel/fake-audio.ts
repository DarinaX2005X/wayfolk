/**
 * A stand-in for Web Audio in Node: enough of AudioContext to check what the engine
 * asks of it (which buffers start, when, at what rate and gain, how many at once).
 * It makes no sound; the samples themselves are measured in the palette tests.
 */

export class FakeParam {
  events: { kind: string; value: number; time: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number): this {
    this.events.push({ kind: 'target', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'ramp', value, time });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
  /** The value the last scheduled event at or before `time` leads to. */
  heading(time: number): number {
    let v = this.value;
    for (const e of this.events) if (e.time <= time) v = e.value;
    return v;
  }
}

export class FakeNode {
  outputs: FakeNode[] = [];
  connected = true;
  constructor(readonly kind: string) {}
  connect(to: FakeNode): FakeNode {
    this.outputs.push(to);
    return to;
  }
  disconnect(): void {
    this.outputs = [];
    this.connected = false;
  }
}

export class FakeBuffer {
  readonly data: Float32Array;
  readonly duration: number;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
    this.duration = length / sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  ended = false;
  constructor(private readonly ctx: FakeContext) {
    super('source');
  }
  start(when = 0, offset = 0): void {
    this.startedAt = Math.max(when, this.ctx.currentTime);
    this.offset = offset;
    this.ctx.started.push(this);
  }
  stop(when = 0): void {
    this.stoppedAt = Math.max(when, this.ctx.currentTime);
  }
  /** When the source falls silent on the context clock. */
  get endsAt(): number {
    if (this.startedAt === null) return Infinity;
    const natural = this.loop ? Infinity : this.startedAt + (this.buffer?.duration ?? 0) / this.playbackRate.value;
    return Math.min(natural, this.stoppedAt ?? Infinity);
  }
}

export class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  sampleRate = 48_000;
  destination = new FakeNode('destination');
  listener = {
    positionX: new FakeParam(0),
    positionY: new FakeParam(0),
    positionZ: new FakeParam(0),
    forwardX: new FakeParam(0),
    forwardY: new FakeParam(0),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(0),
    upY: new FakeParam(1),
    upZ: new FakeParam(0),
  };
  /** Every source that was started, in order. */
  started: FakeSource[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];
  panners: (FakeNode & Record<string, unknown>)[] = [];
  filters: (FakeNode & { frequency: FakeParam; Q: FakeParam; type: string })[] = [];

  createGain(): FakeNode & { gain: FakeParam } {
    const node = Object.assign(new FakeNode('gain'), { gain: new FakeParam(1) });
    this.gains.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }
  createBiquadFilter(): FakeNode & { frequency: FakeParam; Q: FakeParam; type: string } {
    const node = Object.assign(new FakeNode('filter'), {
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      type: 'lowpass',
    });
    this.filters.push(node);
    return node;
  }
  createPanner(): FakeNode & Record<string, unknown> {
    const node: FakeNode & Record<string, unknown> = Object.assign(new FakeNode('panner') as FakeNode & Record<string, unknown>, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 1,
      rolloffFactor: 1,
      maxDistance: 10000,
      positionX: new FakeParam(0),
      positionY: new FakeParam(0),
      positionZ: new FakeParam(0),
    });
    this.panners.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  /** Moves the audio clock and tells finished sources that they have ended. */
  advance(seconds: number): void {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const s of this.started) {
      if (!s.ended && s.endsAt <= this.currentTime) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  /** Sources that are sounding at the current time. */
  sounding(): FakeSource[] {
    return this.started.filter((s) => s.startedAt !== null && s.startedAt <= this.currentTime && s.endsAt > this.currentTime);
  }
}

/** The fake context typed as the real thing for the engine's constructor. */
export function asContext(ctx: FakeContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

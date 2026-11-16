/**
 * The run view (order 20): from an envelope or a spoken task to a finished deliverable on
 * the island.
 *
 *   envelope   taken by hand onto the first stake (or selected from afar) starts its
 *              sample; the "New task" stone takes a spoken or typed task
 *   run        the engine's events drive the stage (./stage.ts): the plan becomes a
 *              trail, instruments walk per open call, units fly to tiles, the gate stamps
 *   review     every station sign opens its step card at the hand: approve, or reject
 *              with an instruction (a preset or spoken) and watch the step run again
 *   result     the plot closes and joins the island, the object rises, the deliverable
 *              opens at the right with "Open the site" and "Send to phone"
 *
 * Every failure has a line and a next action. Debug handle: window.__gw.run.
 */
import { effect } from '@preact/signals-core';
import { Vector3 } from '@iwsdk/core';
import type {
  AnswerSet,
  CheckedItem,
  Doc,
  EnvelopeSpec,
  InputKind,
  Plot,
  Project,
  RunDeps,
  RunEvent,
  RunHandle,
  SampleId,
  StepCard as StepCardData,
  TaskResult,
} from '../../agents/types';
import { SAMPLES, sampleDocs, sampleMeta } from '../../../content/samples';
import { liveAvailability, newTaskProject, redoRecorded, redoStep, startTask } from '../../agents/engine/start';
import { memoryRunStore } from '../../agents/store';
import { replayRun } from '../../agents/replay';
import { ROLE_TITLE } from '../../agents/engine/library';
import type { App } from '../../app/boot/world';
import { debugEnabled, registerDebug, registerTest } from '../../app/debug';
import { parseAppParams } from '../../app/params';
import { llm } from '../../net/index';
import { say } from '../../feel/captions';
import { answer as feel } from '../../feel/answer';
import { onGrab } from '../../interact/grab';
import { onSelect } from '../../interact/select';
import { target } from '../../interact/targets';
import { AskCard, CodeCard } from '../../kit/ui/cards';
import { mountPanel } from '../../kit/ui/root';
import { StepCard, type StepPreview } from '../../kit/ui/step';
import { animate, easeInOut, now as kitNow, progress } from '../../kit/world/time';
import type { Envelope } from '../../kit/world/types';
import { homeScene } from '../scene';
import { LAYOUT, polar } from '../../tokens/tokens';
import { answerChain, savedRun } from './answers';
import { phoneAddress, phoneLink, previewOf } from './deliver';
import { deskInput } from './desk';
import { DeliverablePanel, NewTaskPanel, RunPanel, type Act, type RunNumbers } from './panels';
import { createStage } from './stage';
import { dictate, startRecording, type Recording } from './voice';

export const order = 20;

export const PRESETS = [
  { preset: 'shorter', instruction: 'Make it shorter' },
  { preset: 'style', instruction: 'Different style' },
  { preset: 'again', instruction: 'Try again' },
] as const;

const SLOT_ORDER = [0, 1, 7, 2, 6, 3, 5, 4];
const TODAY = (): string => new Date().toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const by = (input: InputKind): 'hand' | 'voice' | 'gaze' | 'mouse' => (input === 'ray' ? 'hand' : input === 'dwell' ? 'gaze' : input);

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'redoing' | 'failed';
type Source = { kind: 'recorded' | 'written' | 'live' | 'saved'; set: AnswerSet | null };

export function install(app: App): void {
  const home = homeScene();
  const stage = createStage(app, home);
  const { store } = app;

  // ---------------------------------------------------------------- state
  let phase: Phase = 'idle';
  let project: Project | null = null;
  let docs: Doc[] = [];
  let handle: RunHandle | null = null;
  let result: TaskResult | null = null;
  let source: Source = { kind: 'written', set: null };
  let stopEvents: (() => void) | null = null;
  const numbers: RunNumbers = { steps: 0, of: 0, passed: 0, sentBack: 0, working: 0 };
  const cards = new Map<string, StepCardData>();
  const claims = new Map<string, string>();
  const agentOnly = new Set<string>();
  const approved = new Set<string>();
  let version = 1;
  let unitsLaid = 0;
  let seed = 7;
  let runLine: string | null = null;

  const params = parseAppParams(location.search, debugEnabled());
  const deps = (): RunDeps => ({ llm, store: memoryRunStore(), now: () => app.clock.now(), timers: app.clock.timers });

  // ---------------------------------------------------------------- panels
  let runPanel: { panel: RunPanel; mount: { unmount(): void } } | null = null;
  const runActions = (): Act[] => {
    if (phase === 'running' || phase === 'starting') {
      const acts: Act[] = [];
      if (source.kind !== 'live') acts.push({ label: 'Skip to the result', target: 'run:skip', onSelect: () => handle?.skip() });
      acts.push({ label: 'Stop', target: 'run:stop', onSelect: () => stop() });
      return acts;
    }
    if (phase === 'redoing') return [];
    if (phase === 'failed') return [{ label: 'Try again', target: 'run:again', onSelect: () => void again() }];
    return [];
  };
  const sourceLine = (): string =>
    source.kind === 'recorded'
      ? 'Recorded answers of a real model. Every check runs now, here.'
      : source.kind === 'written'
        ? 'Sample with written answers. Every check runs now, here.'
        : source.kind === 'live'
          ? 'Live: the model answers now, code checks every answer.'
          : 'A saved copy of this run.';
  const refreshPanel = (): void => {
    stage.meter(phase === 'idle' ? null : numbers);
    const spec = { source: sourceLine(), numbers: { ...numbers }, line: runLine, actions: runActions() };
    if (!runPanel) {
      const panel = new RunPanel(spec);
      const at = polar(LAYOUT.runCard.az, LAYOUT.runCard.dist, 0);
      runPanel = { panel, mount: mountPanel('desk', panel, { x: at.x, y: -at.z - LAYOUT.bench.dist }) };
    } else runPanel.panel.set(spec);
  };
  const closeRunPanel = (): void => {
    runPanel?.mount.unmount();
    runPanel?.panel.dispose();
    runPanel = null;
  };

  let askCard: { card: AskCard; mount: { unmount(): void }; askId: string } | null = null;
  const closeAsk = (): void => {
    askCard?.mount.unmount();
    askCard?.card.dispose();
    askCard = null;
  };

  let stepCard: { card: StepCard; mount: { unmount(): void }; stepId: string } | null = null;
  const closeStep = (): void => {
    stepCard?.mount.unmount();
    stepCard?.card.dispose();
    stepCard = null;
  };

  let deliverable: { panel: DeliverablePanel; mount: { unmount(): void } } | null = null;
  let codeCard: { card: CodeCard; mount: { unmount(): void } } | null = null;
  const closeDeliverable = (): void => {
    deliverable?.mount.unmount();
    deliverable?.panel.dispose();
    deliverable = null;
    codeCard?.mount.unmount();
    codeCard?.card.dispose();
    codeCard = null;
  };

  let newTask: { panel: NewTaskPanel; mount: { unmount(): void } } | null = null;
  const closeNewTask = (): void => {
    newTask?.mount.unmount();
    newTask?.panel.dispose();
    newTask = null;
  };

  // ---------------------------------------------------------------- envelopes
  const plotOf = (sample: SampleId): Plot | null => store.world.peek()?.plots.find((p) => p.slug === sample && p.sample) ?? null;
  const offerEnvelopes = (): void => {
    const specs: EnvelopeSpec[] = SAMPLES.filter((s) => !plotOf(s.id) && s.id !== project?.sample).map((s) => ({ id: s.id, kind: 'sample', lines: s.label, sample: s.id }));
    home.inbox.offer(specs);
    home.inbox.setPin(specs.some((s) => !store.inboxTouched.peek()[s.id]));
    for (const env of home.inbox.envelopes()) bindEnvelope(env);
  };
  const stakeAt = (out = new Vector3()): Vector3 => home.stake.getWorldPosition(out).add(new Vector3(0, 0.012, 0.006));
  const placed = new Set<string>();

  const flyToStake = (env: Envelope, done: () => void): void => {
    const from = env.handle.getWorldPosition(new Vector3());
    const to = stakeAt();
    const parent = env.handle.parent;
    const at = kitNow();
    animate({
      root: env.handle,
      update(t) {
        const k = easeInOut(progress(t, at, 520));
        const p = from.clone().lerp(to, k);
        p.y += Math.sin(Math.PI * k) * 0.08;
        if (parent) env.handle.position.copy(parent.worldToLocal(p));
        env.proxy.position.copy(env.handle.position);
        if (k >= 1 && !placed.has(env.spec.id)) {
          placed.add(env.spec.id);
          done();
        }
      },
    });
  };

  const onPlaced = (env: Envelope): void => {
    env.setState('open');
    feel({ type: 'drop' as never });
    app.clock.timers.set(() => {
      env.handle.visible = false;
      env.proxy.visible = false;
    }, 700);
    if (env.spec.sample) void startSample(env.spec.sample, 'sample');
  };

  const bindEnvelope = (env: Envelope): void => {
    if (env.handle.userData.gwBound) return;
    env.handle.userData.gwBound = true;
    const id = env.spec.id;
    target(`envelope:${id}`, env.proxy);
    onGrab(env, {
      snapTo: [{ target: home.stake, radius: 0.07 }],
      onTake: () => {
        home.inbox.take(id);
        env.setState('held');
        store.inboxTouched.value = { ...store.inboxTouched.peek(), [id]: true };
      },
      onDrop: (hit) => {
        if (hit && phase !== 'running' && phase !== 'starting') {
          placed.add(id);
          onPlaced(env);
        } else {
          if (hit) say({ source: 'Run', text: 'A run is going. It takes one job at a time.' });
          home.inbox.putBack(id);
        }
      },
    });
    onSelect(
      env.proxy,
      () => {
        if (phase === 'running' || phase === 'starting' || phase === 'redoing') {
          say({ source: 'Run', text: 'A run is going. It takes one job at a time.' });
          return;
        }
        home.inbox.take(id);
        env.setState('held');
        store.inboxTouched.value = { ...store.inboxTouched.peek(), [id]: true };
        flyToStake(env, () => onPlaced(env));
      },
      { nearOf: env.handle },
    );
  };

  effect(() => {
    void store.world.value;
    if (phase === 'idle' || phase === 'done') offerEnvelopes();
  });

  // ---------------------------------------------------------------- starting
  const resetRun = (): void => {
    stopEvents?.();
    stopEvents = null;
    closeAsk();
    closeStep();
    closeDeliverable();
    closeNewTask();
    stage.clear();
    numbers.steps = 0;
    numbers.of = 0;
    numbers.passed = 0;
    numbers.sentBack = 0;
    numbers.working = 0;
    cards.clear();
    claims.clear();
    agentOnly.clear();
    approved.clear();
    result = null;
    version = 1;
    unitsLaid = 0;
    runLine = null;
  };

  const freeSlot = (): number => {
    const plots = store.world.peek()?.plots ?? [];
    const own = project?.sample ? plots.find((p) => p.slug === project!.sample) : plots.find((p) => p.projectId === project?.id);
    if (own) return own.slot;
    const taken = new Set(plots.map((p) => p.slot));
    return SLOT_ORDER.find((s) => !taken.has(s)) ?? -1;
  };

  /** What is left to try for the sample of this run when a source can't finish it. */
  let fallbacks: Source[] = [];

  async function startSample(sample: SampleId, how: 'sample' | 'live'): Promise<void> {
    if (phase === 'running' || phase === 'starting' || phase === 'redoing') return;
    resetRun();
    phase = 'starting';
    const meta = sampleMeta(sample);
    project = newTaskProject({ text: meta.task, by: 'sample', links: [] }, { sample, title: meta.title });
    store.activeProjectId.value = project.id;
    say({ source: 'Task', text: meta.task, key: true });
    refreshPanel();
    const chain: Source[] = [];
    if (how === 'live' && liveAvailability(store.llm.peek()).live) chain.push({ kind: 'live', set: null });
    const prefer = params.answers === 'scripted' ? 'written' : null;
    for (const found of await answerChain(sample, prefer).catch(() => [])) chain.push({ kind: found.kind, set: found.set });
    chain.push({ kind: 'saved', set: null });
    try {
      docs = await sampleDocs(sample);
    } catch (error) {
      console.error('[gw] the sample materials could not be read', error);
      docs = [];
    }
    fallbacks = chain;
    await tryNext();
  }

  /** Starts the next source of the chain; a source that throws passes to the one after it. */
  async function tryNext(): Promise<void> {
    const p = project;
    const next = fallbacks.shift();
    if (!p || !next) return fail('This sample could not start on this device.');
    source = next;
    if (next.kind === 'saved') {
      const saved = p.sample ? await savedRun(p.sample).catch(() => null) : null;
      if (!saved) return fail('This sample could not start on this device.');
      say({ source: 'Run', text: 'Showing a saved copy of this run. The checks could not start on this device.', key: true });
      follow(replayRun(saved.events, { pace: store.pace.peek(), timers: app.clock.timers, now: () => app.clock.now() }), 'full', saved.result);
      return;
    }
    try {
      const h = await startTask(p, docs, deps(), { answers: next.set ?? 'live', pace: store.pace.peek(), today: TODAY(), plant: next.kind === 'live' });
      follow(h, 'full');
    } catch (error) {
      console.error(`[gw] the ${next.kind} run could not start`, error);
      await tryNext();
    }
  }

  async function startTyped(text: string, how: TaskByHow): Promise<void> {
    const goal = text.trim();
    if (!goal) return;
    if (phase === 'running' || phase === 'starting' || phase === 'redoing') {
      say({ source: 'Run', text: 'A run is going. It takes one job at a time.' });
      return;
    }
    const live = liveAvailability(store.llm.peek());
    if (!live.live) {
      openNewTask(`${live.line}`, `"${goal}" needs the live model. Watch a sample meanwhile.`);
      return;
    }
    resetRun();
    phase = 'starting';
    project = newTaskProject({ text: goal, by: how, links: [] });
    store.activeProjectId.value = project.id;
    docs = [];
    source = { kind: 'live', set: null };
    say({ source: 'Task', text: goal, key: true });
    refreshPanel();
    try {
      const h = await startTask(project, docs, deps(), { answers: 'live', pace: 1, today: TODAY() });
      follow(h, 'full');
    } catch (error) {
      console.error('[gw] a live task could not start', error);
      fail("The agents couldn't start this task.");
    }
  }
  type TaskByHow = 'voice' | 'typed' | 'phone';

  function fail(line: string): void {
    phase = 'failed';
    runLine = `${line} Try again, or watch a sample.`;
    say({ source: 'Run', text: line, key: true });
    refreshPanel();
    openNewTask(liveAvailability(store.llm.peek()).line, line);
  }

  async function again(): Promise<void> {
    const p = project;
    if (!p) return;
    if (p.sample) await startSample(p.sample, 'sample');
    else await startTyped(p.task.text, 'typed');
  }

  function stop(): void {
    if (!handle) return;
    handle.cancel();
  }

  // ---------------------------------------------------------------- events
  function follow(h: RunHandle, mode: 'full' | 'redo', savedResult?: TaskResult): void {
    handle = h;
    store.activeRun.value = h;
    phase = mode === 'full' ? 'running' : 'redoing';
    refreshPanel();
    stopEvents?.();
    for (const e of h.record().events) onEvent(e, mode);
    stopEvents = h.subscribe((e) => onEvent(e, mode));
    void h.done.then((record) => {
      if (handle !== h) return;
      const r = (record.result as TaskResult | null) ?? savedResult ?? null;
      finish(record.status, r, mode);
    });
  }

  function onEvent(e: RunEvent, mode: 'full' | 'redo'): void {
    switch (e.type) {
      case 'run-start':
        if (mode === 'full') say({ source: 'Run', text: e.label, key: true });
        break;
      case 'plan': {
        if (mode === 'redo') break;
        numbers.of = e.stations.length;
        const slot = freeSlot();
        if (slot < 0) {
          runLine = 'All eight plots are taken. This run will not get a plot.';
        }
        seed = Math.floor(Math.random() * 1000) + 1;
        home.island.rotateTo((slot < 0 ? 0 : slot) * 45, 900);
        stage.plan(e.stations, e.tilesPlanned, Math.max(0, slot), seed);
        for (const s of e.stations) {
          const sign = stage.sign(s.id);
          if (!sign) continue;
          target(`station:${s.id}`, sign);
          onSelect(sign, () => openStep(s.id));
        }
        say({ source: 'Planner', text: `${e.understood} ${plural(e.stations.length, 'step')}.` });
        if (e.fit === 'partly' && project) say({ source: 'Planner', text: 'Part of this is out of reach here; the rest is done.' });
        break;
      }
      case 'step-start':
        if (mode === 'redo') stage.redo(e.station);
        else stage.stepStart(e.station);
        break;
      case 'call-start':
        numbers.working++;
        stage.callStart(e.callId, e.station, e.role, e.what);
        if (e.attempt > 1) say({ source: ROLE_TITLE[e.role] ?? 'Agent', text: 'is asked to answer again.' });
        break;
      case 'call-end':
        numbers.working = Math.max(0, numbers.working - 1);
        stage.callEnd(e.callId, e.ok);
        break;
      case 'waiting':
        stage.waiting(e.station);
        say({ source: 'Run', text: `Waiting for the model. Retrying in ${Math.ceil(e.retryInMs / 1000)} s.` });
        break;
      case 'item':
        onItem(e.station, e.item);
        break;
      case 'tile': {
        unitsLaid++;
        const label = claims.get(e.ref.id) ?? e.ref.id.split(':').pop() ?? '';
        stage.tile(e.station, e.i, label.slice(0, 22), !agentOnly.has(e.ref.id));
        break;
      }
      case 'card':
        cards.set(e.station, e.card);
        if (stepCard?.stepId === e.station) openStep(e.station);
        break;
      case 'ask':
        showAsk(e.askId, e.question, e.options, e.station);
        break;
      case 'answer':
        if (askCard?.askId === e.askId) closeAsk();
        stage.asking(cards.get(e.askId.replace(/^ask:/, ''))?.stepId ?? e.askId.replace(/^ask:/, ''), false);
        break;
      case 'note':
        say({ source: e.source, text: e.text, key: e.key });
        break;
      case 'fallback':
        source = { ...source, kind: 'recorded' };
        say({ source: 'Run', text: 'The live model stopped answering. Finishing with recorded answers.', key: true });
        break;
      case 'step-end':
        if (mode === 'full') numbers.steps++;
        stage.stepEnd(e.station, e.summary.kept ?? 0);
        break;
      case 'error':
        stage.error(e.station);
        say({ source: 'Run', text: errorLine(e.code), key: true });
        break;
      case 'run-end':
        break;
      case 'progress':
        break;
    }
    refreshPanel();
  }

  const errorLine = (code: string): string =>
    code === 'daily-cap'
      ? "Today's live runs are used up."
      : code === 'agents-offline' || code === 'offline'
        ? "The agents can't be reached right now."
        : code === 'budget'
          ? 'This run used its budget of model calls.'
          : code === 'timeout'
            ? 'The model took too long to answer.'
            : 'The model gave an answer code could not use.';

  function onItem(station: string, item: CheckedItem): void {
    const id = item.unitId ?? item.id;
    claims.set(id, item.claim);
    if (item.label === 'agent') agentOnly.add(id);
    switch (item.status) {
      case 'accepted':
      case 'corrected':
        numbers.passed++;
        stage.stamp(station, 'pass');
        break;
      case 'merged':
        stage.stamp(station, 'pass');
        break;
      case 'rejected':
        numbers.sentBack++;
        stage.stamp(station, 'back');
        say({ source: 'Check', text: `Sent back: ${item.problems?.[0]?.replace(/\. The nearest text there:.*$/, '') ?? item.claim}`, key: true });
        break;
      case 'fixed':
        numbers.passed++;
        stage.stamp(station, 'fixed');
        say({ source: 'Check', text: `Fixed on a second look: ${item.claim}` });
        break;
      case 'dropped':
        stage.stamp(station, 'dropped');
        say({ source: 'Check', text: `Dropped: ${item.claim}` });
        break;
    }
  }

  // ---------------------------------------------------------------- the question
  function showAsk(askId: string, question: string, options: { id: string; label: string }[], station: string): void {
    closeAsk();
    closeStep();
    closeNewTask();
    stage.asking(station, true);
    const h = handle;
    const opts = options.slice(0, 2).map((o, i) => ({
      label: o.label,
      target: `ask:${i}`,
      onSelect: (input: InputKind) => {
        h?.answer(askId, o.id, by(input));
        closeAsk();
      },
    })) as [Act, Act];
    if (opts.length < 2) opts.push({ label: 'Skip', target: 'ask:1', onSelect: () => (h?.answer(askId, options[0].id, 'mouse'), closeAsk()) });
    const card = new AskCard({ question, options: opts, timeoutMs: 20000 });
    askCard = { card, mount: mountPanel('hand', card, { x: 0, y: 0 }), askId };
    card.shown();
    h?.shown(askId);
    feel({ type: 'ask' as never });
    say({ source: 'Agents', text: `A question for you: ${question}`, key: true });
  }

  // ---------------------------------------------------------------- step cards
  const STATUS: Record<StepCardData['state'], 'queued' | 'running' | 'review' | 'redoing' | 'failed'> = {
    waiting: 'queued',
    running: 'running',
    done: 'review',
    redoing: 'redoing',
    stale: 'review',
    failed: 'failed',
    skipped: 'queued',
  };

  function previewOfStep(stepId: string): StepPreview | null {
    const r = result;
    if (!r) return null;
    const step = r.plan.steps.find((s) => s.id === stepId);
    if (!step) return null;
    const units = r.units.filter((u) => u.stepId === stepId);
    if (step.kind === 'write-code' && r.deliverable?.kind === 'site') {
      const file = r.deliverable.files.find((f) => units.some((u) => u.path === f.path)) ?? r.deliverable.files[0];
      if (!file) return null;
      const lines = file.text.split('\n');
      const start = Math.max(0, lines.findIndex((l) => /<main|<body/.test(l)));
      return { kind: 'code', file: file.path, start: start + 1, lines: lines.slice(start, start + 12) };
    }
    if (step.kind === 'make-plan' && r.deliverable?.kind === 'plan') {
      return { kind: 'table', caption: `${r.deliverable.items.length} items`, columns: ['Task', 'Owner', 'Start', 'End'], rows: r.deliverable.items.map((i) => [i.task, i.owner.split(' ')[0], i.start.slice(5), i.end.slice(5)]) };
    }
    if (step.kind === 'research') {
      const u = units.find((x) => x.quote && 'docId' in x.quote.source);
      if (u?.quote && 'docId' in u.quote.source) {
        const src = u.quote.source;
        const page = docs.flatMap((d) => d.pages).find((p) => p.n === src.page);
        const text = page?.text ?? u.quote.text;
        const at = text.indexOf(u.quote.text);
        return { kind: 'text', source: `${src.docTitle}, page ${src.page} · ${units.length} facts`, text, quote: at >= 0 ? [{ start: at, end: at + u.quote.text.length }] : undefined };
      }
    }
    if (step.kind === 'review') {
      const list = r.reviews.filter((x) => x.stepId === stepId);
      if (list.length) return { kind: 'text', source: 'Reviewed by an agent', text: list.map((x) => `${x.severity === 'major' ? 'Major' : 'Minor'}: ${x.text}`).join('\n') };
    }
    if (units.length) return { kind: 'text', source: step.title, text: units.map((u) => (u.kind === 'section' ? `${u.title}. ${u.body}` : u.body || u.title)).join('\n') };
    const out = r.outputs[stepId];
    return out ? { kind: 'text', source: step.title, text: out.text.slice(0, 600) } : null;
  }

  function openStep(stepId: string): void {
    if (askCard) return;
    closeNewTask();
    const c = cards.get(stepId);
    const station = stage.stations.find((s) => s.id === stepId);
    const title = c?.title ?? station?.label ?? stepId;
    const role = station?.role ? (ROLE_TITLE[station.role] ?? 'Agent') : station?.by === 'human' ? 'You' : 'Code';
    const done = phase === 'done' || phase === 'failed';
    const redoable = station?.by === 'model';
    let status = c ? STATUS[c.state] : 'queued';
    if (approved.has(stepId)) status = 'approved' as never;
    if (status === 'review' && !done) status = 'running';
    if (status === 'review' && !redoable) status = 'approved' as never;
    const note = c ? [c.summary, ...c.checked.slice(0, 2)].filter(Boolean).join('. ') : null;
    const spec = {
      id: stepId,
      title,
      role,
      seconds: c && c.ms > 0 ? c.ms / 1000 : null,
      status,
      preview: done ? previewOfStep(stepId) : null,
      note: note ? `${note}.` : null,
      onApprove: () => {
        approved.add(stepId);
        project?.edits.push({ id: `e${Date.now()}`, at: new Date().toISOString(), by: 'me', source: 'hand', kind: 'step-review', stepId, verdict: 'approved' });
        say({ source: 'You', text: `Approved: ${title}.` });
        app.clock.timers.set(() => {
          if (stepCard?.stepId === stepId) closeStep();
        }, 600);
      },
      onReject: () => {
        stepCard?.card.set({ status: 'review', redo: { open: true, suggestions: suggestionsFor(stepId).map((x) => x.label) } });
        if (voiceReady()) say({ source: 'Agents', text: 'Pick one, or touch the stone and say what should change.' });
      },
      onRedo: (instruction: string, input: InputKind) => void redo(stepId, instruction, input),
    };
    if (stepCard?.stepId === stepId) {
      stepCard.card.set(spec as never);
      return;
    }
    closeStep();
    const card = new StepCard(spec as never);
    stepCard = { card, mount: mountPanel('hand', card, { x: -0.02, y: 0.02 }), stepId };
    feel({ type: 'select' as never });
  }

  /** Ready instructions for a step: the recording's own redos first, then the presets, three at most. */
  function suggestionsFor(stepId: string): { label: string; instruction: string; preset?: string }[] {
    const out: { label: string; instruction: string; preset?: string }[] = [];
    for (const r of source.set?.redos ?? []) {
      if (r.stepId !== stepId) continue;
      out.push({ label: r.instruction.split(/[:.]/)[0].trim().slice(0, 28), instruction: r.instruction, preset: r.preset });
    }
    for (const p of PRESETS) if (!out.some((o) => o.preset === p.preset)) out.push({ label: p.instruction, instruction: p.instruction, preset: p.preset });
    return out.slice(0, 3);
  }

  async function redo(stepId: string, said: string, input: InputKind): Promise<void> {
    const p = project;
    const prev = result;
    if (!p || !prev || phase === 'redoing') return;
    const ready = suggestionsFor(stepId).find((x) => x.label === said || x.instruction === said);
    const instruction = ready?.instruction ?? said;
    const preset = ready?.preset;
    let answers: AnswerSet | 'live';
    if (source.set && redoRecorded(source.set, stepId, instruction, preset)) answers = source.set;
    else if (liveAvailability(store.llm.peek()).live) answers = 'live';
    else {
      say({ source: 'Agents', text: 'Your own instruction needs the live model. The ready ones work offline.', key: true });
      stepCard?.card.set({ status: 'review', redo: { open: true, suggestions: suggestionsFor(stepId).map((x) => x.label) } } as never);
      return;
    }
    p.edits.push({ id: `e${Date.now()}`, at: new Date().toISOString(), by: 'me', source: by(input), kind: 'step-redo', stepId, instruction, ...(preset ? { preset } : {}), runId: handle?.id ?? '' });
    say({ source: 'You', text: `Redo "${cards.get(stepId)?.title ?? stepId}": ${ready?.label ?? instruction}.`, key: true });
    closeStep();
    closeDeliverable();
    approved.delete(stepId);
    try {
      const h = await redoStep({ ...p, result: prev }, prev, stepId, instruction, docs, deps(), { answers, preset, pace: store.pace.peek(), today: TODAY() });
      version++;
      follow(h, 'redo');
    } catch (error) {
      console.error('[gw] redo failed to start', error);
      say({ source: 'Run', text: "The step couldn't run again. The earlier result stays.", key: true });
      phase = 'done';
      openDeliverable();
    }
  }

  // ---------------------------------------------------------------- the end
  function finish(status: string, r: TaskResult | null, mode: 'full' | 'redo'): void {
    numbers.working = 0;
    closeAsk();
    handle = null;
    store.activeRun.value = null;
    if (status === 'cancelled') {
      phase = 'idle';
      runLine = null;
      say({ source: 'Run', text: 'Stopped. Nothing was laid on the island.', key: true });
      stage.clear();
      closeRunPanel();
      project = null;
      offerEnvelopes();
      return;
    }
    if (!r || status === 'failed' || status === 'declined' || !r.deliverable) {
      if (mode === 'redo') {
        phase = 'done';
        say({ source: 'Run', text: "The step couldn't run again. The earlier result stays.", key: true });
        openDeliverable();
        refreshPanel();
        return;
      }
      if (project?.sample && fallbacks.length && status !== 'declined') {
        say({ source: 'Run', text: "This copy of the run didn't finish here. Playing the next one.", key: true });
        resetRun();
        phase = 'starting';
        void tryNext();
        return;
      }
      return fail(status === 'declined' ? 'The planner says this task is out of reach for these agents.' : 'The run stopped before the work was done.');
    }
    result = r;
    phase = 'done';
    const p = project!;
    p.result = r;
    p.status = status === 'partial' ? 'partial' : 'ready';
    p.title = r.plan.title || p.title;
    p.rev++;
    p.passes++;
    store.projects.value = new Map(store.projects.peek()).set(p.id, p);
    const s = r.stats;
    runLine =
      mode === 'redo'
        ? `Version ${version}: ${cards.get(p.edits.at(-1)?.kind === 'step-redo' ? (p.edits.at(-1) as { stepId: string }).stepId : '')?.title ?? 'the step'} ran again.`
        : `Done: ${plural(s.steps, 'step')}, ${plural(s.kept, 'part')} checked, ${s.sentBack} sent back and ${s.fixed} fixed.`;
    say({ source: 'Run', text: runLine, key: true });
    refreshPanel();
    const slot = stage.slot;
    const save = (): void => {
      const plot: Plot = {
        projectId: p.id,
        slug: p.sample ?? p.slug,
        slot,
        kind: 'task',
        title: r.plan.title,
        sample: Boolean(p.sample),
        visibility: 'private',
        object: { kind: r.plan.object, units: s.tiles } as unknown as Plot['object'],
        doneAt: new Date(app.clock.wall()).toISOString(),
        tiles: Math.max(1, s.tiles),
        perTile: 1,
        seed: seed + version - 1,
        tileRefs: [],
        passes: p.passes,
        open: 0,
        total: 0,
        flag: 'none',
      };
      app.plots.save(plot);
      // The island built its own closed plot for the slot: the run's copy goes, the object rises.
      app.clock.timers.set(() => {
        stage.dropSector();
        home.island.object(slot)?.setState('growing');
        feel({ type: 'bloom' as never });
      }, 30);
    };
    if (mode === 'full') {
      stage.close(Math.max(1, s.tiles));
      app.clock.timers.set(save, 650);
    } else save();
    app.clock.timers.set(() => openDeliverable(), mode === 'full' ? 1200 : 400);
  }

  async function openSite(input: InputKind): Promise<void> {
    if (!result) return;
    let p;
    try {
      p = await previewOf(result);
    } catch {
      say({ source: 'Site', text: "This result isn't a site." });
      return;
    }
    if (store.mode.peek() === 'desk') {
      const w = window.open(p.url, '_blank', 'noopener');
      if (!w) deskInput.link(p.url, 'Open the site');
      say({ source: 'Site', text: p.where === 'browser' ? 'Opened a copy kept in this browser.' : 'Opened in a new tab.' });
      return;
    }
    void input;
    // In the headset: the page opens once the person is back in the browser; the phone gets a code.
    deskInput.link(p.url, 'Open the site');
    await sendToPhone();
    say({ source: 'Site', text: 'Leave VR to open it here, or type the code on your phone.', key: true });
  }

  async function sendToPhone(): Promise<void> {
    if (!result) return;
    codeCard?.mount.unmount();
    codeCard?.card.dispose();
    codeCard = null;
    try {
      const link = await phoneLink(result);
      const card = new CodeCard({ code: link.code, address: phoneAddress(link.code), note: 'Type this on your phone' });
      codeCard = { card, mount: mountPanel('side', card, { x: 0, y: -0.27 }) };
      say({ source: 'Phone', text: `Open ${phoneAddress(link.code)} on your phone.`, key: true });
    } catch (error) {
      say({ source: 'Phone', text: error instanceof Error ? error.message : 'The phone link failed.', key: true });
    }
  }

  function openDeliverable(): void {
    const r = result;
    const d = r?.deliverable;
    if (!r || !d) return;
    closeDeliverable();
    const s = r.stats;
    let rows: { text: string; meta?: string; mark?: 'ok' | 'warn' }[] = [];
    let sub = '';
    const actions: Act[] = [];
    if (d.kind === 'site') {
      sub = `A site, ${plural(d.files.length, 'file')}. ${d.load.required.filter((x) => x.found).length} of ${d.load.required.length} required parts found.`;
      rows = d.files.map((f) => ({ text: f.path, meta: `${f.text.split('\n').length} lines`, mark: f.ok ? 'ok' : 'warn' }));
      actions.push({ label: 'Open the site', target: 'deliverable:open', onSelect: (input) => void openSite(input) });
    } else if (d.kind === 'document') {
      sub = `A document, ${plural(d.sections.length, 'section')}.`;
      rows = d.sections.map((x) => ({ text: x.heading, mark: 'ok' }));
    } else {
      sub = `A plan, ${plural(d.items.length, 'item')}${d.window ? `, ${d.window.from} to ${d.window.to}` : ''}.`;
      rows = d.items.map((i) => ({ text: i.task.length > 30 ? `${i.task.slice(0, 29)}…` : i.task, meta: `${i.owner.split(' ')[0]}, ${i.start.slice(5)}`, mark: 'ok' }));
    }
    const shown = rows.slice(0, 7);
    actions.push({ label: 'Send to phone', target: 'deliverable:phone', onSelect: () => void sendToPhone() });
    const panel = new DeliverablePanel({
      title: version > 1 ? `${d.title}, version ${version}` : d.title,
      sub,
      rows: shown,
      more: rows.length > shown.length ? `${rows.length - shown.length} more` : null,
      line: `${s.kept} parts checked by code, ${s.sentBack} sent back, ${s.fixed} fixed.`,
      actions,
    });
    deliverable = { panel, mount: mountPanel('side', panel, { x: 0, y: 0.1 }) };
  }

  // ---------------------------------------------------------------- new task
  let recording: Recording | null = null;
  let heard: string | null = null;
  const voiceReady = (): boolean => {
    const st = store.llm.peek();
    return Boolean(st?.live && st.audio && navigator.mediaDevices?.getUserMedia);
  };

  function openNewTask(line?: string, extra?: string | null): void {
    closeStep();
    const live = liveAvailability(store.llm.peek());
    const actions: Act[] = [];
    if (voiceReady()) actions.push({ label: recording ? 'Done speaking' : 'Speak the task', target: 'task:speak', onSelect: () => void toggleVoice('task') });
    if (live.live && store.mode.peek() === 'desk') actions.push({ label: 'Type it below', target: 'task:type', onSelect: () => deskInput.focus() });
    if (live.live && store.mode.peek() !== 'desk') actions.push({ label: 'Type it on your phone', target: 'task:phone', onSelect: () => say({ source: 'Phone', text: 'Typing from a phone needs the code service, which is not in this copy yet. Speak it, or watch a sample.', key: true }) });
    const samples: Act[] = SAMPLES.map((s) => ({ label: s.title, target: `task:sample:${s.id}`, onSelect: () => (closeNewTask(), void startSample(s.id, 'sample')) }));
    const spec = { title: 'New task', line: line ?? live.line, heard: extra ?? heard, actions, samples };
    if (newTask) newTask.panel.set(spec);
    else {
      const panel = new NewTaskPanel(spec);
      newTask = { panel, mount: mountPanel('hand', panel, { x: 0.02, y: 0 }) };
    }
  }

  async function toggleVoice(about: 'task' | 'instruction'): Promise<void> {
    if (recording) {
      const rec = recording;
      recording = null;
      home.stone.setState('thinking');
      try {
        const wav = await rec.stop();
        const text = await dictate(llm, wav, about);
        home.stone.setState('idle');
        if (!text) {
          say({ source: 'Voice', text: "Nothing was heard. Touch the stone and try again." });
          return;
        }
        if (about === 'instruction' && stepCard) {
          stepCard.card.set({ redo: { open: true, instruction: text, suggestions: suggestionsFor(stepCard.stepId).map((x) => x.label) } } as never);
          return;
        }
        heard = `You said: "${text}"`;
        closeNewTask();
        void startTyped(text, 'voice');
      } catch (error) {
        console.error('[gw] voice failed', error);
        home.stone.setState('idle');
        say({ source: 'Voice', text: "The voice couldn't be written down. Type it, or pick a sample.", key: true });
      }
      return;
    }
    try {
      recording = await startRecording((level) => home.stone.setState('listening', level));
      say({ source: 'Voice', text: 'Listening. Touch the stone again when you are done.' });
      app.clock.timers.set(() => {
        if (recording) void toggleVoice(about);
      }, 15000);
      if (newTask) openNewTask();
    } catch {
      home.stone.setState('idle');
      say({ source: 'Voice', text: 'The microphone is blocked. Allow it in the browser, or type the task.', key: true });
    }
  }

  onSelect(home.stone.root, () => {
    if (recording) return void toggleVoice(stepCard ? 'instruction' : 'task');
    if (stepCard && stepCard.card.value.redo?.open) {
      if (voiceReady()) return void toggleVoice('instruction');
      say({ source: 'Voice', text: 'Speaking needs the live model. Pick one of the ready instructions.' });
      return;
    }
    if (newTask) return closeNewTask();
    openNewTask();
  });

  // The first stake during a run asks to stop.
  onSelect(home.stake, () => {
    if (phase === 'running' || phase === 'redoing') {
      runLine = 'Stop this job? Use Stop on the run card, or keep going.';
      refreshPanel();
    } else if (phase === 'done' && result) openDeliverable();
  });

  // Typing at the desk: the strip of the /app page.
  deskInput.mount((text) => void startTyped(text, 'typed'), () => liveAvailability(store.llm.peek()));

  // A recorded run pauses while the person can't see it.
  effect(() => {
    const visible = app.session.visible.value;
    const h = handle;
    if (!h || source.kind === 'live') return;
    if (!visible && !h.paused) {
      h.pause(true);
      say({ source: 'Run', text: 'Paused. It continues when you are back.' });
    } else if (visible && h.paused) h.pause(false);
  });

  offerEnvelopes();
  if (params.run) void startSample(params.run, 'sample');

  // ---------------------------------------------------------------- debug and scenario hooks
  registerDebug('run', {
    phase: () => phase,
    numbers: () => ({ ...numbers }),
    stations: () => stage.stations.map((s) => s.id),
    lit: () => stage.pool.lit(),
    result: () => result,
    project: () => project,
    source: () => source.kind,
    version: () => version,
    tiles: () => unitsLaid,
    ask: () => askCard?.askId ?? null,
    stepCard: () => stepCard?.stepId ?? null,
    deliverable: () => Boolean(deliverable),
    start: (sample: SampleId) => startSample(sample, 'sample'),
    task: (text: string) => startTyped(text, 'typed'),
    open: (stepId: string) => openStep(stepId),
    redo: (stepId: string, instruction: string) => redo(stepId, instruction, 'mouse'),
    answer: (i = 0) => {
      const id = askCard?.askId;
      const h = handle;
      if (id && h) {
        h.answer(id, `o${i + 1}`, 'mouse');
        closeAsk();
      }
    },
    skip: () => handle?.skip(),
    newTask: () => openNewTask(),
    openSite: () => openSite('mouse'),
    phone: () => sendToPhone(),
    preview: async () => (result ? previewOf(result) : null),
  });
  registerTest('resetIsland', () => {
    const w = store.world.peek();
    if (w) store.world.value = { ...w, plots: [], rev: w.rev + 1 };
    resetRun();
    project = null;
    phase = 'idle';
    closeRunPanel();
    offerEnvelopes();
    return true;
  });
}

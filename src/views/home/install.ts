/**
 * The home (order 10, required): sky and light on the seated frame, the person's own
 * plot, the bench with the inbox, the first stake, the "New task" stone, the Void/Room
 * cap and the settings tile, the island of finished projects and the caption rail.
 *
 * What a run does with these lives in src/views/run/; this file only builds the place
 * and the controls that work without a run (settings, the mode cap).
 */
import { effect } from '@preact/signals-core';
import type { App } from '../../app/boot/world';
import { registerDebug } from '../../app/debug';
import { zone } from '../../app/perf/zone';
import { createBench } from '../../kit/world/bench';
import { createFirstStake } from '../../kit/world/first-stake';
import { createHomePlot } from '../../kit/world/home';
import { createInbox } from '../../kit/world/inbox';
import { createIsland } from '../../kit/world/island';
import { createLight } from '../../kit/world/light';
import { createModeSwitch } from '../../kit/world/mode-switch';
import { createSettingsTile } from '../../kit/world/settings-tile';
import { createSky } from '../../kit/world/sky';
import { installKit } from '../../kit/world/time';
import { createVoiceStone } from '../../kit/world/voice-stone';
import { CaptionRail } from '../../kit/ui/boards';
import { mountPanel } from '../../kit/ui/root';
import { SettingsPanel } from '../../kit/ui/tools';
import { onSelect } from '../../interact/select';
import { target } from '../../interact/targets';
import { say } from '../../feel/captions';
import { LAYOUT, SEAT } from '../../tokens/tokens';
import { setScene } from '../scene';

export const order = 10;

export function install(app: App): void {
  const { world, roots, store } = app;
  installKit(world, app.clock);

  // ---- sky and light hang on the seated frame
  const sky = createSky(world);
  const light = createLight(world);
  roots.seat.add(sky.root, light.root);
  effect(() => {
    const mode = store.mode.value === 'room' ? 'room' : 'void';
    sky.setMode(mode);
    light.setMode(mode);
  });

  // ---- the person's own plot under the seat
  const home = createHomePlot();
  home.position.set(0, -SEAT.benchBelowEyes + LAYOUT.homePlot.y, 0);
  roots.home.add(home);

  // ---- the bench and what lies on it
  const bench = createBench();
  roots.bench.add(bench.root);
  const inbox = createInbox();
  bench.attach('inbox', inbox.root);
  target('inbox', inbox.root);
  const stake = createFirstStake();
  bench.attach('firstStake', stake);
  target('first-stake', stake);
  const stone = createVoiceStone();
  bench.attach('voiceStone', stone.root);
  target('new-task', stone.root);
  const modeSwitch = createModeSwitch();
  bench.attach('modeSwitch', modeSwitch.root);
  target('mode-switch', modeSwitch.root);
  const settingsTile = createSettingsTile();
  bench.attach('settingsTile', settingsTile);
  target('settings', settingsTile);

  // ---- the island of finished projects
  const island = createIsland();
  zone(island.root, 'ring');
  roots.ring.add(island.root);
  let lastKey = '';
  effect(() => {
    const plots = store.world.value?.plots ?? [];
    const key = plots.map((p) => `${p.slot}:${p.projectId}:${p.tiles}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    island.setPlots(plots);
  });

  // ---- the caption rail behind the bench
  mountPanel('rail', new CaptionRail({}), { x: 0, y: 0 });

  // ---- the Void/Room cap: only inside a session that can show the room
  onSelect(modeSwitch.root, () => {
    if (store.mode.peek() === 'desk') {
      say({ source: 'Room', text: 'Room needs the headset. Here the world stays as it is.' });
      return;
    }
    if (!app.session.roomPossible()) {
      say({ source: 'Room', text: "This headset can't show your room here. The Void stays." });
      return;
    }
    const next = store.mode.peek() === 'room' ? 'void' : 'room';
    modeSwitch.setMode(next);
    app.session.setMode(next);
  });

  // ---- settings: the tile opens the panel at the side, a second select closes it
  let settings: { panel: SettingsPanel; mount: { unmount(): void } } | null = null;
  const closeSettings = (): void => {
    settings?.mount.unmount();
    settings?.panel.dispose();
    settings = null;
  };
  onSelect(settingsTile, () => {
    if (settings) return closeSettings();
    const panel = new SettingsPanel({
      settings: store.settings.peek(),
      onChange: (patch) => {
        store.settings.value = { ...store.settings.peek(), ...patch };
      },
      onRecenter: () => app.recenter(),
    });
    settings = { panel, mount: mountPanel('side', panel, { x: 0, y: 0 }) };
  });

  app.bench = bench;
  app.inbox = inbox;
  app.island = island;
  setScene({ sky, light, home, bench, inbox, stake, stone, modeSwitch, settingsTile, island });
  registerDebug('home', { sky, bench, inbox, island, stake, stone });
}

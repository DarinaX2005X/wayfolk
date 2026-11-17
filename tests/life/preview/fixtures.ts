// Twelve sample residents for the preview, one per species, each with a trade.
import type { Resident, Species, Trade, Vehicle } from '../../../src/mind/types';

const rows: [string, Species, Trade, Vehicle, string, string, number, number, Resident['voice']['timbre']][] = [
  ['Juniper', 'fox', 'baker', 'balloon', '#e9813f', '#3f6e8c', 1.05, 1.0, 'warm'],
  ['Pell', 'rabbit', 'gardener', 'kite', '#efe3d3', '#d9677a', 1.3, 1.2, 'bright'],
  ['Mirela', 'cat', 'stargazer', 'lantern', '#9aa3ad', '#2f4f7f', 1.15, 0.9, 'soft'],
  ['Borro', 'bear', 'tea-maker', 'cloud-whale', '#a06a43', '#c7413b', 0.7, 0.8, 'warm'],
  ['Quill', 'frog', 'musician', 'paper-boat', '#76b54a', '#c7413b', 0.85, 1.25, 'croaky'],
  ['Odile', 'owl', 'storyteller', 'lantern', '#8c6a4f', '#3d5a80', 0.9, 0.85, 'soft'],
  ['Fennel', 'deer', 'painter', 'umbrella', '#c48a52', '#5b8f5a', 1.1, 1.0, 'soft'],
  ['Tamsin', 'hedgehog', 'tinkerer', 'balloon', '#d9b48c', '#b5523b', 1.2, 1.3, 'bright'],
  ['Rook', 'raccoon', 'cartographer', 'kite', '#8e8f94', '#d98c3a', 0.95, 1.1, 'croaky'],
  ['Pim', 'penguin', 'lighthouse-keeper', 'paper-boat', '#2f3b52', '#e8574a', 0.8, 0.9, 'warm'],
  ['Wren', 'mouse', 'beekeeper', 'umbrella', '#b9a89a', '#e3b23c', 1.45, 1.4, 'bright'],
  ['Ottoline', 'otter', 'fisher', 'cloud-whale', '#7b5235', '#e3b23c', 1.0, 1.05, 'warm'],
];

export const RESIDENTS: Resident[] = rows.map(([name, species, trade, vehicle, main, accent, pitch, rate, timbre], i) => ({
  id: `r${i}`,
  name,
  species,
  trade,
  vehicle,
  personality: 'Gentle and curious.',
  voice: { pitch, rate, timbre },
  colors: { main, accent },
  story: { intro: 'Hello.', beats: [], secret: '', revealed: 0 },
  likes: [],
  memory: [],
  arrivedAt: 0,
}));

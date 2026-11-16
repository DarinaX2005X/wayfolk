/**
 * Registers the one general job with the runner. Importing this module (the runner does)
 * is what makes startRun able to run a task.
 */
import { registerJob } from '../job';
import { Engine } from './engine';

registerJob((ctx) => new Engine(ctx).run());

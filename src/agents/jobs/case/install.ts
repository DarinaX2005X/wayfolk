/**
 * Registers the case job with the runner: the first run and later pages.
 */
import { registerJob } from '../../job';
import { runCase } from './job';

registerJob('case', 'full', runCase);
registerJob('case', 'late', runCase);

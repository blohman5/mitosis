import { componentToDjango } from '../generators/django';
import { runTestsForTarget } from './test-generator';

describe('Django', () => {
  runTestsForTarget({
    target: 'django',
    generator: componentToDjango,
    options: {},
  });
});

import { expect, test } from 'vitest';
import { symbols } from '../src/index.js';

test('returns symbol data', () => {
  expect(symbols['BCNCAR01']).toEqual({
    description: 'cardinal beacon, north, simplified',
    height: 6.44,
    offset: [
      4.33,
      6.43,
    ],
    width: 4.34,
  });
});

import { expect, test } from 'vitest';
import { FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl';
import { instructionsToStyles } from '../../src/instructions/index.js';

test('AC(CHBRN)', () => {
  const styles = instructionsToStyles("AC(CHBRN)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as FillLayerSpecification
  expect(style.type).toBe('fill')
  expect(style.paint!['fill-color']).toBe('#A19653')
  expect(style.paint!['fill-opacity']).toBe(1.0)
})

test('AC(TRFCF,3)', () => {
  const styles = instructionsToStyles("AC(TRFCF,3)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as FillLayerSpecification
  expect(style.type).toBe('fill')
  expect(style.paint!['fill-color']).toBe('#CBA9F9')
  expect(style.paint!['fill-opacity']).toBe(0.25)
})

test('AP(DQUALA21)', () => {
  const styles = instructionsToStyles("AP(DQUALA21)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as FillLayerSpecification
  expect(style.type).toBe('fill')
  expect(style.paint!['fill-pattern']).toBe('DQUALA21')
})

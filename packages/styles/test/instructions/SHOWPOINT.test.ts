import { test, expect } from 'vitest';
import { instructionsToStyles } from '../../src/instructions/index.js';
import { SymbolLayerSpecification } from 'maplibre-gl';

test("SY(BOYCAR01)", () => {
  const styles = instructionsToStyles("SY(BOYCAR01)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as SymbolLayerSpecification
  expect(style.type).toBe('symbol')
  expect(style.layout!['icon-image']).toBe('BOYCAR01')
})

test('SY(FAIRWY52,135)', () => {
  const styles = instructionsToStyles("SY(FAIRWY52,135)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as SymbolLayerSpecification
  expect(style.type).toBe('symbol')
  expect(style.layout!['icon-image']).toBe('FAIRWY52')
  expect(style.layout!['icon-rotate']).toBe(135)
})

test("SY(EBBSTR01,ORIENT)", () => {
  const styles = instructionsToStyles("SY(EBBSTR01,ORIENT)")
  expect(styles).toHaveLength(1)
  const style = styles[0] as SymbolLayerSpecification
  expect(style.type).toBe('symbol')
  expect(style.layout!['icon-image']).toBe('EBBSTR01')
  expect(style.layout!['icon-rotate']).toEqual(['get', 'ORIENT'])
})

import { describe, expect, it } from 'vitest';
import {
  HIP_Y,
  SEAT_HEIGHT,
  SEATED_HIP_Y,
  SEATED_SHIN_SCALE,
  SHIN_LENGTH,
  THIGH_LENGTH,
  THIGH_THICKNESS,
} from './dimensions';

describe('dimensioni personaggio/sedia', () => {
  it('in piedi: anca = coscia + stinco (piedi a terra)', () => {
    expect(HIP_Y - THIGH_LENGTH - SHIN_LENGTH).toBeCloseTo(0, 6);
  });

  it('seduto: la coscia poggia sulla seduta', () => {
    expect(SEATED_HIP_Y - THIGH_THICKNESS / 2).toBeCloseTo(SEAT_HEIGHT, 6);
  });

  it('seduto: lo stinco verticale dal ginocchio (ad altezza anca) arriva al pavimento', () => {
    expect(Math.abs(SEATED_HIP_Y - SHIN_LENGTH * SEATED_SHIN_SCALE)).toBeLessThan(0.005);
  });

  it('seduta bassa ma non a terra, stinco allungato con moderazione', () => {
    expect(SEAT_HEIGHT).toBeGreaterThan(0.2);
    expect(SEAT_HEIGHT).toBeLessThanOrEqual(0.3);
    expect(SEATED_SHIN_SCALE).toBeGreaterThanOrEqual(1);
    expect(SEATED_SHIN_SCALE).toBeLessThan(1.7);
  });
});

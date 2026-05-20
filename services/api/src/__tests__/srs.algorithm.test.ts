import { describe, it, expect } from 'vitest';
import { calculateNextInterval } from '../services/srs.service';

// Baseline card state — represents a mid-progress card
const baseCard = {
  ease_factor:       2.5,
  interval_days:     6,
  repetition_count:  2,
};

// Ease delta formula: 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
function expectedEase(startEase: number, quality: number): number {
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  return Math.max(1.3, Math.min(3.0, startEase + delta));
}

describe('calculateNextInterval – quality grades', () => {
  it('quality 5 (perfect): ease increases, interval advances', () => {
    const r = calculateNextInterval(baseCard, 5);
    expect(r.ease_factor).toBeCloseTo(2.6, 5);
    expect(r.interval_days).toBe(Math.round(6 * 2.5)); // 15
    expect(r.repetition_count).toBe(3);
    expect(r.next_review_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('quality 4 (good): ease unchanged, interval advances', () => {
    const r = calculateNextInterval(baseCard, 4);
    expect(r.ease_factor).toBeCloseTo(2.5, 5);
    expect(r.interval_days).toBe(Math.round(6 * 2.5)); // 15
    expect(r.repetition_count).toBe(3);
  });

  it('quality 3 (hard pass): ease decreases, interval still advances', () => {
    const r = calculateNextInterval(baseCard, 3);
    expect(r.ease_factor).toBeCloseTo(expectedEase(2.5, 3), 5); // ~2.36
    expect(r.ease_factor).toBeLessThan(2.5);
    expect(r.interval_days).toBe(Math.round(6 * 2.5)); // still advances for quality >= 3
    expect(r.repetition_count).toBe(3);
  });

  it('quality 2 (fail): interval resets to 1, repetition_count resets to 0', () => {
    const r = calculateNextInterval(baseCard, 2);
    expect(r.interval_days).toBe(1);
    expect(r.repetition_count).toBe(0);
    expect(r.ease_factor).toBeCloseTo(expectedEase(2.5, 2), 5);
  });

  it('quality 0 (blackout): interval resets, ease drops significantly', () => {
    const r = calculateNextInterval(baseCard, 0);
    expect(r.interval_days).toBe(1);
    expect(r.repetition_count).toBe(0);
    expect(r.ease_factor).toBeCloseTo(expectedEase(2.5, 0), 5); // ~1.7
    expect(r.ease_factor).toBeGreaterThanOrEqual(1.3); // clamped
  });
});

describe('calculateNextInterval – repetition milestones', () => {
  it('first pass (repetition_count=0): interval becomes 1', () => {
    const card = { ...baseCard, repetition_count: 0, interval_days: 1 };
    const r = calculateNextInterval(card, 5);
    expect(r.interval_days).toBe(1);
    expect(r.repetition_count).toBe(1);
  });

  it('second pass (repetition_count=1): interval becomes 3', () => {
    const card = { ...baseCard, repetition_count: 1, interval_days: 1 };
    const r = calculateNextInterval(card, 5);
    expect(r.interval_days).toBe(3);
    expect(r.repetition_count).toBe(2);
  });

  it('third pass (repetition_count=2): interval = round(interval * ease_factor)', () => {
    const card = { ...baseCard, repetition_count: 2, interval_days: 3, ease_factor: 2.5 };
    const r = calculateNextInterval(card, 5);
    expect(r.interval_days).toBe(Math.round(3 * 2.5)); // 8
    expect(r.repetition_count).toBe(3);
  });
});

describe('calculateNextInterval – ease_factor clamping', () => {
  it('ease_factor never exceeds 3.0', () => {
    const card = { ...baseCard, ease_factor: 2.95, interval_days: 10, repetition_count: 3 };
    const r = calculateNextInterval(card, 5);
    expect(r.ease_factor).toBeLessThanOrEqual(3.0);
  });

  it('ease_factor never drops below 1.3', () => {
    const card = { ...baseCard, ease_factor: 1.35, interval_days: 2, repetition_count: 3 };
    const r = calculateNextInterval(card, 0);
    expect(r.ease_factor).toBeGreaterThanOrEqual(1.3);
  });

  it('ease_factor at exact floor 1.3 after repeated failures', () => {
    let card = { ease_factor: 1.3, interval_days: 1, repetition_count: 0 };
    for (let i = 0; i < 5; i++) {
      const r = calculateNextInterval(card, 0);
      expect(r.ease_factor).toBeGreaterThanOrEqual(1.3);
      card = { ease_factor: r.ease_factor, interval_days: r.interval_days, repetition_count: r.repetition_count };
    }
  });
});

describe('calculateNextInterval – next_review_at', () => {
  it('next_review_at is set to interval_days days in the future', () => {
    const r = calculateNextInterval(baseCard, 5);
    const expectedDays = r.interval_days;
    const nowMs = Date.now();
    const diffMs = r.next_review_at.getTime() - nowMs;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(expectedDays, 0);
  });

  it('failed card (quality=0) next_review_at is 1 day out', () => {
    const r = calculateNextInterval(baseCard, 0);
    const diffMs = r.next_review_at.getTime() - Date.now();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(1, 0);
  });
});

import { describe, it, expect } from 'vitest';
import { updateConceptMastery, updateStrategySuccessRate } from '../services/learner-model.service';

describe('updateConceptMastery – EWMA', () => {
  it('starts a new concept at the default 0.3 confidence baseline', () => {
    const r = updateConceptMastery(undefined, { passed: true, confidence: 0.3, difficultyLevel: 1 });
    // alpha=0.35, signal=0.3 -> 0.35*0.3 + 0.65*0.3 = 0.3
    expect(r.confidence).toBeCloseTo(0.3, 5);
    expect(r.checks_passed).toBe(1);
    expect(r.checks_failed).toBe(0);
    expect(r.highest_level_passed).toBe(1);
    expect(r.last_confirmed_at).toBeInstanceOf(Date);
  });

  it('a confident pass moves confidence up toward the signal', () => {
    const prior = { confidence: 0.3, checks_passed: 0, checks_failed: 0, highest_level_passed: 0, sessions_count: 0 };
    const r = updateConceptMastery(prior, { passed: true, confidence: 0.9, difficultyLevel: 2 });
    // 0.35*0.9 + 0.65*0.3 = 0.315 + 0.195 = 0.51
    expect(r.confidence).toBeCloseTo(0.51, 5);
    expect(r.highest_level_passed).toBe(2);
  });

  it('a confident fail moves confidence down (small positive signal only)', () => {
    const prior = { confidence: 0.7, checks_passed: 3, checks_failed: 0, highest_level_passed: 2, sessions_count: 1 };
    const r = updateConceptMastery(prior, { passed: false, confidence: 0.9, difficultyLevel: 2 });
    // signal = (1-0.9)*0.3 = 0.03 -> 0.35*0.03 + 0.65*0.7 = 0.0105 + 0.455 = 0.4655
    expect(r.confidence).toBeCloseTo(0.4655, 5);
    expect(r.checks_failed).toBe(1);
    expect(r.checks_passed).toBe(3);
    // highest_level_passed unchanged on a fail
    expect(r.highest_level_passed).toBe(2);
  });

  it('an uncertain fail barely moves confidence', () => {
    const prior = { confidence: 0.5, checks_passed: 1, checks_failed: 0, highest_level_passed: 1, sessions_count: 1 };
    const r = updateConceptMastery(prior, { passed: false, confidence: 0.1, difficultyLevel: 1 });
    // signal = (1-0.1)*0.3 = 0.27 -> 0.35*0.27 + 0.65*0.5 = 0.0945 + 0.325 = 0.4195
    expect(r.confidence).toBeCloseTo(0.4195, 5);
  });

  it('confidence never leaves [0, 1]', () => {
    let mastery = { confidence: 0.99, checks_passed: 0, checks_failed: 0, highest_level_passed: 3, sessions_count: 0 };
    for (let i = 0; i < 20; i++) {
      mastery = updateConceptMastery(mastery, { passed: true, confidence: 1, difficultyLevel: 3 });
    }
    expect(mastery.confidence).toBeLessThanOrEqual(1);

    let low = { confidence: 0.01, checks_passed: 0, checks_failed: 0, highest_level_passed: 0, sessions_count: 0 };
    for (let i = 0; i < 20; i++) {
      low = updateConceptMastery(low, { passed: false, confidence: 1, difficultyLevel: 0 });
    }
    expect(low.confidence).toBeGreaterThanOrEqual(0);
  });

  it('does not lower highest_level_passed once achieved', () => {
    const prior = { confidence: 0.6, checks_passed: 2, checks_failed: 0, highest_level_passed: 3, sessions_count: 1 };
    const r = updateConceptMastery(prior, { passed: true, confidence: 0.8, difficultyLevel: 1 });
    expect(r.highest_level_passed).toBe(3);
  });
});

describe('updateStrategySuccessRate – running mean', () => {
  it('first sample sets the rate directly (from a 0.5 prior)', () => {
    const r = updateStrategySuccessRate(undefined, undefined, true);
    expect(r.count).toBe(1);
    expect(r.rate).toBeCloseTo(1.0, 5); // 0.5 + (1-0.5)/1
  });

  it('is the exact sample mean — the 0.5 seed has zero weight once the first sample lands', () => {
    let rate: number | undefined;
    let count: number | undefined;
    // 8 passes, 2 fails -> exact mean 0.8. The recurrence divides by `count`
    // starting at 1 on the first call, which fully replaces the 0.5 seed
    // rather than blending it in as a pseudo-observation.
    const outcomes = [true, true, true, true, true, true, true, true, false, false];
    for (const passed of outcomes) {
      const r = updateStrategySuccessRate(rate, count, passed);
      rate = r.rate;
      count = r.count;
    }
    expect(count).toBe(10);
    expect(rate!).toBeCloseTo(0.8, 5);
  });

  it('a failed strategy never reused in the same session is exercised via the caller, not here — this only checks the math stays a valid probability', () => {
    let rate: number | undefined;
    let count: number | undefined;
    for (let i = 0; i < 50; i++) {
      const r = updateStrategySuccessRate(rate, count, false);
      rate = r.rate;
      count = r.count;
    }
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
    expect(rate!).toBeCloseTo(0, 1);
  });
});

import { describe, it, expect } from 'vitest';
import { selectStrategy, STRATEGY_MAP, type SelectStrategyParams } from '../services/strategy.service';
import type { ExplanationStrategy } from '@college-chatbot/shared';

const base: SelectStrategyParams = {
  conceptType: 'law_relationship',
  hasRelevantImage: true,
  strategiesFailed: [],
  strategiesAttempted: [],
  analogyPolicy: 'sparing',
  mnemonicPolicy: 'only_for_lists',
  strategySuccessRates: {},
  strategyPreferenceOrder: [],
};

describe('selectStrategy', () => {
  it('never reselects a strategy that already failed this session', () => {
    const failed: ExplanationStrategy[] = STRATEGY_MAP.law_relationship.slice(0, 3);
    const picked = selectStrategy({ ...base, strategiesFailed: failed });
    expect(failed).not.toContain(picked);
  });

  it('excludes visual_spatial when no image is available', () => {
    const results = new Set<ExplanationStrategy>();
    for (let i = 0; i < 20; i++) {
      results.add(selectStrategy({
        ...base,
        conceptType: 'process_mechanism', // visual_spatial is first-ranked here
        hasRelevantImage: false,
        strategiesFailed: [...results],
      }));
    }
    expect(results.has('visual_spatial')).toBe(false);
  });

  it('respects analogy_policy = avoid', () => {
    const picked = selectStrategy({
      ...base,
      conceptType: 'structure_anatomy', // analogy is in the map here
      analogyPolicy: 'avoid',
      strategySuccessRates: { analogy: 1.0 }, // would otherwise be picked first
    });
    expect(picked).not.toBe('analogy');
  });

  it('respects mnemonic_policy = only_for_lists outside classification', () => {
    const picked = selectStrategy({
      ...base,
      conceptType: 'structure_anatomy',
      mnemonicPolicy: 'only_for_lists',
      strategySuccessRates: { mnemonic: 1.0 },
    });
    expect(picked).not.toBe('mnemonic');
  });

  it('allows mnemonic for classification even with only_for_lists', () => {
    const candidates = STRATEGY_MAP.classification;
    expect(candidates).toContain('mnemonic');
  });

  it('never returns an antipattern strategy for the concept type', () => {
    const picked = selectStrategy({ ...base, conceptType: 'process_mechanism' });
    expect(picked).not.toBe('mnemonic'); // antipattern for process_mechanism
  });

  it('falls back to concrete_instance when every mapped strategy has failed', () => {
    const picked = selectStrategy({
      ...base,
      strategiesFailed: [...STRATEGY_MAP.law_relationship],
    });
    expect(picked).toBe('concrete_instance');
  });

  it('prefers the strategy with the highest learner success rate among candidates', () => {
    const picked = selectStrategy({
      ...base,
      conceptType: 'classification',
      strategySuccessRates: { contrast_pair: 0.2, mnemonic: 0.95, concrete_instance: 0.5 },
    });
    expect(picked).toBe('mnemonic');
  });

  it('uses faculty preference order as a tiebreaker when success rates are equal', () => {
    const picked = selectStrategy({
      ...base,
      conceptType: 'classification',
      strategySuccessRates: {},
      strategyPreferenceOrder: ['concrete_instance', 'contrast_pair', 'mnemonic', 'visual_spatial'],
    });
    expect(picked).toBe('concrete_instance');
  });
});

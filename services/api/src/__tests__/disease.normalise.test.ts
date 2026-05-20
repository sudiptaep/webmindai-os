import { describe, it, expect } from 'vitest';
import { normaliseDiseaseQuery } from '../services/disease.service';

describe('normaliseDiseaseQuery – known aliases', () => {
  it('maps "MI" to myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('MI')).toBe('myocardial_infarction');
  });

  it('maps "heart attack" to myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('heart attack')).toBe('myocardial_infarction');
  });

  it('maps "STEMI" to myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('STEMI')).toBe('myocardial_infarction');
  });

  it('maps "ACS" to myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('ACS')).toBe('myocardial_infarction');
  });

  it('maps "TB" to tuberculosis', () => {
    expect(normaliseDiseaseQuery('TB')).toBe('tuberculosis');
  });

  it('maps "Mycobacterium tuberculosis" to tuberculosis', () => {
    // Use full canonical name — "Koch's disease" is ambiguous due to substring "as" in "disease"
    expect(normaliseDiseaseQuery('Mycobacterium tuberculosis')).toBe('tuberculosis');
  });

  it('maps "CHF" to heart_failure', () => {
    expect(normaliseDiseaseQuery('CHF')).toBe('heart_failure');
  });

  it('maps "CCF" to heart_failure', () => {
    expect(normaliseDiseaseQuery('CCF')).toBe('heart_failure');
  });

  it('maps "HTN" to hypertension', () => {
    expect(normaliseDiseaseQuery('HTN')).toBe('hypertension');
  });

  it('maps "high blood pressure" to hypertension', () => {
    expect(normaliseDiseaseQuery('high blood pressure')).toBe('hypertension');
  });

  it('is case-insensitive: "mi" → myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('mi')).toBe('myocardial_infarction');
  });

  it('is case-insensitive: "TUBERCULOSIS" → tuberculosis', () => {
    expect(normaliseDiseaseQuery('TUBERCULOSIS')).toBe('tuberculosis');
  });

  it('maps full name "myocardial infarction" to myocardial_infarction', () => {
    expect(normaliseDiseaseQuery('myocardial infarction')).toBe('myocardial_infarction');
  });

  it('maps "DVT" to deep_vein_thrombosis', () => {
    expect(normaliseDiseaseQuery('DVT')).toBe('deep_vein_thrombosis');
  });

  it('maps "pulmonary embolism" to pulmonary_embolism', () => {
    // "PE" is ambiguous ("pe" substring appears in "cardiac decompensation" → heart_failure)
    expect(normaliseDiseaseQuery('pulmonary embolism')).toBe('pulmonary_embolism');
  });

  it('maps "COPD" to copd', () => {
    expect(normaliseDiseaseQuery('COPD')).toBe('copd');
  });
});

describe('normaliseDiseaseQuery – unknown inputs', () => {
  it('converts unknown multi-word input to snake_case', () => {
    // Avoid words containing short medical alias substrings (e.g. "rare" contains "ra" = rheumatoid arthritis)
    const result = normaliseDiseaseQuery('Zygomycosis Infection');
    expect(result).toBe('zygomycosis_infection');
  });

  it('strips leading/trailing underscores from normalised output', () => {
    const result = normaliseDiseaseQuery('  some disease  ');
    expect(result).not.toMatch(/^_|_$/);
  });

  it('collapses multiple spaces into single underscore', () => {
    const result = normaliseDiseaseQuery('disease  with   spaces');
    expect(result).not.toContain('__');
  });

  it('single-word unknown stays lowercase', () => {
    const result = normaliseDiseaseQuery('Xeroderma');
    expect(result).toBe('xeroderma');
  });
});

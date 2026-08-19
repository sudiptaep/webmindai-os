import { describe, it, expect } from 'vitest';
import { computeBacktrackHotspots, type BacktrackPair } from '../services/teaching-analytics.service';

describe('computeBacktrackHotspots', () => {
  it('flags a concept whose backtrack rate clears the threshold', () => {
    const sessionCounts = new Map([['countercurrent-multiplier', 63]]);
    const pairs: BacktrackPair[] = [
      { conceptId: 'countercurrent-multiplier', prerequisiteId: 'osmolarity-gradients', count: 32 }, // ~51%
    ];
    const hotspots = computeBacktrackHotspots(sessionCounts, pairs, 0.30, 5);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]).toMatchObject({
      concept_id: 'countercurrent-multiplier',
      prerequisite_id: 'osmolarity-gradients',
      count: 32,
      sessions: 63,
    });
    expect(hotspots[0].rate).toBeCloseTo(32 / 63, 5);
  });

  it('does not flag a concept below the threshold', () => {
    const sessionCounts = new Map([['cardiac-output', 71]]);
    const pairs: BacktrackPair[] = [
      { conceptId: 'cardiac-output', prerequisiteId: 'stroke-volume', count: 8 }, // ~11%
    ];
    const hotspots = computeBacktrackHotspots(sessionCounts, pairs, 0.30, 5);
    expect(hotspots).toHaveLength(0);
  });

  it('ignores a concept with too few sessions to trust the rate, even at 100%', () => {
    const sessionCounts = new Map([['rare-concept', 3]]);
    const pairs: BacktrackPair[] = [
      { conceptId: 'rare-concept', prerequisiteId: 'some-prereq', count: 3 }, // 100% but n=3
    ];
    const hotspots = computeBacktrackHotspots(sessionCounts, pairs, 0.30, 5);
    expect(hotspots).toHaveLength(0);
  });

  it('picks the most common prerequisite gap when a concept has several', () => {
    const sessionCounts = new Map([['frank-starling', 84]]);
    const pairs: BacktrackPair[] = [
      { conceptId: 'frank-starling', prerequisiteId: 'preload', count: 10 },
      { conceptId: 'frank-starling', prerequisiteId: 'sarcomere-overlap', count: 22 }, // dominant gap
    ];
    const hotspots = computeBacktrackHotspots(sessionCounts, pairs, 0.20, 5);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].prerequisite_id).toBe('sarcomere-overlap');
    expect(hotspots[0].count).toBe(22);
  });

  it('sorts multiple hotspots by rate descending', () => {
    const sessionCounts = new Map([
      ['concept-a', 20],
      ['concept-b', 20],
    ]);
    const pairs: BacktrackPair[] = [
      { conceptId: 'concept-a', prerequisiteId: 'prereq-a', count: 8 },  // 40%
      { conceptId: 'concept-b', prerequisiteId: 'prereq-b', count: 14 }, // 70%
    ];
    const hotspots = computeBacktrackHotspots(sessionCounts, pairs, 0.30, 5);
    expect(hotspots.map((h) => h.concept_id)).toEqual(['concept-b', 'concept-a']);
  });

  it('returns nothing when there are no backtrack pairs at all', () => {
    const sessionCounts = new Map([['clean-concept', 50]]);
    expect(computeBacktrackHotspots(sessionCounts, [], 0.30, 5)).toEqual([]);
  });
});

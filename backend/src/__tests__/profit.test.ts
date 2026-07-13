import { describe, expect, it } from 'vitest';
import { roundMoney, weightedAverageCost } from '../utils/profit';

describe('profit utils', () => {
  it('roundMoney keeps 4 decimal places', () => {
    expect(roundMoney(1.23456)).toBe(1.2346);
    expect(roundMoney(10.1)).toBe(10.1);
    expect(roundMoney(NaN)).toBe(0);
  });

  it('weightedAverageCost blends old stock with receipt', () => {
    // 10 @ $5 + 10 @ $7 = 20 @ $6
    expect(weightedAverageCost(10, 5, 10, 7)).toBe(6);
  });

  it('weightedAverageCost uses receipt cost when no prior stock', () => {
    expect(weightedAverageCost(0, 5, 8, 12)).toBe(12);
  });

  it('weightedAverageCost keeps old cost when receive qty is 0', () => {
    expect(weightedAverageCost(5, 4, 0, 99)).toBe(4);
  });

  it('gross profit identity: net sales − cogs', () => {
    const netRevenue = 1000;
    const cogs = 600;
    const grossProfit = roundMoney(netRevenue - cogs);
    const margin = netRevenue > 0 ? roundMoney((grossProfit / netRevenue) * 100) : 0;
    expect(grossProfit).toBe(400);
    expect(margin).toBe(40);
  });
});

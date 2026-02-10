import { describe, expect, it } from 'vitest';
import { CronExpressionError, getNextCronRun, parseCronExpression } from '../cron-utils.js';

describe('parseCronExpression', () => {
  it('supports wildcard, range and step values', () => {
    const cron = parseCronExpression('*/15 9-17 * * 1-5');
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.minutes.has(45)).toBe(true);
    expect(cron.hours.has(9)).toBe(true);
    expect(cron.hours.has(17)).toBe(true);
    expect(cron.daysOfWeek.has(1)).toBe(true);
    expect(cron.daysOfWeek.has(5)).toBe(true);
  });

  it('throws for malformed expressions', () => {
    expect(() => parseCronExpression('* * * *')).toThrow(CronExpressionError);
    expect(() => parseCronExpression('0 0 1 13 *')).toThrow('Value out of range for month field');
  });
});

describe('getNextCronRun', () => {
  it('returns a future timestamp in the requested timezone', () => {
    const from = Date.UTC(2026, 1, 10, 1, 50, 0);
    const nextRun = getNextCronRun('0 2 * * *', from, 'UTC');

    expect(new Date(nextRun).toISOString()).toBe('2026-02-10T02:00:00.000Z');
  });
});

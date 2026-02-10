import { describe, expect, it } from 'vitest';
import { convertNaturalLanguageToCron } from '../nl-to-cron.js';

describe('convertNaturalLanguageToCron', () => {
  it('converts common daily and weekly schedules', () => {
    expect(convertNaturalLanguageToCron('run at 2am every night')).toEqual({
      cron: '0 2 * * *',
      description: 'Daily at 2:00 AM',
    });

    expect(convertNaturalLanguageToCron('weekdays at 8:30am')).toEqual({
      cron: '30 8 * * 1-5',
      description: 'Weekdays at 8:30 AM',
    });

    expect(convertNaturalLanguageToCron('every monday at 9am')).toEqual({
      cron: '0 9 * * 1',
      description: 'Every monday at 9:00 AM',
    });
  });

  it('converts interval and monthly schedules', () => {
    expect(convertNaturalLanguageToCron('every 6 hours')).toEqual({
      cron: '0 */6 * * *',
      description: 'Every 6 hours',
    });

    expect(convertNaturalLanguageToCron('every 15 minutes')).toEqual({
      cron: '*/15 * * * *',
      description: 'Every 15 minutes',
    });

    expect(convertNaturalLanguageToCron('monthly on the 10th at 6pm')).toEqual({
      cron: '0 18 10 * *',
      description: 'Monthly on day 10 at 6:00 PM',
    });
  });

  it('throws for empty or unsupported text', () => {
    expect(() => convertNaturalLanguageToCron('')).toThrow('Schedule cannot be empty.');
    expect(() => convertNaturalLanguageToCron('sometime after lunch maybe')).toThrow('Could not understand schedule.');
  });
});

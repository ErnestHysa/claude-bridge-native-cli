/**
 * Cron utilities with timezone-aware scheduling.
 */

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export const CRON_FIELD_RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 6 },
};

const DAY_OF_WEEK_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export class CronExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronExpressionError';
  }
}

export function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronExpressionError(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return {
    minutes: parseCronField(minute, CRON_FIELD_RANGES.minute, 'minute'),
    hours: parseCronField(hour, CRON_FIELD_RANGES.hour, 'hour'),
    daysOfMonth: parseCronField(dayOfMonth, CRON_FIELD_RANGES.dayOfMonth, 'dayOfMonth'),
    months: parseCronField(month, CRON_FIELD_RANGES.month, 'month'),
    daysOfWeek: parseCronField(dayOfWeek, CRON_FIELD_RANGES.dayOfWeek, 'dayOfWeek'),
  };
}

export function getNextCronRun(
  expression: string,
  fromTimestamp: number,
  timezone: string,
  maxMinutesAhead = 525600,
): number {
  const fields = parseCronExpression(expression);
  const start = new Date(fromTimestamp + 60000);
  const startMinute = new Date(start.getTime());
  startMinute.setSeconds(0, 0);

  for (let offset = 0; offset < maxMinutesAhead; offset += 1) {
    const candidate = new Date(startMinute.getTime() + offset * 60000);
    if (matchesCron(fields, candidate, timezone)) {
      return candidate.getTime();
    }
  }

  throw new CronExpressionError(`Unable to find next run within ${maxMinutesAhead} minutes.`);
}

export function matchesCron(fields: CronFields, date: Date, timezone: string): boolean {
  const parts = getZonedDateParts(date, timezone);
  const dayMatches = fields.daysOfMonth.has(parts.day);
  const weekdayMatches = fields.daysOfWeek.has(parts.weekday);
  const isDomWildcard = fields.daysOfMonth.size === 31;
  const isDowWildcard = fields.daysOfWeek.size === 7;
  const daySatisfied = (isDomWildcard || isDowWildcard)
    ? dayMatches && weekdayMatches
    : dayMatches || weekdayMatches;

  return (
    fields.minutes.has(parts.minute) &&
    fields.hours.has(parts.hour) &&
    fields.months.has(parts.month) &&
    daySatisfied
  );
}

interface ZonedDateParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: '2-digit',
    hour: '2-digit',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map(part => [part.type, part.value]));

  const weekdayLabel = (lookup.get('weekday') || 'Sun').toLowerCase();
  const weekday = DAY_OF_WEEK_ALIASES[weekdayLabel.slice(0, 3)] ?? 0;

  return {
    minute: Number(lookup.get('minute')),
    hour: Number(lookup.get('hour')),
    day: Number(lookup.get('day')),
    month: Number(lookup.get('month')),
    weekday,
  };
}

function parseCronField(
  value: string,
  range: { min: number; max: number },
  fieldName: string,
): Set<number> {
  const result = new Set<number>();
  const parts = value.split(',');

  for (const part of parts) {
    if (part === '*') {
      for (let i = range.min; i <= range.max; i += 1) {
        result.add(i);
      }
      continue;
    }

    const [base, step] = part.split('/');
    const stepValue = step ? Number(step) : 1;
    if (Number.isNaN(stepValue) || stepValue <= 0) {
      throw new CronExpressionError(`Invalid step in ${fieldName} field: ${part}`);
    }

    const rangeValues = parseCronRange(base, range, fieldName);
    for (let i = 0; i < rangeValues.length; i += stepValue) {
      result.add(rangeValues[i]);
    }
  }

  return result;
}

function parseCronRange(
  value: string,
  range: { min: number; max: number },
  fieldName: string,
): number[] {
  if (value === '*') {
    return Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i);
  }

  const normalized = normalizeDayOfWeek(value, fieldName);
  if (normalized.includes('-')) {
    const [startRaw, endRaw] = normalized.split('-');
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new CronExpressionError(`Invalid range in ${fieldName} field: ${value}`);
    }
    if (start > end) {
      throw new CronExpressionError(`Invalid range order in ${fieldName} field: ${value}`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  const numeric = Number(normalized);
  if (Number.isNaN(numeric)) {
    throw new CronExpressionError(`Invalid value in ${fieldName} field: ${value}`);
  }

  if (numeric < range.min || numeric > range.max) {
    throw new CronExpressionError(`Value out of range for ${fieldName} field: ${numeric}`);
  }

  return [numeric];
}

function normalizeDayOfWeek(value: string, fieldName: string): string {
  if (fieldName !== 'dayOfWeek') {
    return value;
  }

  const lower = value.toLowerCase();
  if (DAY_OF_WEEK_ALIASES[lower] !== undefined) {
    return String(DAY_OF_WEEK_ALIASES[lower]);
  }

  if (lower.includes('-')) {
    const [start, end] = lower.split('-');
    if (DAY_OF_WEEK_ALIASES[start] !== undefined && DAY_OF_WEEK_ALIASES[end] !== undefined) {
      return `${DAY_OF_WEEK_ALIASES[start]}-${DAY_OF_WEEK_ALIASES[end]}`;
    }
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric === 7 ? '0' : String(numeric);
  }

  return value;
}

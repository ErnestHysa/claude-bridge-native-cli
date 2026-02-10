/**
 * Natural language to cron expression converter.
 */

export interface CronConversionResult {
  cron: string;
  description: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function convertNaturalLanguageToCron(input: string): CronConversionResult {
  const normalized = input.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Schedule cannot be empty.');
  }

  const timeMatch = normalized.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const hourMinute = timeMatch ? parseTime(timeMatch[1], timeMatch[2], timeMatch[3]) : null;

  if (normalized.includes('every minute')) {
    return { cron: '* * * * *', description: 'Every minute' };
  }

  const everyMinutes = normalized.match(/every\s+(\d{1,2})\s+minutes?/);
  if (everyMinutes) {
    const interval = Number(everyMinutes[1]);
    if (!Number.isNaN(interval) && interval > 0 && interval <= 59) {
      return { cron: `*/${interval} * * * *`, description: `Every ${interval} minutes` };
    }
  }

  if (normalized.includes('every hour')) {
    return { cron: '0 * * * *', description: 'Every hour' };
  }

  const everyHours = normalized.match(/every\s+(\d{1,2})\s+hours?/);
  if (everyHours) {
    const interval = Number(everyHours[1]);
    if (!Number.isNaN(interval) && interval > 0 && interval <= 23) {
      return { cron: `0 */${interval} * * *`, description: `Every ${interval} hours` };
    }
  }

  if (normalized.includes('daily') || normalized.includes('every day')) {
    const time = hourMinute ?? { hour: 9, minute: 0 };
    return { cron: `${time.minute} ${time.hour} * * *`, description: `Daily at ${formatTime(time.hour, time.minute)}` };
  }

  if (normalized.includes('weekdays')) {
    const time = hourMinute ?? { hour: 9, minute: 0 };
    return { cron: `${time.minute} ${time.hour} * * 1-5`, description: `Weekdays at ${formatTime(time.hour, time.minute)}` };
  }

  if (normalized.includes('weekends')) {
    const time = hourMinute ?? { hour: 9, minute: 0 };
    return { cron: `${time.minute} ${time.hour} * * 0,6`, description: `Weekends at ${formatTime(time.hour, time.minute)}` };
  }

  const weekdayMatch = normalized.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (weekdayMatch) {
    const day = WEEKDAY_MAP[weekdayMatch[1]];
    const time = hourMinute ?? { hour: 9, minute: 0 };
    return { cron: `${time.minute} ${time.hour} * * ${day}`, description: `Every ${weekdayMatch[1]} at ${formatTime(time.hour, time.minute)}` };
  }

  const monthlyMatch = normalized.match(/monthly(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?/);
  if (monthlyMatch) {
    const day = monthlyMatch[1] ? Number(monthlyMatch[1]) : 1;
    const time = hourMinute ?? { hour: 9, minute: 0 };
    if (day >= 1 && day <= 31) {
      return { cron: `${time.minute} ${time.hour} ${day} * *`, description: `Monthly on day ${day} at ${formatTime(time.hour, time.minute)}` };
    }
  }

  if (timeMatch) {
    const time = hourMinute ?? { hour: 9, minute: 0 };
    return { cron: `${time.minute} ${time.hour} * * *`, description: `Daily at ${formatTime(time.hour, time.minute)}` };
  }

  throw new Error('Could not understand schedule. Try phrases like "every day at 2am" or "weekdays at 8:30".');
}

function parseTime(hourRaw: string, minuteRaw?: string, period?: string | null): { hour: number; minute: number } {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return { hour: 9, minute: 0 };
  }

  if (period) {
    if (period === 'pm' && hour < 12) {
      hour += 12;
    }
    if (period === 'am' && hour === 12) {
      hour = 0;
    }
  }

  return { hour: Math.min(Math.max(hour, 0), 23), minute: Math.min(Math.max(minute, 0), 59) };
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

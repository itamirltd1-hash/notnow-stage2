import pool from '../db/pool.js';

// Anchored on digits rather than Hebrew words. Word-anchored patterns have
// broken three times on this project; a numeral is a numeral.
const STATED_HOUR = /(?:^|\s)ב[-־]?(\d{1,2})(?::(\d{2}))?(?=\s|$|[.,!?])/;

// If any of these appear, the person already said which half of the day.
const PERIOD_STATED =
  /בבוקר|לפנות\s+בוקר|בצהריים|אחה"?צ|אחר\s+הצהריים|בערב|בלילה|לפנות\s+ערב|am\b|pm\b/i;

/**
 * Did they name an hour that could be either half of the day?
 *
 * 8 is ambiguous; 19 is not; 8:30 still is. Returns the two candidate hours,
 * or null when there is nothing to ask about.
 */
export function detectAmbiguousHour(text) {
  if (PERIOD_STATED.test(text)) return null;

  const match = text.match(STATED_HOUR);
  if (!match) return null;

  const hour = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;

  // 0 and 13-23 are unambiguous; 12 reads as noon and is left alone.
  if (hour < 1 || hour > 11) return null;

  return { hour, minutes, morning: hour, evening: hour + 12 };
}

/**
 * Has this person already said what a given hour means to them?
 */
export async function recallHour(userId, statedHour) {
  try {
    const result = await pool.query(
      'SELECT resolved_hour FROM hour_preference WHERE user_id = $1 AND stated_hour = $2',
      [userId, statedHour]
    );
    return result.rows[0]?.resolved_hour ?? null;
  } catch (error) {
    console.error('Error reading hour preference:', error.message);
    return null;
  }
}

export async function rememberHour(userId, statedHour, resolvedHour) {
  try {
    await pool.query(
      `INSERT INTO hour_preference (user_id, stated_hour, resolved_hour)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, stated_hour)
       DO UPDATE SET resolved_hour = $3, updated_at = NOW()`,
      [userId, statedHour, resolvedHour]
    );
    console.log(`🕗 ${statedHour} means ${resolvedHour}:00 for user ${userId}`);
  } catch (error) {
    console.error('Error storing hour preference:', error.message);
  }
}

/**
 * Move a timestamp to a given hour of the day, keeping its date.
 * The date was already worked out against Israel time, so the shift is
 * applied in the same zone rather than in UTC.
 */
export function withHour(isoTimestamp, hour, minutes = 0) {
  const date = new Date(isoTimestamp);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const ymd = Object.fromEntries(parts.map(p => [p.type, p.value]));

  // Find the UTC instant whose Israel-local clock reads this hour on that day.
  const guess = new Date(`${ymd.year}-${ymd.month}-${ymd.day}T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
  const offsetMinutes = israelOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMinutes * 60_000).toISOString();
}

function israelOffsetMinutes(instant) {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const p = Object.fromEntries(local.map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

export function formatHour(hour, minutes = 0) {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

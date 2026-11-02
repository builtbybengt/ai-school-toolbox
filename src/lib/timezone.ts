/**
 * All date math ("today", Untis/Moodle dates) runs in the school's time zone,
 * not in the server's (Vercel runs in UTC). Override with TIMEZONE if needed.
 * Must be imported before any Date is created.
 */
process.env.TZ = process.env.TIMEZONE || 'Europe/Vienna';

export {};

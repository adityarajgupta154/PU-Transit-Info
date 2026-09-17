const IST_OFFSET_MS = 19_800_000;

/** Calendar date in Asia/Kolkata (yyyy-mm-dd), the service day the API and Rules reason about. */
export const serviceDateToday = (now = Date.now()): string => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

/** "Sun 8 Nov" for a yyyy-mm-dd service date, independent of the device time zone. */
export const serviceDateLabel = (date: string): string =>
  new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });

import type { Dayjs } from 'dayjs';

import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

// ----------------------------------------------------------------------

dayjs.extend(duration);
dayjs.extend(relativeTime);

// ----------------------------------------------------------------------

export type DatePickerFormat = Dayjs | Date | string | number | null | undefined;

/** ISO 8601 display formats in the viewer's local time zone. */
export const formatStr = {
  dateTime: 'YYYY-MM-DD[T]HH:mm:ssZ',
  date: 'YYYY-MM-DD',
  time: 'HH:mm:ssZ',
};

/** Returns today's ISO 8601 calendar date. */
export function today() {
  return dayjs().format(formatStr.date);
}

// ----------------------------------------------------------------------

/** output: 2026-09-25T19:37:18+02:00
 */
export function fDateTime(date: DatePickerFormat) {
  if (date === null || date === undefined || date === '') {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(formatStr.dateTime) : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: 2026-09-25
 */
export function fDate(date: DatePickerFormat) {
  if (date === null || date === undefined || date === '') {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(formatStr.date) : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: 19:37:18+02:00
 */
export function fTime(date: DatePickerFormat) {
  if (date === null || date === undefined || date === '') {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(formatStr.time) : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: 1713250100
 */
export function fTimestamp(date: DatePickerFormat) {
  if (date === null || date === undefined || date === '') {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).valueOf() : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: a few seconds, 2 years
 */
export function fToNow(date: DatePickerFormat) {
  if (date === null || date === undefined || date === '') {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).toNow(true) : 'Invalid time value';
}

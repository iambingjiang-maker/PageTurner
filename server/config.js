/**
 * San Mateo Main Library configuration, live Pacific Time hours, and BiblioCommons settings.
 */

export const LIBRARY_CONFIG = {
  name: 'San Mateo Main Library',
  systemName: 'San Mateo Public Library',
  shortName: 'SM Main',
  biblioSubdomain: 'smplibrary',
  catalogBaseUrl: 'https://smplibrary.bibliocommons.com',
  gatewayBaseUrl: 'https://gateway.bibliocommons.com/v2/libraries/smplibrary',
  timeZone: 'America/Los_Angeles',
};

/**
 * San Mateo Main Library (dedicated home branch).
 * Day-of-week schedule uses 0 = Sunday .. 6 = Saturday, times in 24h [openHour, openMin, closeHour, closeMin].
 */
export const MAIN_BRANCH = {
  id: 'main',
  biblioCode: '7S',
  statusFilterValue: '7S',
  matchTerms: ['main', 'san mateo main', '55 w', 'third ave', '3rd ave', '7s', 'sma'],
  name: 'San Mateo Main Library',
  shortName: 'Main Library',
  address: '55 W. Third Ave, San Mateo, CA 94402',
  phone: '(650) 522-7800',
  mapsUrl: 'https://maps.google.com/?q=55+W+Third+Ave,+San+Mateo,+CA+94402',
  pickupTip: '2-hr free underground parking off W. 3rd Ave · Self-checkout & holds shelf on 1st floor',
  notice: null,
  hours: {
    0: [11, 0, 17, 0], // Sun 11am - 5pm
    1: [10, 0, 20, 0], // Mon 10am - 8pm
    2: [10, 0, 20, 0], // Tue 10am - 8pm
    3: [10, 0, 20, 0], // Wed 10am - 8pm
    4: [10, 0, 20, 0], // Thu 10am - 8pm
    5: [10, 0, 17, 0], // Fri 10am - 5pm
    6: [10, 0, 17, 0], // Sat 10am - 5pm
  },
  hoursSummary: 'Mon–Thu 10am–8pm · Fri–Sat 10am–5pm · Sun 11am–5pm',
};

export const SMPL_BRANCHES = [MAIN_BRANCH];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime12h(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return minute === 0 ? `${h}:00 ${period}` : `${h}:${String(minute).padStart(2, '0')} ${period}`;
}

function getPacificParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LIBRARY_CONFIG.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayIndex = DAY_NAMES.indexOf(map.weekday);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  return {
    dayOfWeek: weekdayIndex >= 0 ? weekdayIndex : now.getDay(),
    minutesNow: hour * 60 + minute,
  };
}

export function getBranchLiveStatus(branch = MAIN_BRANCH, now = new Date()) {
  const { dayOfWeek, minutesNow } = getPacificParts(now);
  const todaySlot = branch.hours[dayOfWeek];

  if (todaySlot) {
    const [oh, om, ch, cm] = todaySlot;
    const openMins = oh * 60 + om;
    const closeMins = ch * 60 + cm;

    if (minutesNow >= openMins && minutesNow < closeMins) {
      const minsLeft = closeMins - minutesNow;
      const closingSoon = minsLeft <= 60;
      return {
        isOpen: true,
        closingSoon,
        statusLabel: closingSoon ? 'Closing soon' : 'Open now',
        detail: `Closes at ${formatTime12h(ch, cm)}`,
        todayHours: `${formatTime12h(oh, om)} – ${formatTime12h(ch, cm)}`,
      };
    }

    if (minutesNow < openMins) {
      return {
        isOpen: false,
        closingSoon: false,
        statusLabel: 'Closed',
        detail: `Opens today at ${formatTime12h(oh, om)}`,
        todayHours: `${formatTime12h(oh, om)} – ${formatTime12h(ch, cm)}`,
      };
    }
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const nextDay = (dayOfWeek + offset) % 7;
    const slot = branch.hours[nextDay];
    if (slot) {
      const [oh, om] = slot;
      const dayLabel = offset === 1 ? 'tomorrow' : DAY_NAMES[nextDay];
      return {
        isOpen: false,
        closingSoon: false,
        statusLabel: 'Closed',
        detail: `Opens ${dayLabel} at ${formatTime12h(oh, om)}`,
        todayHours: todaySlot
          ? `${formatTime12h(todaySlot[0], todaySlot[1])} – ${formatTime12h(todaySlot[2], todaySlot[3])}`
          : 'Closed today',
      };
    }
  }

  return {
    isOpen: false,
    closingSoon: false,
    statusLabel: 'Closed',
    detail: 'Check branch hours',
    todayHours: 'Closed',
  };
}

export function getMainBranchWithStatus(now = new Date()) {
  return {
    ...MAIN_BRANCH,
    live: getBranchLiveStatus(MAIN_BRANCH, now),
  };
}

export function getBranchesWithStatus(now = new Date()) {
  return [getMainBranchWithStatus(now)];
}

export function normalizeBranchId() {
  return 'main';
}

export function getBranchById() {
  return MAIN_BRANCH;
}

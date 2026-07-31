import { dateLabels, dayOfYear, formatTime, splitClassType } from "./lib.mjs";

const OPENERS = [
  "Tomorrow on the mat 🔥",
  "Your {DAY} sweat, sorted.",
  "{DAY}'s lineup is here 🧘",
  "Plan your {DAY}: hot room, good company.",
  "Tomorrow at the studio —",
  "See you in the hot room, {DAY}:",
  "One breath at a time. Here's {DAY}:",
];

const CLOSERS = [
  "Reserve your mat → link in bio",
  "Spots fill up — book ahead at sealevelhotyoga.com",
  "Book your spot at sealevelhotyoga.com",
  "Grab a mat → sealevelhotyoga.com",
];

const HASHTAGS =
  "#sealevelhotyoga #hotyoga #hot26and2 #seattleyoga #fremontseattle #yogaseattle";

export function buildCaption({ date, classes }) {
  const { dayName } = dateLabels(date);
  const n = dayOfYear(date);
  const opener = OPENERS[n % OPENERS.length].replaceAll("{DAY}", dayName);
  const closer = CLOSERS[n % CLOSERS.length];

  const lines = classes.map((c) => {
    const { time, ampm } = formatTime(c.startTime);
    const { name, duration } = splitClassType(c.classType);
    const dur = duration ? ` (${duration})` : "";
    return `${time}${ampm} — ${name}${dur} with ${c.teacher}`;
  });

  return [opener, "", ...lines, "", closer, "", HASHTAGS].join("\n");
}

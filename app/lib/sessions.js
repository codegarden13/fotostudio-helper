import path from "path";

export function groupSessions(items, gapMinutes) {
  const gapMs = gapMinutes * 60 * 1000;
  const sessions = [];
  let current = [];
  //#TODO: Erklären lassen was diese kalkulation soll
  //#TODO:Will komplette sessions löschen können

  for (const it of items) {
    if (!current.length) { current.push(it); continue; }
    const prev = current[current.length - 1];
    if (it.ts - prev.ts > gapMs) { sessions.push(current); current = [it]; }
    else current.push(it);
  }
  if (current.length) sessions.push(current);

  return sessions.map((s, idx) => {
    const examplePath = s[0].path;
    return {
      id: String(idx),
      start: s[0].ts,
      end: s[s.length - 1].ts,
      count: s.length,
      examplePath,
      exampleName: path.basename(examplePath),
      items: s.map(x => x.path),
    };
  });
}
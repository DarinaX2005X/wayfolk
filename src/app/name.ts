/**
 * A name for the person on a live visit, so a friend never sees "Friend": one picked once
 * from a list of soft names and kept on this device (`?name=` sets it).
 */
const NAMES = [
  'Wren', 'Juniper', 'Rowan', 'Hazel', 'Fern', 'Linden', 'Clover', 'Sorrel', 'Robin', 'Lark', 'Marigold', 'Basil',
  'Briar', 'Poppy', 'Tamsin', 'Ash', 'Willow', 'Ember', 'Pippa', 'Nell', 'Arlo', 'Olive', 'Sage', 'Mabel',
];
const KEY = 'wf.name';

export function personName(): string {
  try {
    const asked = new URLSearchParams(location.search).get('name')?.trim().slice(0, 24);
    if (asked) {
      localStorage.setItem(KEY, asked);
      return asked;
    }
    const kept = localStorage.getItem(KEY);
    if (kept) return kept;
    const picked = NAMES[Math.floor(Math.random() * NAMES.length)];
    localStorage.setItem(KEY, picked);
    return picked;
  } catch {
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }
}

/** The invite link with who invites and to which island, for the friend's first page. */
export function inviteLink(link: string, island: string | undefined): string {
  try {
    const u = new URL(link);
    u.searchParams.set('from', personName());
    if (island) u.searchParams.set('isle', island);
    return u.toString();
  } catch {
    return link;
  }
}

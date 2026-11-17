/**
 * The public address of Wayfolk. Links that leave the device (postcards, QR codes, live
 * invites) point there, except on a development host, where they point to the page itself.
 */
export const PUBLIC_ORIGIN = 'https://wayfolk-island.vercel.app';

/** Origin for shared links: the public one, or the current one on a development host. */
export function shareOrigin(): string {
  if (typeof location === 'undefined') return PUBLIC_ORIGIN;
  const host = location.hostname;
  const dev = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);
  return dev ? location.origin : PUBLIC_ORIGIN;
}

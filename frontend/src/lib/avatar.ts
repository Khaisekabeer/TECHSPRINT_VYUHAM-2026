// Player avatars, drawn in the browser (no network): "a:<seed>" = cartoon person (Avataaars),
// "b:<seed>" = robot (Bottts). Both styles are free for personal and commercial use.
import { createAvatar } from '@dicebear/core';
import { avataaars, bottts } from '@dicebear/collection';

const BACKGROUNDS = ['ffd54d', 'ff9ec7', '8fe3ea', 'b9e43d', 'c4b5fd', 'ffb48a', 'bfd6ff'];
const cache = new Map<string, string>();

export const AVATAR_RE = /^[ab]:[A-Za-z0-9]{1,16}$/;

export function avatarUri(id: string | null | undefined): string {
  const key = id && AVATAR_RE.test(id) ? id : 'b:guest';
  let uri = cache.get(key);
  if (!uri) {
    const seed = key.slice(2);
    const options = { seed, backgroundColor: BACKGROUNDS, backgroundType: ['solid' as const] };
    uri = (key[0] === 'a' ? createAvatar(avataaars, options) : createAvatar(bottts, options)).toDataUri();
    cache.set(key, uri);
  }
  return uri;
}

const randomSeed = () => Math.random().toString(36).slice(2, 10);

// A fresh set to pick from on the join screen: half people, half robots.
export function avatarChoices(count = 12): string[] {
  return Array.from({ length: count }, (_, i) => `${i % 2 ? 'b' : 'a'}:${randomSeed()}`);
}

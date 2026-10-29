// Player avatars, drawn in the browser (no network): "a:<seed>" = cartoon person (Avataaars),
// "b:<seed>" = robot (Bottts). Both styles are free for personal and commercial use.
import { createAvatar } from '@dicebear/core';
import { avataaars, bottts } from '@dicebear/collection';
import type { Options as PersonOptions } from '@dicebear/avataaars';
import type { Options as RobotOptions } from '@dicebear/bottts';

const BACKGROUNDS = ['ffd54d', 'ff9ec7', '8fe3ea', 'b9e43d', 'c4b5fd', 'ffb48a', 'bfd6ff'];
const cache = new Map<string, string>();

// Avataaars limited to young, cheerful faces: no grey or platinum hair, no balding top or big
// beard (they read as elderly), and no crying, dizzy, sick or screaming expressions.
const HAIR_COLORS = ['a55728', '2c1b18', 'b58143', 'd6b370', '724133', '4a312c', 'f59797', 'c93305'];
const PERSON: Partial<PersonOptions> = {
  hairColor: HAIR_COLORS,
  facialHairColor: HAIR_COLORS,
  facialHair: ['beardLight', 'beardMedium', 'moustacheFancy'],
  facialHairProbability: 8,
  top: ['hat', 'hijab', 'turban', 'winterHat1', 'winterHat02', 'winterHat03', 'winterHat04', 'bob', 'bun', 'curly', 'curvy',
    'dreads', 'frida', 'fro', 'froBand', 'longButNotTooLong', 'miaWallace', 'shavedSides', 'straight02', 'straight01',
    'straightAndStrand', 'dreads01', 'dreads02', 'frizzle', 'shaggy', 'shortCurly', 'shortFlat', 'shortRound', 'shortWaved',
    'theCaesar', 'theCaesarAndSidePart', 'bigHair'],
  eyes: ['default', 'happy', 'hearts', 'side', 'squint', 'wink', 'surprised'],
  eyebrows: ['default', 'defaultNatural', 'flatNatural', 'raisedExcited', 'raisedExcitedNatural', 'upDown', 'upDownNatural'],
  mouth: ['default', 'smile', 'twinkle', 'tongue'],
  accessories: ['prescription01', 'prescription02', 'round', 'sunglasses', 'wayfarers'],
};

// Bottts limited to bright, clean robots: no grey or brown bodies, no dirty/grunge textures
// (they look rusty) or blotchy camo, and no ✕✕ "broken" eyes.
const ROBOT: Partial<RobotOptions> = {
  baseColor: ['ffb300', '1e88e5', '00acc1', 'f4511e', '5e35b1', '43a047', '3949ab', '039be5', '7cb342', 'c0ca33', 'fb8c00', 'd81b60', '8e24aa', 'e53935', '00897b', 'fdd835'],
  eyes: ['bulging', 'eva', 'frame1', 'frame2', 'glow', 'happy', 'hearts', 'robocop', 'round', 'roundFrame01', 'roundFrame02', 'sensor', 'shade01'],
  texture: ['circuits', 'dots'],
  textureProbability: 35,
};

export const AVATAR_RE = /^[ab]:[A-Za-z0-9]{1,16}$/;

export function avatarUri(id: string | null | undefined): string {
  const key = id && AVATAR_RE.test(id) ? id : 'b:guest';
  let uri = cache.get(key);
  if (!uri) {
    const seed = key.slice(2);
    const options = { seed, backgroundColor: BACKGROUNDS, backgroundType: ['solid' as const] };
    uri = (key[0] === 'a' ? createAvatar(avataaars, { ...options, ...PERSON }) : createAvatar(bottts, { ...options, ...ROBOT })).toDataUri();
    cache.set(key, uri);
  }
  return uri;
}

const randomSeed = () => Math.random().toString(36).slice(2, 10);

// A fresh set to pick from on the join screen: half people, half robots.
export function avatarChoices(count = 12): string[] {
  return Array.from({ length: count }, (_, i) => `${i % 2 ? 'b' : 'a'}:${randomSeed()}`);
}

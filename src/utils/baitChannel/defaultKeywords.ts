/**
 * Default bait channel keywords seeded on first setup.
 * Edit this list to change the default keyword detection set.
 */
export const DEFAULT_KEYWORDS: { keyword: string; weight: number }[] = [
  { keyword: 'free nitro', weight: 8 },
  { keyword: 'discord nitro', weight: 7 },
  { keyword: 'boost', weight: 3 },
  { keyword: 'giveaway', weight: 4 },
  { keyword: 'win', weight: 2 },
  { keyword: 'click here', weight: 7 },
  { keyword: 'check dm', weight: 6 },
  { keyword: 'dm me', weight: 4 },
  { keyword: '@everyone', weight: 8 },
  { keyword: '@here', weight: 7 },
  { keyword: 'http', weight: 3 },
  { keyword: 'www', weight: 3 },
  { keyword: '.gg/', weight: 5 },
  { keyword: 'steam', weight: 4 },
  { keyword: 'csgo', weight: 5 },
  { keyword: 'tf2', weight: 5 },
];

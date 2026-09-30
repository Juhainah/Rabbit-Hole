// A hand-picked emoji set for labelling rabbit holes, each with words to search by.

export interface EmojiGroup {
  name: string;
  items: [emoji: string, words: string][];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Mystery',
    items: [
      ['🕳️', 'hole rabbit deep pit'], ['🐇', 'rabbit bunny white'], ['🔎', 'search magnifier clue investigate'], ['🕵️', 'detective spy sleuth'],
      ['🗝️', 'key old secret unlock'], ['🕯️', 'candle seance dark'], ['🧿', 'eye evil charm'], ['👁️', 'eye watching seen'],
      ['🧩', 'puzzle piece riddle'], ['❓', 'question unknown'], ['🌀', 'spiral vortex hypnosis'], ['🪞', 'mirror reflection'],
      ['🎭', 'masks theatre identity'], ['🃏', 'joker card trick'], ['🔮', 'crystal ball occult prophecy'], ['🧶', 'yarn red string connect'],
      ['📌', 'pin board evidence'], ['🗂️', 'files dossier folder'], ['🗃️', 'archive cabinet records'], ['🕰️', 'clock time old'],
    ],
  },
  {
    name: 'Crime',
    items: [
      ['🔪', 'knife murder stab'], ['🩸', 'blood crime'], ['💀', 'skull death'], ['☠️', 'poison pirate death'], ['⚰️', 'coffin funeral burial'],
      ['🪦', 'grave tomb cemetery'], ['🚨', 'siren police alarm'], ['🚔', 'police car arrest'], ['⚖️', 'law court trial justice'],
      ['💰', 'money heist fraud'], ['💎', 'diamond jewel heist gem'], ['🧪', 'poison chemistry lab'], ['🔒', 'lock locked secret'],
      ['⛓️', 'chains prison'], ['🗡️', 'dagger blade'], ['🧤', 'gloves fingerprints'], ['🚪', 'door locked room'], ['📸', 'photo evidence camera'],
    ],
  },
  {
    name: 'Space & strange',
    items: [
      ['🛸', 'ufo flying saucer'], ['👽', 'alien extraterrestrial'], ['🌌', 'galaxy cosmos universe'], ['🌑', 'moon dark new'], ['🌕', 'full moon lunar'],
      ['🚀', 'rocket launch space'], ['🛰️', 'satellite orbit'], ['☄️', 'comet meteor impact'], ['🌠', 'shooting star meteor'], ['🪐', 'planet saturn'],
      ['👾', 'monster space invader'], ['🤖', 'robot ai machine'], ['📡', 'antenna radio signal numbers station'], ['🔭', 'telescope astronomy'],
      ['👻', 'ghost haunted spirit'], ['🧛', 'vampire undead'], ['🐉', 'dragon myth legend'], ['🧜', 'mermaid sea myth'],
    ],
  },
  {
    name: 'History',
    items: [
      ['📜', 'scroll document ancient manuscript'], ['🏛️', 'ancient temple rome greece'], ['🏺', 'amphora artefact archaeology'], ['🗿', 'moai easter island statue'],
      ['⚔️', 'swords battle war'], ['🛡️', 'shield knight medieval'], ['👑', 'crown royal king queen'], ['🏰', 'castle medieval'], ['🗺️', 'map treasure'],
      ['🧭', 'compass expedition explore'], ['⚓', 'anchor ship navy'], ['⛵', 'sailing ship voyage'], ['🚢', 'ship titanic ocean liner'], ['🚂', 'train railway steam'],
      ['✉️', 'letter mail'], ['🪖', 'helmet soldier war'], ['🏴‍☠️', 'pirate flag'], ['⛩️', 'shrine japan'],
    ],
  },
  {
    name: 'Nature',
    items: [
      ['🌋', 'volcano eruption'], ['🌊', 'wave ocean sea tsunami'], ['🌲', 'forest woods tree'], ['🏔️', 'mountain pass snow'], ['❄️', 'snow ice cold'],
      ['🌪️', 'tornado storm'], ['⚡', 'lightning electric'], ['🔥', 'fire burning'], ['🦉', 'owl night wise'], ['🐺', 'wolf howl'], ['🦇', 'bat cave night'],
      ['🐙', 'octopus sea creature'], ['🦑', 'squid kraken deep sea'], ['🦈', 'shark ocean'], ['🐍', 'snake serpent'], ['🕷️', 'spider web'],
      ['🦴', 'bone fossil skeleton'], ['🍄', 'mushroom fungus'], ['🐋', 'whale ocean'], ['🐦', 'bird'],
    ],
  },
  {
    name: 'Science & tech',
    items: [
      ['🧬', 'dna genetics'], ['🔬', 'microscope science'], ['⚗️', 'alchemy chemistry'], ['🧠', 'brain mind psychology'], ['💻', 'computer code hacker'],
      ['📼', 'vhs tape lost media video'], ['📻', 'radio broadcast'], ['📺', 'tv television broadcast'], ['💾', 'floppy disk data'], ['📟', 'pager old tech'],
      ['☢️', 'radiation nuclear'], ['☣️', 'biohazard virus'], ['🧲', 'magnet'], ['📷', 'camera photo'], ['🎞️', 'film reel footage'], ['🧮', 'abacus maths numbers'],
      ['🕹️', 'joystick game arcade'], ['🔋', 'battery power'],
    ],
  },
  {
    name: 'Culture',
    items: [
      ['🎵', 'music song'], ['🎸', 'guitar rock band'], ['🎤', 'microphone singer interview'], ['🎬', 'film movie clapper'], ['📚', 'books library'],
      ['📖', 'book reading'], ['✒️', 'pen writing author'], ['🎨', 'art painting'], ['🖼️', 'painting frame museum'], ['🎲', 'dice chance game'],
      ['♟️', 'chess strategy'], ['🎪', 'circus tent'], ['🎡', 'ferris wheel fair'], ['👤', 'person silhouette unknown'], ['🗣️', 'speaking rumour'],
      ['💔', 'heartbreak loss'], ['🕊️', 'dove peace'], ['🎙️', 'podcast studio mic'],
    ],
  },
  {
    name: 'Places',
    items: [
      ['🏚️', 'abandoned house derelict haunted'], ['🏝️', 'island remote'], ['🏜️', 'desert'], ['🗼', 'tower paris'], ['🏙️', 'city skyline'],
      ['🌃', 'night city'], ['🛤️', 'railway tracks'], ['🌉', 'bridge'], ['🏭', 'factory industry'], ['⛪', 'church chapel'], ['🕌', 'mosque'],
      ['🗽', 'statue liberty new york'], ['🚇', 'metro subway tunnel'], ['⛺', 'tent camp expedition'], ['🏕️', 'camping woods'], ['🗻', 'mount fuji'],
    ],
  },
  {
    name: 'Symbols',
    items: [
      ['⚠️', 'warning danger'], ['❗', 'important'], ['💡', 'idea theory'], ['🔗', 'link connection'], ['♾️', 'infinity loop'], ['☯️', 'yin yang balance'],
      ['⚜️', 'fleur de lis'], ['🔺', 'triangle illuminati'], ['⭕', 'circle'], ['❌', 'cross wrong debunked'], ['✅', 'check confirmed solved'],
      ['🚩', 'red flag'], ['🏷️', 'label tag'], ['📍', 'location pin place'], ['#️⃣', 'number hash'], ['🔢', 'numbers code cipher'],
    ],
  },
];

export const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.items);

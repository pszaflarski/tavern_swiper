/**
 * Character Creation Wizard — Preset Data & Option Definitions
 *
 * Ported from examples/character_creator/src/data/characters.ts
 * and the step component option maps.
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CharacterPreset {
  name: string;
  tagline: string;
  bio: string;
  race: string;
  gender: string;
  fandom: string;
  image: string;
  class: string;
}

export interface WizardOption {
  id: string;
  name: string;
  desc?: string;
  active?: boolean;
}

export interface WizardSelections {
  fandom: string;
  gender: string;
  race: string;
  characterClass: string;
}

// ─── Fandom Options ──────────────────────────────────────────────────────────

export const FANDOM_OPTIONS: WizardOption[] = [
  { id: 'D&D', name: 'Dungeons & Dragons', active: true },
  { id: 'Genshin', name: 'Genshin Impact', active: false },
  { id: 'LOTR', name: 'Lord of the Rings', active: false },
  { id: 'Witcher', name: 'The Witcher', active: false },
];

// ─── Gender Options ──────────────────────────────────────────────────────────

export const GENDER_OPTIONS: WizardOption[] = [
  { id: 'Male', name: 'Male', desc: 'Representing masculine traits and warrior archetypes.' },
  { id: 'Female', name: 'Female', desc: 'Representing feminine traits and heroine archetypes.' },
  { id: 'Other', name: 'Other', desc: 'Representing custom, fluid, or other-worldly identities.' },
];

// ─── Race Options by Fandom ─────────────────────────────────────────────────

export const RACE_OPTIONS_BY_FANDOM: Record<string, WizardOption[]> = {
  'D&D': [
    { id: 'Elf', name: 'Elf', desc: 'Long-lived, elegant mystics with sharp senses and deep magical affinity.' },
    { id: 'Human', name: 'Human', desc: 'Versatile, ambitious, and adaptable defenders with an unmatched drive.' },
    { id: 'Orc', name: 'Orc', desc: 'Powerful, fierce, and proud commandos commanding immense physical might.' },
    { id: 'Undead', name: 'Undead', desc: 'Reanimated knights or spirits bound by runes, holding eternal oaths.' },
  ],
  'Genshin': [
    { id: 'Human', name: 'Human', desc: 'Adaptable mortals inhabiting the lands of Teyvat.' },
    { id: 'Adeptus', name: 'Adeptus', desc: 'Ancient illuminated protectors of contract and heritage.' },
  ],
};

// ─── Class Options by Fandom ─────────────────────────────────────────────────

export const CLASS_OPTIONS_BY_FANDOM: Record<string, WizardOption[]> = {
  'D&D': [
    { id: 'Fighter', name: 'Fighter', desc: 'Masters of martial combat, skilled with shields, broadswords, and gladiator tactics.' },
    { id: 'Rogue', name: 'Rogue', desc: 'Sleek spellblades and pickpockets relying on quick reflexes, stealth, and charm.' },
    { id: 'Wizard', name: 'Wizard', desc: 'Arcane scholars wielding forbidden shadow magic, meteor spells, or technomancy.' },
    { id: 'Cleric', name: 'Cleric', desc: 'Devout priestess-knights commanding radiant healing energy and moon spells.' },
    { id: 'Druid', name: 'Druid', desc: 'Groves protectors who speak to plants and spirits, brewing herbal potions.' },
    { id: 'Ranger', name: 'Ranger', desc: 'Swift ocean scouts and lake rangers patrolling the wilderness with bows.' },
    { id: 'Paladin', name: 'Paladin', desc: 'Vanguard commanders sworn to holy oaths, wielding warhammers and golden plate.' },
  ],
  'Genshin': [
    { id: 'Sword', name: 'Sword', desc: 'Swift close-range light blades.' },
    { id: 'Claymore', name: 'Claymore', desc: 'Heavy, high-impact greatswords.' },
    { id: 'Bow', name: 'Bow', desc: 'Ranged precision archery.' },
    { id: 'Catalyst', name: 'Catalyst', desc: 'Elemental magic channelers.' },
    { id: 'Polearm', name: 'Polearm', desc: 'Rapid thrusting spears.' },
  ],
};

// ─── Character Presets ───────────────────────────────────────────────────────

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    name: "Aethelgard Moonwhisper",
    tagline: "The stars align to guide my path, and the forest speaks to those who listen.",
    bio: "A wandering elven druid and archmage who has lived for over three centuries in the deep whispering groves. He holds the Staff of the Astral Conjunction, using it to read cosmic alignments and channel elemental energies. He values wisdom and quiet taverns.",
    race: "Elf",
    gender: "Male",
    fandom: "D&D",
    image: "1f2ee97a-1bce-4da8-abe8-e5ae8c429868_1080x1350.jpg",
    class: "Druid"
  },
  {
    name: "Sylas Vane",
    tagline: "A little magic, a little steel, and a lot of charm.",
    bio: "A clever spellblade and rogue from the high towers of Lotheria. Sylas blends quick swordplay with minor arcane tricks. He has a quick tongue, a sharp wit, and a habit of getting into trouble at the card tables.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "2bbfac57-b369-1ad6-edc7-d7fc29b9c651_1080x1350.jpg",
    class: "Rogue"
  },
  {
    name: "Garok Ironbound",
    tagline: "Honor is not in the strength of the blade, but in the shield that guards the weak.",
    bio: "A vanguard commander of the Iron Peak. Garok broke away from the traditional chaotic clans to pledge his oath to the Order of the Gilded Sun. He walks a path of discipline, wielding holy fire alongside his warhammer.",
    race: "Orc",
    gender: "Male",
    fandom: "D&D",
    image: "2d799bbf-e43b-46ed-a48b-7a93629cef22_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Aiden of Oakhaven",
    tagline: "Determined to earn my shield, one quest at a time.",
    bio: "A young human squire training under the legendary knights of Oakhaven. Aiden is honest, hard-working, and slightly naive, but his courage is unmatched. He spends his free time practicing swordplay in the woods.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "2dff66ec-c121-7164-b339-87fce85af7e0_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Malakar the Pale",
    tagline: "My blade does the talking, and it has a very sharp tongue.",
    bio: "A pale, muscular wanderer from the ash plains of the northern wastes. Malakar is a lone gladiator and mercenary who relies on sheer strength and instinct. His giant sword, Whisper, has tasted the blood of dragons.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "42f61adf-86ee-417f-a535-304aa4c50f94_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Evelyn of the Frost Peaks",
    tagline: "The cold mountain wind is my home, but the warmth of justice is my shield.",
    bio: "A sworn defender of the High Peak Citadel. Evelyn was trained in the harshest mountain conditions, learning to fight with heavy armor on sheer icy cliffs. Her golden plate armor is a family heirloom blessed by the sun.",
    race: "Human",
    gender: "Female",
    fandom: "D&D",
    image: "47e47060-c479-45f2-b8a2-0d034e91d192_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Lord Korthas the Undying",
    tagline: "My oath did not end when my heart stopped beating.",
    bio: "A fallen knight of the silver realm, reanimated by runic magic. Korthas maintains his sense of honor and chivalry despite his skeletal form. He wanders the ruins, seeking to fulfill his long-lost duty.",
    race: "Undead",
    gender: "Male",
    fandom: "D&D",
    image: "4d7e7069-5a8f-44cb-88c6-dbeece1e4caa_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Lilith Starspire",
    tagline: "Magic isn't just about spells; it's about style, presence, and a touch of danger.",
    bio: "A rogue elven enchantress who graduated top of her class before leaving to practice forbidden shadow magic. Lilith loves high fashion, glowing crystals, and testing new hexes on bandits.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "539d70c7-0626-4314-ae95-22aaf0ed26c8_1080x1350.jpg",
    class: "Wizard"
  },
  {
    name: "Garrick Sunshield",
    tagline: "The sun rises to light our path, and my shield rises to guard it.",
    bio: "A seasoned veteran of the Dawn Guard, Garrick has spent thirty years defending the borders of the kingdom. He is calm, wise, and deeply protective. He carries a sun-crested shield to turn aside demon blades.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "67bccd3e-89e0-4933-9277-df4ebd18add4_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Aria Starwind",
    tagline: "The stars shine brightest in the coldest nights.",
    bio: "Princess and champion of the northern Ice Spire. Aria was chosen by the Starspirit to wield the legendary blade Stella, a sword forged from a meteor. She is polite, elegant, yet deadly in combat.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "6c8df807-3ded-459e-8283-46b678d14595_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Aurelia the Angelic Blade",
    tagline: "The heavens guide my blade, but my heart guides my path.",
    bio: "A celestial sentinel sent to the mortal plane to battle the creeping shadows. Aurelia is fierce, direct, and unyielding in her duties, yet she is fascinated by mortal taverns, food, and music.",
    race: "Human",
    gender: "Female",
    fandom: "D&D",
    image: "733977df-f3b1-4aa2-88d4-148fe12895f3_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Malkor the Defiant",
    tagline: "Do not judge a warrior by his tusks, but by the weight of his words.",
    bio: "A rogue shaman and spellweaver of the Shattered Stone tribe. Malkor rejected the warmongering clans to study natural spirits and minor arcana. He has a quiet, reflective personality despite his massive frame.",
    race: "Orc",
    gender: "Male",
    fandom: "D&D",
    image: "80540bf2-b6e1-4df6-9a61-8b6d0baeec67_1080x1350.jpg",
    class: "Druid"
  },
  {
    name: "Sylvia the Golden Lily",
    tagline: "The river flows, the sun rises, and my steel remains clean.",
    bio: "A vanguard knight of the Elven River Kingdom. Sylvia is dedicated to defending the waters and ancient temples from corruption. She walks through shallow streams and lakes to meditate.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "8aa2e880-9348-4ac1-a027-041ce59d279b_1080x1350.jpg",
    class: "Paladin"
  },
  {
    name: "Kaelen Stormborn",
    tagline: "The storm answers to my blade, and I answer to no one.",
    bio: "A rogue tempest warrior from the sky-high peaks of the Thunder Mountains. Kaelen survived being struck by lightning as a child and now channels electrical currents into his golden sword.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "9098b7a3-f9c2-4b37-9b5a-b23b4af0dbe6_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Alandra Mooncrest",
    tagline: "The moonlight reveals all secrets, and my silver shield guards them.",
    bio: "A holy priestess-knight of the Silver Moon Order. Alandra protects the ancient moon shrines from dark defilement. She is quiet, pious, and possesses healing magic alongside her sword skills.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "b1960a9c-95b0-41e8-a080-9d531d084341_1080x1350.jpg",
    class: "Cleric"
  },
  {
    name: "Talia Greenweave",
    tagline: "The heartbeat of the forest is the only melody I need.",
    bio: "A woodland scholar and healer who lives in the eternal groves. Talia speaks the language of plants and beasts, brewing herbal remedies for lost travelers. She has a gentle, sweet disposition.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "cfe53962-a733-429a-8f8e-7e77fb67f5b0_1080x1350.jpg",
    class: "Druid"
  },
  {
    name: "Elysia Swifthand",
    tagline: "Swiping right on adventure... and maybe you.",
    bio: "An elven technomancer who discovered a strange portal linking her realm to the mortal internet. Now she spends her time reviewing tavern menus online and looking for local adventuring parties.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "d21e8587-95ac-443f-80c1-c3872cdbd383_1080x1350.jpg",
    class: "Wizard"
  },
  {
    name: "Fiona Leafbloom",
    tagline: "A cup of hot chamomile tea solves most of the realm's problems.",
    bio: "An elven herbalist and botanist who manages the royal glasshouse. Fiona is sweet, soft-spoken, and prefers tending to rare magical orchids over adventuring in dirty dungeons.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "d6ab92f3-5c4f-4115-a4c8-95f5c298732a_1080x1350.jpg",
    class: "Druid"
  },
  {
    name: "Ignis the Stone Guard",
    tagline: "Flesh decays, kingdoms fall, but stone stands eternal.",
    bio: "An ancient warrior carved from basalt and animated by golden starlight. He has guarded the desert ruins of Oros for a thousand years. He is calm, stoic, and speaks slowly.",
    race: "Undead",
    gender: "Male",
    fandom: "D&D",
    image: "df3abe2c-a526-413b-ba77-0493259f7fa6_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Talia Wavecrest",
    tagline: "You can't catch the wind, but you can swim in the lake all day.",
    bio: "An elven swimmer and ranger who loves nothing more than spending hot summer days by the lake. Talia is optimistic, bubbly, and always finds the positive side of any situation.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "efac4ed7-d6b2-4f4d-95e0-a5e6a5f0fab0_1080x1350.jpg",
    class: "Ranger"
  },
  {
    name: "Kailani Stormwave",
    tagline: "The ocean holds a different kind of magic, deep and quiet.",
    bio: "An elven ocean-scout who patrols the southern beaches. Kailani has a calm, warm, and inviting nature. She loves walking on sandy shores, finding rare seashells, and telling stories of ancient sea beasts.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "f5d73fde-eef1-48a4-8b68-f54c024d0403_1080x1350.jpg",
    class: "Ranger"
  },
  {
    name: "Theseus of Mycenae",
    tagline: "Even the most petrifying gaze must eventually fall.",
    bio: "A legendary demigod and monster-slayer from the ancient city-states. Theseus has slain Gorgons, Minotaurs, and chimeras in his quest to protect the mortal realms. He is quiet and focused.",
    race: "Human",
    gender: "Male",
    fandom: "D&D",
    image: "f8467863-6f69-4ad4-afb7-712a0b77b474_1080x1350.jpg",
    class: "Fighter"
  },
  {
    name: "Sylvia Frostbloom",
    tagline: "The winter winds are cold, but my blade shines with a warm light.",
    bio: "A vanguard knight of the Frost Alliance. Sylvia protects the mountain passes from ogres and frost trolls. Her silver and gold armor is enchanted to resist extreme cold, and her blade, Northwind, is light as a feather.",
    race: "Elf",
    gender: "Female",
    fandom: "D&D",
    image: "fa1d86b2-8d5f-40df-86d0-c00052d5e3e1_1080x1350.jpg",
    class: "Paladin"
  },
];

// ─── Scoring Helpers ─────────────────────────────────────────────────────────

export interface ScoredPreset {
  preset: CharacterPreset;
  score: number;
}

/**
 * Score-based matching engine — finds presets that best match the user's selections.
 * Weights: race (4), gender (2), class (1). Must match at least one attribute.
 * Falls back to all presets if no selections were made.
 */
export function scorePresets(selections: WizardSelections): ScoredPreset[] {
  const { gender, race, characterClass } = selections;

  const scored = CHARACTER_PRESETS.map(preset => {
    let score = 0;

    // Race match (highest weight)
    if (race && preset.race.toLowerCase() === race.toLowerCase()) {
      score += 4;
    }

    // Gender match (medium weight)
    if (gender && preset.gender.toLowerCase() === gender.toLowerCase()) {
      score += 2;
    }

    // Class match (lower weight)
    if (characterClass && preset.class.toLowerCase() === characterClass.toLowerCase()) {
      score += 1;
    }

    return { preset, score };
  })
    .filter(item => item.score > 0) // must match at least one selected attribute
    .sort((a, b) => b.score - a.score); // highest matches first

  // Fallback to all presets if no matching attributes were selected
  return scored.length > 0
    ? scored
    : CHARACTER_PRESETS.map(preset => ({ preset, score: 0 }));
}

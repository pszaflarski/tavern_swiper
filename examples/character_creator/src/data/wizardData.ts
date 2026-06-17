export interface WizardOption {
  id: string;
  name: string;
  desc?: string;
  active?: boolean;
}

export const FANDOM_OPTIONS: WizardOption[] = [
  { id: 'D&D', name: 'Dungeons & Dragons', active: true },
  { id: 'Genshin', name: 'Genshin Impact', active: false },
  { id: 'LOTR', name: 'Lord of the Rings', active: false },
  { id: 'Witcher', name: 'The Witcher', active: false },
];

export const GENDER_OPTIONS: WizardOption[] = [
  { id: 'Male', name: 'Male', desc: 'Representing masculine traits and warrior archetypes.' },
  { id: 'Female', name: 'Female', desc: 'Representing feminine traits and heroine archetypes.' },
  { id: 'Other', name: 'Other', desc: 'Representing custom, fluid, or other-worldly identities.' },
];

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

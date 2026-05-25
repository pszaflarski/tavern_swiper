import React from 'react';
import type { CharacterState, CharTag } from './CharacterWizard.tsx';
import { Compass, ShieldAlert, Users } from 'lucide-react';

interface StepTraitsProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
}

const PRESET_FANDOMS: CharTag[] = [
  { id: 't-f1', category: 'fandom', name: 'Forgotten Realms (D&D)', slug: 'forgotten-realms' },
  { id: 't-f2', category: 'fandom', name: "Baldur's Gate 3", slug: 'baldurs-gate-3' },
  { id: 't-f3', category: 'fandom', name: 'Lord of the Rings', slug: 'lotr' },
  { id: 't-f4', category: 'fandom', name: 'The Witcher', slug: 'the-witcher' },
  { id: 't-f5', category: 'fandom', name: 'World of Warcraft', slug: 'wow' },
  { id: 't-f6', category: 'fandom', name: 'Critical Role', slug: 'critical-role' },
  { id: 't-f7', category: 'fandom', name: 'Original Character', slug: 'oc' },
];

const PRESET_RACES: CharTag[] = [
  { id: 't-r1', category: 'race', name: 'Human', slug: 'human' },
  { id: 't-r2', category: 'race', name: 'Elf', slug: 'elf' },
  { id: 't-r3', category: 'race', name: 'Dwarf', slug: 'dwarf' },
  { id: 't-r4', category: 'race', name: 'Orc', slug: 'orc' },
  { id: 't-r5', category: 'race', name: 'Tiefling', slug: 'tiefling' },
  { id: 't-r6', category: 'race', name: 'Halfling', slug: 'halfling' },
  { id: 't-r7', category: 'race', name: 'Dragonborn', slug: 'dragonborn' },
  { id: 't-r8', category: 'race', name: 'Vampire / Dhampir', slug: 'vampire' },
  { id: 't-r9', category: 'race', name: 'Undead', slug: 'undead' },
];

const PRESET_GENDERS: CharTag[] = [
  { id: 't-g1', category: 'gender', name: 'Male', slug: 'male' },
  { id: 't-g2', category: 'gender', name: 'Female', slug: 'female' },
  { id: 't-g3', category: 'gender', name: 'Non-Binary', slug: 'non-binary' },
  { id: 't-g4', category: 'gender', name: 'Androgynous', slug: 'androgynous' },
  { id: 't-g5', category: 'gender', name: 'Genderfluid', slug: 'genderfluid' },
];

export default function StepTraits({ character, setCharacter }: StepTraitsProps) {
  const toggleTag = (category: 'fandom' | 'race' | 'gender', tag: CharTag) => {
    setCharacter(prev => {
      const list = prev[category];
      const exists = list.some(t => t.id === tag.id);
      
      const newList = exists
        ? list.filter(t => t.id !== tag.id)
        : [...list, tag];

      return {
        ...prev,
        [category]: newList,
      };
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl md:text-2xl text-[hsl(var(--accent-gold))] mb-2">
          Step 2: Origins & Traits
        </h2>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Assign fandom alignments, fantasy races, and gender attributes to categorize your character.
        </p>
      </div>

      <div className="flex flex-col gap-8 mt-2">
        {/* Fandom Selection */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-primary))] flex items-center gap-2">
            <Compass className="w-4 h-4 text-[hsl(var(--primary))]" />
            Fandom Alignment (Multi-select)
          </h3>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_FANDOMS.map(tag => {
              const isSelected = character.fandom.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag('fandom', tag)}
                  className={`trait-chip fandom ${isSelected ? 'selected' : ''}`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Race Selection */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-primary))] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[hsl(var(--accent-gold))]" />
            Fantasy Race / Ancestry (Multi-select)
          </h3>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_RACES.map(tag => {
              const isSelected = character.race.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag('race', tag)}
                  className={`trait-chip race ${isSelected ? 'selected' : ''}`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Gender Selection */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-primary))] flex items-center gap-2">
            <Users className="w-4 h-4 text-[hsl(var(--accent-green))]" />
            Gender Identity (Multi-select)
          </h3>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_GENDERS.map(tag => {
              const isSelected = character.gender.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag('gender', tag)}
                  className={`trait-chip gender ${isSelected ? 'selected' : ''}`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

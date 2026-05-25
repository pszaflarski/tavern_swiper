import React from 'react';
import type { CharacterState } from './CharacterWizard.tsx';

interface StepIdentityProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
}

export default function StepIdentity({ character, setCharacter }: StepIdentityProps) {
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCharacter(prev => ({ ...prev, displayName: e.target.value }));
  };

  const handleTaglineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.length <= 100) {
      setCharacter(prev => ({ ...prev, tagline: e.target.value }));
    }
  };

  const handleBioChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= 500) {
      setCharacter(prev => ({ ...prev, bio: e.target.value }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl md:text-2xl text-[hsl(var(--accent-gold))] mb-2">
          Step 1: Character Identity
        </h2>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Start by naming your hero (or villain) and defining their tagline and backstory.
        </p>
      </div>

      <div className="flex flex-col gap-5 max-w-2xl mt-2">
        {/* Display Name */}
        <div className="flex flex-col">
          <label htmlFor="displayName" className="rpg-label">
            Character Name <span className="text-[hsl(var(--accent-rose))]">*</span>
          </label>
          <input
            id="displayName"
            type="text"
            className="rpg-input"
            placeholder="e.g. Valerius the Bold"
            value={character.displayName}
            onChange={handleNameChange}
            required
            autoComplete="off"
          />
          <div className="flex items-center justify-between mt-1 px-1">
            <span className="text-xs text-[hsl(var(--text-muted))]">
              Minimum 2 characters
            </span>
            {character.displayName.trim().length > 0 && character.displayName.trim().length < 2 && (
              <span className="text-xs text-[hsl(var(--accent-rose))]">Name too short</span>
            )}
          </div>
        </div>

        {/* Tagline */}
        <div className="flex flex-col">
          <label htmlFor="tagline" className="rpg-label">Tagline</label>
          <input
            id="tagline"
            type="text"
            className="rpg-input"
            placeholder="e.g. A rogue with a heart of gold (and pockets full of it)"
            value={character.tagline}
            onChange={handleTaglineChange}
            autoComplete="off"
          />
          <span className="text-xs text-[hsl(var(--text-muted))] mt-1 text-right">
            {character.tagline.length} / 100 characters
          </span>
        </div>

        {/* Biography */}
        <div className="flex flex-col">
          <label htmlFor="bio" className="rpg-label">Backstory / Bio</label>
          <textarea
            id="bio"
            className="rpg-input min-h-[140px] resize-none"
            placeholder="Describe their origins, traits, achievements, or tavern rumors..."
            value={character.bio}
            onChange={handleBioChange}
          />
          <span className="text-xs text-[hsl(var(--text-muted))] mt-1 text-right">
            {character.bio.length} / 500 characters
          </span>
        </div>
      </div>
    </div>
  );
}

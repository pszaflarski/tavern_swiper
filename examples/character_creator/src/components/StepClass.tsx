import { Check } from 'lucide-react';

interface StepClassProps {
  fandom: string;
  characterClass: string;
  setCharacterClass: (c: string) => void;
}

const CLASS_OPTIONS_BY_FANDOM: Record<string, { id: string; name: string; desc: string }[]> = {
  'D&D': [
    { id: 'Fighter', name: 'Fighter', desc: 'Masters of martial combat, skilled with shields, broadswords, and gladiator tactics.' },
    { id: 'Rogue', name: 'Rogue', desc: 'Sleek spellblades and pickpockets relying on quick reflexes, stealth, and charm.' },
    { id: 'Wizard', name: 'Wizard', desc: 'Arcane scholars wielding forbidden shadow magic, meteor spells, or technomancy.' },
    { id: 'Cleric', name: 'Cleric', desc: 'Devout priestess-knights commanding radiant healing energy and moon spells.' },
    { id: 'Druid', name: 'Druid', desc: 'Groves protectors who speak to plants and spirits, brewing herbal potions.' },
    { id: 'Ranger', name: 'Ranger', desc: 'Swift ocean scouts and lake rangers patrolling the wilderness with bows.' },
    { id: 'Paladin', name: 'Paladin', desc: 'Vanguard commanders sworn to holy oaths, wielding warhammers and golden plate.' }
  ],
  'Genshin': [
    { id: 'Sword', name: 'Sword', desc: 'Swift close-range light blades.' },
    { id: 'Claymore', name: 'Claymore', desc: 'Heavy, high-impact greatswords.' },
    { id: 'Bow', name: 'Bow', desc: 'Ranged precision archery.' },
    { id: 'Catalyst', name: 'Catalyst', desc: 'Elemental magic channelers.' },
    { id: 'Polearm', name: 'Polearm', desc: 'Rapid thrusting spears.' }
  ]
};

export default function StepClass({ fandom, characterClass, setCharacterClass }: StepClassProps) {
  const options = CLASS_OPTIONS_BY_FANDOM[fandom] || CLASS_OPTIONS_BY_FANDOM['D&D'];

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl text-accent-gold mb-2">
          Choose Adventuring Class <span className="text-sm font-normal text-muted lowercase">(optional)</span>
        </h2>
        <p className="text-sm text-secondary">
          Your class or combat style for the {fandom} universe.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 w-full">
        {options.map((opt) => {
          const isSelected = characterClass === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setCharacterClass(opt.id === characterClass ? '' : opt.id)} // Allow de-selection
              className="glass-card p-4 text-left border flex flex-col justify-between transition-all duration-300 hover:scale-[1.01] min-h-[110px] w-full"
              style={{
                borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.06)',
                background: isSelected ? 'rgba(0, 109, 78, 0.25)' : 'hsl(var(--bg-card))',
                boxShadow: isSelected ? '0 0 12px hsl(var(--primary-glow))' : 'none'
              }}
            >
              <div className="flex items-start justify-between w-full">
                <span className={`text-sm font-bold ${isSelected ? 'text-primary' : 'text-secondary'}`}>
                  {opt.name}
                </span>
                <div 
                  className="w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-all duration-300"
                  style={{
                    borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.2)',
                    backgroundColor: isSelected ? 'hsl(var(--primary))' : 'transparent',
                  }}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-muted mt-2 leading-relaxed">
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

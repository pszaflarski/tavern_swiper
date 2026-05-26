import { Check } from 'lucide-react';

interface StepRaceProps {
  fandom: string;
  race: string;
  setRace: (r: string) => void;
}

const RACE_OPTIONS_BY_FANDOM: Record<string, { id: string; name: string; desc: string }[]> = {
  'D&D': [
    { id: 'Elf', name: 'Elf', desc: 'Long-lived, elegant mystics with sharp senses and deep magical affinity.' },
    { id: 'Human', name: 'Human', desc: 'Versatile, ambitious, and adaptable defenders with an unmatched drive.' },
    { id: 'Orc', name: 'Orc', desc: 'Powerful, fierce, and proud commandos commanding immense physical might.' },
    { id: 'Undead', name: 'Undead', desc: 'Reanimated knights or spirits bound by runes, holding eternal oaths.' }
  ],
  'Genshin': [
    { id: 'Human', name: 'Human', desc: 'Adaptable mortals inhabiting the lands of Teyvat.' },
    { id: 'Adeptus', name: 'Adeptus', desc: 'Ancient illuminated protectors of contract and heritage.' }
  ]
};

export default function StepRace({ fandom, race, setRace }: StepRaceProps) {
  const options = RACE_OPTIONS_BY_FANDOM[fandom] || RACE_OPTIONS_BY_FANDOM['D&D'];

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl text-accent-gold mb-2">
          Select Fantasy Race <span className="text-sm font-normal text-muted lowercase">(optional)</span>
        </h2>
        <p className="text-sm text-secondary">
          Races dictate the physical form and traits for the {fandom} universe.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 w-full">
        {options.map((opt) => {
          const isSelected = race === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setRace(opt.id === race ? '' : opt.id)} // Allow de-selection
              className="glass-card p-5 text-left border flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] min-h-[140px] w-full"
              style={{
                borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.06)',
                background: isSelected ? 'rgba(0, 109, 78, 0.25)' : 'hsl(var(--bg-card))',
                boxShadow: isSelected ? '0 0 12px hsl(var(--primary-glow))' : 'none'
              }}
            >
              <div className="flex items-start justify-between w-full">
                <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-secondary'}`}>
                  {opt.name}
                </span>
                <div 
                  className="w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all duration-300"
                  style={{
                    borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.2)',
                    backgroundColor: isSelected ? 'hsl(var(--primary))' : 'transparent',
                  }}
                >
                  {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                </div>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

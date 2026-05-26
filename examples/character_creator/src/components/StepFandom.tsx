import { Check, Compass, Lock } from 'lucide-react';

interface StepFandomProps {
  fandom: string;
  setFandom: (f: string) => void;
}

const FANDOM_OPTIONS = [
  { id: 'D&D', name: 'Dungeons & Dragons', active: true },
  { id: 'Genshin', name: 'Genshin Impact', active: false },
  { id: 'LOTR', name: 'Lord of the Rings', active: false },
  { id: 'Witcher', name: 'The Witcher', active: false }
];

export default function StepFandom({ fandom, setFandom }: StepFandomProps) {
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl text-accent-gold mb-2">
          Select Fandom Universe
        </h2>
        <p className="text-sm text-secondary">
          Aligning with a fandom unlocks specific layout shapes and archetype filters.
        </p>
      </div>

      <div className="flex flex-col gap-3 mt-4 w-full">
        {FANDOM_OPTIONS.map((opt) => {
          const isSelected = fandom === opt.id;
          
          if (!opt.active) {
            return (
              <div
                key={opt.id}
                className="glass-card p-4 text-left border border-[rgba(255,255,255,0.03)] bg-slate-950/20 opacity-55 relative flex items-center justify-between cursor-not-allowed w-full"
              >
                <div className="flex items-center gap-2 flex-1 pr-4">
                  <span className="text-base font-bold text-slate-500">{opt.name}</span>
                  <span className="text-[9px] bg-slate-800/80 text-slate-400 font-bold px-1.5 py-0.5 rounded tracking-wide uppercase flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" /> Coming Soon
                  </span>
                </div>
                <div className="w-6 h-6 rounded-full border border-slate-900 flex items-center justify-center bg-slate-950/40 flex-shrink-0">
                  <Compass className="w-3.5 h-3.5 text-slate-700" />
                </div>
              </div>
            );
          }

          return (
            <button
              key={opt.id}
              onClick={() => setFandom(opt.id)}
              className="glass-card p-4 text-left border flex items-center justify-between transition-all duration-300 hover:scale-[1.01] w-full"
              style={{
                borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.06)',
                background: isSelected ? 'rgba(0, 109, 78, 0.25)' : 'hsl(var(--bg-card))',
                boxShadow: isSelected ? '0 0 12px hsl(var(--primary-glow))' : 'none'
              }}
            >
              <div className="flex-1 pr-4">
                <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-secondary'}`}>
                  {opt.name}
                </span>
              </div>
              <div 
                className="w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 transition-all duration-300"
                style={{
                  borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.2)',
                  backgroundColor: isSelected ? 'hsl(var(--primary))' : 'transparent',
                }}
              >
                {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

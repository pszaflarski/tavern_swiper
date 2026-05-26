import { Check } from 'lucide-react';

interface StepGenderProps {
  gender: string;
  setGender: (g: string) => void;
}

const GENDER_OPTIONS = [
  { id: 'Male', name: 'Male', desc: 'Representing masculine traits and warrior archetypes.' },
  { id: 'Female', name: 'Female', desc: 'Representing feminine traits and heroine archetypes.' },
  { id: 'Other', name: 'Other', desc: 'Representing custom, fluid, or other-worldly identities.' }
];

export default function StepGender({ gender, setGender }: StepGenderProps) {
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl text-accent-gold mb-2">
          Choose Gender Identity <span className="text-sm font-normal text-muted lowercase">(optional)</span>
        </h2>
        <p className="text-sm text-secondary">
          Define the identity of your adventurer to customize their visual presence.
        </p>
      </div>

      <div className="flex flex-col gap-3 mt-4 w-full">
        {GENDER_OPTIONS.map((opt) => {
          const isSelected = gender === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setGender(opt.id === gender ? '' : opt.id)} // Allow de-selecting the option by clicking it again
              className="glass-card p-5 text-left border flex items-center justify-between transition-all duration-300 hover:scale-[1.01] w-full"
              style={{
                borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.06)',
                background: isSelected ? 'rgba(0, 109, 78, 0.25)' : 'hsl(var(--bg-card))',
                boxShadow: isSelected ? '0 0 12px hsl(var(--primary-glow))' : 'none'
              }}
            >
              <div className="flex flex-col gap-1 flex-1 pr-4">
                <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-secondary'}`}>
                  {opt.name}
                </span>
                <span className="text-xs text-muted">
                  {opt.desc}
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

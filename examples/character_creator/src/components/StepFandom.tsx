import { Lock, Compass } from 'lucide-react';
import { FANDOM_OPTIONS } from '../data/wizardData';
import type { WizardOption } from '../data/wizardData';

interface StepFandomProps {
  fandom: string;
  onSelect: (fandom: string) => void;
}

export default function StepFandom({ fandom, onSelect }: StepFandomProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="step-title">Select Fandom Universe</h2>
        <p className="step-description">
          Aligning with a fandom unlocks specific layout shapes and archetype filters.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {FANDOM_OPTIONS.map((opt: WizardOption) => {
          const isSelected = fandom === opt.id;

          if (opt.active === false) {
            return (
              <div key={opt.id} className="option-card locked">
                <div className="flex items-center flex-1">
                  <span className="option-name">{opt.name}</span>
                  <div className="lock-badge">
                    <Lock size={10} className="text-muted" />
                    <span className="lock-badge-text">Coming Soon</span>
                  </div>
                </div>
                <div className="radio-outer">
                  <Compass size={12} className="text-muted" />
                </div>
              </div>
            );
          }

          return (
            <div
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`option-card ${isSelected ? 'selected' : ''}`}
            >
              <div className="flex-1">
                <span className="option-name">{opt.name}</span>
              </div>
              <div className="radio-outer">
                {isSelected && <div className="radio-inner" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { GENDER_OPTIONS } from '../data/wizardData';
import type { WizardOption } from '../data/wizardData';

interface StepGenderProps {
  gender: string;
  onSelect: (gender: string) => void;
}

export default function StepGender({ gender, onSelect }: StepGenderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="step-title">
          Select Identity <span className="step-optional-tag">(optional)</span>
        </h2>
        <p className="step-description">
          Choose a gender archetype baseline to help the AI frame the character's narrative role.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {GENDER_OPTIONS.map((opt: WizardOption) => {
          const isSelected = gender === opt.id;

          return (
            <div
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`option-card ${isSelected ? 'selected' : ''}`}
            >
              <div className="flex-1 text-left">
                <div className="option-name">{opt.name}</div>
                {opt.desc && <div className="option-desc">{opt.desc}</div>}
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

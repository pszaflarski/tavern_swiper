import { RACE_OPTIONS_BY_FANDOM } from '../data/wizardData';
import type { WizardOption } from '../data/wizardData';

interface StepRaceProps {
  fandom: string;
  race: string;
  onSelect: (race: string) => void;
}

export default function StepRace({ fandom, race, onSelect }: StepRaceProps) {
  const options = RACE_OPTIONS_BY_FANDOM[fandom] || [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="step-title">
          Select Fantasy Race <span className="step-optional-tag">(optional)</span>
        </h2>
        <p className="step-description">
          Species and heritage dictate physical appearance constraints and default lineage traits.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {options.length > 0 ? (
          options.map((opt: WizardOption) => {
            const isSelected = race === opt.id;

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
          })
        ) : (
          <div className="text-center text-muted p-4">
            No race options found for this fandom universe.
          </div>
        )}
      </div>
    </div>
  );
}

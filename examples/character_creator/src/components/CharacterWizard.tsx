import { useState } from 'react';
import StepFandom from './StepFandom';
import StepGender from './StepGender';
import StepRace from './StepRace';
import StepClass from './StepClass';
import StepResult from './StepResult';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function CharacterWizard() {
  const [step, setStep] = useState(1);
  const [fandom, setFandom] = useState('');
  const [gender, setGender] = useState('');
  const [race, setRace] = useState('');
  const [characterClass, setCharacterClass] = useState('');

  const stepsList = [
    { num: 1, label: 'Fandom' },
    { num: 2, label: 'Gender' },
    { num: 3, label: 'Race' },
    { num: 4, label: 'Class' },
    { num: 5, label: 'Forge' },
  ];

  const handleNext = () => {
    if (step < 5 && isStepValid()) {
      setStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => prev - 1);
    }
  };

  const handleReset = () => {
    setFandom('');
    setGender('');
    setRace('');
    setCharacterClass('');
    setStep(1);
  };

  const isStepValid = () => {
    if (step === 1) return fandom !== ''; // Fandom is required to start
    return true; // Gender, Race, Class are optional
  };

  // Auto-reset dependent state if fandom changes
  const handleFandomSelect = (selectedFandom: string) => {
    if (selectedFandom !== fandom) {
      setFandom(selectedFandom);
      setRace('');
      setCharacterClass('');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 mt-2">
      {/* Step Panels */}
      <div className="glass-panel min-h-380 flex flex-col justify-between">
        <div className="flex-grow mb-6">
          {step === 1 && (
            <StepFandom fandom={fandom} onSelect={handleFandomSelect} />
          )}

          {step === 2 && (
            <StepGender gender={gender} onSelect={setGender} />
          )}

          {step === 3 && (
            <StepRace fandom={fandom} race={race} onSelect={setRace} />
          )}

          {step === 4 && (
            <StepClass fandom={fandom} characterClass={characterClass} onSelect={setCharacterClass} />
          )}

          {step === 5 && (
            <StepResult
              fandom={fandom}
              gender={gender}
              race={race}
              characterClass={characterClass}
              onReset={handleReset}
            />
          )}
        </div>

        {/* Bottom Progress Dots Indicator */}
        <div className="progress-dots-container">
          {stepsList.map((s) => (
            <div
              key={s.num}
              className={`progress-dot ${
                step === s.num
                  ? 'active'
                  : step > s.num
                  ? 'completed'
                  : ''
              }`}
              title={s.label}
            />
          ))}
        </div>

        {/* Wizard Controls (Only show if not on final result screen) */}
        {step < 5 && (
          <div className="nav-row">
            <button
              onClick={handleBack}
              disabled={step === 1}
              className="rpg-btn px-5 py-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={!isStepValid()}
              className="rpg-btn rpg-btn-primary px-6 py-2 font-bold"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

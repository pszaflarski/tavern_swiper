import { useState } from 'react';
import StepGender from './StepGender.tsx';
import StepFandom from './StepFandom.tsx';
import StepRace from './StepRace.tsx';
import StepClass from './StepClass.tsx';
import StepResult from './StepResult.tsx';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function CharacterWizard() {
  const [step, setStep] = useState(1);
  const [gender, setGender] = useState('');
  const [fandom, setFandom] = useState('');
  const [race, setRace] = useState('');
  const [characterClass, setCharacterClass] = useState('');

  const stepsList = [
    { num: 1, label: 'Fandom' },
    { num: 2, label: 'Gender' },
    { num: 3, label: 'Race' },
    { num: 4, label: 'Class' },
    { num: 5, label: 'Result' },
  ];

  const handleNext = () => {
    if (step < 5 && isStepValid()) {
      setStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(prev => prev - 1);
    }
  };

  const handleReset = () => {
    setGender('');
    setFandom('');
    setRace('');
    setCharacterClass('');
    setStep(1);
  };

  const isStepValid = () => {
    if (step === 1) return fandom !== ''; // Fandom is required to start
    return true; // Gender, Race, Class are optional, so Step 2, 3, 4 are always valid
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 mt-2">
      {/* Step Panels */}
      <div className="glass-panel p-6 md:p-8 min-h-[380px] flex flex-col justify-between">
        <div className="flex-1 mb-6">
          {step === 1 && (
            <StepFandom fandom={fandom} setFandom={setFandom} />
          )}

          {step === 2 && (
            <StepGender gender={gender} setGender={setGender} />
          )}

          {step === 3 && (
            <StepRace fandom={fandom} race={race} setRace={setRace} />
          )}

          {step === 4 && (
            <StepClass fandom={fandom} characterClass={characterClass} setCharacterClass={setCharacterClass} />
          )}

          {step === 5 && (
            <StepResult 
              gender={gender} 
              fandom={fandom} 
              race={race} 
              characterClass={characterClass} 
              onReset={handleReset}
            />
          )}
        </div>

        {/* Bottom Progress Dots Indicator */}
        <div className="progress-dots-container">
          {stepsList.map(s => (
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
          <div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-4 mt-4">
            <button
              onClick={handleBack}
              disabled={step === 1}
              className="rpg-btn rpg-btn-secondary px-5 py-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={!isStepValid()}
              className="rpg-btn rpg-btn-gold px-6 py-2 font-bold"
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

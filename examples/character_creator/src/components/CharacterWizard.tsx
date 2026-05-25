import { useState } from 'react';
import type { AppConfig } from '../App.tsx';
import StepIdentity from './StepIdentity.tsx';
import StepTraits from './StepTraits.tsx';
import StepVisuals from './StepVisuals.tsx';
import StepReview from './StepReview.tsx';
import { ArrowLeft, ArrowRight, UserCheck, AlertCircle } from 'lucide-react';

export interface CharTag {
  id: string;
  category: string;
  name: string;
  slug: string;
}

export interface CharacterState {
  displayName: string;
  tagline: string;
  bio: string;
  fandom: CharTag[];
  race: CharTag[];
  gender: CharTag[];
  images: {
    url: string;
    sourceType: 'artist' | 'ai_generated';
    artistName?: string;
    artistHandle?: string;
    artistLink?: string;
    position: number;
    file?: File;
  }[];
}

interface CharacterWizardProps {
  config: AppConfig;
}

export default function CharacterWizard({ config }: CharacterWizardProps) {
  const [step, setStep] = useState(1);
  const [character, setCharacter] = useState<CharacterState>({
    displayName: '',
    tagline: '',
    bio: '',
    fandom: [],
    race: [],
    gender: [],
    images: [],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successPayload, setSuccessPayload] = useState<any | null>(null);

  const stepsList = [
    { num: 1, label: 'Identity' },
    { num: 2, label: 'Traits' },
    { num: 3, label: 'Visuals' },
    { num: 4, label: 'Review' },
  ];

  const handleNext = () => {
    if (step < 4) setStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(prev => prev - 1);
      setSuccessPayload(null);
      setApiError(null);
    }
  };

  const isStepValid = () => {
    if (step === 1) {
      return character.displayName.trim().length >= 2;
    }
    if (step === 2) {
      // Allow moving past traits even if empty, but recommend at least one select.
      return true;
    }
    if (step === 3) {
      // Must have at least 1 image
      return character.images.length > 0;
    }
    return true;
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    setApiError(null);
    setSuccessPayload(null);

    // Prepare JSON payload according to models.go
    const payload = {
      display_name: character.displayName,
      tagline: character.tagline || undefined,
      bio: character.bio || undefined,
      fandom: character.fandom,
      race: character.race,
      gender: character.gender,
      image_ids: [] as string[],
    };

    if (config.mode === 'mock') {
      // Simulate successful API response after 1 second
      setTimeout(() => {
        setIsSubmitting(false);
        setSuccessPayload({
          character_id: 'mock-char-uuid-12345678',
          display_name: character.displayName,
          tagline: character.tagline || null,
          bio: character.bio || null,
          fandom: character.fandom,
          race: character.race,
          gender: character.gender,
          images: character.images.map((img, idx) => ({
            image_id: `mock-img-uuid-${idx}`,
            url: img.url,
            source_type: img.sourceType,
            character_id: 'mock-char-uuid-12345678',
            artist_handle: img.artistHandle || null,
            artist_name: img.artistName || null,
            artist_link: img.artistLink || null,
            position: img.position,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }, 1000);
      return;
    }

    // Live API integration
    try {
      // 1. Create the character document
      const charRes = await fetch(`${config.apiUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!charRes.ok) {
        const errorData = await charRes.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to create character (HTTP ${charRes.status})`);
      }

      const createdChar = await charRes.json();
      const characterId = createdChar.character_id;

      // 2. Upload images if we have any files
      const uploadedImages = [];
      for (const img of character.images) {
        if (img.file) {
          const formData = new FormData();
          formData.append('character_id', characterId);
          formData.append('source_type', img.sourceType);
          if (img.artistName) formData.append('artist_name', img.artistName);
          if (img.artistHandle) formData.append('artist_handle', img.artistHandle);
          if (img.artistLink) formData.append('artist_link', img.artistLink);
          formData.append('position', img.position.toString());
          formData.append('file', img.file);

          const imgRes = await fetch(`${config.apiUrl}/images`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.token}`,
            },
            body: formData,
          });

          if (!imgRes.ok) {
            const errorData = await imgRes.json().catch(() => ({}));
            console.warn('Image upload failed:', errorData.detail);
          } else {
            const uploadedImg = await imgRes.json();
            uploadedImages.push(uploadedImg);
          }
        } else {
          // If we had a selected mockup/preset image rather than a uploaded file, 
          // in live mode we'd try to fetch it and upload, or we can just bypass
          uploadedImages.push({
            image_id: 'preset-image-placeholder',
            url: img.url,
            source_type: img.sourceType,
            character_id: characterId,
            position: img.position,
          });
        }
      }

      setIsSubmitting(false);
      // Fetch resolved character details
      const finalRes = await fetch(`${config.apiUrl}/${characterId}`, {
        headers: {
          'Authorization': `Bearer ${config.token}`,
        },
      });

      if (finalRes.ok) {
        const finalChar = await finalRes.json();
        setSuccessPayload(finalChar);
      } else {
        setSuccessPayload({
          ...createdChar,
          images: uploadedImages,
        });
      }
    } catch (err: any) {
      console.error(err);
      setIsSubmitting(false);
      setApiError(err.message || 'An unexpected error occurred.');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 mt-2">
      {/* Step Progress Tracker */}
      <div className="glass-panel py-5 px-6 flex items-center justify-between relative overflow-hidden">
        {/* Progress Background bar */}
        <div className="absolute top-[38px] left-[10%] right-[10%] h-[2px] bg-slate-800 z-0" />
        <div 
          className="absolute top-[38px] left-[10%] h-[2px] bg-[gradient-to-r] bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent-gold))] z-0 transition-all duration-300"
          style={{ width: `${((step - 1) / 3) * 80}%` }}
        />

        {stepsList.map(s => (
          <div key={s.num} className="flex flex-col items-center gap-2 z-10 flex-1 relative">
            <button
              disabled={s.num > step && !isStepValid()}
              onClick={() => {
                if (s.num < step || isStepValid()) setStep(s.num);
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border transition-all duration-300 ${
                step === s.num
                  ? 'bg-slate-900 border-[hsl(var(--primary))] text-[hsl(var(--primary))] scale-110 shadow-[0_0_15px_hsl(var(--primary-glow))]'
                  : step > s.num
                  ? 'bg-[hsl(var(--primary-dark))] border-[hsl(var(--primary))] text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              {s.num}
            </button>
            <span className={`text-xs font-semibold uppercase tracking-wider ${
              step === s.num ? 'text-[hsl(var(--accent-gold))]' : 'text-[hsl(var(--text-muted))]'
            }`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step Panels */}
      <div className="glass-panel p-6 md:p-8 min-h-[380px] flex flex-col justify-between">
        <div className="flex-1">
          {step === 1 && (
            <StepIdentity character={character} setCharacter={setCharacter} />
          )}

          {step === 2 && (
            <StepTraits character={character} setCharacter={setCharacter} />
          )}

          {step === 3 && (
            <StepVisuals character={character} setCharacter={setCharacter} />
          )}

          {step === 4 && (
            <StepReview 
              character={character} 
              isSubmitting={isSubmitting} 
              successPayload={successPayload}
              onSubmit={handleComplete}
            />
          )}
        </div>

        {/* Error Notification */}
        {apiError && (
          <div className="mt-4 p-4 bg-[rgba(230,80,100,0.15)] border border-rose-500/50 rounded-lg flex items-start gap-3 text-sm text-[hsl(var(--accent-rose))]">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="block font-semibold">Tavern Gatekeeper Alert</strong>
              <span>{apiError}</span>
            </div>
          </div>
        )}

        {/* Wizard Controls */}
        <div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-6 mt-8">
          <button
            onClick={handleBack}
            disabled={step === 1 || isSubmitting}
            className="rpg-btn rpg-btn-secondary px-5 py-2.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          {step < 4 ? (
            <button
              onClick={handleNext}
              disabled={!isStepValid()}
              className="rpg-btn rpg-btn-primary px-6 py-2.5"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : !successPayload ? (
            <button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="rpg-btn rpg-btn-gold px-8 py-2.5 font-bold"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  Forge Character
                </>
              )}
            </button>
          ) : (
            <div className="text-xs text-[hsl(var(--accent-green))] font-semibold uppercase tracking-wider flex items-center gap-1">
              🎉 Character Forge Complete!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CHARACTER_PRESETS } from '../data/characters.ts';
import { Sparkles, ChevronLeft, ChevronRight, Check, Copy, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';

interface StepResultProps {
  gender: string;
  fandom: string;
  race: string;
  characterClass: string;
  onReset: () => void;
}

export default function StepResult({ gender, fandom, race, characterClass, onReset }: StepResultProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  // Score-based matching engine
  const scoredPresets = CHARACTER_PRESETS.map(preset => {
    let score = 0;
    
    // Race match (highest weight)
    if (race && preset.race.toLowerCase() === race.toLowerCase()) {
      score += 4;
    }
    
    // Gender match (medium weight)
    if (gender && preset.gender.toLowerCase() === gender.toLowerCase()) {
      score += 2;
    }
    
    // Class match (lower weight)
    if (characterClass && preset.class.toLowerCase() === characterClass.toLowerCase()) {
      score += 1;
    }
    
    return { preset, score };
  })
  .filter(item => item.score > 0) // must match at least one selected attribute
  .sort((a, b) => b.score - a.score); // highest matches first

  // Fallback to all presets if no matching attributes
  const matches = scoredPresets.length > 0 
    ? scoredPresets 
    : CHARACTER_PRESETS.map(preset => ({ preset, score: 0 }));

  const currentMatch = matches[currentIndex] || null;
  const hasMultipleMatches = matches.length > 1;

  const handleNext = () => {
    setCurrentIndex(prev => (prev + 1) % matches.length);
  };

  const handlePrev = () => {
    setCurrentIndex(prev => (prev - 1 + matches.length) % matches.length);
  };

  // Build the mock JSON payload for the user to understand the boundary integration
  const generatedPayload = currentMatch ? {
    display_name: currentMatch.preset.name,
    tagline: currentMatch.preset.tagline,
    bio: currentMatch.preset.bio,
    fandom: [{ id: 'f-1', category: 'fandom', name: fandom === 'D&D' ? 'Forgotten Realms (D&D)' : fandom, slug: fandom.toLowerCase() }],
    race: [{ id: 'r-1', category: 'race', name: currentMatch.preset.race, slug: currentMatch.preset.race.toLowerCase() }],
    gender: [{ id: 'g-1', category: 'gender', name: currentMatch.preset.gender, slug: currentMatch.preset.gender.toLowerCase() }],
    class: [{ id: 'c-1', category: 'class', name: currentMatch.preset.class, slug: currentMatch.preset.class.toLowerCase() }],
    images: [
      {
        url: `/sample_characters/${currentMatch.preset.image}`,
        source_type: 'ai_generated',
        artist_name: 'Tavern Swiper Generator',
        artist_handle: '@tavern_swiper',
        artist_link: 'https://tavernswiper.dev',
        position: 0
      }
    ]
  } : null;

  const handleCopyJson = () => {
    if (!generatedPayload) return;
    navigator.clipboard.writeText(JSON.stringify(generatedPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!currentMatch) {
    return (
      <div className="text-center p-8 glass-panel max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 text-accent-rose mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">Tavern Empty</h3>
        <p className="text-sm text-secondary mb-6">
          No adventurers match these criteria, and even the backup portal failed.
        </p>
        <button onClick={onReset} className="rpg-btn rpg-btn-primary w-full">
          Reset Wizard
        </button>
      </div>
    );
  }

  const { preset, score } = currentMatch;
  const isExactMatch = score === 7;

  return (
    <div className="flex flex-col items-center gap-6 max-w-xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl text-accent-gold mb-1">
          Adventurer Summoned!
        </h2>
        <p className="text-sm text-secondary">
          {isExactMatch 
            ? "🎯 Found an exact match in the tavern archives!"
            : "🍻 No exact match found. Showing the closest matching heroes!"}
        </p>
      </div>

      {/* Centered RPG Character Card */}
      <div className="relative">
        <div className="tavern-card-container">
          <img 
            src={`/sample_characters/${preset.image}`} 
            alt={preset.name} 
            className="tavern-card-image" 
          />
          <div className="tavern-card-overlay">
            <div className="badge-row">
              <span className="badge-tag fandom">{fandom}</span>
              <span className="badge-tag race">{preset.race}</span>
              <span className="badge-tag gender">{preset.gender}</span>
            </div>
            <span className="text-[10px] text-accent-gold uppercase tracking-widest font-bold block mb-1">
              {preset.class}
            </span>
            <h3 className="text-xl text-primary font-extrabold mb-1 uppercase tracking-wide">
              {preset.name}
            </h3>
            <p className="text-xs text-amber-100/90 italic mb-2">
              "{preset.tagline}"
            </p>
            <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-3">
              {preset.bio}
            </p>
          </div>

          {/* Overlay Navigation if multiple matches */}
          {hasMultipleMatches && (
            <>
              <button
                onClick={handlePrev}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/80 hover:bg-[hsl(var(--primary))] text-white flex items-center justify-center transition-all shadow-md border border-slate-800"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={handleNext}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/80 hover:bg-[hsl(var(--primary))] text-white flex items-center justify-center transition-all shadow-md border border-slate-800"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Info Status Indicator */}
      {hasMultipleMatches && (
        <div className="text-xs text-secondary flex items-center gap-1.5 bg-slate-950/40 px-3 py-1 rounded border border-slate-900/60 pointer-events-none">
          <Sparkles className="w-3.5 h-3.5 text-accent-gold" />
          <span>Adventurer {currentIndex + 1} of {matches.length} matching</span>
        </div>
      )}

      {/* Central Action Buttons Row (Directly below Card/Status) */}
      <div className="flex flex-wrap items-center justify-center gap-3 w-full mt-2">
        <button 
          onClick={onReset} 
          className="rpg-btn rpg-btn-secondary py-2.5 px-5 text-xs flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Start
        </button>

        {hasMultipleMatches && (
          <button 
            onClick={handleNext} 
            className="rpg-btn rpg-btn-gold py-2.5 px-6 text-xs flex items-center gap-1.5 font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate / Next
          </button>
        )}

        <button
          onClick={handleCopyJson}
          className="rpg-btn rpg-btn-secondary py-2.5 px-5 text-xs flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied Payload!' : 'Copy JSON'}
        </button>
      </div>

      {/* Collapsed Inspector at the very bottom */}
      <details className="w-full glass-card p-3 border-slate-800 mt-4">
        <summary className="text-[10px] text-muted uppercase tracking-wider font-semibold cursor-pointer select-none outline-none hover:text-secondary">
          Inspect Database Payload JSON
        </summary>
        <pre className="text-[10px] bg-slate-950 p-3 rounded border border-slate-900 overflow-x-auto font-mono text-accent-green max-h-[140px] mt-2 scrollbar-thin">
          {JSON.stringify(generatedPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

import React, { useRef, useEffect, useState } from 'react';
import type { CharacterState } from './CharacterWizard.tsx';
import { Upload, Image as ImageIcon, ChevronLeft, ChevronRight, Sparkles, Check, Info } from 'lucide-react';
import { CHARACTER_PRESETS } from '../data/characters.ts';
import type { CharacterPreset } from '../data/characters.ts';

interface StepVisualsProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
}

// Helper to determine if a character from our list matches the selected tags
export const matchPreset = (preset: CharacterPreset, character: CharacterState) => {
  // Race filter: if any race tags are selected, the preset's race must match at least one selected race tag.
  if (character.race.length > 0) {
    const matched = character.race.some(tag => 
      tag.slug.toLowerCase() === preset.race.toLowerCase() ||
      tag.name.toLowerCase() === preset.race.toLowerCase()
    );
    if (!matched) return false;
  }

  // Gender filter: if any gender tags are selected, the preset's gender must match at least one selected gender tag.
  if (character.gender.length > 0) {
    const matched = character.gender.some(tag => 
      tag.slug.toLowerCase() === preset.gender.toLowerCase() ||
      tag.name.toLowerCase() === preset.gender.toLowerCase()
    );
    if (!matched) return false;
  }

  // Fandom filter: since all presets are 'D&D', they only match if the selected fandom includes a D&D-related slug/name.
  if (character.fandom.length > 0) {
    const matched = character.fandom.some(tag => {
      const slug = tag.slug.toLowerCase();
      const name = tag.name.toLowerCase();
      return slug === 'forgotten-realms' || 
             slug === 'baldurs-gate-3' || 
             slug === 'critical-role' ||
             name.includes('d&d') ||
             name.includes('forgotten realms') ||
             name.includes('baldur');
    });
    if (!matched) return false;
  }

  return true;
};

export default function StepVisuals({ character, setCharacter }: StepVisualsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bypassFilters, setBypassFilters] = useState(false);
  
  const currentImage = character.images[0] || null;

  // Filter presets list
  const matches = bypassFilters 
    ? CHARACTER_PRESETS 
    : CHARACTER_PRESETS.filter(p => matchPreset(p, character));

  // Check if current selection belongs to a preset
  const matchedPreset = CHARACTER_PRESETS.find(p => `/sample_characters/${p.image}` === currentImage?.url);
  const isCustomUpload = currentImage?.file || currentImage?.url.startsWith('blob:');

  // Index of current preset in matching list
  const currentMatchIndex = matches.findIndex(p => `/sample_characters/${p.image}` === currentImage?.url);

  const handleSelectPreset = (preset: CharacterPreset) => {
    setCharacter(prev => ({
      ...prev,
      images: [
        {
          url: `/sample_characters/${preset.image}`,
          sourceType: 'ai_generated',
          artistName: 'Tavern Swiper Generator',
          artistHandle: '@tavern_swiper',
          artistLink: 'https://tavernswiper.dev',
          position: 0,
        },
      ],
    }));
  };

  // Auto-select first matching preset on mount / filter change (unless user has custom upload)
  useEffect(() => {
    if (matches.length > 0 && !isCustomUpload) {
      const isInMatches = matches.some(m => `/sample_characters/${m.image}` === currentImage?.url);
      if (!currentImage || !isInMatches) {
        handleSelectPreset(matches[0]);
      }
    }
  }, [character.race, character.gender, character.fandom, bypassFilters]);

  const handleNextPreset = () => {
    if (matches.length <= 1) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    handleSelectPreset(matches[nextIndex]);
  };

  const handlePrevPreset = () => {
    if (matches.length <= 1) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    handleSelectPreset(matches[prevIndex]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create local object URL for previewing
    const url = URL.createObjectURL(file);

    setCharacter(prev => ({
      ...prev,
      images: [
        {
          url,
          sourceType: 'artist',
          artistName: '',
          artistHandle: '',
          artistLink: '',
          position: 0,
          file, // store file object for upload
        },
      ],
    }));
  };

  const updateAttribution = (field: 'artistName' | 'artistHandle' | 'artistLink' | 'sourceType', value: string) => {
    setCharacter(prev => {
      const imgs = [...prev.images];
      if (imgs.length > 0) {
        imgs[0] = {
          ...imgs[0],
          [field]: value,
        };
      }
      return {
        ...prev,
        images: imgs,
      };
    });
  };

  const handleApplyPresetLore = () => {
    if (!matchedPreset) return;
    setCharacter(prev => ({
      ...prev,
      displayName: matchedPreset.name,
      tagline: matchedPreset.tagline,
      bio: matchedPreset.bio,
    }));
  };

  const isLoreApplied = matchedPreset && 
    character.displayName === matchedPreset.name &&
    character.tagline === matchedPreset.tagline &&
    character.bio === matchedPreset.bio;

  // Selected tags descriptive string
  const selectedTraitsDesc = [
    ...character.race.map(t => t.name),
    ...character.gender.map(t => t.name),
    ...character.fandom.map(t => t.name)
  ].join(' • ');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-xl md:text-2xl text-[hsl(var(--accent-gold))]">
            Step 3: Character Visuals
          </h2>
          {selectedTraitsDesc && (
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] bg-slate-950/60 px-3 py-1 rounded border border-slate-800/40">
              Filters: {selectedTraitsDesc}
            </div>
          )}
        </div>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Assign a portrait based on your selected tags, or cycle through matching presets.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-2">
        {/* Left Column: Preset Card and Selector (Span 5) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-primary))] flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[hsl(var(--primary))]" />
            Portrait Selection
          </h3>

          {matches.length > 0 ? (
            <div className="flex flex-col gap-4">
              {/* Premium Portrait Frame */}
              <div 
                className="relative aspect-[3/4] rounded-2xl overflow-hidden border-2 bg-slate-950 flex flex-col justify-end group cursor-pointer shadow-lg transition-all duration-300"
                style={{
                  borderColor: isCustomUpload ? 'rgba(255,255,255,0.08)' : 'hsl(var(--primary))',
                  boxShadow: isCustomUpload ? 'none' : '0 0 20px hsl(var(--primary-glow))'
                }}
                onClick={handleNextPreset}
                title="Click image to cycle next portrait"
              >
                {currentImage ? (
                  <img 
                    src={currentImage.url} 
                    alt="Character Portrait" 
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                    No image loaded
                  </div>
                )}
                
                {/* Custom Upload Badge */}
                {isCustomUpload && (
                  <div className="absolute top-3 left-3 bg-[hsl(var(--accent-green))] text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded shadow">
                    Custom Upload
                  </div>
                )}

                {/* Bypass badge */}
                {bypassFilters && (
                  <div className="absolute top-3 right-3 bg-amber-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded shadow">
                    All Presets Mode
                  </div>
                )}

                {/* Inner Shadows and Page Indicators */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent pointer-events-none" />
                
                <div className="relative p-4 z-10 flex flex-col gap-1 w-full text-center">
                  {!isCustomUpload && matches.length > 1 && (
                    <span className="text-[10px] text-white/70 tracking-widest uppercase bg-slate-900/80 mx-auto px-3 py-1 rounded-full backdrop-blur-sm">
                      Portrait {currentMatchIndex + 1} of {matches.length}
                    </span>
                  )}
                  <span className="text-[9px] text-slate-400 group-hover:text-[hsl(var(--accent-gold))] transition-colors duration-200 mt-1">
                    {!isCustomUpload && matches.length > 1 ? "💡 Click image to cycle portrait" : ""}
                  </span>
                </div>

                {/* Absolute overlay arrow buttons on hover */}
                {!isCustomUpload && matches.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrevPreset();
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/80 hover:bg-[hsl(var(--primary))] text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-md border border-slate-800"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNextPreset();
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/80 hover:bg-[hsl(var(--primary))] text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-md border border-slate-800"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>

              {/* Slider / Controls underneath portrait */}
              {!isCustomUpload && matches.length > 1 && (
                <div className="flex items-center justify-between gap-4 px-2">
                  <button 
                    onClick={handlePrevPreset}
                    className="rpg-btn rpg-btn-secondary py-2 px-3 text-xs flex-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Previous
                  </button>
                  <button 
                    onClick={handleNextPreset}
                    className="rpg-btn rpg-btn-secondary py-2 px-3 text-xs flex-1"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Fallback State: No Matching Presets */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-slate-800 rounded-2xl bg-slate-950/40 text-[hsl(var(--text-muted))] min-h-[300px]">
              <Info className="w-10 h-10 mb-3 stroke-[1.25] text-amber-500" />
              <h4 className="text-sm font-semibold text-[hsl(var(--text-primary))] mb-1">No Matching Portraits</h4>
              <p className="text-xs max-w-xs mb-4">
                We couldn't find any character presets in our dataset that match your current selected traits.
              </p>
              <div className="flex flex-col gap-2 w-full">
                <button
                  onClick={() => setBypassFilters(true)}
                  className="rpg-btn rpg-btn-primary py-2.5 text-xs font-semibold"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Browse All 23 Presets
                </button>
                <div className="text-[10px] text-slate-500">
                  Or adjust your selections in Step 2.
                </div>
              </div>
            </div>
          )}

          {/* Reset Filters Option if in bypass mode */}
          {bypassFilters && CHARACTER_PRESETS.filter(p => matchPreset(p, character)).length > 0 && (
            <button
              onClick={() => setBypassFilters(false)}
              className="rpg-btn rpg-btn-secondary py-2 text-xs border border-dashed border-amber-500/35 text-amber-400"
            >
              Re-apply tag filters
            </button>
          )}

          {/* File Upload Selector */}
          <div className="flex flex-col gap-3 mt-1">
            <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider font-semibold">Or upload custom art</span>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rpg-btn rpg-btn-secondary w-full py-3.5 border-dashed border-2 flex flex-col items-center gap-1 rounded-xl text-xs"
            >
              <Upload className="w-5 h-5 text-[hsl(var(--text-muted))]" />
              <span>Click to Browse Images</span>
            </button>
          </div>
        </div>

        {/* Right Column: Character Details & Attribution Fields (Span 7) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Preset Lore Details Section */}
          {matchedPreset && !isCustomUpload && (
            <div className="glass-card p-5 border-[hsl(var(--primary-glow))] relative overflow-hidden flex flex-col gap-4">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[hsla(var(--primary),0.08)] to-transparent pointer-events-none" />
              
              <div>
                <span className="text-[10px] font-bold text-[hsl(var(--accent-gold))] uppercase tracking-widest block mb-1">
                  Preset Lore Details
                </span>
                <h4 className="text-lg text-[hsl(var(--text-primary))] font-bold">
                  {matchedPreset.name}
                </h4>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                    Race: {matchedPreset.race}
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                    Gender: {matchedPreset.gender}
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                    Fandom: {matchedPreset.fandom}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 bg-slate-950/45 p-4 rounded-lg border border-slate-900/60">
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Tagline</label>
                  <p className="text-xs text-amber-100/90 italic mt-0.5">"{matchedPreset.tagline}"</p>
                </div>
                <div className="border-t border-slate-900/60 pt-2">
                  <label className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Backstory</label>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">{matchedPreset.bio}</p>
                </div>
              </div>

              <div>
                <button
                  onClick={handleApplyPresetLore}
                  disabled={isLoreApplied}
                  className={`rpg-btn w-full py-3 text-xs font-bold ${
                    isLoreApplied 
                      ? 'bg-slate-900 border-slate-800 text-emerald-400 cursor-default' 
                      : 'rpg-btn-gold'
                  }`}
                >
                  {isLoreApplied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      Applied to Identity (Step 1)
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Apply Preset Identity (Name, Tagline, Bio)
                    </>
                  )}
                </button>
                {!isLoreApplied && (
                  <span className="text-[9.5px] text-[hsl(var(--text-muted))] text-center block mt-1.5">
                    Clicking this will populate Step 1 fields with this character's backstory.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Attribution & Credit Details Form */}
          {currentImage && (
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--accent-gold))] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Image Attribution & Credit
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="rpg-label text-[10px]">Source Type</label>
                  <select
                    className="rpg-input py-2 px-3 text-sm bg-slate-950 border-slate-800"
                    value={currentImage.sourceType}
                    onChange={(e) => updateAttribution('sourceType', e.target.value as any)}
                  >
                    <option value="artist">Artist Credit</option>
                    <option value="ai_generated">AI Generated</option>
                  </select>
                </div>

                <div className="flex flex-col">
                  <label className="rpg-label text-[10px]">Artist/Generator Name</label>
                  <input
                    type="text"
                    className="rpg-input py-2 px-3 text-sm border-slate-800"
                    placeholder="e.g. Midjourney"
                    value={currentImage.artistName || ''}
                    onChange={(e) => updateAttribution('artistName', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="rpg-label text-[10px]">Artist Handle/Social</label>
                  <input
                    type="text"
                    className="rpg-input py-2 px-3 text-sm border-slate-800"
                    placeholder="e.g. @tavern_swiper"
                    value={currentImage.artistHandle || ''}
                    onChange={(e) => updateAttribution('artistHandle', e.target.value)}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="rpg-label text-[10px]">Artist Website/Link</label>
                  <input
                    type="text"
                    className="rpg-input py-2 px-3 text-sm border-slate-800"
                    placeholder="e.g. https://..."
                    value={currentImage.artistLink || ''}
                    onChange={(e) => updateAttribution('artistLink', e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

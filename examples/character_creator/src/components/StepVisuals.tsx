import React, { useRef } from 'react';
import type { CharacterState } from './CharacterWizard.tsx';
import { Upload, Image as ImageIcon, Check } from 'lucide-react';

interface StepVisualsProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
}

interface PresetAvatar {
  url: string;
  artistName: string;
  artistHandle: string;
  artistLink: string;
  sourceType: 'artist' | 'ai_generated';
}

const PRESET_AVATARS: PresetAvatar[] = [
  {
    url: 'https://images.unsplash.com/photo-1599824434225-44059b763841?q=80&w=600&auto=format&fit=crop',
    artistName: 'Marek Piwnicki',
    artistHandle: '@marekpiwnicki',
    artistLink: 'https://unsplash.com/@marekpiwnicki',
    sourceType: 'artist',
  },
  {
    url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=600&auto=format&fit=crop',
    artistName: 'Matheus Ferrero',
    artistHandle: '@matheusferrero',
    artistLink: 'https://unsplash.com/@matheusferrero',
    sourceType: 'artist',
  },
  {
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop',
    artistName: 'Toyin Adedokun',
    artistHandle: '@toyinadedokun',
    artistLink: 'https://unsplash.com/@toyinadedokun',
    sourceType: 'artist',
  },
  {
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop',
    artistName: 'Joseph Gonzalez',
    artistHandle: '@jgonzalez',
    artistLink: 'https://unsplash.com/@josephgonzalez',
    sourceType: 'artist',
  },
];

export default function StepVisuals({ character, setCharacter }: StepVisualsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Currently we only support single character image for the simple wizard, 
  // but keeping structure compatible with array of images from models.go
  const currentImage = character.images[0] || null;

  const handleSelectPreset = (preset: PresetAvatar) => {
    setCharacter(prev => ({
      ...prev,
      images: [
        {
          url: preset.url,
          sourceType: preset.sourceType,
          artistName: preset.artistName,
          artistHandle: preset.artistHandle,
          artistLink: preset.artistLink,
          position: 0,
        },
      ],
    }));
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
          file, // store the actual file object for uploading via API
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl md:text-2xl text-[hsl(var(--accent-gold))] mb-2">
          Step 3: Character Visuals
        </h2>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Provide a portrait image for your character sheet, and credit the original artist or source.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-2">
        {/* Left Side: Select image source */}
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-primary))] flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[hsl(var(--primary))]" />
              Choose Preset Portrait
            </h3>
            <div className="grid grid-cols-4 gap-3">
              {PRESET_AVATARS.map((preset, index) => {
                const isSelected = currentImage?.url === preset.url;
                return (
                  <button
                    key={index}
                    onClick={() => handleSelectPreset(preset)}
                    className="relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all duration-300 hover:scale-105"
                    style={{
                      borderColor: isSelected ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.08)',
                      boxShadow: isSelected ? '0 0 12px hsl(var(--primary-glow))' : 'none',
                    }}
                  >
                    <img src={preset.url} alt="Preset RPG Avatar" className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-[hsl(var(--primary-glow))] flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-[hsl(var(--primary))] text-white flex items-center justify-center shadow-lg">
                          <Check className="w-4 h-4" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-xs text-[hsl(var(--text-secondary))] uppercase tracking-wider font-semibold">Or upload local file</span>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rpg-btn rpg-btn-secondary w-full py-4 border-dashed border-2 flex flex-col items-center gap-2 rounded-xl"
            >
              <Upload className="w-6 h-6 text-[hsl(var(--text-muted))]" />
              <span className="text-sm">Click to Browse Images</span>
              <span className="text-xs text-[hsl(var(--text-muted))]">JPEG, PNG, or WebP up to 10MB</span>
            </button>
          </div>
        </div>

        {/* Right Side: Image Preview & Attribution Form */}
        <div className="flex flex-col gap-5">
          {currentImage ? (
            <div className="flex flex-col gap-4">
              {/* Preview frame */}
              <div className="w-full aspect-[3/2] rounded-lg overflow-hidden border border-[rgba(255,255,255,0.08)] bg-slate-900 relative">
                <img
                  src={currentImage.url}
                  alt="Portrait Preview"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-2 right-2 bg-slate-950/80 px-2 py-0.5 text-[10px] text-white tracking-widest uppercase rounded">
                  Live Preview
                </span>
              </div>

              {/* Attribution details */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--accent-gold))]">
                  Attribution & Credit Details
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="rpg-label text-[10px]">Source Type</label>
                    <select
                      className="rpg-input py-2 px-3 text-sm bg-slate-950"
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
                      className="rpg-input py-2 px-3 text-sm"
                      placeholder="e.g. Valerius Cosplay"
                      value={currentImage.artistName || ''}
                      onChange={(e) => updateAttribution('artistName', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="rpg-label text-[10px]">Artist Handle/Social</label>
                    <input
                      type="text"
                      className="rpg-input py-2 px-3 text-sm"
                      placeholder="e.g. @valerius"
                      value={currentImage.artistHandle || ''}
                      onChange={(e) => updateAttribution('artistHandle', e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col">
                    <label className="rpg-label text-[10px]">Artist Website/Link</label>
                    <input
                      type="text"
                      className="rpg-input py-2 px-3 text-sm"
                      placeholder="e.g. https://artstation.com/..."
                      value={currentImage.artistLink || ''}
                      onChange={(e) => updateAttribution('artistLink', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-slate-800 rounded-xl bg-slate-950/20 text-[hsl(var(--text-muted))] min-h-[300px]">
              <ImageIcon className="w-12 h-12 mb-3 stroke-[1.25]" />
              <p className="text-sm">No Portrait Selected</p>
              <p className="text-xs max-w-xs mt-1">
                Choose a preset image on the left or upload your own file to proceed.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

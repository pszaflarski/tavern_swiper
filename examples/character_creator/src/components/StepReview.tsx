import { useState } from 'react';
import type { CharacterState } from './CharacterWizard.tsx';
import { Copy, Check, Eye, Code, Award, ExternalLink, ShieldCheck } from 'lucide-react';

interface StepReviewProps {
  character: CharacterState;
  isSubmitting: boolean;
  successPayload: any | null;
  onSubmit: () => void;
}

export default function StepReview({ character, isSubmitting, successPayload, onSubmit }: StepReviewProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'card' | 'json'>('card');
  
  const currentImage = character.images[0] || null;

  const handleCopy = () => {
    if (!successPayload) return;
    navigator.clipboard.writeText(JSON.stringify(successPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Convert the current state to the expected API output representation for previewing
  const mockApiRepresentation = {
    display_name: character.displayName,
    tagline: character.tagline || null,
    bio: character.bio || null,
    fandom: character.fandom,
    race: character.race,
    gender: character.gender,
    images: character.images.map((img, idx) => ({
      image_id: `img-uuid-${idx}`,
      url: img.url,
      source_type: img.sourceType,
      artist_handle: img.artistHandle || null,
      artist_name: img.artistName || null,
      artist_link: img.artistLink || null,
      position: img.position,
    })),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl md:text-2xl text-[hsl(var(--accent-gold))] mb-2">
          Step 4: Forge & Review
        </h2>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Inspect your custom character card sheet and cast the creation spell.
        </p>
      </div>

      {successPayload && (
        <div className="p-4 bg-[rgba(16,185,129,0.12)] border border-emerald-500/40 rounded-xl flex items-center gap-3 text-emerald-400 text-sm">
          <ShieldCheck className="w-5 h-5 flex-shrink-0" />
          <div>
            <strong className="block font-semibold">Character Forged Successfully!</strong>
            <span>The character template has been compiled and is ready for use.</span>
          </div>
        </div>
      )}

      {/* Tabs to toggle preview vs JSON */}
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.06)] pb-3 mt-2">
        <button
          onClick={() => setActiveTab('card')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
            activeTab === 'card' 
              ? 'bg-[hsl(var(--primary-glow))] text-[hsl(var(--text-primary))] border border-hsla(var(--primary),0.3)' 
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          Adventurer Card
        </button>
        <button
          onClick={() => setActiveTab('json')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
            activeTab === 'json' 
              ? 'bg-[hsl(var(--primary-glow))] text-[hsl(var(--text-primary))] border border-hsla(var(--primary),0.3)' 
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          JSON Document
        </button>
      </div>

      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 py-4">
        {activeTab === 'card' ? (
          /* Tavern Swiper RPG Card Preview */
          <div className="tavern-card-container flex-shrink-0">
            {currentImage ? (
              <img src={currentImage.url} alt="Character Portrait" className="tavern-card-image" />
            ) : (
              <div className="w-full h-full bg-slate-900 flex items-center justify-center text-slate-700">
                No Portrait
              </div>
            )}
            
            {/* Attribution Overlay top left */}
            {currentImage && (currentImage.artistName || currentImage.artistHandle) && (
              <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur-sm border border-[rgba(255,255,255,0.08)] py-1 px-2.5 rounded-lg flex items-center gap-1 text-[10px] text-[hsl(var(--text-secondary))] max-w-[200px]">
                <Award className="w-3 h-3 text-[hsl(var(--accent-gold))]" />
                <span className="truncate">
                  Art: {currentImage.artistName || currentImage.artistHandle}
                </span>
                {currentImage.artistLink && (
                  <a href={currentImage.artistLink} target="_blank" rel="noreferrer" className="text-[hsl(var(--accent-gold))] hover:text-white">
                    <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
                  </a>
                )}
              </div>
            )}

            {/* Content overlay bottom */}
            <div className="tavern-card-overlay">
              {/* Badge Tags Row */}
              <div className="badge-row">
                {character.fandom.map(f => (
                  <span key={f.id} className="badge-tag fandom">{f.name}</span>
                ))}
                {character.race.map(r => (
                  <span key={r.id} className="badge-tag race">{r.name}</span>
                ))}
                {character.gender.map(g => (
                  <span key={g.id} className="badge-tag gender">{g.name}</span>
                ))}
              </div>

              {/* Title / Name */}
              <h3 className="text-2xl font-bold text-white tracking-wide truncate mb-1">
                {character.displayName}
              </h3>

              {/* Tagline */}
              {character.tagline && (
                <p className="text-xs text-[hsl(var(--accent-gold))] font-medium tracking-wider italic mb-2">
                  &ldquo;{character.tagline}&rdquo;
                </p>
              )}

              {/* Biography preview */}
              {character.bio && (
                <p className="text-xs text-[hsl(var(--text-secondary))] line-clamp-3 leading-relaxed">
                  {character.bio}
                </p>
              )}
            </div>
          </div>
        ) : (
          /* JSON Inspection Code Box */
          <div className="w-full max-w-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[hsl(var(--text-muted))] font-mono">
                {successPayload ? 'REST_API_RESPONSE.json' : 'PREVIEW_API_PAYLOAD.json'}
              </span>
              {successPayload && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-[hsl(var(--accent-gold))] hover:text-white transition-all bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy JSON
                    </>
                  )}
                </button>
              )}
            </div>
            
            <pre className="w-full bg-[rgba(10,5,20,0.6)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 overflow-x-auto text-[11px] font-mono text-slate-300 leading-relaxed max-h-[380px] shadow-inner">
              {JSON.stringify(successPayload || mockApiRepresentation, null, 2)}
            </pre>
          </div>
        )}

        {/* Action Panel on the right / below */}
        <div className="flex-1 flex flex-col gap-4 max-w-md w-full">
          <div className="glass-card p-5 flex flex-col gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--accent-gold))]">
              Adventurer Digest
            </h4>
            <ul className="text-xs text-[hsl(var(--text-secondary))] flex flex-col gap-2">
              <li className="flex justify-between border-b border-[rgba(255,255,255,0.04)] pb-1.5">
                <span>Display Name:</span>
                <strong className="text-white">{character.displayName}</strong>
              </li>
              <li className="flex justify-between border-b border-[rgba(255,255,255,0.04)] pb-1.5">
                <span>Alignments (Fandom):</span>
                <strong className="text-white">{character.fandom.length} tags</strong>
              </li>
              <li className="flex justify-between border-b border-[rgba(255,255,255,0.04)] pb-1.5">
                <span>Races/Ancestries:</span>
                <strong className="text-white">{character.race.length} tags</strong>
              </li>
              <li className="flex justify-between border-b border-[rgba(255,255,255,0.04)] pb-1.5">
                <span>Genders:</span>
                <strong className="text-white">{character.gender.length} tags</strong>
              </li>
              <li className="flex justify-between pb-0.5">
                <span>Source Image Type:</span>
                <strong className="text-white capitalize">{currentImage?.sourceType || 'None'}</strong>
              </li>
            </ul>
          </div>

          {!successPayload && (
            <div className="p-4 bg-[hsla(var(--primary),0.06)] border border-[hsla(var(--primary),0.2)] rounded-xl">
              <p className="text-xs text-[hsl(var(--text-secondary))] leading-relaxed">
                Clicking <strong className="text-white">Forge Character</strong> will assemble this metadata payload. 
                If in API mode, it will execute requests to create the character in the Firestore database.
              </p>
            </div>
          )}

          {!successPayload && (
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="rpg-btn rpg-btn-gold py-4 text-sm font-bold uppercase tracking-widest w-full"
            >
              {isSubmitting ? 'Summoning...' : 'Casting Creation Spell'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

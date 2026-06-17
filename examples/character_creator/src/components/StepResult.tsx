import { useState, useEffect } from 'react';
import { Sparkles, Bot, Terminal, RefreshCw, ArrowLeft, Check, AlertCircle } from 'lucide-react';

interface StepResultProps {
  fandom: string;
  gender: string;
  race: string;
  characterClass: string;
  onReset: () => void;
}

interface CharacterDetails {
  name: string;
  tagline: string;
  bio: string;
  image_prompt: string;
}

export default function StepResult({
  fandom,
  gender,
  race,
  characterClass,
  onReset,
}: StepResultProps) {
  const [isForging, setIsForging] = useState(false);
  const [forgingStep, setForgingStep] = useState(0);
  const [resultCharacter, setResultCharacter] = useState<CharacterDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const promptText = `Universe Fandom: ${fandom}, Gender Identity: ${gender || 'any'}, Race Lineage: ${race || 'any'}, Class Role: ${characterClass || 'any'}`;

  // Log steps shown during generation
  const forgingLogs = [
    'Connecting to local agent router (http://localhost:8000)...',
    'Invoking character_generator graph...',
    'Requesting model gemini-flash-lite...',
    'Parsing structured JSON output...',
    'Invoking Imagen 4.0 for portrait generation...',
    'Summoning completed!',
  ];

  // Auto-increment logs for visual flair while loading
  useEffect(() => {
    if (!isForging) return;
    const interval = setInterval(() => {
      setForgingStep((prev) => (prev < forgingLogs.length - 2 ? prev + 1 : prev));
    }, 600);
    return () => clearInterval(interval);
  }, [isForging]);

  const handleForge = async () => {
    setIsForging(true);
    setForgingStep(0);
    setResultCharacter(null);
    setImageBase64(null);
    setError(null);

    let characterData: CharacterDetails;

    try {
      const response = await fetch('http://localhost:8000/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: promptText,
          agent: 'character_generator',
          model: 'gemini-flash-lite',
          thread_id: threadId,
        }),
      });

      if (!response.ok) {
        const errDetails = await response.json().catch(() => ({}));
        throw new Error(errDetails.detail || `Server returned status ${response.status}`);
      }

      const data = await response.json();
      
      // Parse the JSON string from the response field
      try {
        characterData = JSON.parse(data.response);
      } catch (parseErr) {
        // Fallback in case LLM outputs loose markdown or raw text instead of standard JSON
        console.warn('Failed to parse response JSON, attempting extract', parseErr);
        const jsonMatch = data.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          characterData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Agent response was not in a valid JSON format');
        }
      }

      if (!characterData.name || !characterData.tagline || !characterData.bio || !characterData.image_prompt) {
        throw new Error('Structured character data is missing required attributes');
      }

      // Finish log sequence and show results for details immediately
      setForgingStep(forgingLogs.length - 2);
      setResultCharacter(characterData);
      setIsForging(false);

    } catch (err: any) {
      console.error('[Forge API Error]:', err);
      setError(
        err.message === 'Failed to fetch'
          ? 'Cannot connect to agent router. Please ensure the agent router is running locally on http://localhost:8000 (run: python debug_server.py or equivalent)'
          : err.message || 'An error occurred during AI character generation.'
      );
      setIsForging(false);
      return;
    }

    // Fetch the image using the generated image_prompt in the background of the sheet page
    setIsGeneratingImage(true);
    try {
      const imgResponse = await fetch('http://localhost:8000/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: characterData.image_prompt,
          aspect_ratio: '3:4',
        }),
      });

      if (!imgResponse.ok) {
        const errDetails = await imgResponse.json().catch(() => ({}));
        throw new Error(errDetails.detail || `Server returned status ${imgResponse.status} while generating portrait`);
      }

      const imgData = await imgResponse.json();
      setImageBase64(imgData.image);
    } catch (err: any) {
      console.error('[Forge Image API Error]:', err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleRegeneratePortrait = async () => {
    if (!resultCharacter) return;
    setIsGeneratingImage(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: resultCharacter.image_prompt,
          aspect_ratio: '3:4',
        }),
      });

      if (!response.ok) {
        const errDetails = await response.json().catch(() => ({}));
        throw new Error(errDetails.detail || `Server returned status ${response.status} while generating portrait`);
      }

      const data = await response.json();
      setImageBase64(data.image);
    } catch (err: any) {
      console.error('[Regenerate Portrait Error]:', err);
      setError(err.message || 'An error occurred during portrait generation.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  if (isForging) {
    return (
      <div className="glass-panel text-center py-8 min-h-380 flex flex-col justify-center items-center">
        <div className="mb-6 relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20 w-16 h-16 mx-auto"></div>
          <Sparkles className="w-16 h-16 text-accent-gold animate-spin duration-[4000ms] relative z-10" />
        </div>
        <h3 className="summary-title mb-4 font-rpg glow-text">Contacting the AI Oracle...</h3>
        <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded p-4 font-mono text-left text-xs">
          <div className="text-muted mb-2">&gt; terminal_log initialized</div>
          {forgingLogs.slice(0, forgingStep + 1).map((log, index) => (
            <div key={index} className="text-primary-fixed mb-1">
              <span className="text-accent-gold">✓</span> {log}
            </div>
          ))}
          {forgingStep < forgingLogs.length - 1 && (
            <div className="text-secondary animate-pulse mt-2">
              <span className="animate-ping mr-1">●</span> Generation in progress...
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel text-center py-8 min-h-380 flex flex-col justify-center items-center">
        <div className="mb-4 text-accent-rose">
          <AlertCircle className="w-16 h-16 mx-auto" />
        </div>
        <h3 className="summary-title mb-2 font-rpg text-accent-rose">Summoning Failed</h3>
        <p className="text-sm text-secondary max-w-md mb-6">{error}</p>
        <div className="flex gap-4">
          <button
            onClick={() => {
              setThreadId(crypto.randomUUID());
              onReset();
            }}
            className="rpg-btn px-5 py-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
          <button onClick={handleForge} className="rpg-btn rpg-btn-primary px-6 py-2 font-bold">
            <RefreshCw className="w-4 h-4" />
            Retry Forge
          </button>
        </div>
      </div>
    );
  }

  if (resultCharacter) {
    return (
      <div className="flex flex-col gap-6 items-center">
        <h2 className="step-title font-rpg glow-text">Adventurer Summoned!</h2>
        <p className="step-description">
          Successfully queried the `character_generator` agent with the `gemini-flash-lite` model.
        </p>

        {/* Customized Sheet layout with split picture frame */}
        <div className="summary-card final-sheet w-full">
          <div className="character-sheet-container">
            {/* Portrait Column */}
            <div className="portrait-side">
              <div className="portrait-frame">
                {isGeneratingImage ? (
                  <div className="portrait-skeleton">
                    <Sparkles className="w-8 h-8 text-accent-gold animate-spin duration-[3000ms]" />
                    <span className="text-[10px] text-accent-gold font-mono tracking-wider uppercase">Forging Art...</span>
                  </div>
                ) : imageBase64 ? (
                  <img
                    src={imageBase64}
                    alt={resultCharacter.name}
                    className="portrait-image"
                  />
                ) : (
                  <div className="portrait-skeleton">
                    <Bot className="w-10 h-10 portrait-placeholder-icon" />
                    <span className="text-[10px] text-muted font-mono uppercase">No Art</span>
                  </div>
                )}
              </div>
            </div>

            {/* Information Column */}
            <div className="info-side">
              <div className="badge-row mb-3 flex flex-wrap gap-2 justify-start">
                <span className="badge-tag fandom">{fandom}</span>
                {race && <span className="badge-tag race">{race}</span>}
                {gender && <span className="badge-tag gender">{gender}</span>}
                {characterClass && <span className="badge-tag">{characterClass}</span>}
              </div>

              <div className="mb-4 text-left">
                <h3 className="character-name font-rpg text-primary-fixed text-2xl mb-1">
                  {resultCharacter.name}
                </h3>
                <p className="character-tagline text-accent-gold italic text-sm">
                  "{resultCharacter.tagline}"
                </p>
              </div>

              <div className="generation-panel text-left !mt-0">
                <div className="text-xs text-muted uppercase font-bold tracking-wider mb-2">
                  Character Background Lore
                </div>
                <p className="text-sm text-secondary leading-relaxed font-rpg mb-4">
                  {resultCharacter.bio}
                </p>
                
                <div className="text-xs text-muted uppercase font-bold tracking-wider mb-2 pt-2 border-t border-outline-variant">
                  Stable Diffusion Image Prompt
                </div>
                <p className="text-xs text-secondary leading-relaxed font-mono bg-surface-container-lowest border border-outline-variant p-2 rounded max-h-24 overflow-y-auto">
                  {resultCharacter.image_prompt}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Row */}
        <div className="flex flex-wrap gap-3 justify-center w-full max-w-xl mt-2">
          <button
            onClick={() => {
              setThreadId(crypto.randomUUID());
              onReset();
            }}
            className="rpg-btn px-4 py-2.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Start Over
          </button>

          <button 
            onClick={handleRegeneratePortrait} 
            disabled={isGeneratingImage || isForging}
            className="rpg-btn rpg-btn-gold px-4 py-2.5 font-bold"
          >
            <RefreshCw className={`w-4 h-4 ${isGeneratingImage ? 'animate-spin' : ''}`} />
            New Portrait
          </button>

          <button 
            onClick={handleForge} 
            disabled={isGeneratingImage || isForging}
            className="rpg-btn rpg-btn-gold px-4 py-2.5 font-bold"
          >
            <RefreshCw className={`w-4 h-4 ${isForging ? 'animate-spin' : ''}`} />
            Regenerate Hero
          </button>

          <button
            onClick={() => alert('Adventurer adopted! Saved to your profile database.')}
            className="rpg-btn rpg-btn-primary px-5 py-2.5 font-bold"
          >
            <Check className="w-4 h-4" />
            Adopt Hero
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="step-title">AI Character Forge</h2>
        <p className="step-description">
          Review your selection parameters. We will invoke the local agent router to forge your character details.
        </p>
      </div>

      {/* Selected Attributes Table */}
      <div className="summary-card w-full">
        <h3 className="summary-title font-rpg mb-4">Forge Blueprint</h3>
        <div className="summary-badge-row">
          <span className="summary-badge fandom">{fandom}</span>
          {gender && <span className="summary-badge gender">{gender}</span>}
          {race && <span className="summary-badge race">{race}</span>}
          {characterClass && <span className="summary-badge">{characterClass}</span>}
        </div>

        <div className="flex flex-col gap-2 mb-6">
          <div className="summary-item">
            <span className="summary-label">Universe Fandom:</span>
            <span className="summary-value">{fandom}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Identity baseline:</span>
            <span className="summary-value">{gender || 'Undetermined (AI Random)'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Lineage Race:</span>
            <span className="summary-value">{race || 'Undetermined (AI Random)'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Class Role:</span>
            <span className="summary-value">{characterClass || 'Undetermined (AI Random)'}</span>
          </div>
        </div>

        {/* AI Prompt Mock Input */}
        <div className="generation-panel text-left">
          <div className="flex items-center gap-2 mb-2 text-xs text-accent-gold uppercase font-bold tracking-wider">
            <Bot size={14} />
            <span>AI Prompt Generator Blueprint</span>
          </div>
          <div className="generation-prompt-box">
            <span>{promptText}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Terminal size={12} />
            <span>Model: gemini-flash-lite (via Local Agent Router)</span>
          </div>
        </div>
      </div>

      {/* Button controls */}
      <div className="flex gap-4 justify-between w-full max-w-md mx-auto nav-row">
        <button
          onClick={() => {
            setThreadId(crypto.randomUUID());
            onReset();
          }}
          className="rpg-btn px-5 py-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Reset Selection
        </button>

        <button onClick={handleForge} className="rpg-btn rpg-btn-primary px-6 py-3 font-bold">
          <Sparkles className="w-4 h-4 text-accent-gold" />
          Forge Character
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Sparkles, Sliders, Shield, Terminal } from 'lucide-react';
import CharacterWizard from './components/CharacterWizard.tsx';

export interface AppConfig {
  mode: 'mock' | 'api';
  apiUrl: string;
  token: string;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>({
    mode: 'mock',
    apiUrl: 'http://localhost:8012/characters',
    token: '',
  });
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Generate some sparks for the ambient background
  const sparks = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 90}%`,
    top: `${Math.random() * 90}%`,
    animationDelay: `${i * 1.5}s`,
    animationDuration: `${6 + Math.random() * 4}s`,
  }));

  return (
    <div className="min-h-screen relative flex flex-col pb-12 select-none">
      {/* Ambient background and sparks */}
      <div className="ambient-bg">
        {sparks.map((spark) => (
          <div
            key={spark.id}
            className="ambient-spark"
            style={{
              left: spark.left,
              top: spark.top,
              animationDelay: spark.animationDelay,
              animationDuration: spark.animationDuration,
            }}
          />
        ))}
      </div>

      {/* Header Bar */}
      <header className="w-full max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 z-10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-6 h-6 text-[hsl(var(--accent-gold))]" />
            <h1 className="text-2xl md:text-3xl text-[hsl(var(--text-primary))] font-extrabold tracking-wide uppercase">
              Tavern Swiper
            </h1>
          </div>
          <p className="text-sm text-[hsl(var(--text-secondary))] tracking-wider">
            CHARACTER CREATOR & RPG SHEET WIZARD
          </p>
        </div>

        {/* Configuration Selector */}
        <div className="relative">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfigPanel(!showConfigPanel)}
              className="rpg-btn rpg-btn-secondary py-2 px-4 flex items-center gap-2"
              title="Configure API / Mock connection"
            >
              <Sliders className="w-4 h-4" />
              <span>Connection: <strong className="text-[hsl(var(--accent-gold))] uppercase">{config.mode}</strong></span>
            </button>
          </div>

          {showConfigPanel && (
            <div className="absolute right-0 mt-3 w-80 glass-panel p-5 z-50 flex flex-col gap-4 shadow-2xl">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--accent-gold))] flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Connection Settings
              </h3>
              
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[hsl(var(--text-secondary))]">Operation Mode</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, mode: 'mock' }))}
                    className={`rpg-btn text-xs py-2 ${config.mode === 'mock' ? 'rpg-btn-primary' : 'rpg-btn-secondary'}`}
                  >
                    Mock Playground
                  </button>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, mode: 'api' }))}
                    className={`rpg-btn text-xs py-2 ${config.mode === 'api' ? 'rpg-btn-primary' : 'rpg-btn-secondary'}`}
                  >
                    Live API (Auth)
                  </button>
                </div>
              </div>

              {config.mode === 'api' && (
                <div className="flex flex-col gap-3 pt-2 border-t border-[rgba(255,255,255,0.08)]">
                  <div className="flex flex-col">
                    <label className="rpg-label text-[10px]">Characters API URL</label>
                    <input
                      type="text"
                      className="rpg-input py-1.5 px-3 text-xs"
                      value={config.apiUrl}
                      onChange={(e) => setConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="rpg-label text-[10px]">Tavern JWT Token</label>
                    <input
                      type="password"
                      placeholder="Bearer token..."
                      className="rpg-input py-1.5 px-3 text-xs"
                      value={config.token}
                      onChange={(e) => setConfig(prev => ({ ...prev, token: e.target.value }))}
                    />
                  </div>
                </div>
              )}
              
              <button
                onClick={() => setShowConfigPanel(false)}
                className="rpg-btn rpg-btn-gold py-1.5 text-xs font-semibold mt-2"
              >
                Apply & Close
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 z-10 flex flex-col justify-center">
        <CharacterWizard config={config} />
      </main>

      {/* Footer */}
      <footer className="w-full max-w-6xl mx-auto px-4 mt-8 pt-6 border-t border-[hsla(var(--primary),0.1)] flex items-center justify-between text-xs text-[hsl(var(--text-muted))] z-10">
        <span>Tavern Swiper Project &copy; {new Date().getFullYear()}</span>
        <div className="flex items-center gap-1">
          <Terminal className="w-3.5 h-3.5" />
          <span>Character Creator Module v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}

import { Sparkles, Terminal } from 'lucide-react';
import CharacterWizard from './components/CharacterWizard.tsx';

export default function App() {

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
            <Sparkles className="w-6 h-6 text-accent-gold" />
            <h1 className="text-2xl md:text-3xl text-primary font-extrabold tracking-wide uppercase">
              Tavern Swiper
            </h1>
          </div>
          <p className="text-sm text-secondary tracking-wider">
            CHARACTER CREATOR & RPG SHEET WIZARD
          </p>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 z-10 flex flex-col justify-center">
        <CharacterWizard />
      </main>

      {/* Footer */}
      <footer className="w-full max-w-6xl mx-auto px-4 mt-8 pt-6 border-t border-[hsla(var(--primary),0.1)] flex items-center justify-between text-xs text-muted z-10">
        <span>Tavern Swiper Project &copy; {new Date().getFullYear()}</span>
        <div className="flex items-center gap-1">
          <Terminal className="w-3.5 h-3.5" />
          <span>Character Creator Module v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}

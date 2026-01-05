import { useEffect, useRef, useState } from 'react';
import './App.css';
import { Game } from './game/GameTSL';
import { GameStateService, GameState } from './game/GameState';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    health: 100,
    ammo: 30,
    score: 0,
    isGameOver: false
  });

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
      gameRef.current = new Game(containerRef.current);
    }

    // Subscribe to game state
    const unsubscribe = GameStateService.getInstance().subscribe((state) => {
      setGameState(state);
    });

    return () => {
      unsubscribe();
      if (gameRef.current) {
        gameRef.current.dispose();
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* HUD */}
      <div className="absolute top-4 left-4 text-white font-bold pointer-events-none select-none">
        <div className="text-xl">SCORE: {gameState.score}</div>
        <div className="text-sm font-normal opacity-70">Click to Play | WASD to Move | Space to Jump</div>
      </div>

      <div className="absolute bottom-8 left-8 text-white font-bold pointer-events-none select-none">
        <div className="text-4xl flex items-end gap-2">
          <span>{gameState.health}</span>
          <span className="text-lg font-normal opacity-70 mb-1">HP</span>
        </div>
      </div>

      <div className="absolute bottom-8 right-8 text-white font-bold pointer-events-none select-none text-right">
        <div className="text-4xl flex items-end justify-end gap-2">
          <span>{gameState.ammo}</span>
          <span className="text-lg font-normal opacity-70 mb-1">AMMO</span>
        </div>
      </div>
      
      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 w-4 h-4 -mt-2 -ml-2 pointer-events-none">
        <div className="w-full h-0.5 bg-white absolute top-1/2 transform -translate-y-1/2 shadow-sm"></div>
        <div className="h-full w-0.5 bg-white absolute left-1/2 transform -translate-x-1/2 shadow-sm"></div>
      </div>

      {/* Game Over Screen */}
      {gameState.isGameOver && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-50">
          <h1 className="text-6xl font-bold mb-4 text-red-500">GAME OVER</h1>
          <p className="text-2xl mb-8">Final Score: {gameState.score}</p>
          <button 
            className="px-6 py-3 bg-white text-black font-bold rounded hover:bg-gray-200 transition-colors cursor-pointer pointer-events-auto"
            onClick={() => {
              GameStateService.getInstance().reset();
              window.location.reload(); // Simple reload to restart for now
            }}
          >
            TRY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}

export default App;

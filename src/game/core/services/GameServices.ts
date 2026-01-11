import type { GameStateStore } from '../GameState';
import { GameStateService as GameStateServiceSingleton } from '../GameState';
import type { SoundManagerApi } from '../SoundManager';
import { SoundManager as SoundManagerSingleton } from '../SoundManager';

export type GameServices = {
    state: GameStateStore;
    sound: SoundManagerApi;
};

export function getDefaultGameServices(): GameServices {
    return {
        state: GameStateServiceSingleton.getInstance(),
        sound: SoundManagerSingleton.getInstance(),
    };
}

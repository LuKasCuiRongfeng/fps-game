import React from 'react';

interface ScoreInfoProps {
    score: number;
}

export const ScoreInfo: React.FC<ScoreInfoProps> = ({ score }) => {
    return (
        <div className="absolute top-4 left-4 text-white font-bold pointer-events-none select-none">
            <div className="text-xl">SCORE: {score}</div>
            <div className="text-sm font-normal opacity-70">Click to Play | WASD Move | Scroll/1-2 Switch | G Grenade</div>
        </div>
    );
};

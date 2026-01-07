import React from 'react';

interface PickupHintProps {
    hint: string | null;
}

export const PickupHint: React.FC<PickupHintProps> = ({ hint }) => {
    if (!hint) return null;

    return (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 mt-16 pointer-events-none select-none">
            <div className="bg-black/60 px-4 py-2 rounded-lg border border-white/30 backdrop-blur-sm">
                <div className="text-white text-center">
                    <span className="text-yellow-300 font-bold">[F]</span>
                    <span className="ml-2">{hint}</span>
                </div>
            </div>
        </div>
    );
};

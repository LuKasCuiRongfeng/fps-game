import React from 'react';

interface LoadingScreenProps {
    isLoading: boolean;
    progress: number;
    description: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ isLoading, progress, description }) => {
    if (!isLoading) return null;

    return (
        <div className="absolute inset-0 bg-black flex flex-col items-center justify-center text-white z-100">
            <div className="w-16 h-16 border-4 border-white/20 border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <div className="text-2xl font-bold tracking-widest mb-2">LOADING</div>
            
            {/* Progress Bar */}
            <div className="w-64 h-2 bg-gray-800 rounded-full mt-4 mb-2 overflow-hidden">
                <div 
                    className="h-full bg-blue-500 transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
            
            <div className="text-sm opacity-50 font-mono">
                {description} ({Math.round(progress)}%)
            </div>
        </div>
    );
};

import React from 'react';

export const Crosshair: React.FC = () => {
    return (
        <div className="absolute top-1/2 left-1/2 w-4 h-4 -mt-2 -ml-2 pointer-events-none">
            <div className="w-full h-0.5 bg-white absolute top-1/2 transform -translate-y-1/2 shadow-sm"></div>
            <div className="h-full w-0.5 bg-white absolute left-1/2 transform -translate-x-1/2 shadow-sm"></div>
        </div>
    );
};

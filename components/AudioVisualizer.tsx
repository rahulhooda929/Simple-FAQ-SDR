import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
  isSpeaking: boolean; // Model is speaking
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, volume, isSpeaking }) => {
  return (
    <div className="flex items-center justify-center h-32 w-full relative">
      {/* Background Rings */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className={`absolute w-20 h-20 bg-blue-500 rounded-full opacity-20 animate-ping`} style={{ animationDuration: '2s' }}></div>
            <div className={`absolute w-16 h-16 bg-blue-500 rounded-full opacity-30 animate-ping`} style={{ animationDuration: '1.5s' }}></div>
        </div>
      )}

      {/* Main Circle */}
      <div 
        className={`relative z-10 rounded-full transition-all duration-100 flex items-center justify-center shadow-lg
          ${isActive ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-slate-300'}
        `}
        style={{
          width: isActive ? `${64 + (volume * 50)}px` : '64px',
          height: isActive ? `${64 + (volume * 50)}px` : '64px',
        }}
      >
        {isSpeaking ? (
             <div className="flex gap-1 h-4 items-center">
               <div className="w-1 bg-white animate-[bounce_1s_infinite] h-full"></div>
               <div className="w-1 bg-white animate-[bounce_1.2s_infinite] h-3"></div>
               <div className="w-1 bg-white animate-[bounce_0.8s_infinite] h-4"></div>
             </div>
        ) : (
            <svg className={`w-8 h-8 ${isActive ? 'text-white' : 'text-slate-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </div>
      
      <div className="absolute -bottom-2 text-xs font-medium text-slate-500">
        {isActive ? (isSpeaking ? "Riya is speaking..." : "Listening...") : "Idle"}
      </div>
    </div>
  );
};
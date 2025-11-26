import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LeadData, ConnectionState, LogMessage } from './types';
import { SYSTEM_INSTRUCTION, LEAD_TOOL_SCHEMA } from './constants';
import { createPcmBlob, decodeAudioData } from './utils/audioUtils';
import { LeadForm } from './components/LeadForm';
import { AudioVisualizer } from './components/AudioVisualizer';

// Define the shape of the tool arguments for type safety
interface ToolArgs {
  name?: string;
  company?: string;
  email?: string;
  role?: string;
  useCase?: string;
  teamSize?: string;
  timeline?: string;
  summary?: string;
}

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(process.env.API_KEY || '');
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [volume, setVolume] = useState(0);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Session & Playback Refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // --- Audio Setup ---
  const initializeAudio = async () => {
    try {
      // 1. Input Audio (Microphone)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
      }});
      mediaStreamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioContextRef.current = inputCtx;

      const source = inputCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      // Use ScriptProcessor for capturing PCM data (bufferSize 4096 = ~256ms latency)
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Simple volume meter logic
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);
        setVolume(Math.min(rms * 5, 1)); // Amplify for visual

        const blob = createPcmBlob(inputData);
        
        if (sessionPromiseRef.current) {
          sessionPromiseRef.current.then(session => {
             // Only send if connected
             session.sendRealtimeInput({ media: blob });
          }).catch(err => {
             // Session might be closed or failed
             console.debug("Skipping send, session likely closed");
          });
        }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination); // Required for script processor to run

      // 2. Output Audio (Speaker)
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioContextRef.current = outputCtx;

    } catch (err) {
      console.error("Audio init error:", err);
      throw new Error("Failed to access microphone. Please allow permissions.");
    }
  };

  const stopAudio = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    // Stop any currently playing sounds
    scheduledSourcesRef.current.forEach(src => {
        try { src.stop(); } catch(e){}
    });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  // --- Live API Connection ---
  const connectToLiveAPI = async () => {
    if (!apiKey) {
      setErrorMsg("API Key is required.");
      return;
    }
    
    setConnectionState(ConnectionState.CONNECTING);
    setErrorMsg(null);
    setLogs(prev => [...prev, { role: 'system', text: 'Initializing audio...', timestamp: new Date() }]);

    try {
      await initializeAudio();
      
      const ai = new GoogleGenAI({ apiKey });
      
      setLogs(prev => [...prev, { role: 'system', text: 'Connecting to Gemini Live...', timestamp: new Date() }]);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [LEAD_TOOL_SCHEMA] }],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } 
          }
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            setLogs(prev => [...prev, { role: 'system', text: 'Connected! Start speaking.', timestamp: new Date() }]);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // 1. Handle Tool Calls
            if (msg.toolCall) {
                console.log("Tool Call Received:", msg.toolCall);
                const responses = [];
                for (const fc of msg.toolCall.functionCalls) {
                    if (fc.name === 'updateLeadInfo') {
                        const args = fc.args as ToolArgs;
                        setLeadData(prev => ({ ...prev, ...args }));
                        
                        // Add log
                        setLogs(prev => [...prev, { 
                            role: 'assistant', 
                            text: `[CRM Update] ${JSON.stringify(args)}`, 
                            timestamp: new Date() 
                        }]);

                        responses.push({
                            id: fc.id,
                            name: fc.name,
                            response: { result: "CRM Updated Successfully" }
                        });
                    }
                }
                // Send response back
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                        session.sendToolResponse({ functionResponses: responses });
                    });
                }
            }

            // 2. Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                setIsModelSpeaking(true);
                
                try {
                    const audioBuffer = await decodeAudioData(
                        new Uint8Array(atob(audioData).split('').map(c => c.charCodeAt(0))),
                        ctx
                    );

                    // Scheduling
                    // Ensure we don't schedule in the past
                    const now = ctx.currentTime;
                    // Provide a small buffer (0.05s) if we fell behind to avoid glitches
                    if (nextStartTimeRef.current < now) {
                        nextStartTimeRef.current = now + 0.05;
                    }
                    
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(ctx.destination);
                    
                    source.start(nextStartTimeRef.current);
                    
                    // Cleanup when done
                    source.onended = () => {
                        scheduledSourcesRef.current.delete(source);
                        if (scheduledSourcesRef.current.size === 0) {
                            setIsModelSpeaking(false);
                        }
                    };
                    
                    scheduledSourcesRef.current.add(source);
                    nextStartTimeRef.current += audioBuffer.duration;

                } catch (e) {
                    console.error("Decoding error", e);
                }
            }

            // 3. Handle Interruptions
            if (msg.serverContent?.interrupted) {
                setLogs(prev => [...prev, { role: 'system', text: 'Model interrupted by user.', timestamp: new Date() }]);
                // Stop all currently playing sources
                scheduledSourcesRef.current.forEach(s => {
                    try { s.stop(); } catch(e){}
                });
                scheduledSourcesRef.current.clear();
                setIsModelSpeaking(false);
                if (outputAudioContextRef.current) {
                    nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
                }
            }
          },
          onclose: () => {
             setConnectionState(ConnectionState.DISCONNECTED);
             setLogs(prev => [...prev, { role: 'system', text: 'Connection closed.', timestamp: new Date() }]);
             stopAudio();
          },
          onerror: (err) => {
             console.error("Live API Error:", err);
             setErrorMsg("Connection error occurred. Check console.");
             setConnectionState(ConnectionState.ERROR);
             stopAudio();
          }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
        console.error(e);
        setErrorMsg(e.message || "Failed to connect.");
        setConnectionState(ConnectionState.ERROR);
        stopAudio();
    }
  };

  const handleDisconnect = () => {
     // There is no explicit "disconnect" method on the session object exposed easily 
     // without keeping the session object. 
     // But closing the websocket is triggered if we drop references or if the server closes.
     // For this demo, we can just stop sending audio and reset local state, 
     // effectively ending the "call" from client side perspective. 
     // A cleaner way in a real app is to send a "goodbye" message or simply reload/unmount.
     // Here we force stop audio which usually triggers close events eventually or just stops flow.
     stopAudio();
     setConnectionState(ConnectionState.DISCONNECTED);
     sessionPromiseRef.current = null;
  };

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => {
        stopAudio();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      {/* --- Sidebar / Info Panel --- */}
      <div className="w-full md:w-1/3 lg:w-1/4 bg-white border-r border-slate-200 p-6 flex flex-col">
        <div className="mb-8">
            <h1 className="text-2xl font-bold text-blue-900 mb-2">Razorpay SDR</h1>
            <p className="text-sm text-slate-500">
                Voice Agent Demo powered by Gemini Live API (2.5 Native Audio).
            </p>
        </div>

        {/* Lead Form */}
        <div className="flex-1 overflow-hidden">
            <LeadForm data={leadData} />
        </div>

        {/* API Key Input (if needed, though prompt says use env, keeping hidden if env exists) */}
        {!process.env.API_KEY && (
            <div className="mt-6 pt-6 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-500 mb-2">GEMINI API KEY</label>
                <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter key..."
                />
            </div>
        )}
      </div>

      {/* --- Main Interaction Area --- */}
      <div className="flex-1 flex flex-col relative">
        
        {/* Header */}
        <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
            <div className="pointer-events-auto">
               {/* Place for any header controls if needed */}
            </div>
            
            {/* Connection Status Badge */}
            <div className={`px-4 py-1.5 rounded-full text-sm font-semibold shadow-sm backdrop-blur-sm pointer-events-auto transition-colors
                ${connectionState === ConnectionState.CONNECTED ? 'bg-green-100/90 text-green-700' : 
                  connectionState === ConnectionState.CONNECTING ? 'bg-yellow-100/90 text-yellow-700' : 
                  connectionState === ConnectionState.ERROR ? 'bg-red-100/90 text-red-700' :
                  'bg-slate-200/90 text-slate-600'}
            `}>
                {connectionState === ConnectionState.CONNECTED ? 'Connected to Riya' :
                 connectionState === ConnectionState.CONNECTING ? 'Connecting...' :
                 connectionState === ConnectionState.ERROR ? 'Connection Error' : 'Disconnected'}
            </div>
        </div>

        {/* Center Visualizer & Controls */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-12">
            
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-800">
                    {connectionState === ConnectionState.CONNECTED 
                        ? (isModelSpeaking ? "Riya is speaking..." : "Riya is listening...") 
                        : "Start a conversation"}
                </h2>
                <p className="text-slate-500 max-w-md mx-auto">
                    {connectionState === ConnectionState.CONNECTED 
                     ? "Talk naturally about Razorpay's products, pricing, or your business needs."
                     : "Connect to speak with our AI Sales Representative to qualify your leads."}
                </p>
            </div>

            <AudioVisualizer 
                isActive={connectionState === ConnectionState.CONNECTED}
                volume={volume}
                isSpeaking={isModelSpeaking}
            />

            <div className="flex gap-4 items-center">
                {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
                    <button 
                        onClick={connectToLiveAPI}
                        disabled={connectionState === ConnectionState.CONNECTING}
                        className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-semibold shadow-lg shadow-blue-200 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        {connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 'Call Riya'}
                    </button>
                ) : (
                    <button 
                        onClick={handleDisconnect}
                        className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold shadow-lg shadow-red-200 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3"
                    >
                         <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        End Call
                    </button>
                )}
            </div>

            {errorMsg && (
                <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm max-w-md text-center">
                    {errorMsg}
                </div>
            )}
        </div>

        {/* Live Logs / Transcript (Optional but good for debug/demo) */}
        <div className="h-48 bg-white border-t border-slate-200 p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Activity Log</h3>
            <div className="h-full overflow-y-auto custom-scrollbar space-y-2 pb-8">
                {logs.length === 0 && <span className="text-slate-400 text-sm italic">Logs will appear here...</span>}
                {logs.map((log, i) => (
                    <div key={i} className={`text-sm ${log.role === 'system' ? 'text-slate-400 italic' : log.role === 'assistant' ? 'text-blue-600' : 'text-slate-700'}`}>
                        <span className="text-xs text-slate-300 mr-2">{log.timestamp.toLocaleTimeString()}</span>
                        <span className="font-semibold uppercase text-xs mr-1">{log.role}:</span>
                        {log.text}
                    </div>
                ))}
                <div id="log-end" />
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
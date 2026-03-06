/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Video, 
  Type as TypeIcon, 
  Image as ImageIcon, 
  Mic, 
  ChevronRight, 
  ChevronLeft,
  Loader2,
  Sparkles,
  Download,
  Plus
} from 'lucide-react';
import { analyzeScript, generateImage, generateAudio, Scene } from './services/gemini';

const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

export default function App() {
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [generationStep, setGenerationStep] = useState('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const startRecording = async () => {
    if (scenes.length === 0) return;
    
    try {
      setError(null);
      setIsRecording(true);
      setRecordingProgress(0);
      setCurrentSceneIndex(0);
      recordedChunksRef.current = [];

      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      canvasRef.current = canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");

      // Create a combined stream of canvas and audio
      const canvasStream = canvas.captureStream(30);
      
      // Setup Audio Context
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      if (!audioSourceRef.current && audioRef.current) {
        try {
          audioSourceRef.current = audioCtx.createMediaElementSource(audioRef.current);
        } catch (e) {
          console.warn("Audio source already created or failed", e);
        }
      }
      
      const destination = audioCtx.createMediaStreamDestination();
      
      if (audioSourceRef.current) {
        audioSourceRef.current.disconnect();
        audioSourceRef.current.connect(destination);
        audioSourceRef.current.connect(audioCtx.destination);
      }

      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
      destination.stream.getAudioTracks().forEach(track => combinedStream.addTrack(track));

      const mimeType = getSupportedMimeType();
      if (!mimeType) throw new Error("Your browser does not support video recording");

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 5000000
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        try {
          const finalMimeType = mimeType || 'video/webm';
          const blob = new Blob(recordedChunksRef.current, { type: finalMimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const extension = finalMimeType.includes('mp4') ? 'mp4' : 'webm';
          a.download = `script-video-${Date.now()}.${extension}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error("Download failed", e);
          setError("Failed to save the video file.");
        } finally {
          setIsRecording(false);
          setIsPlaying(false);
          setRecordingProgress(0);
        }
      };

      mediaRecorderRef.current = recorder;
      
      // Pre-load images
      const loadedImages = new Map<string, HTMLImageElement>();
      await Promise.all(scenes.map(scene => {
        if (!scene.imageUrl) return Promise.resolve();
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            loadedImages.set(scene.imageUrl!, img);
            resolve(null);
          };
          img.onerror = () => resolve(null);
          img.src = scene.imageUrl!;
        });
      }));
      
      const render = () => {
        if (recorder.state !== 'recording') return;
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const currentScene = scenes[currentSceneIndex];
        const imageAreaHeight = canvas.height * 0.82;
        const subtitleAreaHeight = canvas.height - imageAreaHeight;

        if (currentScene?.imageUrl) {
          const img = loadedImages.get(currentScene.imageUrl);
          if (img) {
            ctx.drawImage(img, 0, 0, canvas.width, imageAreaHeight);
          }
        }

        if (currentScene?.text) {
          const fontSize = 22;
          ctx.font = `400 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const words = currentScene.text.split(' ');
          let line = '';
          const maxWidth = canvas.width * 0.9;
          const lineHeight = fontSize * 1.4;
          const lines = [];

          for(let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
              lines.push(line);
              line = words[n] + ' ';
            } else {
              line = testLine;
            }
          }
          lines.push(line);

          const totalTextHeight = lines.length * lineHeight;
          let startY = imageAreaHeight + (subtitleAreaHeight - totalTextHeight) / 2 + (lineHeight / 2);

          lines.forEach((l) => {
            ctx.fillStyle = '#fff';
            ctx.fillText(l.trim(), canvas.width / 2, startY);
            startY += lineHeight;
          });
        }

        requestAnimationFrame(render);
      };

      recorder.start();
      requestAnimationFrame(render);
      setIsPlaying(true);
    } catch (err: any) {
      console.error("Recording error:", err);
      setError(err.message || "Failed to start recording");
      setIsRecording(false);
    }
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    
    setIsGenerating(true);
    setGenerationStep('Analyzing script and creating storyboard...');
    
    try {
      const analyzedScenes = await analyzeScript(script);
      setScenes(analyzedScenes);
      
      const updatedScenes = [...analyzedScenes];
      
      for (let i = 0; i < updatedScenes.length; i++) {
        setGenerationStep(`Generating visuals and audio for scene ${i + 1} of ${updatedScenes.length}...`);
        
        const [imageUrl, audioData] = await Promise.all([
          generateImage(updatedScenes[i].imagePrompt),
          generateAudio(updatedScenes[i].text, selectedVoice)
        ]);
        
        updatedScenes[i] = {
          ...updatedScenes[i],
          imageUrl,
          audioData
        };
        
        // Update state incrementally so user sees progress
        setScenes([...updatedScenes]);
      }
      
      setGenerationStep('Video ready!');
      setTimeout(() => setIsGenerating(false), 1000);
    } catch (error) {
      console.error("Generation failed", error);
      setIsGenerating(false);
      alert("Something went wrong during generation. Please try again.");
    }
  };

  const playScene = (index: number) => {
    if (index >= scenes.length) {
      setIsPlaying(false);
      setCurrentSceneIndex(0);
      if (isRecording && mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    setCurrentSceneIndex(index);
    if (isRecording) {
      setRecordingProgress(Math.round(((index + 1) / scenes.length) * 100));
    }
    const scene = scenes[index];
    
    if (scene.audioData) {
      if (audioRef.current) {
        audioRef.current.src = `data:audio/wav;base64,${scene.audioData}`;
        audioRef.current.play();
        
        audioRef.current.onended = () => {
          if (isPlaying) {
            playScene(index + 1);
          }
        };
      }
    } else {
      // Fallback if no audio
      setTimeout(() => {
        if (isPlaying) playScene(index + 1);
      }, 3000);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      playScene(currentSceneIndex);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/10 p-4 md:p-6 flex flex-col sm:flex-row justify-between items-center bg-black/50 backdrop-blur-xl sticky top-0 z-50 gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <Video className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">Script2Video</h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Faceless Creator Studio</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 w-full sm:w-auto">
          <select 
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 min-w-[120px]"
          >
            {VOICES.map(v => <option key={v} value={v} className="bg-[#1a1a1a]">{v} (Voice)</option>)}
          </select>
          <button 
            onClick={startRecording}
            disabled={isGenerating || scenes.length === 0 || isRecording}
            className={`font-bold px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm ${
              error ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {isRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isRecording ? `Recording ${recordingProgress}%` : error ? 'Retry Download' : 'Download'}
          </button>
          <button 
            onClick={handleGenerate}
            disabled={isGenerating || !script}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm shadow-lg shadow-emerald-500/20"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isGenerating ? 'Creating...' : 'Create Video'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Script Input */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <TypeIcon className="w-5 h-5" />
              <h2 className="font-semibold">Your Script</h2>
            </div>
            <textarea 
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste your YouTube script here... (e.g., 'Welcome back to the channel! Today we are exploring the mysteries of the deep sea...')"
              className="w-full h-96 bg-transparent border-none focus:ring-0 text-white/80 placeholder:text-white/20 resize-none text-lg leading-relaxed"
            />
            <div className="pt-4 border-t border-white/10 flex justify-between items-center text-xs text-white/40">
              <span>{script.length} characters</span>
              <span>AI will generate visuals for each scene</span>
            </div>
          </div>
        </div>

        {/* Right Column: Preview & Storyboard */}
        <div className="lg:col-span-8 space-y-8">
          {/* Video Player Preview */}
          <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative group flex flex-col">
            <div className="flex-1 relative overflow-hidden">
              <AnimatePresence mode="wait">
                {scenes.length > 0 && scenes[currentSceneIndex]?.imageUrl ? (
                  <motion.img 
                    key={currentSceneIndex}
                    src={scenes[currentSceneIndex].imageUrl}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white/20 gap-4">
                    <Video className="w-16 h-16 opacity-10" />
                    <p className="text-sm font-medium">Generate a video to see the preview</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Subtitles Area Below Image */}
            <div className="h-[18%] bg-black flex items-center justify-center px-8 text-center border-t border-white/5">
              <AnimatePresence mode="wait">
                {scenes.length > 0 && (
                  <motion.p 
                    key={`sub-${currentSceneIndex}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm md:text-base text-white/90 font-normal leading-relaxed max-w-[90%]"
                  >
                    {scenes[currentSceneIndex].text}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-6">
              <button 
                onClick={togglePlay}
                disabled={scenes.length === 0}
                className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform disabled:opacity-50"
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
              </button>
              
              <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-emerald-500"
                  animate={{ width: `${((currentSceneIndex + 1) / scenes.length) * 100}%` }}
                />
              </div>

              <div className="flex items-center gap-4 text-sm font-mono text-white/60">
                <span>{currentSceneIndex + 1} / {scenes.length}</span>
                <button onClick={() => setCurrentSceneIndex(0)} className="hover:text-white transition-colors">
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Loading Overlay */}
            {isGenerating && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6 z-20">
                <div className="relative">
                  <Loader2 className="w-16 h-16 text-emerald-500 animate-spin" />
                  <Sparkles className="w-6 h-6 text-emerald-400 absolute -top-2 -right-2 animate-pulse" />
                </div>
                <div className="text-center space-y-2 px-6">
                  <p className="text-xl font-bold tracking-tight">{generationStep}</p>
                  <p className="text-sm text-white/40">Our AI is crafting your masterpiece...</p>
                </div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-30 px-6 text-center">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <RotateCcw className="text-red-500 w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-bold text-red-400">Download Error</p>
                  <p className="text-sm text-white/60">{error}</p>
                </div>
                <button 
                  onClick={() => setError(null)}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm transition-all"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Storyboard Grid */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400">
                <ImageIcon className="w-5 h-5" />
                <h2 className="font-semibold">Storyboard</h2>
              </div>
              <p className="text-xs text-white/40 uppercase tracking-widest">{scenes.length} Scenes Generated</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {scenes.map((scene, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSceneIndex(idx)}
                  className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                    currentSceneIndex === idx ? 'border-emerald-500 scale-105 z-10 shadow-xl shadow-emerald-500/20' : 'border-white/5 hover:border-white/20'
                  }`}
                >
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full bg-white/5 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin opacity-20" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/60 backdrop-blur-sm">
                    <p className="text-[10px] truncate text-white/80">{scene.text}</p>
                  </div>
                  <div className="absolute top-2 left-2 w-5 h-5 bg-black/60 rounded-md flex items-center justify-center text-[10px] font-bold">
                    {idx + 1}
                  </div>
                </button>
              ))}
              
              {scenes.length === 0 && !isGenerating && (
                <div className="col-span-full py-12 border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-white/20 gap-3">
                  <Plus className="w-8 h-8 opacity-10" />
                  <p className="text-sm">Your storyboard will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <audio ref={audioRef} hidden />
      
      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto p-8 border-t border-white/10 mt-12 flex flex-col md:flex-row justify-between items-center gap-6 text-white/40 text-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4" />
            <span>AI Voiceovers</span>
          </div>
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            <span>AI Visuals</span>
          </div>
        </div>
        <p>© 2024 Script2Video Studio. Built for creators.</p>
      </footer>
    </div>
  );
}

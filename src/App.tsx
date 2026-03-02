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

  const [isRecording, setIsRecording] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    if (scenes.length === 0) return;
    
    setIsRecording(true);
    setCurrentSceneIndex(0);
    recordedChunksRef.current = [];

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a combined stream of canvas and audio
    const canvasStream = canvas.captureStream(30);
    
    // We need to capture audio from the audio element
    // Note: AudioContext might be needed if the audio element stream isn't enough
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audioRef.current!);
    const destination = audioCtx.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioCtx.destination); // Also play to speakers

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);

    const supportedTypes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ];
    
    let selectedType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    const extension = selectedType.includes('mp4') ? 'mp4' : 'webm';

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: selectedType
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: selectedType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-youtube-video.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
      setIsPlaying(false);
    };

    mediaRecorderRef.current = recorder;
    
    // Start drawing loop
    let lastTime = 0;
    const render = (time: number) => {
      if (!isRecording && recorder.state === 'inactive') return;
      
      // Draw background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw current image
      const currentScene = scenes[currentSceneIndex];
      if (currentScene?.imageUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = currentScene.imageUrl;
        // We assume image is loaded since it's in the preview, but for recording we might want to wait
        // In a real app we'd pre-load all images
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      // Draw subtitles
      if (currentScene?.text) {
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 48px Inter, sans-serif';
        ctx.textAlign = 'center';
        
        // Simple text wrapping
        const words = currentScene.text.split(' ');
        let line = '';
        let y = canvas.height - 100;
        const maxWidth = canvas.width - 200;
        const lineHeight = 60;

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

        // Draw lines from bottom up
        for (let i = lines.length - 1; i >= 0; i--) {
          ctx.fillText(lines[i], canvas.width / 2, y);
          y -= lineHeight;
        }
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
    recorder.start();
    setIsPlaying(true);
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
      <header className="border-b border-white/10 p-6 flex justify-between items-center bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Video className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Script2Video</h1>
            <p className="text-xs text-white/40 uppercase tracking-widest">Faceless Creator Studio</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <select 
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {VOICES.map(v => <option key={v} value={v} className="bg-[#1a1a1a]">{v} (Voice)</option>)}
          </select>
          <button 
            onClick={startRecording}
            disabled={isGenerating || scenes.length === 0 || isRecording}
            className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-lg transition-all flex items-center gap-2"
          >
            {isRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isRecording ? 'Exporting...' : 'Download Video'}
          </button>
          <button 
            onClick={handleGenerate}
            disabled={isGenerating || !script}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-6 py-2 rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isGenerating ? 'Generating...' : 'Create Video'}
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
          <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative group">
            <AnimatePresence mode="wait">
              {scenes.length > 0 && scenes[currentSceneIndex]?.imageUrl ? (
                <motion.img 
                  key={currentSceneIndex}
                  src={scenes[currentSceneIndex].imageUrl}
                  initial={{ opacity: 0, scale: 1.1 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1 }}
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

            {/* Subtitles Overlay */}
            {scenes.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0 px-12 text-center pointer-events-none">
                <motion.p 
                  key={`sub-${currentSceneIndex}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-2xl font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                >
                  {scenes[currentSceneIndex].text}
                </motion.p>
              </div>
            )}

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
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold tracking-tight">{generationStep}</p>
                  <p className="text-sm text-white/40">Our AI is crafting your masterpiece...</p>
                </div>
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

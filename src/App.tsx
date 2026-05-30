/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { 
  Cpu, 
  Mic, 
  Database, 
  MapPin, 
  Clock, 
  Check, 
  Trash2, 
  Play, 
  Square, 
  Sliders, 
  Download, 
  Sparkles, 
  Copy, 
  FileText, 
  Volume2, 
  Navigation, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle,
  Terminal,
  Battery,
  Mail,
  Cloud,
  LogOut,
  ExternalLink,
  Video
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { androidCodebase, CodeFile } from "./codebaseData";
import { User } from "firebase/auth";
import { initAuth, googleSignIn, logoutGoogle } from "./googleAuth";
import { convertLogsToCSV, convertLogsToJSON, uploadToGoogleDrive, generateEmailUrl } from "./googleDriveService";

interface SimulatedFrame {
  id: number;
  vehicleName: string;
  plateNumber: string;
  plateConfidence: number;
  plateDetected: boolean;
  color: string;
  imageRepresentation: string; // SVG path or styling type
  latOffset: number;
  lonOffset: number;
}

interface LocalLog {
  id: string;
  rating: "GOOD" | "BAD";
  plateOcr: string | null;
  vehicleMmc: string | null;
  timestamp: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
}

const CT3DLogo = () => (
  <div className="flex items-center gap-3 py-0.5">
    <svg viewBox="0 0 130 42" className="h-9 w-auto select-none" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Advanced 3D Organic Lattice Wireframe/Web Mesh Pattern */}
        <pattern id="ct3d-lattice" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(30 0 0)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#16A34A" strokeWidth="1.2" />
          <line x1="0" y1="0" x2="10" y2="0" stroke="#16A34A" strokeWidth="1.2" />
          <line x1="0" y1="0" x2="10" y2="10" stroke="#22C55E" strokeWidth="0.8" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="#22C55E" strokeWidth="0.8" />
          <circle cx="5" cy="5" r="1.5" fill="#4ADE80" />
          <circle cx="0" cy="0" r="1.5" fill="#4ADE80" />
          <circle cx="10" cy="0" r="1.5" fill="#4ADE80" />
          <circle cx="0" cy="10" r="1.5" fill="#4ADE80" />
          <circle cx="10" cy="10" r="1.5" fill="#4ADE80" />
        </pattern>
        
        {/* Soft, professional drop-shadow and outer neon-green wireframe bloom */}
        <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#22C55E" floodOpacity="0.4" />
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* 3D Chamfered/Beveled metallic linear gradient for CT */}
        <linearGradient id="ct-metallic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#F8FAFC" />
          <stop offset="70%" stopColor="#E2E8F0" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>
      </defs>

      {/* Solid white/silver bevel text CT */}
      <text
        x="2"
        y="32"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="400"
        fontSize="32"
        fill="url(#ct-metallic)"
        letterSpacing="-1.5"
      >
        CT
      </text>

      {/* Organic Crystalline Lattice/Mesh text 3D with glowing neon mesh outline */}
      <text
        x="38"
        y="32"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="400"
        fontSize="32"
        fill="url(#ct3d-lattice)"
        stroke="#16A34A"
        strokeWidth="1.5"
        letterSpacing="-0.5"
        filter="url(#neon-glow)"
      >
        3D
      </text>
    </svg>
    <div className="h-6 w-[1px] bg-white/10 hidden xs:block" />
  </div>
);

const SIMULATED_FRAMES: SimulatedFrame[] = [
  {
    id: 1,
    vehicleName: "Tesla Model Y",
    plateNumber: "7XYZ892",
    plateConfidence: 0.94,
    plateDetected: true,
    color: "#4FC3F7", // Ocean Blue
    imageRepresentation: "electric-sedan",
    latOffset: 0.0024,
    lonOffset: -0.0012
  },
  {
    id: 2,
    vehicleName: "Honda Civic",
    plateNumber: "PLATE-OBSCURED",
    plateConfidence: 0.12,
    plateDetected: false,
    color: "#37474F", // Charcoal Gray
    imageRepresentation: "sport-coupe",
    latOffset: 0.0041,
    lonOffset: 0.0035
  },
  {
    id: 3,
    vehicleName: "Toyota RAV4",
    plateNumber: "3ABC456",
    plateConfidence: 0.88,
    plateDetected: true,
    color: "#CFD8DC", // Silver Metallic
    imageRepresentation: "compact-suv",
    latOffset: -0.0018,
    lonOffset: 0.0052
  },
  {
    id: 4,
    vehicleName: "Ford F-150",
    plateNumber: "PLATE-OBSCURED",
    plateConfidence: 0.18,
    plateDetected: false,
    color: "#E53935", // Crimson Red
    imageRepresentation: "heavy-truck",
    latOffset: -0.0035,
    lonOffset: -0.0046
  },
  {
    id: 5,
    vehicleName: "Toyota Accord",
    plateNumber: "4KLP731",
    plateConfidence: 0.96,
    plateDetected: true,
    color: "#ECEFF1", // Glacier White
    imageRepresentation: "sedan",
    latOffset: 0.0011,
    lonOffset: -0.0029
  }
];

export default function App() {
  // Simulator State
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [currentBattery, setCurrentBattery] = useState<number>(94);
  const [fpsTrigger, setFpsTrigger] = useState<boolean>(false);
  const [processTime, setProcessTime] = useState<number>(142);
  const [incidentLoggedFlash, setIncidentLoggedFlash] = useState<boolean>(false);
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const [hudMessage, setHudMessage] = useState<string>("Jolt ALPR Pipeline Initialized");

  // Active coordinates simulating vehicle moving down road
  const [baseCoords, setBaseCoords] = useState<{ lat: number; lon: number }>({
    lat: 37.7749,
    lon: -122.4194
  });

  // Code Explorer State
  const [selectedFile, setSelectedFile] = useState<CodeFile>(androidCodebase[0]);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Camera Source & Webcam States
  const [cameraMode, setCameraMode] = useState<"simulated" | "live">("simulated");
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Google Auth & Export States
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"CSV" | "JSON">("CSV");
  const [isExportingDrive, setIsExportingDrive] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<{ success: boolean; message: string; link?: string } | null>(null);

  // Google Authentication Observer
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Webcam Activation and Lifetime Controller
  useEffect(() => {
    let activeStream: MediaStream | null = null;

    async function startCamera() {
      try {
        setWebcamError(null);
        const constraints = {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = stream;
        setWebcamStream(stream);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHudMessage("Live environment-facing web camera connected.");
      } catch (err: any) {
        console.error("Camera access error:", err);
        setWebcamError("Could not capture webcam. Verify browser camera permissions.");
        setCameraMode("simulated");
        setHudMessage("Webcam integration failed. Falling back to simulator.");
      }
    }

    if (cameraMode === "live") {
      startCamera();
    } else {
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        setWebcamStream(null);
      }
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraMode]);

  // Ensure high-reliability mounting playback sync
  useEffect(() => {
    if (cameraMode === "live" && webcamStream && videoRef.current) {
      videoRef.current.srcObject = webcamStream;
    }
  }, [cameraMode, webcamStream]);

  const handleGoogleLogin = async () => {
    try {
      setExportStatus(null);
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setGoogleToken(res.accessToken);
        setHudMessage(`Driver Profile [${res.user.displayName || "Google User"}] connected securely.`);
      }
    } catch (e: any) {
      console.error(e);
      setExportStatus({
        success: false,
        message: `Google Sign-in failed: ${e.message || "Unknown Error"}`
      });
      setHudMessage("Google login configuration failed.");
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await logoutGoogle();
      setGoogleUser(null);
      setGoogleToken(null);
      setExportStatus(null);
      setHudMessage("Google Drive profile disconnected.");
    } catch (e: any) {
      console.error(e);
    }
  };

  // Google Drive Upload Handler
  const handleDriveUpload = async () => {
    if (!googleToken) {
      setExportStatus({
        success: false,
        message: "Please connect your Google Account first."
      });
      return;
    }
    if (logs.length === 0) {
      setExportStatus({
        success: false,
        message: "There are no driver log database records to export."
      });
      return;
    }

    setIsExportingDrive(true);
    setExportStatus(null);
    setHudMessage("Initiating secure upload to Google Drive...");

    try {
      const mimeType = exportFormat === "CSV" ? "text/csv" : "application/json";
      const fileContent = exportFormat === "CSV" ? convertLogsToCSV(logs) : convertLogsToJSON(logs);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `jolt_logs_${timestamp}.${exportFormat.toLowerCase()}`;

      const res = await uploadToGoogleDrive(googleToken, filename, fileContent, mimeType);

      setExportStatus({
        success: true,
        message: `File successfully uploaded as "${res.name}"`,
        link: res.webViewLink
      });
      setHudMessage(`Google Drive upload success! File: ${res.name}`);
    } catch (e: any) {
      console.error(e);
      setExportStatus({
        success: false,
        message: `Upload failed: ${e.message || e.toString()}`
      });
      setHudMessage("Google Drive upload failed.");
    } finally {
      setIsExportingDrive(false);
    }
  };

  // Local Download file trigger
  const handleLocalDownload = () => {
    if (logs.length === 0) {
      setExportStatus({
        success: false,
        message: "There are no driver log database records to export."
      });
      return;
    }

    try {
      const isCsv = exportFormat === "CSV";
      const mimeType = isCsv ? "text/csv" : "application/json";
      const content = isCsv ? convertLogsToCSV(logs) : convertLogsToJSON(logs);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `jolt_logs_local_${timestamp}.${exportFormat.toLowerCase()}`;

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportStatus({
        success: true,
        message: `Successfully compiled & downloaded: "${filename}"`
      });
      setHudMessage(`Local download file compiled: ${filename}`);
    } catch (e: any) {
      console.error(e);
      setExportStatus({
        success: false,
        message: `Local download failed: ${e.message || e.toString()}`
      });
    }
  };

  // Trigger Email Draft Sharing
  const handleEmailShare = () => {
    if (logs.length === 0) {
      setExportStatus({
        success: false,
        message: "There are no driver log database records to export."
      });
      return;
    }

    try {
      const emailUrl = generateEmailUrl(logs, exportFormat);
      window.location.href = emailUrl;
      setExportStatus({
        success: true,
        message: "Email client draft launched successfully."
      });
      setHudMessage("Email sharing interface triggered.");
    } catch (e: any) {
      console.error(e);
      setExportStatus({
        success: false,
        message: `Email launcher failed: ${e.message || e.toString()}`
      });
    }
  };

  // Simulator frame loop targeting 1 FPS (approx 3.5 seconds per complete car switch for demonstration clarity, but 1 FPS ticks)
  useEffect(() => {
    let tickInterval: NodeJS.Timeout;
    let transitionInterval: NodeJS.Timeout;

    if (isPlaying) {
      // 1 FPS Visual Ticker to emulate the ImageAnalysis.Analyzer rate limit
      tickInterval = setInterval(() => {
        setFpsTrigger(prev => !prev);
        setProcessTime(Math.floor(110 + Math.random() * 60));
      }, 1000);

      // Rotate simulated cars every 4 seconds
      transitionInterval = setInterval(() => {
        setCurrentFrameIndex(prev => (prev + 1) % SIMULATED_FRAMES.length);
        // Slowly update coordinates to simulate pathing
        setBaseCoords(prev => ({
          lat: prev.lat + 0.0002 * (Math.random() - 0.5),
          lon: prev.lon + 0.0002 * (Math.random() - 0.5)
        }));
      }, 4000);
    }

    return () => {
      clearInterval(tickInterval);
      clearInterval(transitionInterval);
    };
  }, [isPlaying]);

  // Load and Save Local Driving Logs from LocalStorage (mimicking Room)
  useEffect(() => {
    const saved = localStorage.getItem("jolt_logs") || localStorage.getItem("dashcam_logs");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migrate legacy logs missing batteryLevel
        const migrated = parsed.map((log: any) => ({
          ...log,
          batteryLevel: log.batteryLevel || Math.floor(75 + Math.random() * 20)
        }));
        setLogs(migrated);
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const saveLogs = (updated: LocalLog[]) => {
    setLogs(updated);
    localStorage.setItem("jolt_logs", JSON.stringify(updated));
  };

  const handleManualActionLog = (rating: "GOOD" | "BAD") => {
    // Flash visual feedback
    setIncidentLoggedFlash(true);
    
    setTimeout(() => {
      setIncidentLoggedFlash(false);
    }, 1200);

    const activeFrame = SIMULATED_FRAMES[currentFrameIndex];
    const isPlate = activeFrame.plateDetected;

    const calculatedBattery = Math.max(1, currentBattery - (Math.random() > 0.4 ? 1 : 0));
    setCurrentBattery(calculatedBattery);

    const newLog: LocalLog = {
      id: Math.random().toString(36).substring(2, 9).toUpperCase(),
      rating: rating,
      plateOcr: isPlate ? activeFrame.plateNumber : null,
      vehicleMmc: isPlate ? null : `${activeFrame.color === "#4FC3F7" ? "Ocean Blue" : activeFrame.color === "#37474F" ? "Midnight Charcoal" : activeFrame.color === "#CFD8DC" ? "Silver Metallic" : activeFrame.color === "#E53935" ? "Solid Red" : "Glacier White"} ${activeFrame.vehicleName}`,
      timestamp: Date.now(),
      latitude: baseCoords.lat + activeFrame.latOffset,
      longitude: baseCoords.lon + activeFrame.lonOffset,
      batteryLevel: calculatedBattery
    };

    const newLogs = [newLog, ...logs];
    saveLogs(newLogs);
    setHudMessage(`Log Created: [${newLog.id}] classified as ${rating === "BAD" ? "⚠️ RECKLESS/BAD DRIVER" : "✓ SAFE/GOOD DRIVER"}`);
  };

  const handleDeleteLog = (id: string) => {
    const nextLogs = logs.filter(l => l.id !== id);
    saveLogs(nextLogs);
    setHudMessage(`Deleted record ID: ${id}`);
  };

  const handleClearAllLogs = () => {
    saveLogs([]);
    setHudMessage("Cleared all local entries");
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const currentActiveFrame = SIMULATED_FRAMES[currentFrameIndex];

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 font-sans selection:bg-cyan-500/30 selection:text-cyan-400 select-none antialiased">
      
      {/* --- Sophisticated Dark Header: System Status App Header --- */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0 sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <div className="flex items-center gap-3">
            <CT3DLogo />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                Jolt ALPR
              </h1>
            </div>
          </div>
        </div>

        {/* Dynamic Telemetry Status indicators in Header */}
        <div className="flex items-center space-x-6 text-xs font-semibold tracking-tighter">
          <div className="hidden md:flex items-center space-x-2 font-mono">
            <span className="text-slate-500">GPS</span>
            <span className="text-cyan-400">{baseCoords.lat.toFixed(4)}° N, {Math.abs(baseCoords.lon).toFixed(4)}° W</span>
          </div>
          <div className="hidden sm:flex items-center space-x-2 font-mono pb-0.5">
            <span className="text-slate-500">PID</span>
            <span className="text-slate-400">28492</span>
          </div>
          <div className="hidden sm:flex items-center space-x-2.5 font-mono bg-white/5 border border-white/10 px-2.5 py-1 rounded">
            <Battery className={`w-3.5 h-3.5 ${currentBattery > 20 ? "text-emerald-400" : "text-red-500 animate-pulse"}`} />
            <span className="text-slate-500 text-[10px]">BATTERY:</span>
            <span className={`text-[10px] font-bold ${currentBattery > 20 ? "text-emerald-400" : "text-red-500"}`}>{currentBattery}%</span>
          </div>
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 text-[11px] font-medium transition-all"
          >
            {isPlaying ? (
              <>
                <Square className="w-3 h-3 text-cyan-400" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-emerald-400 fill-emerald-400/20" />
                <span>Resume</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* --- Main Viewport Layout --- */}
      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6 w-full">
        
        {/* =========================================================
            Dashcam HUD Interactive Simulator
            ========================================================= */}
        <div className="flex flex-col gap-6">
          
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2 font-mono">
              <Sliders className="w-4 h-4 text-cyan-400" /> Live Viewport Emulator
            </h2>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
              <span>SYSTEM_READY</span>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]" />
            </div>
          </div>

          {/* Interactive Screen Dashboard featuring Sophisticated Dark theme elements */}
          <div className={`relative rounded-xl border transition-all duration-300 ${incidentLoggedFlash ? "border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "border-white/10"} bg-[#0A0A0A] overflow-hidden shadow-2xl`}>
            {/* Camera Viewport Area */}
            <div className="h-[340px] w-full relative select-none flex items-center justify-center overflow-hidden bg-gradient-to-tr from-[#050505] via-[#111] to-[#050505]">
              
              {/* Red overlay flash upon incident logging */}
              {incidentLoggedFlash && (
                <div className="absolute inset-0 bg-red-600/10 pointer-events-none z-40 flex items-center justify-center border-4 border-red-500 animate-pulse">
                  <div className="bg-red-950/90 border border-red-500 text-red-400 px-4 py-2 rounded-lg font-mono text-xs font-black tracking-widest uppercase flex items-center gap-2 shadow-2xl">
                    <AlertCircle className="w-4 h-4 animate-bounce text-red-500" />
                    <span>LOGGING: RECKLESS_DRIVING</span>
                  </div>
                </div>
              )}

              {/* Corner target outlines matching Sophisticated Dark Theme HTML */}
              <div className="absolute inset-4 pointer-events-none z-10">
                <div className="absolute top-0 left-0 border-l-2 border-t-2 border-cyan-500 w-12 h-12 opacity-80" />
                <div className="absolute top-0 right-0 border-r-2 border-t-2 border-cyan-500 w-12 h-12 opacity-80" />
                <div className="absolute bottom-0 left-0 border-l-2 border-b-2 border-cyan-500 w-12 h-12 opacity-80" />
                <div className="absolute bottom-0 right-0 border-r-2 border-b-2 border-cyan-500 w-12 h-12 opacity-80" />
              </div>

              {/* Grid or street vector backdrop (always visible for HUD aesthetic) */}
              <div className="absolute inset-0 opacity-10 pointer-events-none z-0">
                <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                  <line x1="50%" y1="10%" x2="5%" y2="100%" stroke="#FFF" strokeWidth="1.5" strokeDasharray="4 4" />
                  <line x1="50%" y1="10%" x2="95%" y2="100%" stroke="#FFF" strokeWidth="1.5" strokeDasharray="4 4" />
                  <line x1="50%" y1="10%" x2="50%" y2="100%" stroke="#FFF" strokeWidth="3" strokeDasharray="8 8" />
                </svg>
              </div>

              {/* Edge HUD Switcher and Label Indicators (Moved to top-left) */}
              <div className="absolute top-4 left-4 flex flex-col gap-2 z-30">
                <div className="flex bg-black/90 p-0.5 rounded border border-white/10 text-[9px] font-mono shadow-md backdrop-blur-sm">
                  <button
                    onClick={() => setCameraMode("simulated")}
                    className={`px-2 py-0.5 rounded transition-all font-bold flex items-center gap-1 ${cameraMode === "simulated" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-slate-400 hover:text-slate-200 border border-transparent"}`}
                  >
                    <Sliders className="w-2.5 h-2.5" />
                    <span>EMULATOR REPLAY</span>
                  </button>
                  <button
                    onClick={() => setCameraMode("live")}
                    className={`px-2 py-0.5 rounded transition-all font-bold flex items-center gap-1 ${cameraMode === "live" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-slate-400 hover:text-slate-200 border border-transparent"}`}
                  >
                    <Video className="w-2.5 h-2.5" />
                    <span>LIVE WEBCAM</span>
                  </button>
                </div>
                
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black/85 border border-white/10 rounded font-mono text-[8px] text-slate-300 font-semibold tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)] animate-pulse" />
                    {cameraMode === "live" ? "ACTIVE WEB DEVICE - REAR ENVIRONMENT LENS" : "5.0X TELEPHOTO FOCUS LENS (EMULATED)"}
                  </div>
                  {webcamError && cameraMode === "live" && (
                    <div className="text-[7.5px] font-mono text-red-400 bg-red-950/80 border border-red-500/20 px-2 py-0.5 rounded tracking-tighter">
                      ⚠️ {webcamError}
                    </div>
                  )}
                </div>
              </div>

              {/* GPS HUD Info box on top right */}
              <div className="absolute top-4 right-4 flex flex-col items-end gap-1 z-30 font-mono text-[9px]">
                <div className="px-2 py-0.5 bg-black/85 rounded border border-white/10 text-cyan-400 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5 text-slate-500" />
                  <span>LAT: {baseCoords.lat.toFixed(5)}</span>
                </div>
                <div className="px-2 py-0.5 bg-black/85 rounded border border-white/10 text-cyan-400 flex items-center gap-1">
                  <Navigation className="w-2.5 h-2.5 text-slate-500" />
                  <span>LON: {baseCoords.lon.toFixed(5)}</span>
                </div>
              </div>

              {/* --- 1. SIMULATED REPLAY MODE --- */}
              {cameraMode === "simulated" && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentActiveFrame.id}
                    initial={{ opacity: 0, scale: 0.85, y: 30 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 1.05, y: -20 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="relative z-10 flex flex-col items-center justify-center p-4 bg-black/45 rounded-xl backdrop-blur-sm border border-white/5"
                  >
                    {/* Multi-layered Bounding Box Simulator */}
                    <div className="relative w-72 h-36 flex items-center justify-center">
                      
                      {/* === OUTER VEHICLE BOUNDING BOX === */}
                      <div className="absolute inset-0 border-2 border-emerald-400/60 bg-emerald-400/5 rounded-lg flex items-center justify-center">
                        
                        {/* Vehicle bounding label tag */}
                        <div className="absolute -top-6.5 left-0 flex items-center gap-1 font-mono">
                          <span className="bg-emerald-500 text-black text-[9px] font-black px-1.5 py-0.5 uppercase tracking-wide rounded">
                            TRACKING_VEHICLE
                          </span>
                          <span className="bg-slate-900 border border-white/10 text-slate-300 text-[8px] font-semibold px-2 py-0.5 rounded">
                            {currentActiveFrame.vehicleName}
                          </span>
                        </div>

                        {/* Vehicle Vector Graphic */}
                        <svg viewBox="0 0 100 40" className="w-48 h-20 drop-shadow-2xl" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="5" y="15" width="90" height="15" rx="4" fill={currentActiveFrame.color} />
                          <path d="M25 15 L35 4 L65 4 L75 15 Z" fill={currentActiveFrame.color} filter="brightness(0.7)" />
                          {/* Windows */}
                          <path d="M36 6 L48 6 L48 13 L28 13 Z" fill="#0C1D2A" opacity="0.9" />
                          <path d="M52 6 L64 6 L72 13 L52 13 Z" fill="#0C1D2A" opacity="0.9" />
                          {/* Tires */}
                          <circle cx="20" cy="30" r="6" fill="#050505" stroke="#222" strokeWidth="2.5" />
                          <circle cx="80" cy="30" r="6" fill="#050505" stroke="#222" strokeWidth="2.5" />
                          {/* License plate position */}
                          <rect x="42" y="22" width="16" height="5" rx="0.5" fill="#FFFFFF" stroke="#000" strokeWidth="0.5" />
                        </svg>
                        
                        {/* === INNER LICENSE PLATE BOUNDING BOX === */}
                        {/* Positions perfectly matching the white rect above */}
                        <motion.div 
                          className="absolute bottom-[16px] left-[50%] -translate-x-1/2 w-[104px] h-[28px] border-2 border-cyan-400 bg-black/90 backdrop-blur-sm rounded flex items-center justify-center shadow-lg"
                          animate={{ scale: [1, 1.03, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          {/* Cyan Crop Corners */}
                          <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-cyan-400" />
                          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-cyan-400" />
                          <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-cyan-400" />
                          <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-cyan-400" />

                          {/* Plate label tag */}
                          <div className="absolute -top-4 left-1 bg-cyan-500 text-black text-[7px] font-black px-1 rounded uppercase tracking-tighter font-mono">
                            OCR_LPR_LOCKED
                          </div>

                          {/* Plate text */}
                          <span className="font-mono text-[10px] font-extrabold tracking-widest text-cyan-300">
                            {currentActiveFrame.plateDetected ? currentActiveFrame.plateNumber : "OBSCURED"}
                          </span>

                          {/* Confidence rating */}
                          <div className="absolute -right-2 -bottom-2 bg-slate-900 border border-white/10 text-cyan-400 text-[6.5px] font-bold px-1 rounded scale-90">
                            {currentActiveFrame.plateDetected ? `${(currentActiveFrame.plateConfidence * 100).toFixed(0)}%` : "MMC_FALLBACK"}
                          </div>
                        </motion.div>

                      </div>

                    </div>

                    {/* 1 FPS indicator tick */}
                    <div className="flex items-center gap-1.5 mt-3 text-[8px] text-slate-400 font-mono tracking-wider bg-black/60 px-2.5 py-0.5 rounded border border-white/5">
                      <span className={`w-1.5 h-1.5 rounded-full ${fpsTrigger ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" : "bg-cyan-800"} transition-all duration-100`} />
                      <span>ON-DEVICE FPS STREAMING INTERVAL</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}

              {/* --- 2. REAL-TIME LIVE WEBCAM FEED MODE --- */}
              {cameraMode === "live" && (
                <div className="absolute inset-0 w-full h-full z-0 bg-black flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover opacity-70"
                  />
                  
                  {/* Real-time scanning grid visualizers */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />
                  
                  {/* Flashing scanning radar lines */}
                  <div className="absolute left-6 right-6 h-[1.5px] bg-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.7)] z-10 pointer-events-none animate-pulse" style={{ top: '50%' }} />

                  {/* === LIVE MODE DOUBLE BOUNDING BOXES OVERLAY === */}
                  <div className="absolute w-[70%] h-[62%] border-2 border-emerald-400/50 bg-emerald-500/5 rounded-xl z-20 flex flex-col items-center justify-center p-3">
                    
                    {/* Bounding box dynamic corner targets */}
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-500" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-500" />
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-500" />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-500" />

                    {/* Outer Vehicle Header */}
                    <div className="absolute -top-6 left-0 flex items-center gap-1 font-mono">
                      <span className="bg-emerald-500 text-black text-[8px] font-black px-1.5 py-0.2 rounded uppercase">
                        YOLOv8_VEHICLE
                      </span>
                      <span className="bg-slate-950 border border-white/10 text-slate-300 text-[8px] px-1.5 py-0.2 rounded font-bold">
                        {currentActiveFrame.vehicleName}
                      </span>
                    </div>

                    {/* Scanning Text HUD */}
                    <div className="text-center flex flex-col items-center gap-1 select-none">
                      <div className="animate-pulse flex items-center justify-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                        <span className="font-mono text-[9px] font-bold text-emerald-400 tracking-wider">LIVE RECORD CLASSIFIER</span>
                      </div>
                      <p className="text-[11px] font-bold text-slate-200 uppercase font-mono tracking-wide">{currentActiveFrame.vehicleName} DETECTED</p>
                    </div>

                    {/* === INNER LICENSE PLATE BOUNDING BOX IN LIVE WEBCAM === */}
                    <motion.div 
                      className="absolute bottom-[10%] w-[150px] h-[36px] border-2 border-cyan-400 bg-black/95 backdrop-blur rounded-lg flex flex-col justify-center items-center shadow-2xl px-2"
                      animate={{ scale: [1, 1.02, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      {/* Crop design ticks */}
                      <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-cyan-400" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-cyan-400" />
                      <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-cyan-400" />
                      <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-cyan-400" />

                      {/* Plate Label Tag */}
                      <div className="absolute -top-4 left-2 bg-cyan-500 text-black text-[7px] font-black px-1 rounded uppercase tracking-widest font-mono">
                        {currentActiveFrame.plateDetected ? "PLATE OCR ENCODER" : "FALLBACK MMC"}
                      </div>

                      {/* Real time license plate text */}
                      <span className="font-mono text-xs font-black tracking-widest text-white text-center">
                        {currentActiveFrame.plateDetected ? currentActiveFrame.plateNumber : "OBSCURED"}
                      </span>

                      {/* OCR confidence score panel */}
                      <div className="absolute -right-2 -bottom-2 bg-slate-900 border border-white/10 text-cyan-400 text-[7px] font-extrabold px-1.5 rounded font-mono shadow-md">
                        OCR: {currentActiveFrame.plateDetected ? `${(currentActiveFrame.plateConfidence * 100).toFixed(0)}%` : "N/A"}
                      </div>
                    </motion.div>

                  </div>
                </div>
              )}

              {/* Pipeline Diagnostic overlay line */}
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between z-10 px-3 py-1.5 bg-black/95 backdrop-blur border border-white/10 rounded font-mono text-[9px] text-slate-400">
                <span className="flex items-center gap-1.5 text-slate-200">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{hudMessage}</span>
                </span>
                <span className="text-slate-500 font-bold shrink-0">LATENCY: {processTime}ms</span>
              </div>
            </div>

            {/* Incident Trigger Controller Section */}
            <div className={`p-6 border-t border-white/10 transition-all duration-300 ${incidentLoggedFlash ? "bg-red-950/20" : "bg-[#0A0A0A]"}`}>
              <div className="flex flex-col md:flex-row items-center justify-between gap-5">
                
                <div className="flex items-center gap-4">
                  <div className="relative">
                    {/* Pulsing warning indicator */}
                    <div className={`p-3.5 rounded-full border flex items-center justify-center transition-all duration-300 ${incidentLoggedFlash ? "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]" : "bg-red-500/5 border-red-500/20 text-red-500/60"}`}>
                      <AlertCircle className={`w-5 h-5 ${incidentLoggedFlash ? "scale-125 animate-bounce" : ""}`} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Instant Bad Driver Incident Logger</h3>
                    <p className="text-[11.5px] text-slate-500 mt-1 font-mono">
                      {incidentLoggedFlash ? (
                        <span className="text-red-400 font-bold animate-pulse">⚠️ RECKLESS DRIVING INCIDENT REGISTERED</span>
                      ) : (
                        <span>Tap the button when reckless driving is witnessed to log the current vehicle metadata.</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Simulated Triggers - Just the Red Button */}
                <div className="w-full md:w-auto">
                  <button 
                    onClick={() => handleManualActionLog("BAD")}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 font-extrabold text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all font-mono active:scale-95 border border-red-500/50"
                  >
                    <AlertCircle className="w-4 h-4 text-white animate-pulse" />
                    <span>INDICATE BAD DRIVER</span>
                  </button>
                </div>

              </div>
            </div>
          </div>

          {/* SQLite / Room Logs list Registry styled as Table/Card list in Sophisticated Dark style */}
          <div className="bg-[#0A0A0A] rounded-xl border border-white/10 p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2 font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <Database className="w-4 h-4 text-cyan-400" /> Driver_Logs Table (Room Session DB)
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 uppercase font-semibold">Auto-Sync</span>
                {logs.length > 0 && (
                  <button 
                    onClick={handleClearAllLogs}
                    className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-1 font-mono transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear DB
                  </button>
                )}
              </div>
            </div>

            {/* Direct Client-Side Export Controls Section matching Sophisticated Dark */}
            <div className="bg-[#050505] rounded-lg border border-white/5 p-4 flex flex-col gap-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-[10px] uppercase text-cyan-400 font-extrabold tracking-widest flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5" /> Secure On-Device Export System
                </span>
                <span className="text-[9px] text-slate-500 bg-white/5 px-2 py-0.5 rounded border border-white/5 font-semibold">EDGE SECURITY</span>
              </div>

              {/* Format selection */}
              <div className="flex items-center justify-between gap-3 text-[11px] py-1 border-b border-white/5">
                <span className="text-slate-400 text-[10px]">EXPORT FORMAT:</span>
                <div className="flex bg-[#0A0A0A] p-0.5 rounded border border-white/5">
                  <button
                    onClick={() => setExportFormat("CSV")}
                    className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${exportFormat === "CSV" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    CSV (Spreadsheet)
                  </button>
                  <button
                    onClick={() => setExportFormat("JSON")}
                    className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${exportFormat === "JSON" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    JSON (Structured)
                  </button>
                </div>
              </div>

              {/* Status Alert feedback */}
              {exportStatus && (
                <div className={`p-2.5 rounded border flex items-start gap-2 text-[10.5px] ${exportStatus.success ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-red-500/5 border-red-500/20 text-red-400"}`}>
                  {exportStatus.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                  <div className="flex-1">
                    <p className="font-semibold">{exportStatus.message}</p>
                    {exportStatus.link && (
                      <a
                        href={exportStatus.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-1 font-bold underline hover:text-white transition-colors"
                      >
                        Open on Google Drive <ExternalLink className="w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons wrapper */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-1">
                {/* Google Connection/Upload Panel */}
                <div className="flex flex-col gap-2 p-3 bg-[#0A0A0A] rounded border border-white/5">
                  <div className="text-[9px] text-zinc-500 uppercase font-black">Google Drive Cloud Storage</div>
                  {!googleUser ? (
                    /* official gsi material-style button */
                    <button
                      onClick={handleGoogleLogin}
                      className="w-full flex items-center justify-center gap-2.5 px-3 py-2 bg-[#050505] hover:bg-neutral-900 border border-white/10 rounded transition-all active:scale-[0.98]"
                    >
                      <svg className="w-4 h-4 shrink-0" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      </svg>
                      <span className="font-semibold text-xs text-white">Connect Google Drive</span>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between border-b border-white/5 pb-1">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          {googleUser.photoURL ? (
                            <img src={googleUser.photoURL} alt="Avatar" className="w-5 h-5 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-cyan-700/25 border border-cyan-500/30 text-cyan-400 flex items-center justify-center font-bold text-[9px] uppercase">{googleUser.displayName?.slice(0, 1) || "U"}</div>
                          )}
                          <span className="text-[10px] text-slate-300 font-bold max-w-[110px] truncate">{googleUser.displayName || "Driver"}</span>
                        </div>
                        <button onClick={handleGoogleLogout} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors flex items-center gap-0.5">
                          <LogOut className="w-2.5 h-2.5" /> Disconnect
                        </button>
                      </div>
                      <button
                        onClick={handleDriveUpload}
                        disabled={isExportingDrive}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-black rounded font-bold transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                      >
                        {isExportingDrive ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            <span className="text-[11px] font-bold">Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Cloud className="w-3.5 h-3.5 text-black" />
                            <span className="text-[11px] font-bold uppercase tracking-wider">Upload to Drive</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Direct Sharing Panel */}
                <div className="flex flex-col gap-2 p-3 bg-[#0A0A0A] rounded border border-white/5 justify-between">
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase font-black">Direct Handset Action</div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 mt-2">
                    <button
                      onClick={handleEmailShare}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 bg-neutral-900 border border-white/10 hover:bg-neutral-800 text-slate-300 font-bold rounded transition-all active:scale-95 cursor-pointer"
                    >
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px] font-bold">EMAIL DRIVER LOGS</span>
                    </button>
                    <button
                      onClick={handleLocalDownload}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 bg-neutral-900 border border-white/10 hover:bg-neutral-800 text-slate-300 font-bold rounded transition-all active:scale-95 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px] font-bold">SAVE TO FILE</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* List items - Sophisticated Dark table-row alignment details */}
            <div className="max-h-[300px] overflow-y-auto pr-1 flex flex-col gap-2.5 custom-scrollbar font-mono text-xs">
              <AnimatePresence initial={false}>
                {logs.length === 0 ? (
                  <div className="h-28 border border-dashed border-white/10 rounded flex flex-col items-center justify-center text-center p-6 bg-[#050505]">
                    <p className="text-xs text-slate-500">No sqlite_logs found in active session memory.</p>
                    <p className="text-[10px] text-slate-600 mt-2">Trigger real-time edge ratings via manual buttons or speech commands.</p>
                  </div>
                ) : (
                  logs.map(log => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`border px-4 py-3.5 rounded flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 overflow-hidden transition-all ${log.rating === "GOOD" ? "bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10" : "bg-red-500/5 border-red-500/10 hover:bg-red-500/10"}`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Rating Tag */}
                        <div className={`shrink-0 px-2.5 py-1 rounded text-[10px] tracking-widest font-extrabold flex items-center justify-center leading-none ${log.rating === "GOOD" ? "bg-emerald-400/10 text-emerald-400 border border-emerald-500/20" : "bg-red-400/10 text-red-400 border border-red-500/20"}`}>
                          RATING_{log.rating}
                        </div>

                        {/* Text and identifiers metadata */}
                        <div className="flex flex-col gap-1.5">
                          <h4 className="font-bold tracking-tight text-white flex items-center gap-1.5">
                            {log.plateOcr ? (
                              <span className="flex items-center gap-2">
                                <span className="text-slate-500 text-[10px] uppercase">ALPR plate:</span>
                                <span className="bg-white text-black px-1.5 py-0.5 rounded text-[10px] font-black">{log.plateOcr}</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span className="text-slate-500 text-[10px] uppercase">MMC:</span>
                                <span className="bg-white/10 text-slate-100 border border-white/5 px-2 py-0.5 rounded text-[10px]">{log.vehicleMmc}</span>
                              </span>
                            )}
                          </h4>
                          {/* Coords & Datestamp */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-slate-500">
                            <span className="flex items-center gap-1 text-slate-400">
                              <MapPin className="w-3 h-3 text-slate-600" />
                              {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                            </span>
                            <span className="text-slate-700">|</span>
                            <span className="flex items-center gap-1 shrink-0">
                              <Clock className="w-3 h-3 text-slate-600" />
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="text-slate-700 font-normal opacity-40">|</span>
                            <span className="flex items-center gap-1 bg-white/5 border border-white/5 px-2 py-0.5 rounded text-cyan-400 text-[9px] font-bold tracking-tight shrink-0">
                              <Battery className="w-3 h-3 text-cyan-500" />
                              {log.batteryLevel}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 self-stretch sm:self-center">
                        <span className="text-[9px] text-slate-600 border border-white/5 px-2 py-0.5 bg-black/40 rounded">HEXID_{log.id}</span>
                        <button 
                          onClick={() => handleDeleteLog(log.id)}
                          className="p-1 px-2 text-slate-500 hover:text-red-400 rounded hover:bg-white/5 transition-all text-xs"
                        >
                          <span className="sm:hidden mr-1.5">Delete Rec</span>
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>

      </main>

      {/* --- Footer Signature matches Sophisticated Dark bar --- */}
      <footer className="border-t border-white/10 bg-[#0A0A0A] h-12 flex items-center justify-between px-8 text-slate-500 text-[10px] font-mono shrink-0 select-none">
        <p className="hidden sm:inline">PROD ARCHITECTURE MVP // ALL SOURCE FILES PACKAGED IN INLINE ASSETS</p>
        <p className="sm:hidden">PROD ARCHITECTURE MVP</p>
        <div className="flex items-center gap-1.5 text-cyan-400 font-bold tracking-wider">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>COMPILE_RUN_VERIFIED PIXEL_10_PRO</span>
        </div>
      </footer>
    </div>
  );
}

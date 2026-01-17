"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Sparkles } from "@react-three/drei";
import { motion } from "framer-motion";
import { Cpu, ShieldCheck, UploadCloud, Zap } from "lucide-react";
import { Color, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type PointLight } from "three";

import ModelView from "@/components/ModelView";
import { ToastContainer, useToast } from "@/components/Toast";

type SynthesisMode = "image" | "text";

const statusStages = [
  "GENETIC_MAPPING",
  "TOPOLOGY_SYNTH",
  "MATERIAL_BIND",
  "OPTICAL_SOLVER",
];

const logLines = [
  "[OK] NEURAL_LINK_ESTABLISHED",
  "[OK] DOWNLOAD_WEIGHTS_V3...",
  "[..] MAPPING_TOPOLOGY_0x88F",
  "[..] COMPUTING_GEOMETRY_NODES",
  "[..] RECONSTRUCT_VOLUME",
  "[..] CALIBRATING_LATENT_GRID",
];

const SYNTH_DURATION_MS = 3600;

const normalizePreview = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/\.(glb|gltf)(\?.*)?$/i.test(trimmed)) return null;
  return trimmed;
};

function NeuralCore({ active }: { active: boolean }) {
  const groupRef = useRef<Group | null>(null);
  const coreRef = useRef<Mesh | null>(null);
  const coreMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const cageRef = useRef<Mesh | null>(null);
  const cageMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const ringMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const coolEmissive = useRef(new Color("#2ED1FF"));
  const cageBase = useRef(new Color("#7FE7FF"));
  const hotEmissive = useRef(new Color("#F9E7AE"));
  const tempColor = useRef(new Color());

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.35;
      groupRef.current.rotation.x = Math.sin(t * 0.2) * 0.15;
    }
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 2.1) * 0.04;
      coreRef.current.scale.setScalar(pulse);
    }
    if (coreMaterialRef.current) {
      if (active) {
        const glow = (Math.sin(t * 4) + 1) / 2;
        tempColor.current.copy(coolEmissive.current).lerp(hotEmissive.current, glow);
        coreMaterialRef.current.emissive.copy(tempColor.current);
        coreMaterialRef.current.emissiveIntensity = 2.1 + glow * 1.4;
      } else {
        coreMaterialRef.current.emissive.copy(coolEmissive.current);
        coreMaterialRef.current.emissiveIntensity = 1.4 + Math.sin(t * 3.1) * 0.35;
      }
    }
    if (cageRef.current) {
      cageRef.current.rotation.z = t * 0.15;
    }
    if (cageMaterialRef.current) {
      const glow = active ? (Math.sin(t * 4) + 1) / 2 : 0;
      tempColor.current.copy(cageBase.current).lerp(hotEmissive.current, glow);
      cageMaterialRef.current.color.copy(tempColor.current);
    }
    if (ringMaterialRef.current) {
      const glow = active ? (Math.sin(t * 4) + 1) / 2 : 0;
      tempColor.current.copy(coolEmissive.current).lerp(hotEmissive.current, glow);
      ringMaterialRef.current.emissive.copy(tempColor.current);
      ringMaterialRef.current.emissiveIntensity = 0.8 + glow * 0.8;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.1, 64, 64]} />
        <meshStandardMaterial
          ref={coreMaterialRef}
          color="#0b1220"
          emissive="#2ED1FF"
          emissiveIntensity={1.5}
          roughness={0.18}
          metalness={0.2}
        />
      </mesh>
      <mesh ref={cageRef} scale={1.75}>
        <boxGeometry args={[2.4, 2.4, 2.4]} />
        <meshBasicMaterial
          ref={cageMaterialRef}
          color="#7FE7FF"
          wireframe
          transparent
          opacity={0.35}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.7, 0.05, 16, 128]} />
        <meshStandardMaterial
          ref={ringMaterialRef}
          color="#7FE7FF"
          emissive="#2ED1FF"
          emissiveIntensity={0.9}
          roughness={0.2}
          metalness={0.4}
        />
      </mesh>
      <Sparkles count={140} scale={4.2} size={2} color="#BFF4FF" speed={0.6} opacity={0.65} />
    </group>
  );
}

function ReactorLights({ active }: { active: boolean }) {
  const keyLightRef = useRef<PointLight | null>(null);
  const fillLightRef = useRef<PointLight | null>(null);
  const coolColor = useRef(new Color("#7FE7FF"));
  const hotColor = useRef(new Color("#F9E7AE"));
  const mixColor = useRef(new Color());

  useFrame(({ clock }) => {
    if (!keyLightRef.current) return;
    if (active) {
      const pulse = (Math.sin(clock.getElapsedTime() * 3.4) + 1) / 2;
      mixColor.current.copy(coolColor.current).lerp(hotColor.current, pulse);
      keyLightRef.current.color.copy(mixColor.current);
      keyLightRef.current.intensity = 1.35 + pulse * 1.1;
    } else {
      keyLightRef.current.color.copy(coolColor.current);
      keyLightRef.current.intensity = 1.35;
    }
    if (fillLightRef.current) {
      fillLightRef.current.intensity = active ? 0.7 : 0.5;
    }
  });

  return (
    <>
      <pointLight ref={keyLightRef} position={[6, 6, 6]} intensity={1.35} color="#7FE7FF" />
      <pointLight ref={fillLightRef} position={[-6, -2, -4]} intensity={0.5} color="#0ea5e9" />
    </>
  );
}

export default function AiLabPage() {
  const searchParams = useSearchParams();
  const previewParam = searchParams.get("preview");
  const previewModel = useMemo(() => normalizePreview(previewParam), [previewParam]);
  const previewLabel = useMemo(() => {
    if (!previewModel) return null;
    const stripped = previewModel.split("?")[0] ?? previewModel;
    const parts = stripped.split("/");
    return parts[parts.length - 1] ?? previewModel;
  }, [previewModel]);

  const [mode, setMode] = useState<SynthesisMode>("image");
  const [prompt, setPrompt] = useState("");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLine, setStatusLine] = useState(statusStages[0]);
  const [isSynthRunning, setIsSynthRunning] = useState(false);
  const [showAccessDenied, setShowAccessDenied] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const { toasts, showError, removeToast } = useToast();

  useEffect(() => {
    if (!uploadPreview) return;
    return () => {
      URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  useEffect(() => {
    if (!isSynthRunning) return;
    const start = Date.now();
    setProgress(0);
    setStatusLine(statusStages[0]);
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const ratio = Math.min(1, elapsed / SYNTH_DURATION_MS);
      const nextProgress = ratio * 100;
      setProgress(nextProgress);
      const nextStage = Math.min(
        statusStages.length - 1,
        Math.floor(ratio * statusStages.length)
      );
      setStatusLine(statusStages[nextStage]);
    }, 120);
    const stopTimer = setTimeout(() => {
      setProgress(100);
      setIsSynthRunning(false);
      setShowAccessDenied(true);
    }, SYNTH_DURATION_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stopTimer);
    };
  }, [isSynthRunning]);

  const handleFile = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError("ACCESS RESTRICTED: INVALID INPUT FORMAT");
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    setUploadPreview(nextPreview);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleBrowse = () => {
    uploadInputRef.current?.click();
  };

  const handleSynthesis = () => {
    if (isSynthRunning) return;
    setShowAccessDenied(false);
    setShowThankYou(false);
    setIsSynthRunning(true);
  };

  const handleApplyForTest = () => {
    setShowThankYou(true);
    setTimeout(() => {
      setShowAccessDenied(false);
      setShowThankYou(false);
    }, 2400);
  };

  const currentStatus = isSynthRunning ? statusLine : "STANDBY";
  const displayProgress = isSynthRunning ? progress : 0;
  const displayStage = isSynthRunning ? statusLine : statusStages[0];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040405] text-white">
      <div className="absolute inset-0 cad-grid-pattern opacity-[0.28]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(46,209,255,0.12),_transparent_45%),radial-gradient(circle_at_20%_20%,_rgba(148,163,184,0.1),_transparent_40%)]" />

      <header className="relative z-20 border-b border-white/10 bg-obsidian/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <a href="/" className="text-xl font-bold tracking-[0.25em] text-white">
              3D-STORE
            </a>
            <div className="hidden items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/50 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              LAB_STATUS: READY
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/70 sm:gap-3">
            <a
              href="/"
              className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-2 transition hover:border-white/40 hover:text-white sm:inline-flex"
            >
              МАГАЗИН
            </a>
            <a
              href="/ai-lab"
              className="rounded-full border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-2 text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] hover:text-white"
            >
              AI ЛАБОРАТОРИЯ
            </a>
          </nav>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-20 pt-10 sm:px-6 lg:grid lg:grid-cols-[1.6fr_0.9fr]"
      >
        <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-white/5 via-transparent to-black/40 shadow-[0_30px_60px_rgba(0,0,0,0.45)]">
          <div className="absolute left-6 top-6 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/70">
            <Cpu className="h-3.5 w-3.5 text-[#2ED1FF]" />
            REACTOR_VIEW
          </div>
          <div className="absolute right-6 top-6 z-20 rounded-full border border-white/10 bg-black/50 px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
            STAGE: EXPERIMENTAL // API INTEGRATION IN PROGRESS
          </div>

          <div className="relative h-[520px] w-full sm:h-[600px] lg:h-full">
            <Canvas
              dpr={[1, 1.6]}
              camera={{ position: [3.6, 2.6, 4.6], fov: 40 }}
              className="h-full w-full"
            >
              <color attach="background" args={["#050505"]} />
              <ambientLight intensity={0.65} />
              <ReactorLights active={isSynthRunning} />
              <Grid
                infiniteGrid
                sectionColor="#1f2937"
                cellColor="#0b3b4f"
                fadeDistance={18}
                fadeStrength={3}
                position={[0, -1.2, 0]}
              />
              <Suspense fallback={null}>
                {previewModel ? (
                  <ModelView
                    rawModelUrl={previewModel}
                    paintedModelUrl={null}
                    finish="Raw"
                    renderMode="final"
                    accentColor="#2ED1FF"
                  />
                ) : (
                  <NeuralCore active={isSynthRunning} />
                )}
              </Suspense>
              <OrbitControls
                enablePan={false}
                enableZoom
                enableDamping
                autoRotate={!previewModel}
                autoRotateSpeed={0.7}
              />
              <Environment preset="city" />
            </Canvas>
            <div className="laser-scan pointer-events-none absolute inset-x-6 z-10 h-0.5 rounded-full bg-gradient-to-r from-transparent via-[#2ED1FF] to-transparent opacity-70 shadow-[0_0_18px_rgba(46,209,255,0.65)]" />
          </div>

          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute left-6 top-24 flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              NEURAL_LINK: READY
            </div>
            {isSynthRunning && (
              <div className="absolute left-6 top-32 h-24 w-64 overflow-hidden rounded-xl border border-emerald-500/30 bg-black/60 p-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-emerald-200/80 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                <div className="log-scroll space-y-2">
                  {logLines.concat(logLines).map((line, index) => (
                    <p key={`${line}-${index}`} className="whitespace-nowrap">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="absolute right-6 top-24 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              SYNTHESIS_ENGINE: V3.0_BETA
            </div>
            <div className="absolute left-6 bottom-6 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              RESOURCES: RESTRICTED
            </div>
            <div className="absolute right-6 bottom-6 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              {previewLabel ? `PREVIEW: ${previewLabel}` : "NEURAL_CORE: ACTIVE"}
            </div>
          </div>
        </section>

        <aside className="relative flex h-fit flex-col gap-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:sticky lg:top-24">
          <div className="space-y-2">
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/50">
              AI 3D GENERATION SUITE
            </p>
            <h2 className="text-2xl font-semibold text-white">Лаборатория синтеза</h2>
            <p className="text-sm text-white/55">
              Высокоточный протокол сборки цифровых материалов. Используйте тестовый
              `.glb` через параметр `preview`.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-2">
            <div className="grid grid-cols-2 gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em]">
              <button
                type="button"
                onClick={() => setMode("image")}
                className={`min-h-[44px] rounded-xl px-3 py-2 transition ${
                  mode === "image"
                    ? "border border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.35)]"
                    : "border border-white/10 text-white/50 hover:text-white"
                }`}
              >
                ИЗОБРАЖЕНИЕ-В-3D
              </button>
              <button
                type="button"
                onClick={() => setMode("text")}
                className={`min-h-[44px] rounded-xl px-3 py-2 transition ${
                  mode === "text"
                    ? "border border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.35)]"
                    : "border border-white/10 text-white/50 hover:text-white"
                }`}
              >
                ТЕКСТ-В-3D
              </button>
            </div>
          </div>

          <div
            className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-black/20 p-4 text-center transition ${
              dragActive
                ? "border-[#2ED1FF]/70 bg-[#0b1014]/70"
                : "border-white/15 hover:border-white/40"
            }`}
            onClick={handleBrowse}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleBrowse();
              }
            }}
          >
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            {uploadPreview ? (
              <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10">
                <img src={uploadPreview} alt="Preview" className="h-full w-full object-cover" />
                <div className="scanline absolute inset-x-0 top-0 h-1 bg-emerald-400/70 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
                <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_10px_rgba(16,185,129,0.7)]" />
                  SCANNING
                </div>
              </div>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-[#2ED1FF]" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-white">Перетащите изображение</p>
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/50">
                    DROP IMAGE OR CLICK TO UPLOAD
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              <span>AI PROMPT</span>
              <span className="text-white/30">LEN: {prompt.length}</span>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Опишите желаемый результат: форма, стиль, назначение."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 placeholder:text-white/40 focus:border-[#2ED1FF]/60 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={handleSynthesis}
            className="group flex items-center justify-center gap-3 rounded-2xl border border-[#2ED1FF]/70 bg-[#0b1014] px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_20px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            <Zap className="h-4 w-4 text-[#2ED1FF] transition group-hover:text-white" />
            ЗАПУСТИТЬ СИНТЕЗ
          </button>

          <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
            <div className="flex items-center justify-between">
              <span>TERMINAL STREAM</span>
              <span className="flex items-center gap-2 text-white/40">
                <ShieldCheck className="h-3.5 w-3.5 text-[#2ED1FF]" />
                {currentStatus}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-white/70">
              <span>{displayStage}</span>
              <span>{Math.round(displayProgress)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-[#2ED1FF] via-[#7FE7FF] to-white transition-all"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
          </div>
        </aside>
      </motion.main>

      {showAccessDenied && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-[#2ED1FF]/40 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-[#BFF4FF]">
              <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(248,113,113,0.7)]" />
              [ ACCESS_DENIED ]
            </div>
            <p className="mt-4 text-sm text-white/75">
              Для активации нейронного синтеза Tripo_V3 требуется API-ключ уровня
              "Master" или участие в Beta-тестировании.
            </p>
            {showThankYou ? (
              <p className="mt-4 text-sm text-emerald-200">
                Заявка получена. Мы свяжемся с вами после верификации доступа.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleApplyForTest}
                className="mt-6 w-full rounded-2xl border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
              >
                ПОДАТЬ ЗАЯВКУ НА ТЕСТ
              </button>
            )}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
    </div>
  );
}

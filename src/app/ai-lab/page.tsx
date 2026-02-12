"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { DragEvent } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Sparkles } from "@react-three/drei";
import { motion } from "framer-motion";
import { Cpu, ShieldCheck, UploadCloud } from "lucide-react";
import {
  AdditiveBlending,
  Color,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from "three";

import ModelView from "@/components/ModelView";
import { ToastContainer, useToast } from "@/components/Toast";

type SynthesisMode = "image" | "text";

type GeneratedAsset = {
  id: string;
  name: string;
  createdAt: number;
  previewImage?: string | null;
  modelUrl?: string | null;
  format: "glb" | "gltf" | "image";
  localOnly?: boolean;
};

type AiGenerationJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  mode: "image" | "text";
  provider: string;
  progress: number;
  prompt: string;
  sourceType: "none" | "url" | "image";
  sourceUrl: string;
  errorMessage: string;
  result: {
    modelUrl: string;
    previewUrl: string;
    format: string;
  };
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
};

const logLines = [
  "[OK] NEURAL_LINK_ESTABLISHED",
  "[OK] DOWNLOAD_WEIGHTS_V3...",
  "[..] MAPPING_TOPOLOGY_0x88F",
  "[..] COMPUTING_GEOMETRY_NODES",
  "[..] RECONSTRUCT_VOLUME",
  "[..] CALIBRATING_LATENT_GRID",
];

const TOKEN_COST = 10;
const DEFAULT_TOKENS = 120;
const GALLERY_LIMIT = 12;
const GALLERY_STORAGE_KEY = "aiLabGallery";
const TOKENS_STORAGE_KEY = "aiLabTokens";
const AI_LAB_BG = "/backgrounds/pedestal.png";
const MODEL_STAGE_OFFSET = -0.95;
const MODEL_STAGE_TARGET_SIZE = 2.2;
const AI_GENERATE_API_URL = "/api/ai/generate";
const SERVER_STAGE_BY_STATUS: Record<AiGenerationJob["status"], string> = {
  queued: "SERVER_QUEUE",
  processing: "GENETIC_MAPPING",
  completed: "SYNTHESIS_DONE",
  failed: "SYNTHESIS_FAILED",
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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
      <Sparkles count={90} scale={3.6} size={1.6} color="#BFF4FF" speed={0.35} opacity={0.45} />
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

function FloorPulse({ active }: { active: boolean }) {
  const ringRef = useRef<Mesh | null>(null);
  const ringMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const glowRef = useRef<Mesh | null>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const cool = useRef(new Color("#2ED1FF"));
  const hot = useRef(new Color("#8CF3FF"));
  const temp = useRef(new Color());

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const basePulse = (Math.sin(t * 1.6) + 1) / 2;
    const charge = active ? (Math.sin(t * 7.5) + 1) / 2 : 0;
    const pulse = active ? 0.6 + basePulse * 0.4 + charge * 0.4 : 0.35 + basePulse * 0.25;

    if (ringRef.current) {
      const scale = 1 + basePulse * 0.04 + (active ? charge * 0.03 : 0);
      ringRef.current.scale.setScalar(scale);
    }
    if (glowRef.current) {
      const scale = 1.02 + basePulse * 0.03 + (active ? charge * 0.04 : 0);
      glowRef.current.scale.setScalar(scale);
    }
    if (ringMaterialRef.current) {
      temp.current.copy(cool.current).lerp(hot.current, active ? charge : 0.15);
      ringMaterialRef.current.emissive.copy(temp.current);
      ringMaterialRef.current.emissiveIntensity = 0.9 + pulse * 1.6;
    }
    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = 0.06 + pulse * 0.14;
    }
  });

  return (
    <group position={[0, -1.12, 0]}>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.12, 1.22, 128]} />
        <meshStandardMaterial
          ref={ringMaterialRef}
          color="#0c1f2a"
          emissive="#2ED1FF"
          emissiveIntensity={1.2}
          roughness={0.35}
          metalness={0.6}
        />
      </mesh>
      <mesh ref={glowRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.36, 96]} />
        <meshBasicMaterial
          ref={glowMaterialRef}
          color="#2ED1FF"
          transparent
          opacity={0.14}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function AiLabContent() {
  const [previewParam, setPreviewParam] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readParams = () => {
      const params = new URLSearchParams(window.location.search);
      setPreviewParam(params.get("preview"));
    };
    readParams();
    window.addEventListener("popstate", readParams);
    return () => window.removeEventListener("popstate", readParams);
  }, []);
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
  const [localPreviewModel, setLocalPreviewModel] = useState<string | null>(null);
  const [localPreviewLabel, setLocalPreviewLabel] = useState<string | null>(null);
  const [uploadedModelName, setUploadedModelName] = useState<string | null>(null);
  const [generatedPreviewModel, setGeneratedPreviewModel] = useState<string | null>(null);
  const [generatedPreviewLabel, setGeneratedPreviewLabel] = useState<string | null>(null);
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [gallery, setGallery] = useState<GeneratedAsset[]>([]);
  const [resultAsset, setResultAsset] = useState<GeneratedAsset | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [serverJob, setServerJob] = useState<AiGenerationJob | null>(null);
  const [serverJobLoading, setServerJobLoading] = useState(false);
  const [serverJobError, setServerJobError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const completedServerJobRef = useRef<string | null>(null);
  const isSynthRunning = serverJob?.status === "queued" || serverJob?.status === "processing";

  const { toasts, showError, removeToast } = useToast();

  useEffect(() => {
    if (!uploadPreview) return;
    if (!uploadPreview.startsWith("blob:")) return;
    return () => {
      URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  useEffect(() => {
    if (!localPreviewModel) return;
    return () => {
      URL.revokeObjectURL(localPreviewModel);
    };
  }, [localPreviewModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedTokens = window.localStorage.getItem(TOKENS_STORAGE_KEY);
    if (storedTokens) {
      const parsed = Number(storedTokens);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        setTokens(parsed);
      }
    }
    const storedGallery = window.localStorage.getItem(GALLERY_STORAGE_KEY);
    if (storedGallery) {
      try {
        const parsed = JSON.parse(storedGallery) as GeneratedAsset[];
        if (Array.isArray(parsed)) {
          setGallery(parsed);
        }
      } catch {
        // ignore invalid cache
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOKENS_STORAGE_KEY, String(tokens));
  }, [tokens]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const safeGallery = gallery.map((item) => {
      let next = item;
      if (next.modelUrl && next.modelUrl.startsWith("blob:")) {
        next = { ...next, modelUrl: null, localOnly: true };
      }
      if (next.previewImage && next.previewImage.startsWith("data:")) {
        next = { ...next, previewImage: null };
      }
      return next;
    });
    try {
      window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(safeGallery));
    } catch {
      const minimalGallery = safeGallery.map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
        format: item.format,
        modelUrl: item.modelUrl && item.modelUrl.startsWith("blob:") ? null : item.modelUrl ?? null,
        previewImage: null,
        localOnly: item.localOnly ?? false,
      }));
      try {
        window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(minimalGallery));
      } catch {
        // ignore quota errors
      }
    }
  }, [gallery]);

  const handleFile = (file?: File | null) => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isModelFile = /\.(glb|gltf)$/.test(lowerName);
    const isImageFile =
      file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(lowerName);

    if (isModelFile) {
      const nextPreview = URL.createObjectURL(file);
      setLocalPreviewModel(nextPreview);
      setLocalPreviewLabel(file.name);
      setUploadedModelName(file.name);
      setUploadPreview(null);
      return;
    }

    if (isImageFile) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : null;
        setUploadPreview(result);
      };
      reader.readAsDataURL(file);
      setLocalPreviewModel(null);
      setLocalPreviewLabel(null);
      setUploadedModelName(null);
      return;
    }

    showError("Неподдерживаемый формат. Разрешены изображения и .glb/.gltf");
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

  const registerGeneratedAsset = useCallback(
    (args: {
      name: string;
      modelUrl: string;
      previewImage?: string | null;
      format?: string;
      localOnly?: boolean;
    }) => {
      const normalizedFormat =
        args.format === "gltf" || args.modelUrl.toLowerCase().endsWith(".gltf")
          ? "gltf"
          : "glb";
      const asset: GeneratedAsset = {
        id: createId(),
        name: args.name.trim().slice(0, 48) || "AI Model",
        createdAt: Date.now(),
        previewImage: args.previewImage ?? null,
        modelUrl: args.modelUrl,
        format: normalizedFormat,
        localOnly: args.localOnly ?? false,
      };
      setGallery((prev) => [asset, ...prev].slice(0, GALLERY_LIMIT));
      setResultAsset(asset);
      setShowResult(true);
      setGeneratedPreviewModel(asset.modelUrl ?? null);
      setGeneratedPreviewLabel(asset.name);
    },
    []
  );

  const handleStartServerSynthesis = useCallback(async () => {
    if (serverJobLoading || isSynthRunning) return;
    if (tokens < TOKEN_COST) {
      showError(`Need ${TOKEN_COST} tokens.`);
      return;
    }
    if (!prompt.trim() && !uploadPreview && !localPreviewModel && !previewModel) {
      showError("Добавьте prompt или референс перед запуском.");
      return;
    }

    setTokens((prev) => Math.max(0, prev - TOKEN_COST));
    setServerJobLoading(true);
    setServerJobError(null);
    setShowResult(false);
    setResultAsset(null);

    try {
      const response = await fetch(AI_GENERATE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode,
          prompt: prompt.trim(),
          sourceUrl: previewModel || "",
          hasImageReference: Boolean(uploadPreview || localPreviewModel),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : "Не удалось создать AI-задачу.";
        throw new Error(message);
      }
      const nextJob = data?.job as AiGenerationJob | undefined;
      if (!nextJob?.id) {
        throw new Error("Сервер вернул некорректный ответ по задаче.");
      }
      completedServerJobRef.current = null;
      setServerJob(nextJob);
    } catch (error) {
      setTokens((prev) => prev + TOKEN_COST);
      const message =
        error instanceof Error ? error.message : "Не удалось создать AI-задачу.";
      setServerJobError(message);
      showError(message);
    } finally {
      setServerJobLoading(false);
    }
  }, [
    localPreviewModel,
    mode,
    isSynthRunning,
    previewModel,
    prompt,
    serverJobLoading,
    showError,
    tokens,
    uploadPreview,
  ]);

  useEffect(() => {
    if (!serverJob?.id) return;
    if (serverJob.status === "completed" || serverJob.status === "failed") return;

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`${AI_GENERATE_API_URL}/${encodeURIComponent(serverJob.id)}`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Не удалось получить статус AI-задачи.";
          throw new Error(message);
        }

        const nextJob = data?.job as AiGenerationJob | undefined;
        if (!nextJob?.id || cancelled) return;

        setServerJob(nextJob);
        if (nextJob.status === "failed") {
          const message = nextJob.errorMessage || "AI-задача завершилась с ошибкой.";
          setServerJobError(message);
          showError(message);
        } else if (
          nextJob.status === "completed" &&
          nextJob.result?.modelUrl &&
          completedServerJobRef.current !== nextJob.id
        ) {
          completedServerJobRef.current = nextJob.id;
          registerGeneratedAsset({
            name: nextJob.prompt || "AI Model",
            modelUrl: nextJob.result.modelUrl,
            previewImage: nextJob.result.previewUrl || uploadPreview || null,
            format: nextJob.result.format,
            localOnly: false,
          });
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Не удалось обновить статус AI-задачи.";
        setServerJobError(message);
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1600);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [registerGeneratedAsset, serverJob?.id, serverJob?.status, showError, uploadPreview]);

  const handleSelectAsset = (asset: GeneratedAsset) => {
    if (!asset.modelUrl) {
      showError("Файл модели недоступен. Загрузите модель заново.");
      return;
    }
    setGeneratedPreviewModel(asset.modelUrl);
    setGeneratedPreviewLabel(asset.name);
  };

  const handleDownload = (asset: GeneratedAsset) => {
    if (typeof window === "undefined") return;
    if (asset.modelUrl) {
      const link = document.createElement("a");
      link.href = asset.modelUrl;
      const extension = asset.format === "gltf" ? "gltf" : "glb";
      link.download = `${asset.name}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (asset.previewImage) {
      const link = document.createElement("a");
      link.href = asset.previewImage;
      link.download = `${asset.name}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    showError("Нет файла для скачивания.");
  };

  const currentStatus = serverJob?.status?.toUpperCase() ?? "STANDBY";
  const displayProgress = Math.max(0, Math.min(100, serverJob?.progress ?? 0));
  const displayStage = serverJob ? SERVER_STAGE_BY_STATUS[serverJob.status] : "STANDBY";
  const activePreviewModel = generatedPreviewModel ?? localPreviewModel ?? previewModel;
  const activePreviewLabel = generatedPreviewLabel ?? localPreviewLabel ?? previewLabel;
  const [modelScale, setModelScale] = useState(1);

  useEffect(() => {
    setModelScale(1);
  }, [activePreviewModel]);

  const handleBounds = useCallback((bounds: { size: number }) => {
    if (!bounds?.size || !Number.isFinite(bounds.size)) return;
    const nextScale = Math.min(1.25, Math.max(0.6, MODEL_STAGE_TARGET_SIZE / bounds.size));
    setModelScale(nextScale);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#030304] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center page-bg-fade"
        style={{ backgroundImage: `url(${AI_LAB_BG})`, backgroundPosition: "center 70%", filter: "brightness(0.75)" }}
      />
      <div className="pointer-events-none fixed inset-0 z-10 bg-black/35" />
      <div className="pointer-events-none fixed inset-0 z-20 cad-grid-pattern opacity-[0.22]" />
      <div className="pointer-events-none fixed inset-0 z-20 bg-[radial-gradient(circle_at_top,_rgba(46,209,255,0.08),_transparent_50%),radial-gradient(circle_at_20%_20%,_rgba(148,163,184,0.07),_transparent_45%)]" />

      <header className="relative z-30 border-b border-white/10 bg-obsidian/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <a href="/store" className="text-xl font-bold tracking-[0.25em] text-white">
              3D-STORE
            </a>
            <div className="hidden items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/50 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              LAB_STATUS: READY
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/70 sm:gap-3">
            <a
              href="/store"
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
        className="relative z-30 mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-20 pt-10 sm:px-6 lg:grid lg:grid-cols-[1.6fr_0.9fr]"
      >
        <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[32px] bg-transparent">
          <div className="absolute left-6 top-6 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/70">
            <Cpu className="h-3.5 w-3.5 text-[#2ED1FF]" />
            REACTOR_VIEW
          </div>
          <div className="absolute right-6 top-6 z-20 rounded-full border border-white/10 bg-black/50 px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
            STAGE: EXPERIMENTAL // API INTEGRATION IN PROGRESS
          </div>

          <div className="relative h-[520px] w-full sm:h-[600px] lg:h-full">
            <Canvas
              gl={{ alpha: true, antialias: true }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
              }}
              dpr={[1, 1.6]}
              camera={{ position: [3.6, 2.6, 4.6], fov: 40 }}
              className="h-full w-full"
            >
              <ambientLight intensity={0.65} />
              <ReactorLights active={isSynthRunning} />
              <FloorPulse active={isSynthRunning} />
              <Grid
                infiniteGrid
                sectionColor="#152b36"
                cellColor="#0b2230"
                fadeDistance={16}
                fadeStrength={4}
                position={[0, -1.2, 0]}
              />
              <Suspense fallback={null}>
                {activePreviewModel ? (
                  <group position={[0, MODEL_STAGE_OFFSET, 0]} scale={modelScale}>
                    <ModelView
                      rawModelUrl={activePreviewModel}
                      paintedModelUrl={null}
                      finish="Raw"
                      renderMode="final"
                      accentColor="#2ED1FF"
                      onBounds={handleBounds}
                    />
                  </group>
                ) : isSynthRunning ? (
                  <NeuralCore active />
                ) : null}
              </Suspense>
              <OrbitControls
                enablePan={false}
                enableZoom
                enableDamping
                autoRotate={false}
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
              {activePreviewLabel ? `PREVIEW: ${activePreviewLabel}` : "NEURAL_CORE: ACTIVE"}
            </div>
          </div>
        </section>

        <aside className="relative flex h-fit flex-col gap-5 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:sticky lg:top-24">
          <div className="space-y-2">
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/50">
              AI 3D GENERATION SUITE
            </p>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-semibold text-white">Лаборатория синтеза</h2>
              <div className="rounded-full border border-[#2ED1FF]/30 bg-[#0b1014] px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#BFF4FF] shadow-[0_0_16px_rgba(46,209,255,0.25)]">
                TOKENS: {tokens}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-amber-200">
              В разработке
            </div>
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
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
            <span>Списание за запуск</span>
            <span className="text-[#BFF4FF]">- {TOKEN_COST} TOKENS</span>
          </div>

          <div
            className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-4 text-center transition ${
              dragActive
                ? "border-[#2ED1FF]/70 bg-[#0b1014]/70 shadow-[0_0_24px_rgba(46,209,255,0.35)]"
                : "border-white/20 bg-[radial-gradient(circle_at_center,rgba(46,209,255,0.06),transparent_60%)] shadow-[inset_0_0_40px_rgba(46,209,255,0.08)] hover:border-white/40"
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
              accept="image/*,.glb,.gltf"
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
            ) : uploadedModelName ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-6 text-center">
                <div className="rounded-full border border-[#2ED1FF]/40 bg-[#0b1014] px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#BFF4FF]">
                  MODEL LOADED
                </div>
                <p className="text-sm font-semibold text-white">{uploadedModelName}</p>
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/40">
                  ready for synthesis
                </p>
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
            onClick={() => {
              void handleStartServerSynthesis();
            }}
            disabled={serverJobLoading || isSynthRunning}
            className="group flex items-center justify-center gap-3 rounded-2xl border border-emerald-400/60 bg-emerald-400/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition hover:border-emerald-300 hover:bg-emerald-400/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Cpu className="h-4 w-4 text-emerald-300 transition group-hover:text-white" />
            {serverJobLoading ? "CREATING JOB..." : isSynthRunning ? "GENERATION IN PROGRESS" : "START GENERATION"}
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
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.26em] text-emerald-100/80">
            <div className="flex items-center justify-between gap-3">
              <span>SERVER JOB</span>
              <span>{serverJob?.status || "idle"}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-white transition-all"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            {serverJob?.id && (
              <p className="mt-2 break-all text-[9px] tracking-[0.2em] text-emerald-100/70">
                ID: {serverJob.id}
              </p>
            )}
            {serverJob?.provider && (
              <p className="mt-1 text-[9px] tracking-[0.2em] text-emerald-100/70">
                Provider: {serverJob.provider}
              </p>
            )}
            {serverJobError && (
              <p className="mt-2 text-[9px] tracking-[0.18em] text-rose-300">{serverJobError}</p>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
              <span>AI ВИТРИНА</span>
              <span className="text-white/30">{gallery.length} / {GALLERY_LIMIT}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {gallery.length === 0 ? (
                <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/40">
                  ПОКА НЕТ РЕЗУЛЬТАТОВ
                </div>
              ) : (
                gallery.map((asset) => (
                  <div
                    key={asset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectAsset(asset)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectAsset(asset);
                      }
                    }}
                    className="group flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-2 text-left transition hover:border-[#2ED1FF]/60"
                  >
                  <div className="relative h-20 w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-[#0b1014] via-[#090c0f] to-black">
                    <span className="absolute left-2 top-2 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-amber-200">
                      DEMO
                    </span>
                    {asset.previewImage ? (
                        <img
                          src={asset.previewImage}
                          alt={asset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/30">
                          MODEL
                        </div>
                      )}
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/60">
                      <span className="truncate">{asset.name}</span>
                      <span className="text-white/30">{asset.format.toUpperCase()}</span>
                    </div>
                    <div className="flex w-full items-center gap-2">
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                        {asset.localOnly ? "LOCAL" : "CLOUD"}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownload(asset);
                        }}
                        className="rounded-full border border-[#2ED1FF]/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                      >
                        SAVE
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </motion.main>

      {showResult && resultAsset && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-[#2ED1FF]/40 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-[#BFF4FF]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
              [ GENERATION COMPLETE ]
            </div>
            <p className="mt-4 text-sm text-white/75">
              Модель готова к просмотру и сохранению. Файлы сохраняются в стандартных
              форматах (.glb/.gltf) или как превью.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => handleDownload(resultAsset)}
                className="flex-1 rounded-2xl border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
              >
                Сохранить результат
              </button>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
    </div>
  );
}

export default function AiLabPage() {
  return <AiLabContent />;
}

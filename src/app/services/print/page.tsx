"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import {
  Box3,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  DoubleSide,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { UploadCloud, AlertTriangle, ShoppingCart, X } from "lucide-react";

import { ToastContainer, useToast } from "@/components/Toast";
import AuthForm from "@/components/AuthForm";
import { toast } from "sonner";

type TechMode = "sla" | "fdm";
type QualityKey = "pro" | "standard";
type PreviewMode = "hologram" | "resin" | "plastic" | "original";

type ModelMetrics = {
  size: { x: number; y: number; z: number };
  volumeCm3: number;
};

const BED_SIZE = 200;
const BASE_FEE = 350;
const PENDING_CART_KEY = "store3d_pending_print_item";
const UPLOAD_TIMEOUT_MS = 300_000;
const PRESIGN_TIMEOUT_MS = 30_000;
const COMPLETE_TIMEOUT_MS = 120_000;
const PROGRESS_SEGMENTS = 10;
const STALLED_TIMEOUT_MS = 15_000;
const STALL_ABORT_MS = 20_000;
const UPLOAD_MAX_RETRIES = 2;
const UPLOAD_RETRY_BASE_MS = 2000;
const UPLOAD_RETRY_MAX_MS = 10_000;
const DEFAULT_UPLOAD_DEBUG_ENABLED = process.env.NEXT_PUBLIC_UPLOAD_DEBUG === "1";
const PRINT_BG_IMAGE = "/backgrounds/Industrial%20Power.png";

const ACCEPTED_EXTENSIONS = [".stl", ".obj", ".glb", ".gltf"];
const ACCEPTED_TYPES = [
  "application/sla",
  "model/stl",
  "model/gltf-binary",
  "text/plain",
];

const materialsByTech: Record<TechMode, Array<{ label: string; rate: number }>> = {
  sla: [
    { label: "Tough Resin", rate: 6.5 },
    { label: "Standard Resin", rate: 5.2 },
  ],
  fdm: [
    { label: "Standard PLA", rate: 2.1 },
    { label: "ABS Pro", rate: 2.8 },
  ],
};

const qualityOptions: Array<{ key: QualityKey; label: string; multiplier: number }> = [
  { key: "pro", label: "0.05mm (Pro)", multiplier: 1.55 },
  { key: "standard", label: "0.1mm (Standard)", multiplier: 1 },
];

const techSurcharge: Record<TechMode, number> = {
  sla: 120,
  fdm: 0,
};

const materialSurcharge: Record<string, number> = {
  "Tough Resin": 50,
  "Standard Resin": 0,
  "Standard PLA": 0,
  "ABS Pro": 60,
};

const qualitySurcharge: Record<QualityKey, number> = {
  pro: 100,
  standard: 0,
};

const formatNumber = (value: number, digits = 1) => {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(digits);
};

const formatPrice = (value: number) => {
  const rounded = Math.max(0, Math.round(value));
  return new Intl.NumberFormat("ru-RU").format(rounded);
};

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatSpeed = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 KB/s";
  const kb = bytesPerSecond / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB/s`;
};

const buildProxyUrlFromSource = (value: string) => {
  const normalized = value.split("?")[0] ?? value;
  const filename = normalized.replace(/\\/g, "/").split("/").pop();
  if (!filename) return null;
  return `/api/media-file/${encodeURIComponent(filename)}`;
};

const buildUploadLogLine = (message: string, data?: Record<string, unknown>) => {
  const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
  if (!data) {
    return `[${time}] ${message}`;
  }
  return `[${time}] ${message} ${JSON.stringify(data)}`;
};

const buildProgressBar = (progress: number) => {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const filled = Math.round((clamped / 100) * PROGRESS_SEGMENTS);
  const empty = PROGRESS_SEGMENTS - filled;
  return `[${"#".repeat(filled)}${"-".repeat(empty)}] ${clamped}%`;
};

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const createGhostMaterial = () =>
  new MeshStandardMaterial({
    color: new Color("#7AD9FF"),
    transparent: true,
    opacity: 0.38,
    roughness: 0.35,
    metalness: 0.1,
    emissive: new Color("#1C8FF0"),
    emissiveIntensity: 0.35,
    side: DoubleSide,
  });

const createResinMaterial = () =>
  new MeshStandardMaterial({
    color: new Color("#8C9198"),
    roughness: 0.75,
    metalness: 0.08,
  });

const createPlasticMaterial = () =>
  new MeshStandardMaterial({
    color: new Color("#D9D3C8"),
    roughness: 0.7,
    metalness: 0.05,
  });

const registerOriginalMaterials = (object: Object3D) => {
  object.traverse((child) => {
    if (child instanceof Mesh && !child.userData.originalMaterial) {
      child.userData.originalMaterial = child.material;
    }
  });
};

const applyPreviewMaterial = (
  object: Object3D,
  mode: PreviewMode,
  materials: {
    hologram: MeshStandardMaterial;
    resin: MeshStandardMaterial;
    plastic: MeshStandardMaterial;
  }
) => {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    if (mode === "original") {
      if (child.userData.originalMaterial) {
        child.material = child.userData.originalMaterial;
        return;
      }
      child.material = materials.resin;
      return;
    }

    const nextMaterial =
      mode === "resin"
        ? materials.resin
        : mode === "plastic"
          ? materials.plastic
          : materials.hologram;
    child.material = nextMaterial;
  });
};

const computeMeshVolume = (mesh: Mesh) => {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return 0;

  const index = geometry.index;
  const vA = new Vector3();
  const vB = new Vector3();
  const vC = new Vector3();
  const cross = new Vector3();
  const matrix = mesh.matrixWorld;
  let volume = 0;

  const getVertex = (idx: number, target: Vector3) => {
    target.fromBufferAttribute(position, idx).applyMatrix4(matrix);
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      getVertex(index.getX(i), vA);
      getVertex(index.getX(i + 1), vB);
      getVertex(index.getX(i + 2), vC);
      volume += vA.dot(cross.copy(vB).cross(vC)) / 6;
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      getVertex(i, vA);
      getVertex(i + 1, vB);
      getVertex(i + 2, vC);
      volume += vA.dot(cross.copy(vB).cross(vC)) / 6;
    }
  }

  return volume;
};

const analyzeModel = (object: Object3D, unit: "mm" | "m") => {
  object.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object);
  const size = new Vector3();
  bounds.getSize(size);
  const unitScale = unit === "m" ? 1000 : 1;

  let volume = 0;
  object.traverse((child) => {
    if (child instanceof Mesh) {
      volume += computeMeshVolume(child);
    }
  });

  const sizeMm = {
    x: size.x * unitScale,
    y: size.y * unitScale,
    z: size.z * unitScale,
  };

  const meshVolumeCm3 =
    unit === "m" ? Math.abs(volume) * 1_000_000 : Math.abs(volume) / 1000;
  const boundsVolumeCm3 = (sizeMm.x * sizeMm.y * sizeMm.z) / 1000;

  let volumeCm3 = meshVolumeCm3;
  if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) {
    volumeCm3 = boundsVolumeCm3;
  }

  return {
    size: sizeMm,
    volumeCm3,
  };
};

const centerAndGroundModel = (object: Object3D) => {
  object.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object);
  const center = new Vector3();
  bounds.getCenter(center);
  object.position.sub(center);
  object.updateMatrixWorld(true);

  const groundedBounds = new Box3().setFromObject(object);
  object.position.y -= groundedBounds.min.y;
  object.updateMatrixWorld(true);
};

const getSceneBounds = (object: Object3D) => {
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  return { size, maxDim };
};

const computePreviewScale = (maxSceneDim: number) => {
  if (!Number.isFinite(maxSceneDim) || maxSceneDim <= 0) {
    return 1;
  }
  const minVisible = BED_SIZE * 0.08;
  if (maxSceneDim >= minVisible) {
    return 1;
  }
  const targetSize = BED_SIZE * 0.6;
  return targetSize / maxSceneDim;
};

const PrintBed = () => {
  return (
    <group position={[0, BED_SIZE / 2, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -BED_SIZE / 2 + 0.5, 0]}
        receiveShadow
      >
        <planeGeometry args={[BED_SIZE, BED_SIZE]} />
        <meshStandardMaterial color="#0a141b" transparent opacity={0.05} />
      </mesh>
    </group>
  );
};

const PrintScene = ({ model }: { model: Object3D | null }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(media.matches);
    update();
    if ("addEventListener" in media) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    legacyMedia.addListener?.(update);
    return () => legacyMedia.removeListener?.(update);
  }, []);

  return (
    <Canvas
      shadows
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [280, 170, 340], fov: 40, near: 1, far: 2000 }}
      dpr={isMobile ? 1 : [1, 1.5]}
      className={`h-full w-full bg-transparent${isMobile ? " pointer-events-none" : ""}`}
      style={{
        touchAction: isMobile ? "pan-y" : "none",
        pointerEvents: isMobile ? "none" : "auto",
      }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[180, 240, 120]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={10}
        shadow-camera-far={800}
        shadow-camera-left={-220}
        shadow-camera-right={220}
        shadow-camera-top={220}
        shadow-camera-bottom={-220}
        shadow-bias={-0.0003}
      />
      <directionalLight position={[-120, 160, -80]} intensity={0.8} />
      <PrintBed />
      <Grid
        position={[0, 0, 0]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#1b3340"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#2ED1FF"
        fadeDistance={350}
        fadeStrength={1}
      />
      {model && <primitive object={model} />}
      <OrbitControls
        enabled={!isMobile}
        enablePan={false}
        enableZoom={!isMobile}
        minDistance={140}
        maxDistance={520}
        dampingFactor={0.08}
        enableDamping
        target={[0, 80, 0]}
      />
    </Canvas>
  );
};

function PrintServiceContent() {
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prefillRef = useRef(false);
  const [modelObject, setModelObject] = useState<Object3D | null>(null);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "analyzing" | "pending" | "uploading" | "finalizing" | "ready"
  >("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadSpeedBps, setUploadSpeedBps] = useState(0);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const [uploadEtaMs, setUploadEtaMs] = useState<number | null>(null);
  const [uploadStalled, setUploadStalled] = useState(false);
  const [uploadAttempt, setUploadAttempt] = useState(1);
  const [uploadRetryInMs, setUploadRetryInMs] = useState<number | null>(null);
  const [uploadDebug, setUploadDebug] = useState<string[]>([]);
  const [uploadDebugEnabled, setUploadDebugEnabled] = useState(DEFAULT_UPLOAD_DEBUG_ENABLED);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadStartRef = useRef<number | null>(null);
  const lastProgressRef = useRef<{ time: number; loaded: number } | null>(null);
  const lastLoggedPercentRef = useRef<number>(-1);
  const lastStallLoggedRef = useRef(false);
  const stallAbortArmedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const [isMobileUa, setIsMobileUa] = useState(false);
  const [uploadedMedia, setUploadedMedia] = useState<{
    id: string;
    url?: string;
    filename?: string;
  } | null>(null);
  const [technology, setTechnology] = useState<TechMode>("sla");
  const [material, setMaterial] = useState<string>(materialsByTech.sla[0].label);
  const [quality, setQuality] = useState<QualityKey>("standard");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("hologram");
  const [previewModeAuto, setPreviewModeAuto] = useState(true);
  const [previewScale, setPreviewScale] = useState(1);
  const [serviceProductId, setServiceProductId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const apiBase = "";
  const isUploadBusy =
    uploadStatus === "uploading" || uploadStatus === "analyzing" || uploadStatus === "finalizing";
  const canStartUpload = Boolean(pendingFile) && uploadStatus === "pending";
  const canAddToCart =
    Boolean(uploadedMedia?.id) &&
    Boolean(metrics) &&
    Boolean(serviceProductId) &&
    uploadStatus === "ready";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent || "";
    setIsMobileUa(/android|iphone|ipad|ipod|iemobile|mobile/i.test(ua));
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setUploadRetryInMs(null);
  }, []);

  const resolveExistingUpload = async (file: File) => {
    if (!apiBase) return null;
    const params = new URLSearchParams();
    params.set("limit", "1");
    params.set("depth", "0");
    params.set("sort", "-createdAt");
    params.set("where[filename][equals]", file.name);
    params.set("where[filesize][equals]", String(file.size));
    params.set("where[isCustomerUpload][equals]", "true");

    try {
      const response = await fetch(`${apiBase}/api/media?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data?.docs?.[0] ?? null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const nextMaterials = materialsByTech[technology];
    if (!nextMaterials.some((entry) => entry.label === material)) {
      setMaterial(nextMaterials[0].label);
    }
  }, [material, technology]);

  useEffect(() => {
    if (!previewModeAuto) {
      return;
    }
    setPreviewMode(technology === "sla" ? "resin" : "plastic");
  }, [previewModeAuto, technology]);

  useEffect(() => {
    fetch(`${apiBase}/api/products?where[slug][equals]=custom-print-service&limit=1`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const product = data?.docs?.[0];
        if (product?.id) {
          setServiceProductId(String(product.id));
        }
      })
      .catch(() => {
        setServiceProductId(null);
      });
  }, [apiBase]);

  useEffect(() => {
    fetch(`${apiBase}/api/users/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.user ?? data?.doc ?? null;
        setIsLoggedIn(Boolean(user?.id));
      })
      .catch(() => setIsLoggedIn(false));
  }, [apiBase]);

  const previewMaterials = useMemo(
    () => ({
      hologram: createGhostMaterial(),
      resin: createResinMaterial(),
      plastic: createPlasticMaterial(),
    }),
    []
  );

  const price = useMemo(() => {
    const materialFee = materialSurcharge[material] ?? 0;
    const qualityFee = qualitySurcharge[quality] ?? 0;
    const techFee = techSurcharge[technology] ?? 0;
    return BASE_FEE + techFee + materialFee + qualityFee;
  }, [material, quality, technology]);

  const materialHint = useMemo(() => {
    const hints: Record<string, string> = {
      "Tough Resin": "Прочная смола для функциональных деталей.",
      "Standard Resin": "Базовая смола для макетов и фигур.",
      "Standard PLA": "Универсальный пластик для прототипов.",
      "ABS Pro": "Пластик с повышенной термостойкостью.",
    };
    return hints[material] ?? "Выберите материал для печати.";
  }, [material]);

  const qualityHint = useMemo(() => {
    return quality === "pro"
      ? "0.05 мм — максимум деталей, дольше и дороже."
      : "0.1 мм — быстрее и дешевле, чуть ниже детализация.";
  }, [quality]);

  const fitsBed = useMemo(() => {
    if (!metrics) return true;
    return (
      metrics.size.x <= BED_SIZE &&
      metrics.size.y <= BED_SIZE &&
      metrics.size.z <= BED_SIZE
    );
  }, [metrics]);

  const isPreviewScaled = useMemo(
    () => Number.isFinite(previewScale) && Math.abs(previewScale - 1) > 0.01,
    [previewScale]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      console.log("File detected:", file.name, file.type);
      const hasExtension = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      const hasMimeType = file.type ? ACCEPTED_TYPES.includes(file.type) : false;
      if (!hasExtension && !hasMimeType) {
        setUploadError("Не удалось разобрать файл.");
        setUploadStatus("idle");
        setPendingFile(null);
        return;
      }

      setUploadedMedia(null);
      setMetrics(null);
      setModelObject(null);
      clearRetryTimer();
      setUploadAttempt(1);
      setPendingFile(null);
      setUploadSpeedBps(0);
      setUploadElapsedMs(0);
      setUploadEtaMs(null);
      setUploadStalled(false);
      setUploadDebug([]);
      setUploadError(null);
      setUploadStatus("analyzing");
      setUploadProgress(0);
      setPreviewScale(1);
      console.log("Analyzing file:", file.name);

      try {
        let object: Object3D | null = null;
        if (lower.endsWith(".stl")) {
          const arrayBuffer = await file.arrayBuffer();
          const geometry = new STLLoader().parse(arrayBuffer);
          geometry.computeVertexNormals();
          const mesh = new Mesh(geometry, previewMaterials.resin);
          const group = new Group();
          group.add(mesh);
          object = group;
        } else if (lower.endsWith(".obj")) {
          const text = await file.text();
          const group = new OBJLoader().parse(text);
          object = group;
        } else {
          const loader = new GLTFLoader();
          const data = lower.endsWith(".glb") ? await file.arrayBuffer() : await file.text();
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.parse(data as any, "", resolve, reject);
          });
          object = gltf.scene ?? gltf.scenes?.[0] ?? null;
        }

        if (!object) {
          throw new Error("Не удалось загрузить модель.");
        }

        registerOriginalMaterials(object);
        applyPreviewMaterial(object, previewMode, previewMaterials);
        object.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        centerAndGroundModel(object);
        const sceneBounds = getSceneBounds(object);
        const unit =
          lower.endsWith(".glb") || lower.endsWith(".gltf")
            ? sceneBounds.maxDim <= 5
              ? "m"
              : "mm"
            : "mm";
        const nextMetrics = analyzeModel(object, unit);
        const scale = computePreviewScale(sceneBounds.maxDim);
        if (Math.abs(scale - 1) > 0.001) {
          object.scale.multiplyScalar(scale);
          object.updateMatrixWorld(true);
        }
        setPreviewScale(scale);
        centerAndGroundModel(object);
        setModelObject(object);
        setMetrics(nextMetrics);
        console.log("Analysis complete:", nextMetrics);
        console.log("Model units:", unit);
      } catch (error) {
        setUploadError("Не удалось разобрать файл.");
        setUploadStatus("idle");
        return;
      }
      setPendingFile(file);
      setUploadStatus("pending");
    },
    [previewMaterials, previewMode, clearRetryTimer]
  );

  useEffect(() => {
    if (prefillRef.current) return;
    const modelParam = searchParams.get("model");
    if (!modelParam || typeof window === "undefined") return;
    prefillRef.current = true;

    const nameParam = searchParams.get("name");
    const resolvedUrl =
      modelParam.startsWith("http://") ||
      modelParam.startsWith("https://") ||
      modelParam.startsWith("blob:") ||
      modelParam.startsWith("data:")
        ? modelParam
        : `${window.location.origin}${modelParam.startsWith("/") ? modelParam : `/${modelParam}`}`;
    const proxyCandidate =
      resolvedUrl.startsWith("http") ? buildProxyUrlFromSource(resolvedUrl) : null;
    const initialUrl = proxyCandidate ?? resolvedUrl;

    const sanitize = (value: string) =>
      value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80);

    const deriveFilename = (url: string, fallback: string) => {
      try {
        const parsed = new URL(url, window.location.origin);
        const base = decodeURIComponent(parsed.pathname.split("/").pop() || fallback);
        return base || fallback;
      } catch {
        return fallback;
      }
    };

    const loadPreset = async () => {
      try {
        let response = await fetch(initialUrl);
        if (!response.ok && initialUrl !== resolvedUrl) {
          response = await fetch(resolvedUrl);
        }
        if (!response.ok && proxyCandidate) {
          response = await fetch(proxyCandidate);
        }
        if (!response.ok) {
          throw new Error(`Failed to fetch ${response.status}`);
        }
        const blob = await response.blob();
        const fallbackName = nameParam ? `${sanitize(nameParam)}.glb` : "model.glb";
        const rawName = deriveFilename(resolvedUrl, fallbackName);
        const hasExtension = /\.[a-z0-9]+$/i.test(rawName);
        const filename = hasExtension ? rawName : `${rawName}.glb`;
        const fileType = blob.type || "model/gltf-binary";
        const file = new File([blob], filename, { type: fileType });
        await handleFile(file);
        showSuccess("Модель подставлена для печати.");
      } catch (error) {
        prefillRef.current = false;
        showError("Не удалось загрузить модель для печати.");
      }
    };

    void loadPreset();
  }, [handleFile, searchParams, showError, showSuccess, isMobileUa]);

  const pushUploadLog = useCallback((message: string, data?: Record<string, unknown>) => {
    if (!uploadDebugEnabled) {
      return;
    }
    setUploadDebug((prev) => {
      const next = [...prev, buildUploadLogLine(message, data)];
      return next.slice(-10);
    });
    if (data) {
      console.info("[upload]", message, data);
      return;
    }
    console.info("[upload]", message);
  }, [uploadDebugEnabled]);

  const waitForRetryDelay = useCallback((delayMs: number) => {
    if (delayMs <= 0) {
      setUploadRetryInMs(null);
      return Promise.resolve();
    }
    clearRetryTimer();
    setUploadRetryInMs(delayMs);
    return new Promise<void>((resolve) => {
      const startedAt = Date.now();
      retryTimerRef.current = window.setInterval(() => {
        const remaining = Math.max(0, delayMs - (Date.now() - startedAt));
        setUploadRetryInMs(remaining);
        if (remaining <= 0) {
          if (retryTimerRef.current) {
            window.clearInterval(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          resolve();
        }
      }, 250);
    });
  }, [clearRetryTimer]);

  const startUpload = useCallback(async () => {
    if (!pendingFile || isUploadBusy) return;
    const file = pendingFile;
    setUploadError(null);
    setUploadProgress(0);
    setUploadSpeedBps(0);
    setUploadElapsedMs(0);
    setUploadEtaMs(null);
    setUploadStalled(false);
    setUploadDebug([]);
    clearRetryTimer();
    setUploadAttempt(1);
    uploadStartRef.current = Date.now();
    lastProgressRef.current = { time: uploadStartRef.current, loaded: 0 };
    lastLoggedPercentRef.current = -1;
    lastStallLoggedRef.current = false;
    stallAbortArmedRef.current = false;
    pushUploadLog("upload-start", { name: file.name, size: file.size, type: file.type });

    const uploadViaServer = async () => {
      pushUploadLog("upload-server-start");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/customer-upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        let errorMessage = "Server upload failed";
        try {
          const data = await response.json();
          errorMessage = data?.error || data?.message || errorMessage;
        } catch {
          const fallbackText = await response.text().catch(() => "");
          if (fallbackText) {
            errorMessage = fallbackText;
          }
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      if (!data?.doc?.id) {
        throw new Error("Server upload failed");
      }
      setUploadedMedia({
        id: String(data.doc.id),
        url: data.doc.url,
        filename: data.doc.filename,
      });
      setUploadStatus("ready");
      setPendingFile(null);
      clearRetryTimer();
      pushUploadLog("upload-server-done", { id: data.doc.id });
      showSuccess("Файл загружен через сервер.");
    };

    const existingUpload = await resolveExistingUpload(file);
    if (existingUpload?.id) {
      console.log("Using existing upload record:", {
        id: existingUpload.id,
        filename: existingUpload.filename,
        url: existingUpload.url,
      });
      setUploadedMedia({
        id: String(existingUpload.id),
        url: existingUpload.url,
        filename: existingUpload.filename,
      });
      setUploadProgress(100);
      setUploadStatus("ready");
      setPendingFile(null);
      pushUploadLog("upload-reused", { id: existingUpload.id });
      showSuccess("Файл уже загружен, используем сохраненную копию.");
      return;
    }

    const maxAttempts = UPLOAD_MAX_RETRIES + 1;
    const isRetryableError = (error: any) =>
      ["UPLOAD_TIMEOUT", "UPLOAD_NETWORK", "UPLOAD_ABORT"].includes(error?.code);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      setUploadAttempt(attempt);
      setUploadStatus("uploading");
      setUploadProgress(0);
      setUploadSpeedBps(0);
      setUploadElapsedMs(0);
      setUploadEtaMs(null);
      setUploadStalled(false);
      uploadStartRef.current = Date.now();
      lastProgressRef.current = { time: uploadStartRef.current, loaded: 0 };
      lastLoggedPercentRef.current = -1;
      lastStallLoggedRef.current = false;
      stallAbortArmedRef.current = false;

      const uploadStartedAt = Date.now();
      const uploadMeta = { name: file.name, type: file.type, size: file.size };
      let phase: "upload" | "finalize" = "upload";

      if (attempt > 1) {
        pushUploadLog("upload-retry", { attempt, maxAttempts });
      }

      try {
        const ua =
          typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
        const isMobileRuntime = isMobileUa || /android|iphone|ipad|ipod|iemobile|mobile/i.test(ua);
        if (isMobileRuntime) {
          setUploadStatus("finalizing");
          await uploadViaServer();
          return;
        }
        console.log("Uploading file via presigned URL:", uploadMeta);
        pushUploadLog("presign-request");

        const presignController = new AbortController();
        const presignTimeout = window.setTimeout(
          () => presignController.abort(),
          PRESIGN_TIMEOUT_MS
        );
        let presignResponse: Response;
        try {
          presignResponse = await fetch("/api/customer-upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            }),
            signal: presignController.signal,
          });
        } finally {
          window.clearTimeout(presignTimeout);
        }
        console.log("Presign response status:", presignResponse.status);
        pushUploadLog("presign-response", { status: presignResponse.status });

        if (!presignResponse.ok) {
          let errorMessage = "Failed to start upload";
          try {
            const errorData = await presignResponse.json();
            errorMessage = errorData?.error || errorData?.message || errorMessage;
            console.warn("Presign error response:", errorData);
          } catch {
            const fallbackText = await presignResponse.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
            console.warn("Presign error response (text):", fallbackText);
          }
          throw new Error(errorMessage);
        }

        const presignData = await presignResponse.json();
        if (!presignData?.uploadUrl || !presignData?.key) {
          throw new Error("Presign response missing upload data");
        }
        try {
          const parsed = new URL(presignData.uploadUrl);
          pushUploadLog("upload-target", { host: parsed.host, path: parsed.pathname });
        } catch {
          pushUploadLog("upload-target", { host: "unknown" });
        }

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          uploadXhrRef.current = xhr;
          const buildXhrError = (label: string, code?: string) => {
            const responseText =
              typeof xhr.responseText === "string" ? xhr.responseText.slice(0, 800) : "";
            const error = new Error(`${label} (status ${xhr.status || 0})`);
            (error as any).code = code;
            (error as any).details = {
              status: xhr.status,
              statusText: xhr.statusText,
              readyState: xhr.readyState,
              responseText,
            };
            return error;
          };

          xhr.open("PUT", presignData.uploadUrl, true);
          xhr.timeout = UPLOAD_TIMEOUT_MS;
          xhr.setRequestHeader(
            "Content-Type",
            presignData.contentType || "application/octet-stream"
          );
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              const now = Date.now();
              const elapsedMs = uploadStartRef.current ? now - uploadStartRef.current : 0;
              const speedBps = elapsedMs > 0 ? event.loaded / (elapsedMs / 1000) : 0;
              const etaMs =
                speedBps > 0 && file.size > event.loaded
                  ? ((file.size - event.loaded) / speedBps) * 1000
                  : null;
              setUploadProgress(percent);
              setUploadSpeedBps(speedBps);
              setUploadElapsedMs(elapsedMs);
              setUploadEtaMs(etaMs);
              lastProgressRef.current = { time: now, loaded: event.loaded };
              if (percent >= lastLoggedPercentRef.current + 10 || percent === 100) {
                lastLoggedPercentRef.current = percent;
                pushUploadLog("upload-progress", {
                  percent,
                  loaded: event.loaded,
                  total: event.total,
                });
              }
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress(100);
              setUploadEtaMs(0);
              pushUploadLog("upload-complete", { status: xhr.status });
              resolve();
            } else {
              pushUploadLog("upload-failed", { status: xhr.status, statusText: xhr.statusText });
              reject(buildXhrError("Upload failed", "UPLOAD_FAILED"));
            }
          };
          xhr.onerror = () => {
            pushUploadLog("upload-network-error", { status: xhr.status, statusText: xhr.statusText });
            reject(buildXhrError("Upload network error", "UPLOAD_NETWORK"));
          };
          xhr.onabort = () => {
            pushUploadLog("upload-abort", { status: xhr.status, statusText: xhr.statusText });
            reject(buildXhrError("Upload aborted", "UPLOAD_ABORT"));
          };
          xhr.ontimeout = () => {
            pushUploadLog("upload-timeout", { status: xhr.status });
            reject(buildXhrError("Upload timed out", "UPLOAD_TIMEOUT"));
          };
          xhr.send(file);
        });

        setUploadStatus("finalizing");
        phase = "finalize";
        pushUploadLog("complete-request");

        const completeController = new AbortController();
        const completeTimeout = window.setTimeout(
          () => completeController.abort(),
          COMPLETE_TIMEOUT_MS
        );
        let completeResponse: Response;
        try {
          completeResponse = await fetch("/api/customer-upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: presignData.key,
              fileUrl: presignData.fileUrl,
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            }),
            signal: completeController.signal,
          });
        } finally {
          window.clearTimeout(completeTimeout);
        }

        if (!completeResponse.ok) {
          let errorMessage = "Failed to finalize upload";
          try {
            const errorData = await completeResponse.json();
            errorMessage = errorData?.error || errorData?.message || errorMessage;
            console.warn("Complete error response:", errorData);
          } catch {
            const fallbackText = await completeResponse.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
            console.warn("Complete error response (text):", fallbackText);
          }
          throw new Error(errorMessage);
        }

        const completeData = await completeResponse.json();
        pushUploadLog("complete-response", {
          status: completeResponse.status,
          id: completeData?.doc?.id,
        });
        console.log("Upload success payload:", completeData, {
          ms: Date.now() - uploadStartedAt,
        });
        if (!completeData?.doc?.id) {
          throw new Error("Upload failed");
        }

        setUploadedMedia({
          id: String(completeData.doc.id),
          url: completeData.doc.url,
          filename: completeData.doc.filename,
        });
        setUploadStatus("ready");
        setPendingFile(null);
        clearRetryTimer();
        pushUploadLog("upload-done", { ms: Date.now() - uploadStartedAt });
        return;
      } catch (error) {
        uploadXhrRef.current = null;
        let errorCode = (error as any)?.code;
        if ((error as any)?.name === "AbortError") {
          console.warn("Upload aborted (timeout)", {
            ...uploadMeta,
            ms: Date.now() - uploadStartedAt,
            phase,
          });
          if (phase === "finalize") {
            const existing = await resolveExistingUpload(file);
            if (existing?.id) {
              setUploadedMedia({
                id: String(existing.id),
                url: existing.url,
                filename: existing.filename,
              });
              setUploadStatus("ready");
              setPendingFile(null);
              clearRetryTimer();
              return;
            }
          }
          errorCode = "UPLOAD_ABORT";
        }

        const isRetryable = isRetryableError({ code: errorCode });
        const isLastAttempt = attempt >= maxAttempts;

        if (phase === "upload" && ["UPLOAD_NETWORK", "UPLOAD_FAILED"].includes(errorCode)) {
          try {
            setUploadStatus("finalizing");
            await uploadViaServer();
            return;
          } catch (fallbackError) {
            console.error("Server upload fallback failed", fallbackError);
          }
        }

        if (isRetryable && !isLastAttempt) {
          const delayMs = Math.min(
            UPLOAD_RETRY_MAX_MS,
            UPLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1)
          );
          pushUploadLog("upload-retry-wait", { attempt, delayMs });
          lastProgressRef.current = null;
          setUploadStalled(false);
          await waitForRetryDelay(delayMs);
          continue;
        }

        clearRetryTimer();
        if (errorCode === "UPLOAD_ABORT") {
          setUploadError(
            phase === "finalize"
              ? "Сохранение в базе заняло слишком много времени. Попробуйте обновить страницу."
              : "Загрузка заняла слишком много времени. Попробуйте снова."
          );
          setUploadStatus("pending");
          return;
        }
        if (errorCode === "UPLOAD_TIMEOUT") {
          setUploadError("Загрузка заняла слишком много времени. Попробуйте снова.");
          setUploadProgress(0);
          setUploadStatus("pending");
          return;
        }
        if (errorCode === "UPLOAD_NETWORK") {
          setUploadError(
            "Проблема с сетью при загрузке. Проверьте подключение и попробуйте снова."
          );
          setUploadProgress(0);
          setUploadStatus("pending");
          return;
        }
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Не удалось загрузить файл в систему.";
        const errorInfo =
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                details: (error as any)?.details,
              }
            : { error };
        console.error("Upload failed", {
          name: file.name,
          size: file.size,
          type: file.type,
          ms: Date.now() - uploadStartedAt,
          ...errorInfo,
        });
        setUploadError(message);
        setUploadStatus("pending");
        return;
      } finally {
        uploadXhrRef.current = null;
      }
    }
  }, [
    pendingFile,
    isUploadBusy,
    resolveExistingUpload,
    showSuccess,
    clearRetryTimer,
    waitForRetryDelay,
    pushUploadLog,
    isMobileUa,
  ]);

  useEffect(() => {
    if (!modelObject) {
      return;
    }
    applyPreviewMaterial(modelObject, previewMode, previewMaterials);
  }, [modelObject, previewMaterials, previewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.location.search.includes("uploadDebug=1")) {
      setUploadDebugEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (uploadStatus !== "uploading") {
      setUploadStalled(false);
      clearRetryTimer();
      stallAbortArmedRef.current = false;
      return;
    }
    const interval = window.setInterval(() => {
      if (uploadStartRef.current) {
        setUploadElapsedMs(Date.now() - uploadStartRef.current);
      }
      const last = lastProgressRef.current;
      if (last && Date.now() - last.time > STALLED_TIMEOUT_MS) {
        setUploadStalled(true);
        if (!lastStallLoggedRef.current) {
          lastStallLoggedRef.current = true;
          if (uploadDebugEnabled) {
            setUploadDebug((prev) =>
              [...prev, buildUploadLogLine("upload-stalled")].slice(-10)
            );
            console.info("[upload]", "upload-stalled");
          }
        }
        if (
          uploadXhrRef.current &&
          !stallAbortArmedRef.current &&
          Date.now() - last.time > STALL_ABORT_MS
        ) {
          stallAbortArmedRef.current = true;
          uploadXhrRef.current.abort();
        }
      } else {
        setUploadStalled(false);
        lastStallLoggedRef.current = false;
        stallAbortArmedRef.current = false;
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [uploadStatus, uploadDebugEnabled, clearRetryTimer]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile]
  );

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
    event.currentTarget.value = "";
  };

  const buildCartItem = () => ({
    id: `custom-print:${uploadedMedia?.id ?? "pending"}`,
    productId: serviceProductId ?? "",
    name: "Печать на заказ",
    formatKey: "physical" as const,
    formatLabel: "Печатная модель",
    priceLabel: `${formatPrice(price)} ₽`,
    priceValue: Math.round(price),
    quantity: 1,
    thumbnailUrl: buildCartThumbnail("Печать"),
    customPrint: {
      uploadId: uploadedMedia?.id ?? "",
      uploadUrl: uploadedMedia?.url,
      uploadName: uploadedMedia?.filename,
      technology: technology === "sla" ? "SLA Resin" : "FDM Plastic",
      material,
      quality: quality === "pro" ? "0.05mm" : "0.1mm",
      dimensions: metrics?.size,
      volumeCm3: metrics?.volumeCm3,
    },
  });

  const persistPendingCart = (item: ReturnType<typeof buildCartItem>) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PENDING_CART_KEY, JSON.stringify(item));
  };

  const consumePendingCart = () => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(PENDING_CART_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      window.localStorage.removeItem(PENDING_CART_KEY);
      return parsed;
    } catch {
      window.localStorage.removeItem(PENDING_CART_KEY);
      return null;
    }
  };

  const commitCartItem = (cartItem: ReturnType<typeof buildCartItem>) => {
    try {
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem("store3d_cart") : null;
      const parsed = stored ? JSON.parse(stored) : [];
      const items = Array.isArray(parsed) ? parsed : [];
      const existingIndex = items.findIndex((item: any) => item.id === cartItem.id);
      if (existingIndex >= 0) {
        items[existingIndex] = cartItem;
      } else {
        items.push(cartItem);
      }
      window.localStorage.setItem("store3d_cart", JSON.stringify(items));
      window.dispatchEvent(new CustomEvent("cart-updated"));
      return true;
    } catch {
      return false;
    }
  };

  const handleAddToCart = async () => {
    if (isUploadBusy) {
      showError(
        uploadStatus === "analyzing"
          ? "Дождитесь завершения анализа модели."
          : "Дождитесь завершения загрузки модели."
      );
      return;
    }

    if (!uploadedMedia?.id || !metrics) {
      showError(
        uploadStatus === "pending"
          ? "Нажмите «Загрузить», чтобы отправить модель."
          : "Загрузите файл и дождитесь анализа."
      );
      return;
    }

    if (!serviceProductId) {
      showError("Сервисный продукт пока недоступен. Обновите страницу через пару секунд.");
      return;
    }

    const cartItem = buildCartItem();

    if (!isLoggedIn) {
      persistPendingCart(cartItem);
      const success = commitCartItem(cartItem);
      if (success) {
        showSuccess("Файл добавлен в корзину. Войдите, чтобы оформить заказ.");
      } else {
        showError("Не удалось обновить корзину.");
      }
      setAuthModalOpen(true);
      return;
    }

    setIsAdding(true);
    const success = commitCartItem(cartItem);
    if (success) {
      showSuccess("Файл добавлен в корзину.");
    } else {
      showError("Не удалось обновить корзину.");
    }
    setIsAdding(false);
  };

  const handleAuthSuccess = () => {
    setIsLoggedIn(true);
    setAuthModalOpen(false);
    const pending = consumePendingCart();
    if (pending) {
      const success = commitCartItem(pending);
      if (success) {
        toast.success("Заявка сохранена в корзине", {
          className: "sonner-toast",
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center page-bg-fade"
        style={{
          backgroundImage: `url(${PRINT_BG_IMAGE})`,
          filter: "blur(8px) brightness(0.5) saturate(1.05)",
          transform: "scale(1.05)",
        }}
      />
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.22),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur">
          <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
            <button
              type="button"
              aria-label="Close auth modal"
              className="absolute right-4 top-4 text-white/60 transition hover:text-white"
              onClick={() => setAuthModalOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            <AuthForm onSuccess={handleAuthSuccess} redirectOnSuccess={false} />
          </div>
        </div>
      )}

      <header className="relative z-10 border-b border-white/10 bg-[#050505]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <div>
            <Link href="/store" className="text-2xl font-bold tracking-[0.2em] text-white">
              3D-STORE
            </Link>
            <p className="mt-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              Print Terminal
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/store"
              className="rounded-full border border-white/10 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:text-white"
            >
              В магазин
            </Link>
            <Link
              href="/checkout"
              className="flex items-center gap-2 rounded-full border border-[#2ED1FF]/50 bg-[#2ED1FF]/10 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] transition hover:border-[#7FE7FF]"
            >
              <ShoppingCart className="h-4 w-4" />
              Корзина
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pb-24 pt-4 sm:px-6 sm:pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              CAD PRINT SERVICE
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Печать на заказ</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] uppercase tracking-[0.25em] text-white/55">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
            SYSTEM ONLINE
          </div>
        </div>

        <div className="mt-4 grid gap-6 sm:mt-10 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section
            className="relative min-h-[520px] overflow-hidden"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="relative h-full">
              <PrintScene model={modelObject} />
            </div>

            {!modelObject && (
              <div
                className={`pointer-events-none absolute inset-6 flex items-center justify-center rounded-[28px] border border-dashed text-center text-xs uppercase tracking-[0.3em] shadow-[inset_0_0_40px_rgba(46,209,255,0.08)] ${
                  dragActive
                    ? "border-[#2ED1FF] bg-[#2ED1FF]/10 text-[#BFF4FF]"
                    : "border-white/15 bg-[radial-gradient(circle_at_center,rgba(46,209,255,0.05),transparent_55%)] text-white/50"
                }`}
              >
                <div className="max-w-sm space-y-4">
                  <UploadCloud className="mx-auto h-10 w-10 text-[#2ED1FF]" />
                  <div className="space-y-2">
                    <p>Бросьте STL или OBJ</p>
                    <p className="text-[10px] tracking-[0.25em] text-white/40">
                      ПОДДЕРЖИВАЕМЫЕ ФОРМАТЫ: .STL, .OBJ (MAX 100MB)
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-[9px] tracking-[0.2em] text-white/45">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      .STL
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      .OBJ
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      .GLB
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-[#2ED1FF]/50 bg-[#050505]/80 px-3 py-1 text-[8px] uppercase tracking-[0.3em] text-[#BFF4FF] backdrop-blur-sm transition hover:border-[#7FE7FF] sm:px-5 sm:py-2 sm:text-[10px]"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud className="h-4 w-4" />
                {modelObject ? "Заменить файл" : "Выбрать файл"}
              </button>
              {canStartUpload && (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border border-[#2ED1FF]/70 bg-[#0b1014] px-3 py-1 text-[8px] uppercase tracking-[0.3em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white sm:px-5 sm:py-2 sm:text-[10px]"
                  onClick={startUpload}
                >
                  <UploadCloud className="h-4 w-4" />
                  Загрузить модель
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".stl,.obj,.glb,.gltf,application/sla,model/stl,model/gltf-binary,text/plain"
              className="hidden"
              onChange={handleFilePick}
            />

            {(uploadError ||
              uploadStatus === "uploading" ||
              uploadStatus === "analyzing" ||
              uploadStatus === "finalizing" ||
              uploadStatus === "pending") && (
              <div className="absolute left-6 top-6 flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 backdrop-blur">
                {uploadError ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span>{uploadError}</span>
                  </>
                ) : uploadStatus === "analyzing" ? (
                  <span>АНАЛИЗ МОДЕЛИ...</span>
                ) : uploadStatus === "pending" ? (
                  <span>ГОТОВ К ЗАГРУЗКЕ</span>
                ) : uploadStatus === "finalizing" ? (
                  <span>СОХРАНЯЕМ В БАЗЕ...</span>
                ) : (
                  <div className="flex flex-col">
                    <span>ЗАГРУЗКА В ХРАНИЛИЩЕ... {buildProgressBar(uploadProgress)}</span>
                    <span className="mt-1 text-[9px] tracking-[0.25em] text-white/40">
                      {uploadRetryInMs && uploadRetryInMs > 0
                        ? `ПОВТОР ЧЕРЕЗ ${formatDuration(uploadRetryInMs)}`
                        : `${formatSpeed(uploadSpeedBps)} / ${formatDuration(uploadElapsedMs)}`}
                      {!uploadRetryInMs && uploadEtaMs && uploadEtaMs > 0
                        ? ` / ETA ${formatDuration(uploadEtaMs)}`
                        : ""}
                      {uploadAttempt > 1 ? ` / ПОПЫТКА ${uploadAttempt}/${UPLOAD_MAX_RETRIES + 1}` : ""}
                      {uploadStalled ? " / НЕТ ПРОГРЕССА" : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
            {uploadStatus === "ready" && uploadedMedia?.id && (
              <div className="absolute left-6 top-6 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-emerald-200">
                ЗАГРУЗКА ЗАВЕРШЕНА
              </div>
            )}
            {uploadDebugEnabled && uploadDebug.length > 0 && (
              <div className="pointer-events-none absolute left-6 top-20 max-w-[320px] rounded-2xl border border-white/10 bg-black/70 px-3 py-2 text-[9px] uppercase tracking-[0.2em] text-white/60 backdrop-blur">
                <div className="space-y-1">
                  {uploadDebug.map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))}
                </div>
              </div>
            )}
            {isPreviewScaled && (
              <div className="absolute right-6 top-6 rounded-full border border-[#2ED1FF]/40 bg-[#0b1014]/80 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF]">
                ПРЕДПРОСМОТР МАСШТАБИРОВАН
              </div>
            )}
          </section>

          <aside
            id="print-settings"
            className="space-y-5 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl"
          >
            <div className="space-y-3">
              <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                Технические данные
              </p>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/60">
                  <span>X</span>
                  <span>{metrics ? `${formatNumber(metrics.size.x)} мм` : "--"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/60">
                  <span>Y</span>
                  <span>{metrics ? `${formatNumber(metrics.size.y)} мм` : "--"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/60">
                  <span>Z</span>
                  <span>{metrics ? `${formatNumber(metrics.size.z)} мм` : "--"}</span>
                </div>
                <div className="mt-3 border-t border-white/10 pt-3 text-xs uppercase tracking-[0.2em] text-white/60">
                  <div className="flex items-center justify-between">
                    <span>Volume</span>
                    <span>{metrics ? `${formatNumber(metrics.volumeCm3)} см3` : "--"}</span>
                  </div>
                </div>
                {!fitsBed && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-red-200">
                    Модель больше 200mm
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                  Технология
                </p>
                <div className="grid grid-cols-2 gap-2 rounded-full bg-white/5 p-1">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] ${
                      technology === "sla"
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white"
                    }`}
                    onClick={() => setTechnology("sla")}
                  >
                    SLA Resin
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] ${
                      technology === "fdm"
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white"
                    }`}
                    onClick={() => setTechnology("fdm")}
                  >
                    FDM Plastic
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                  Режим
                </p>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/60">
                  <span>Авто</span>
                  <button
                    type="button"
                    className={`flex h-7 w-12 items-center rounded-full border border-white/20 p-1 transition ${
                      previewModeAuto ? "bg-[#2ED1FF]/40" : "bg-white/5"
                    }`}
                    onClick={() => setPreviewModeAuto((prev) => !prev)}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-[#2ED1FF] transition ${
                        previewModeAuto ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <span>Ручной</span>
                </div>
                <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                  Визуализация
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "hologram" as const, label: "Голограмма" },
                    { key: "resin" as const, label: "Смола" },
                    { key: "plastic" as const, label: "Пластик" },
                    { key: "original" as const, label: "Оригинал" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`rounded-2xl border px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                        previewMode === option.key
                          ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => {
                        setPreviewModeAuto(false);
                        setPreviewMode(option.key);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="space-y-2">
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                  Материал
                </p>
                <p className="text-xs text-white/50">{materialHint}</p>
                <div className="space-y-2">
                  {materialsByTech[technology].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-xs uppercase tracking-[0.2em] transition ${
                        material === option.label
                          ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => setMaterial(option.label)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-px bg-white/10" />
              <div className="space-y-2">
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                  Качество
                </p>
                <p className="text-xs text-white/50">{qualityHint}</p>
                <div className="space-y-2">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-xs uppercase tracking-[0.2em] transition ${
                        quality === option.key
                          ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => setQuality(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[24px] border border-[#D4AF37]/40 bg-[#0c0b05] p-5">
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#D4AF37]/80">
                  Итоговая цена
                </p>
                <p className="mt-3 text-3xl font-semibold text-[#D4AF37]">
                {formatPrice(price)} ₽
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[#D4AF37]/60">
                  BASE {BASE_FEE} + ОПЦИИ
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                disabled={isAdding}
                aria-disabled={!canAddToCart || isAdding}
                className={`w-full rounded-full bg-[#D4AF37] px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition ${
                  canAddToCart ? "hover:bg-[#f5d57a]" : ""
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isAdding ? "Добавляем..." : "ДОБАВИТЬ В КОРЗИНУ"}
              </button>
              {!serviceProductId && (
                <p className="text-xs text-white/50">
                  Подключаем сервисный продукт. Обновите страницу через пару секунд.
                </p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default function PrintServicePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050505] text-white">
          <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
        </div>
      }
    >
      <PrintServiceContent />
    </Suspense>
  );
}










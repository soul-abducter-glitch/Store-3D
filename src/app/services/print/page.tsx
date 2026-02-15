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
  type MutableRefObject,
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
import {
  UploadCloud,
  AlertTriangle,
  ShoppingCart,
  X,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { getCartStorageKey, readCartStorage, writeCartStorage } from "@/lib/cartStorage";
import { computePrintPrice } from "@/lib/printPricing";
import { evaluateStlPreflight } from "@/lib/stlPreflight";

import { ToastContainer, useToast } from "@/components/Toast";
import AuthForm from "@/components/AuthForm";
import { toast } from "sonner";

type TechMode = "sla" | "fdm";
type QualityKey = "pro" | "standard";
type PreviewMode = "hologram" | "resin" | "plastic" | "original";
type PrintOrientationKey = "upright" | "side_x" | "side_y";

type ModelMetrics = {
  size: { x: number; y: number; z: number };
  volumeCm3: number;
  volumeMethod: "mesh" | "fallback";
};

type OrientationAdvisorItem = {
  key: PrintOrientationKey;
  label: string;
  note: string;
  size: { x: number; y: number; z: number };
  fitsBed: boolean;
  riskStatus: "ok" | "risk" | "critical";
  riskScore: number;
  etaMinutes: number;
};

type OrientationPresetEstimate = {
  key: PrintOrientationKey;
  label: string;
  note: string;
  reason: string;
  fitsBed: boolean;
  riskStatus: "ok" | "risk" | "critical";
  riskScore: number;
  etaMinutes: number;
  size: { x: number; y: number; z: number };
  volumeCm3: number;
  materialUsageCm3: number;
  estimatedPrice: number;
};

const BED_SIZE = 200;
const BASE_FEE = 300;
const DEFAULT_PRINT_HEIGHT_MM = 120;
const MIN_PRINT_HEIGHT_MM = 20;
const MAX_PRINT_HEIGHT_MM = 280;
const DEFAULT_FDM_INFILL_PERCENT = 20;
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
const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
const PRINT_BG_IMAGE = "/backgrounds/Industrial%20Power.png";
const PUBLIC_MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");
const SMART_PRICING_ENABLED =
  (process.env.NEXT_PUBLIC_PRINT_SMART_ENABLED || "true").trim().toLowerCase() !== "false";
const SMART_QUEUE_MULTIPLIER = (() => {
  const parsed = Number.parseFloat(
    (process.env.NEXT_PUBLIC_PRINT_QUEUE_MULTIPLIER || "1").trim()
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.max(parsed, 1), 2);
})();

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

const toPrinterAxes = (size: { x: number; y: number; z: number }) => ({
  // three.js scene uses Y-up; printer convention is Z-up.
  x: size.x,
  y: size.z,
  z: size.y,
});

const ORIENTATION_OPTIONS: Array<{
  key: PrintOrientationKey;
  label: string;
  note: string;
}> = [
  { key: "upright", label: "Вертикально", note: "Базовая ориентация" },
  { key: "side_x", label: "На бок X", note: "Меньше высота, больше основание" },
  { key: "side_y", label: "На бок Y", note: "Баланс по времени/устойчивости" },
];

const orientPrinterDimensions = (
  base: { x: number; y: number; z: number },
  orientation: PrintOrientationKey
) => {
  if (orientation === "side_x") {
    return { x: base.y, y: base.z, z: base.x };
  }
  if (orientation === "side_y") {
    return { x: base.x, y: base.z, z: base.y };
  }
  return { x: base.x, y: base.y, z: base.z };
};

const evaluateOrientationAdvisor = (size: { x: number; y: number; z: number }): Omit<
  OrientationAdvisorItem,
  "key" | "label" | "note"
> => {
  const x = Math.max(0, size.x);
  const y = Math.max(0, size.y);
  const z = Math.max(0, size.z);
  const fitsBed = x <= BED_SIZE && y <= BED_SIZE && z <= BED_SIZE;
  if (!fitsBed) {
    return {
      size,
      fitsBed,
      riskStatus: "critical",
      riskScore: 100,
      etaMinutes: Math.max(20, Math.round(z * 0.6 + 25)),
    };
  }

  const baseAreaRatio = Math.min(1.4, (x * y) / (BED_SIZE * BED_SIZE));
  const slenderness = z / Math.max(1, Math.max(x, y));
  const edgePenalty = Math.max(x, y) > BED_SIZE * 0.92 ? 8 : 0;
  const riskScore = Math.round(
    Math.min(99, Math.max(0, baseAreaRatio * 48 + slenderness * 36 + edgePenalty))
  );
  const riskStatus: "ok" | "risk" = riskScore >= 65 ? "risk" : "ok";
  const etaMinutes = Math.max(
    20,
    Math.round(18 + z * 0.58 + baseAreaRatio * 95 + (riskStatus === "risk" ? 10 : 0))
  );

  return {
    size,
    fitsBed,
    riskStatus,
    riskScore,
    etaMinutes,
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveMaterialUsageFactor = (
  tech: TechMode,
  isHollow: boolean,
  infill: number
) => {
  if (tech === "sla") {
    return isHollow ? 0.28 : 1;
  }
  const normalizedInfill = clamp(Number.isFinite(infill) ? infill : DEFAULT_FDM_INFILL_PERCENT, 8, 100) / 100;
  return clamp(0.12 + normalizedInfill * 0.88, 0.12, 1);
};

const orientationRiskLabel = (status: OrientationAdvisorItem["riskStatus"]) => {
  if (status === "critical") return "критический";
  if (status === "risk") return "средний";
  return "низкий";
};

const buildProxyUrlFromSource = (value: string) => {
  const normalized = value.split("?")[0] ?? value;
  if (PUBLIC_MEDIA_BASE_URL && normalized.toLowerCase().startsWith(PUBLIC_MEDIA_BASE_URL.toLowerCase())) {
    return null;
  }
  const clean = normalized.replace(/\\/g, "/");
  const lower = clean.toLowerCase();
  const marker = "/media/";
  const idx = lower.indexOf(marker);
  if (idx >= 0) {
    const key = clean.slice(idx + 1);
    return key ? `/api/media-file/${encodeURIComponent(key)}` : null;
  }
  return null;
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

const clonePreviewMaterial = (
  base: MeshStandardMaterial,
  source?: MeshStandardMaterial | null
) => {
  const next = base.clone();
  if (!source) {
    return next;
  }
  if (source.normalMap) {
    next.normalMap = source.normalMap;
    next.normalScale = source.normalScale?.clone?.() ?? source.normalScale;
  }
  if (source.bumpMap) {
    next.bumpMap = source.bumpMap;
    next.bumpScale = source.bumpScale ?? 1;
  }
  if (source.aoMap) {
    next.aoMap = source.aoMap;
    next.aoMapIntensity = source.aoMapIntensity ?? 1;
  }
  if (source.roughnessMap) {
    next.roughnessMap = source.roughnessMap;
  }
  if (source.metalnessMap) {
    next.metalnessMap = source.metalnessMap;
  }
  if (source.displacementMap) {
    next.displacementMap = source.displacementMap;
    next.displacementScale = source.displacementScale ?? 1;
    next.displacementBias = source.displacementBias ?? 0;
  }
  return next;
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

    const originalMaterial = child.userData.originalMaterial ?? child.material;

    if (mode === "original") {
      if (originalMaterial) {
        child.material = originalMaterial;
        return;
      }
      child.material = materials.resin;
      return;
    }

    const cache = (child.userData.previewMaterials ?? {}) as Record<
      PreviewMode,
      MeshStandardMaterial | MeshStandardMaterial[] | undefined
    >;

    if (!cache[mode]) {
      const base =
        mode === "resin"
          ? materials.resin
          : mode === "plastic"
            ? materials.plastic
            : materials.hologram;

      if (Array.isArray(originalMaterial)) {
        cache[mode] = originalMaterial.map((material) =>
          clonePreviewMaterial(
            base,
            material instanceof MeshStandardMaterial ? material : null
          )
        );
      } else if (mode === "resin" || mode === "plastic") {
        cache[mode] = clonePreviewMaterial(
          base,
          originalMaterial instanceof MeshStandardMaterial ? originalMaterial : null
        );
      } else {
        cache[mode] = base;
      }

      child.userData.previewMaterials = cache;
    }

    child.material = cache[mode] ?? materials.resin;
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
  let volumeMethod: "mesh" | "fallback" = "mesh";
  const maxAllowedMeshVolume =
    boundsVolumeCm3 > 0 ? boundsVolumeCm3 * 1.15 : Number.POSITIVE_INFINITY;
  if (
    !Number.isFinite(volumeCm3) ||
    volumeCm3 <= 0 ||
    volumeCm3 > maxAllowedMeshVolume
  ) {
    // Mesh volume can explode for non-manifold/open meshes; use conservative occupancy.
    volumeCm3 = boundsVolumeCm3 > 0 ? boundsVolumeCm3 * 0.32 : 0;
    volumeMethod = "fallback";
  }

  return {
    size: sizeMm,
    volumeCm3,
    volumeMethod,
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

const PrintScene = ({
  model,
  controlsRef,
}: {
  model: Object3D | null;
  controlsRef: MutableRefObject<any | null>;
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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

  const enableShadows = !isMobile;

  const stopPropagation = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handlePointerDown = (event: { stopPropagation: () => void }) => {
    stopPropagation(event);
    setIsDragging(true);
  };

  const handlePointerUp = (event: { stopPropagation: () => void }) => {
    stopPropagation(event);
    setIsDragging(false);
  };

  return (
    <Canvas
      shadows={enableShadows}
      gl={{ alpha: true, antialias: !isMobile }}
      camera={{ position: [280, 170, 340], fov: 40, near: 1, far: 2000 }}
      dpr={isMobile ? 1 : [1, 1.5]}
      className="h-full w-full bg-transparent"
      style={{
        touchAction: isMobile ? "none" : "none",
        pointerEvents: "auto",
        cursor: isMobile ? "default" : isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={stopPropagation}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={stopPropagation}
    >
      <ambientLight intensity={isMobile ? 0.85 : 0.7} />
      <directionalLight
        position={[180, 240, 120]}
        intensity={isMobile ? 1.1 : 1.4}
        castShadow={enableShadows}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-near={10}
        shadow-camera-far={800}
        shadow-camera-left={-220}
        shadow-camera-right={220}
        shadow-camera-top={220}
        shadow-camera-bottom={-220}
        shadow-bias={-0.0003}
      />
      <directionalLight position={[-120, 160, -80]} intensity={isMobile ? 0.6 : 0.8} />
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
        enabled
        enablePan={false}
        enableZoom={!isMobile}
        minDistance={140}
        maxDistance={520}
        dampingFactor={0.08}
        enableDamping
        target={[0, 80, 0]}
        ref={controlsRef}
      />
    </Canvas>
  );
};

function PrintServiceContent() {
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<any | null>(null);
  const prefillRef = useRef(false);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceThumb, setSourceThumb] = useState<string | null>(null);
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
  const [targetHeightMm, setTargetHeightMm] = useState(DEFAULT_PRINT_HEIGHT_MM);
  const [printOrientation, setPrintOrientation] = useState<PrintOrientationKey>("upright");
  const [orientationTouched, setOrientationTouched] = useState(false);
  const [showOrientationDetails, setShowOrientationDetails] = useState(false);
  const [isHollowModel, setIsHollowModel] = useState(true);
  const [infillPercent, setInfillPercent] = useState(DEFAULT_FDM_INFILL_PERCENT);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadStartRef = useRef<number | null>(null);
  const lastProgressRef = useRef<{ time: number; loaded: number } | null>(null);
  const lastLoggedPercentRef = useRef<number>(-1);
  const lastStallLoggedRef = useRef(false);
  const stallAbortArmedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const defaultSettingsRef = useRef<{
    technology: TechMode;
    material: string;
    quality: QualityKey;
  }>({
    technology: "sla",
    material: materialsByTech.sla[0].label,
    quality: "standard",
  });
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
  const [settingsAuto, setSettingsAuto] = useState(true);
  const [previewScale, setPreviewScale] = useState(1);
  const [serviceProductId, setServiceProductId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [technologyLocked, setTechnologyLocked] = useState(false);
  const apiBase = "";
  const cartStorageKey = useMemo(
    () => getCartStorageKey(isLoggedIn ? userId : null),
    [isLoggedIn, userId]
  );
  const isUploadBusy =
    uploadStatus === "uploading" || uploadStatus === "analyzing" || uploadStatus === "finalizing";
  const canStartUpload = Boolean(pendingFile) && uploadStatus === "pending";

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

  const fetchMediaById = async (id: string) => {
    if (!id) return null;
    try {
      const response = await fetch(`${apiBase}/api/media/${id}?depth=0`, {
        credentials: "include",
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
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

  const applyDefaultSettings = useCallback(() => {
    const defaults = defaultSettingsRef.current;
    setTechnology(defaults.technology);
    setMaterial(defaults.material);
    setQuality(defaults.quality);
    setPreviewModeAuto(true);
  }, []);

  useEffect(() => {
    if (!modelObject) {
      return;
    }
    defaultSettingsRef.current = {
      technology,
      material,
      quality,
    };
    setSettingsAuto(true);
  }, [modelObject]);

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
        setUserId(user?.id ? String(user.id) : null);
      })
      .catch(() => {
        setIsLoggedIn(false);
        setUserId(null);
      });
  }, [apiBase]);

  const previewMaterials = useMemo(
    () => ({
      hologram: createGhostMaterial(),
      resin: createResinMaterial(),
      plastic: createPlasticMaterial(),
    }),
    []
  );

  const orientationAdvisor = useMemo(() => {
    if (!metrics) return null;
    const printerBase = toPrinterAxes(metrics.size);
    const items: OrientationAdvisorItem[] = ORIENTATION_OPTIONS.map((option) => {
      const oriented = orientPrinterDimensions(printerBase, option.key);
      const evaluated = evaluateOrientationAdvisor(oriented);
      return {
        key: option.key,
        label: option.label,
        note: option.note,
        ...evaluated,
      };
    });

    const fittingSorted = items
      .filter((item) => item.fitsBed)
      .sort(
        (a, b) =>
          a.riskScore - b.riskScore ||
          a.etaMinutes - b.etaMinutes ||
          a.size.z - b.size.z
      );
    const recommendedKey = fittingSorted[0]?.key || "upright";
    return {
      items,
      recommendedKey,
    };
  }, [metrics]);

  useEffect(() => {
    if (!orientationAdvisor || orientationTouched) return;
    setPrintOrientation(orientationAdvisor.recommendedKey);
  }, [orientationAdvisor, orientationTouched]);

  const orientedBaseDimensions = useMemo(() => {
    if (!metrics) return null;
    const printerBase = toPrinterAxes(metrics.size);
    return orientPrinterDimensions(printerBase, printOrientation);
  }, [metrics, printOrientation]);

  const maxHeightForBedMm = useMemo(() => {
    if (!orientedBaseDimensions) return MAX_PRINT_HEIGHT_MM;
    const sx = Math.max(orientedBaseDimensions.x, 1);
    const sy = Math.max(orientedBaseDimensions.y, 1);
    const sz = Math.max(orientedBaseDimensions.z, 1);
    const maxScale = Math.min(BED_SIZE / sx, BED_SIZE / sy, BED_SIZE / sz);
    if (!Number.isFinite(maxScale) || maxScale <= 0) {
      return MIN_PRINT_HEIGHT_MM;
    }
    const recommended = Math.floor(sz * maxScale);
    return Math.max(MIN_PRINT_HEIGHT_MM, Math.min(MAX_PRINT_HEIGHT_MM, recommended));
  }, [orientedBaseDimensions]);

  const heightInputMax = useMemo(() => {
    return Math.max(
      MIN_PRINT_HEIGHT_MM,
      Math.min(MAX_PRINT_HEIGHT_MM, maxHeightForBedMm)
    );
  }, [maxHeightForBedMm]);

  useEffect(() => {
    if (!orientedBaseDimensions) return;
    const measuredHeight = orientedBaseDimensions.z;
    const suggestedHeight =
      Number.isFinite(measuredHeight) &&
      measuredHeight >= MIN_PRINT_HEIGHT_MM &&
      measuredHeight <= MAX_PRINT_HEIGHT_MM
        ? Math.round(measuredHeight)
        : DEFAULT_PRINT_HEIGHT_MM;
    const next = Math.min(heightInputMax, suggestedHeight);
    setTargetHeightMm(Math.max(MIN_PRINT_HEIGHT_MM, next));
  }, [heightInputMax, orientedBaseDimensions]);

  useEffect(() => {
    setTargetHeightMm((prev) => Math.min(prev, heightInputMax));
  }, [heightInputMax]);

  const scaledMetrics = useMemo(() => {
    if (!metrics || !orientedBaseDimensions) return null;
    const baseHeight = Math.max(orientedBaseDimensions.z, 1);
    const safeTargetHeight = Math.min(
      heightInputMax,
      Math.max(MIN_PRINT_HEIGHT_MM, targetHeightMm)
    );
    const scale = safeTargetHeight / baseHeight;
    const size = {
      x: orientedBaseDimensions.x * scale,
      y: orientedBaseDimensions.y * scale,
      z: orientedBaseDimensions.z * scale,
    };
    const volumeCm3 = Math.max(0, metrics.volumeCm3 * Math.pow(scale, 3));
    return {
      size,
      volumeCm3,
      scale,
      safeTargetHeight,
    };
  }, [heightInputMax, metrics, orientedBaseDimensions, targetHeightMm]);

  const preflight = useMemo(
    () =>
      evaluateStlPreflight({
        dimensions: scaledMetrics?.size,
        volumeCm3: scaledMetrics?.volumeCm3,
        volumeMethod: metrics?.volumeMethod,
        bedSizeMm: { x: BED_SIZE, y: BED_SIZE, z: BED_SIZE },
      }),
    [metrics?.volumeMethod, scaledMetrics?.size, scaledMetrics?.volumeCm3]
  );

  const pricing = useMemo(
    () =>
      computePrintPrice({
        technology,
        material,
        quality,
        dimensions: scaledMetrics?.size,
        volumeCm3: scaledMetrics?.volumeCm3,
        isHollow: technology === "sla" ? isHollowModel : undefined,
        infillPercent: technology === "fdm" ? infillPercent : undefined,
        enableSmart: SMART_PRICING_ENABLED,
        queueMultiplier: SMART_QUEUE_MULTIPLIER,
      }),
    [
      infillPercent,
      isHollowModel,
      material,
      quality,
      technology,
      scaledMetrics?.size,
      scaledMetrics?.volumeCm3,
    ]
  );
  const orientationPresets = useMemo(() => {
    if (!metrics || !orientationAdvisor) return null;
    const printerBase = toPrinterAxes(metrics.size);
    const materialFactor = resolveMaterialUsageFactor(
      technology,
      isHollowModel,
      infillPercent
    );

    const presets: OrientationPresetEstimate[] = orientationAdvisor.items.map((item) => {
      const base = orientPrinterDimensions(printerBase, item.key);
      const maxScale = Math.min(
        BED_SIZE / Math.max(base.x, 1),
        BED_SIZE / Math.max(base.y, 1),
        BED_SIZE / Math.max(base.z, 1)
      );
      const maxAllowedHeight = clamp(Math.floor(base.z * maxScale), MIN_PRINT_HEIGHT_MM, MAX_PRINT_HEIGHT_MM);
      const targetHeight = clamp(targetHeightMm, MIN_PRINT_HEIGHT_MM, maxAllowedHeight);
      const scale = targetHeight / Math.max(base.z, 1);
      const size = {
        x: base.x * scale,
        y: base.y * scale,
        z: base.z * scale,
      };
      const volumeCm3 = Math.max(0, metrics.volumeCm3 * Math.pow(scale, 3));
      const materialUsageCm3 = Math.max(0, volumeCm3 * materialFactor);
      const estimatedPrice = computePrintPrice({
        technology,
        material,
        quality,
        dimensions: size,
        volumeCm3,
        isHollow: technology === "sla" ? isHollowModel : undefined,
        infillPercent: technology === "fdm" ? infillPercent : undefined,
        enableSmart: SMART_PRICING_ENABLED,
        queueMultiplier: SMART_QUEUE_MULTIPLIER,
      }).price;
      const etaMultiplier = quality === "pro" ? 1.2 : 1;
      const etaMinutes = Math.max(20, Math.round(item.etaMinutes * etaMultiplier));
      return {
        key: item.key,
        label: item.label,
        note: item.note,
        reason: "",
        fitsBed: item.fitsBed,
        riskStatus: item.riskStatus,
        riskScore: item.riskScore,
        etaMinutes,
        size,
        volumeCm3,
        materialUsageCm3,
        estimatedPrice,
      };
    });

    const riskWeight = (status: OrientationPresetEstimate["riskStatus"]) =>
      status === "critical" ? 3 : status === "risk" ? 2 : 1;

    const sorted = [...presets].sort(
      (a, b) =>
        riskWeight(a.riskStatus) - riskWeight(b.riskStatus) ||
        a.riskScore - b.riskScore ||
        a.etaMinutes - b.etaMinutes ||
        a.estimatedPrice - b.estimatedPrice
    );
    const recommended = sorted[0] || presets[0];

    const withReason = presets.map((preset) => {
      if (!recommended) return preset;
      if (preset.key === recommended.key) {
        return {
          ...preset,
          reason: `Лучший баланс: риск ${orientationRiskLabel(preset.riskStatus)}, ETA ~${preset.etaMinutes}м, цена ~${formatPrice(
            preset.estimatedPrice
          )} ₽.`,
        };
      }
      const faster = preset.etaMinutes < recommended.etaMinutes;
      const cheaper = preset.estimatedPrice < recommended.estimatedPrice;
      const reason = faster
        ? "Выбирайте, если приоритет - время печати."
        : cheaper
          ? "Выбирайте, если приоритет - бюджет."
          : "Альтернатива для другой геометрии опор.";
      return {
        ...preset,
        reason,
      };
    });

    return {
      items: withReason,
      recommendedKey: recommended?.key || "upright",
    };
  }, [
    infillPercent,
    isHollowModel,
    material,
    metrics,
    orientationAdvisor,
    quality,
    targetHeightMm,
    technology,
  ]);
  const price = pricing.price;
  const selectedOrientationPreset = useMemo(
    () => orientationPresets?.items.find((item) => item.key === printOrientation) || null,
    [orientationPresets, printOrientation]
  );

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
    if (!scaledMetrics) return true;
    return (
      scaledMetrics.size.x <= BED_SIZE &&
      scaledMetrics.size.y <= BED_SIZE &&
      scaledMetrics.size.z <= BED_SIZE
    );
  }, [scaledMetrics]);
  const canAddToCart =
    Boolean(uploadedMedia?.id) &&
    Boolean(scaledMetrics) &&
    fitsBed &&
    preflight.status !== "critical" &&
    Boolean(serviceProductId) &&
    uploadStatus === "ready";

  const isPreviewScaled = useMemo(
    () => Number.isFinite(previewScale) && Math.abs(previewScale - 1) > 0.01,
    [previewScale]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (isMobileUa) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDragActive(true);
    },
    [isMobileUa]
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (isMobileUa) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
    },
    [isMobileUa]
  );

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      const label = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
      if (label) {
        setSourceName(label);
      }
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
      setPrintOrientation("upright");
      setOrientationTouched(false);
      setShowOrientationDetails(false);
      setTechnologyLocked(false);
      setModelObject(null);
      setSourceThumb(null);
      clearRetryTimer();
      setUploadAttempt(1);
      setPendingFile(null);
      setUploadSpeedBps(0);
      setUploadElapsedMs(0);
      setUploadEtaMs(null);
      setUploadStalled(false);
      setUploadError(null);
      setUploadStatus("analyzing");
      setUploadProgress(0);
      setPreviewScale(1);

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
    const mediaIdParam = searchParams.get("mediaId");
    const techParam = searchParams.get("tech");
    const thumbParam = searchParams.get("thumb");
    const resolvedUrl =
      modelParam.startsWith("http://") ||
      modelParam.startsWith("https://") ||
      modelParam.startsWith("blob:") ||
      modelParam.startsWith("data:")
        ? modelParam
        : `${window.location.origin}${modelParam.startsWith("/") ? modelParam : `/${modelParam}`}`;

    if (thumbParam) {
      const resolvedThumb =
        thumbParam.startsWith("http://") ||
        thumbParam.startsWith("https://") ||
        thumbParam.startsWith("data:") ||
        thumbParam.startsWith("blob:") ||
        thumbParam.startsWith("/")
          ? thumbParam
          : `${window.location.origin}${thumbParam.startsWith("/") ? thumbParam : `/${thumbParam}`}`;
      setSourceThumb(resolvedThumb);
    }
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
        if (nameParam) {
          setSourceName(nameParam);
        }
        if (techParam) {
          const normalized = techParam.toLowerCase();
          const nextTech =
            normalized.includes("fdm") || normalized.includes("plastic") ? "fdm" : "sla";
          const nextMaterial =
            materialsByTech[nextTech][0]?.label ?? materialsByTech.sla[0].label;
          setTechnology(nextTech);
          setMaterial(nextMaterial);
          setQuality("standard");
          defaultSettingsRef.current = {
            technology: nextTech,
            material: nextMaterial,
            quality: "standard",
          };
          setSettingsAuto(true);
          setTechnologyLocked(true);
        } else {
          setTechnologyLocked(false);
        }
        await handleFile(file);
        if (mediaIdParam) {
          const existingMedia = await fetchMediaById(mediaIdParam);
          setUploadedMedia({
            id: mediaIdParam,
            url: existingMedia?.url ?? resolvedUrl,
            filename:
              typeof existingMedia?.filename === "string"
                ? existingMedia.filename
                : filename,
          });
          setUploadProgress(100);
          setUploadStatus("ready");
          setPendingFile(null);
          showSuccess("Модель уже в базе. Можно добавлять в корзину.");
        } else {
          showSuccess("Модель подставлена для печати.");
        }
      } catch (error) {
        prefillRef.current = false;
        showError("Не удалось загрузить модель для печати.");
      }
    };

    void loadPreset();
  }, [handleFile, searchParams, showError, showSuccess, isMobileUa, fetchMediaById]);

  const pushUploadLog = useCallback((_message: string, _data?: Record<string, unknown>) => {}, []);

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
    clearRetryTimer();
    setUploadAttempt(1);
    uploadStartRef.current = Date.now();
    lastProgressRef.current = { time: uploadStartRef.current, loaded: 0 };
    lastLoggedPercentRef.current = -1;
    lastStallLoggedRef.current = false;
    stallAbortArmedRef.current = false;
    pushUploadLog("upload-start", { name: file.name, size: file.size, type: file.type });

    const uploadViaServer = async () => {
      if (file.size > SERVER_UPLOAD_MAX_BYTES) {
        throw new Error("Файл слишком большой для серверной загрузки.");
      }
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

    const uploadViaMultipart = async () => {
      pushUploadLog("multipart-start", { size: file.size });
      const startResponse = await fetch("/api/customer-upload/multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      if (!startResponse.ok) {
        let errorMessage = "Failed to start multipart upload";
        try {
          const errorData = await startResponse.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {
          const fallbackText = await startResponse.text().catch(() => "");
          if (fallbackText) {
            errorMessage = fallbackText;
          }
        }
        throw new Error(errorMessage);
      }

      const startData = await startResponse.json();
      const uploadId = startData?.uploadId;
      const key = startData?.key;
      const partSize = startData?.partSize;
      const partCount = startData?.partCount;

      if (!uploadId || !key || !partSize || !partCount) {
        throw new Error("Multipart start returned invalid data.");
      }

      const parts: Array<{ ETag: string; PartNumber: number }> = [];
      let uploadedBase = 0;

      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        pushUploadLog("multipart-part-start", { partNumber, size: chunk.size });

        const partResponse = await fetch("/api/customer-upload/multipart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "part",
            uploadId,
            key,
            partNumber,
          }),
        });
        if (!partResponse.ok) {
          let errorMessage = "Failed to sign multipart chunk";
          try {
            const errorData = await partResponse.json();
            errorMessage = errorData?.error || errorData?.message || errorMessage;
          } catch {
            const fallbackText = await partResponse.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
          }
          throw new Error(errorMessage);
        }
        const partData = await partResponse.json();
        const uploadUrl = partData?.uploadUrl;
        if (!uploadUrl) {
          throw new Error("Multipart part URL is missing.");
        }

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const uploadTimeoutMs = isMobileUa ? 20 * 60 * 1000 : UPLOAD_TIMEOUT_MS;
          xhr.open("PUT", uploadUrl, true);
          xhr.timeout = uploadTimeoutMs;
          xhr.upload.onprogress = (event) => {
            const loaded = event.lengthComputable ? event.loaded : 0;
            const totalLoaded = uploadedBase + loaded;
            const percent = Math.min(100, Math.round((totalLoaded / file.size) * 100));
            const now = Date.now();
            const elapsedMs = uploadStartRef.current ? now - uploadStartRef.current : 0;
            const speedBps = elapsedMs > 0 ? totalLoaded / (elapsedMs / 1000) : 0;
            const etaMs =
              speedBps > 0 && file.size > totalLoaded
                ? ((file.size - totalLoaded) / speedBps) * 1000
                : null;
            setUploadProgress(percent);
            setUploadSpeedBps(speedBps);
            setUploadElapsedMs(elapsedMs);
            setUploadEtaMs(etaMs);
            lastProgressRef.current = { time: now, loaded: totalLoaded };
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const etagHeader = xhr.getResponseHeader("ETag") || "";
              const etag = etagHeader.replace(/\"/g, "");
              if (!etag) {
                reject(new Error("Missing ETag from upload response."));
                return;
              }
              parts.push({ ETag: etag, PartNumber: partNumber });
              uploadedBase += chunk.size;
              {
                const percent = Math.min(100, Math.round((uploadedBase / file.size) * 100));
                setUploadProgress(percent);
                setUploadSpeedBps((prev) => prev);
                setUploadElapsedMs((prev) => prev);
                lastProgressRef.current = { time: Date.now(), loaded: uploadedBase };
              }
              pushUploadLog("multipart-part-done", { partNumber });
              resolve();
            } else {
              reject(new Error(`Multipart upload failed (status ${xhr.status})`));
            }
          };
          xhr.onerror = () => reject(new Error("Multipart upload network error"));
          xhr.ontimeout = () => reject(new Error("Multipart upload timed out"));
          xhr.send(chunk);
        });
      }

      pushUploadLog("multipart-complete");
      const completeResponse = await fetch("/api/customer-upload/multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          uploadId,
          key,
          parts,
        }),
      });
      if (!completeResponse.ok) {
        let errorMessage = "Failed to complete multipart upload";
        try {
          const errorData = await completeResponse.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {
          const fallbackText = await completeResponse.text().catch(() => "");
          if (fallbackText) {
            errorMessage = fallbackText;
          }
        }
        throw new Error(errorMessage);
      }

      setUploadStatus("finalizing");
      const finalizeResponse = await fetch("/api/customer-upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          fileUrl: startData?.fileUrl,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });

      if (!finalizeResponse.ok) {
        let errorMessage = "Failed to finalize upload";
        try {
          const errorData = await finalizeResponse.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {
          const fallbackText = await finalizeResponse.text().catch(() => "");
          if (fallbackText) {
            errorMessage = fallbackText;
          }
        }
        throw new Error(errorMessage);
      }

      const finalizeData = await finalizeResponse.json();
      if (!finalizeData?.doc?.id) {
        throw new Error("Upload failed");
      }

      setUploadedMedia({
        id: String(finalizeData.doc.id),
        url: finalizeData.doc.url,
        filename: finalizeData.doc.filename,
      });
      setUploadProgress(100);
      setUploadStatus("ready");
      setPendingFile(null);
      clearRetryTimer();
      pushUploadLog("upload-done", { ms: Date.now() - (uploadStartRef.current ?? Date.now()) });
    };

    const existingUpload = await resolveExistingUpload(file);
    if (existingUpload?.id) {
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
      let phase: "upload" | "finalize" = "upload";

      if (attempt > 1) {
        pushUploadLog("upload-retry", { attempt, maxAttempts });
      }

      try {
        if (file.size >= MULTIPART_THRESHOLD_BYTES) {
          await uploadViaMultipart();
          return;
        }

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
        pushUploadLog("presign-response", { status: presignResponse.status });

        if (!presignResponse.ok) {
          let errorMessage = "Failed to start upload";
          try {
            const errorData = await presignResponse.json();
            errorMessage = errorData?.error || errorData?.message || errorMessage;
          } catch {
            const fallbackText = await presignResponse.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
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

          const uploadTimeoutMs = isMobileUa ? 20 * 60 * 1000 : UPLOAD_TIMEOUT_MS;
          xhr.open("PUT", presignData.uploadUrl, true);
          xhr.timeout = uploadTimeoutMs;
          xhr.setRequestHeader(
            "Content-Type",
            presignData.contentType || "application/octet-stream"
          );
          pushUploadLog("upload-timeout", { ms: uploadTimeoutMs });
          xhr.upload.onprogress = (event) => {
            const total =
              event.lengthComputable && event.total > 0 ? event.total : file.size || 1;
            const loaded = event.loaded;
            const percent = Math.min(100, Math.round((loaded / total) * 100));
            const now = Date.now();
            const elapsedMs = uploadStartRef.current ? now - uploadStartRef.current : 0;
            const speedBps = elapsedMs > 0 ? loaded / (elapsedMs / 1000) : 0;
            const etaMs =
              speedBps > 0 && file.size > loaded
                ? ((file.size - loaded) / speedBps) * 1000
                : null;
            setUploadProgress(percent);
            setUploadSpeedBps(speedBps);
            setUploadElapsedMs(elapsedMs);
            setUploadEtaMs(etaMs);
            lastProgressRef.current = { time: now, loaded };
            if (percent >= lastLoggedPercentRef.current + 10 || percent === 100) {
              lastLoggedPercentRef.current = percent;
              pushUploadLog("upload-progress", {
                percent,
                loaded,
                total,
              });
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
          } catch {
            const fallbackText = await completeResponse.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
          }
          throw new Error(errorMessage);
        }

        const completeData = await completeResponse.json();
        pushUploadLog("complete-response", {
          status: completeResponse.status,
          id: completeData?.doc?.id,
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
          if (file.size > SERVER_UPLOAD_MAX_BYTES) {
            clearRetryTimer();
            setUploadError(
              "Файл слишком большой для серверной загрузки. Разрешите прямую загрузку (CORS) и попробуйте снова."
            );
            setUploadStatus("pending");
            return;
          }
          try {
            setUploadStatus("finalizing");
            await uploadViaServer();
            return;
          } catch {
            // keep fallback silent to avoid noisy logs
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
    if (uploadStatus !== "uploading") {
      setUploadStalled(false);
      clearRetryTimer();
      stallAbortArmedRef.current = false;
      return;
    }
    const stallTimeout = isMobileUa ? STALLED_TIMEOUT_MS * 4 : STALLED_TIMEOUT_MS;
    const interval = window.setInterval(() => {
      if (uploadStartRef.current) {
        setUploadElapsedMs(Date.now() - uploadStartRef.current);
      }
      const last = lastProgressRef.current;
      if (last && Date.now() - last.time > stallTimeout) {
        setUploadStalled(true);
        if (!lastStallLoggedRef.current) {
          lastStallLoggedRef.current = true;
        }
        if (
          !isMobileUa &&
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
  }, [uploadStatus, clearRetryTimer, isMobileUa]);

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
    name: sourceName ? `Печать: ${sourceName}` : "Печать на заказ",
    formatKey: "physical" as const,
    formatLabel: "Печатная модель",
    priceLabel: `${formatPrice(price)} ₽`,
    priceValue: Math.round(price),
    quantity: 1,
    thumbnailUrl: sourceThumb ?? buildCartThumbnail("Печать"),
    customPrint: {
      uploadId: uploadedMedia?.id ?? "",
      uploadUrl: uploadedMedia?.url,
      uploadName: pendingFile?.name ?? uploadedMedia?.filename,
      technology: technology === "sla" ? "SLA Resin" : "FDM Plastic",
      material,
      quality: quality === "pro" ? "0.05mm" : "0.1mm",
      isHollow: technology === "sla" ? isHollowModel : undefined,
      infillPercent: technology === "fdm" ? infillPercent : undefined,
      dimensions: scaledMetrics?.size,
      volumeCm3: scaledMetrics?.volumeCm3,
      preflightStatus: preflight.status,
      preflightIssues: preflight.issues.map((issue) => issue.message),
      orientationPreset: selectedOrientationPreset
        ? {
            key: selectedOrientationPreset.key,
            label: selectedOrientationPreset.label,
            reason: selectedOrientationPreset.reason,
            riskStatus: selectedOrientationPreset.riskStatus,
            riskScore: selectedOrientationPreset.riskScore,
            etaMinutes: selectedOrientationPreset.etaMinutes,
            materialUsageCm3: Number(selectedOrientationPreset.materialUsageCm3.toFixed(2)),
            estimatedPrice: Math.round(selectedOrientationPreset.estimatedPrice),
          }
        : undefined,
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
      const parsed = readCartStorage(cartStorageKey, { migrateLegacy: true });
      const items = Array.isArray(parsed) ? parsed : [];
      const existingIndex = items.findIndex((item: any) => item.id === cartItem.id);
      if (existingIndex >= 0) {
        items[existingIndex] = cartItem;
      } else {
        items.push(cartItem);
      }
      writeCartStorage(cartStorageKey, items);
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

    if (!uploadedMedia?.id || !scaledMetrics) {
      showError(
        uploadStatus === "pending"
          ? "Нажмите «Загрузить», чтобы отправить модель."
          : "Загрузите файл и дождитесь анализа."
      );
      return;
    }

    if (!fitsBed) {
      showError("Модель в выбранном размере не помещается в область печати 200мм.");
      return;
    }

    if (preflight.status === "critical") {
      showError(preflight.issues[0]?.message || "Авто-проверка обнаружила критичную проблему модели.");
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

  const handleZoom = useCallback((delta: number) => {
    const controls = controlsRef.current;
    if (!controls || !controls.object || !controls.target) return;
    const camera = controls.object;
    const target = controls.target;
    const direction = new Vector3()
      .copy(camera.position)
      .sub(target)
      .normalize();
    const currentDistance = camera.position.distanceTo(target);
    const nextDistance = Math.min(520, Math.max(140, currentDistance + delta));
    camera.position.copy(target).add(direction.multiplyScalar(nextDistance));
    controls.update?.();
  }, []);

  const rotateBy = useCallback((azimuth: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (typeof controls.getAzimuthalAngle === "function" && typeof controls.setAzimuthalAngle === "function") {
      const current = controls.getAzimuthalAngle();
      controls.setAzimuthalAngle(current + azimuth);
    } else if (typeof controls.rotateLeft === "function") {
      controls.rotateLeft(azimuth);
    }
    controls.update?.();
  }, []);


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
          filter: "blur(8px) brightness(0.6) saturate(1.15)",
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
              href={isLoggedIn ? "/profile" : "/profile?from=checkout"}
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
            className="relative min-h-[360px] overflow-hidden sm:min-h-[520px]"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="relative h-full">
              <PrintScene model={modelObject} controlsRef={controlsRef} />
            </div>

            <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-2 sm:hidden">
              <span className="text-[9px] uppercase tracking-[0.3em] text-white/50">ZOOM</span>
              <button
                type="button"
                onClick={() => handleZoom(-40)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:border-[#2ED1FF]/60 hover:text-white"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleZoom(40)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:border-[#2ED1FF]/60 hover:text-white"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => rotateBy(0.35)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:border-[#2ED1FF]/60 hover:text-white"
                  aria-label="Rotate left"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => rotateBy(-0.35)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition hover:border-[#2ED1FF]/60 hover:text-white"
                  aria-label="Rotate right"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
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
              <div className="absolute left-4 right-4 top-4 z-30 flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 backdrop-blur sm:left-6 sm:right-auto sm:top-6">
                {uploadError ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span>{uploadError}</span>
                  </>
                ) : uploadStatus === "analyzing" ? (
                  <span>АНАЛИЗ МОДЕЛИ...</span>
                ) : uploadStatus === "pending" ? (
                  <span>НАЖМИТЕ «ЗАГРУЗИТЬ МОДЕЛЬ»</span>
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
              <div className="absolute left-4 right-4 top-4 z-30 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-emerald-200 sm:left-6 sm:right-auto sm:top-6">
                ЗАГРУЗКА ЗАВЕРШЕНА
              </div>
            )}
            {isPreviewScaled && (
              <div className="absolute right-6 top-6 hidden rounded-full border border-[#2ED1FF]/40 bg-[#0b1014]/80 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] sm:block">
                ПРЕДПРОСМОТР МАСШТАБИРОВАН
              </div>
            )}
          </section>

          <aside
            id="print-settings"
            className="space-y-5 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl"
          >
            <div className="space-y-3">
              <p className="text-sm font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                Технические данные
              </p>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm uppercase tracking-[0.2em] text-white/60">
                    Высота печати
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={MIN_PRINT_HEIGHT_MM}
                      max={heightInputMax}
                      step={1}
                      value={targetHeightMm}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        const next = Math.min(
                          heightInputMax,
                          Math.max(MIN_PRINT_HEIGHT_MM, Math.round(parsed))
                        );
                        setTargetHeightMm(next);
                      }}
                      className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-right text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                    />
                    <span className="text-sm uppercase tracking-[0.2em] text-white/50">мм</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={MIN_PRINT_HEIGHT_MM}
                  max={heightInputMax}
                  step={1}
                  value={targetHeightMm}
                  onChange={(event) => setTargetHeightMm(Number(event.target.value))}
                  className="mt-3 w-full accent-[#2ED1FF]"
                />
              </div>
              {orientationPresets && (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  {(() => {
                    const recommendedOrientation =
                      orientationPresets.items.find(
                        (item) => item.key === orientationPresets.recommendedKey
                      ) || orientationPresets.items[0];
                    const allCritical = orientationPresets.items.every(
                      (item) => item.riskStatus === "critical"
                    );

                    return (
                      <>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/55">
                            Orientation advisor 2.0
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowOrientationDetails((prev) => !prev)}
                            className="rounded-full border border-white/15 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-white/60 transition hover:border-white/35 hover:text-white"
                          >
                            {showOrientationDetails ? "Скрыть детали" : "Подробнее"}
                          </button>
                        </div>

                        {recommendedOrientation && (
                          <p className="mb-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100/90">
                            Рекомендуем пресет: <span className="font-semibold">{recommendedOrientation.label}</span>.{" "}
                            {recommendedOrientation.reason}
                          </p>
                        )}

                        {allCritical && (
                          <p className="mb-3 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                            Текущий размер слишком большой для стола 200 мм. Уменьшите высоту модели.
                          </p>
                        )}

                        <div className="grid gap-2">
                          {orientationPresets.items.map((item) => {
                            const selected = item.key === printOrientation;
                            const recommended = item.key === orientationPresets.recommendedKey;
                            const statusTone =
                              item.riskStatus === "critical"
                                ? "text-red-200"
                                : item.riskStatus === "risk"
                                  ? "text-amber-100"
                                  : "text-emerald-100";
                            const statusLabel =
                              item.riskStatus === "critical"
                                ? "Не подходит"
                                : item.riskStatus === "risk"
                                  ? "Есть риск"
                                  : "Подходит";
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => {
                                  setOrientationTouched(true);
                                  setPrintOrientation(item.key);
                                }}
                                className={`rounded-xl border px-3 py-2 text-left transition ${
                                  selected
                                    ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10"
                                    : "border-white/10 bg-white/[0.03] hover:border-white/30"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs uppercase tracking-[0.2em] text-white/80">
                                    {item.label}
                                    {recommended ? " • рекомендуем" : ""}
                                  </p>
                                  <p className={`text-[10px] uppercase tracking-[0.2em] ${statusTone}`}>
                                    {statusLabel}
                                  </p>
                                </div>
                                <p className="mt-1 text-[11px] text-white/60">{item.note}. {item.reason}</p>
                                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] uppercase tracking-[0.14em] text-white/50">
                                  <span>ETA ~{item.etaMinutes}м</span>
                                  <span className={statusTone}>Risk: {item.riskScore}</span>
                                  <span>Расход ~{formatNumber(item.materialUsageCm3)} см3</span>
                                  <span>Цена ~{formatPrice(item.estimatedPrice)} ₽</span>
                                </div>
                                {showOrientationDetails && (
                                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
                                    {`${formatNumber(item.size.x)} x ${formatNumber(item.size.y)} x ${formatNumber(
                                      item.size.z
                                    )} мм • V:${formatNumber(item.volumeCm3)} см3`}
                                  </p>
                                )}
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setOrientationTouched(true);
                                      setPrintOrientation(item.key);
                                      setTargetHeightMm(Math.round(item.size.z));
                                    }}
                                    className="rounded-full border border-cyan-300/35 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/55 hover:text-white"
                                  >
                                    Применить пресет
                                  </button>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
                <div className="flex items-center justify-between text-base uppercase tracking-[0.2em] text-white/60">
                  <span>X</span>
                  <span>{scaledMetrics ? `${formatNumber(scaledMetrics.size.x)} мм` : "--"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-base uppercase tracking-[0.2em] text-white/60">
                  <span>Y</span>
                  <span>{scaledMetrics ? `${formatNumber(scaledMetrics.size.y)} мм` : "--"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-base uppercase tracking-[0.2em] text-white/60">
                  <span>Z</span>
                  <span>{scaledMetrics ? `${formatNumber(scaledMetrics.size.z)} мм` : "--"}</span>
                </div>
                <div className="mt-3 border-t border-white/10 pt-3 text-base uppercase tracking-[0.2em] text-white/60">
                  <div className="flex items-center justify-between">
                    <span>Volume</span>
                    <span>{scaledMetrics ? `${formatNumber(scaledMetrics.volumeCm3)} см3` : "--"}</span>
                  </div>
                  {metrics && scaledMetrics && (
                    <div className="mt-2 flex items-center justify-between text-sm tracking-[0.15em] text-white/40">
                      <span>База</span>
                      <span>
                        {formatNumber(orientedBaseDimensions?.z || 0)}мм → {formatNumber(scaledMetrics.safeTargetHeight, 0)}мм
                      </span>
                    </div>
                  )}
                </div>
                {scaledMetrics && (
                  <div
                    className={`mt-3 rounded-xl border px-3 py-2 text-xs uppercase tracking-[0.2em] ${
                      preflight.status === "critical"
                        ? "border-red-500/40 bg-red-500/10 text-red-200"
                        : preflight.status === "risk"
                          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                          : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>Авто-диагностика</span>
                      <span>Q:{preflight.score}</span>
                    </div>
                    <p className="mt-1 text-[11px] normal-case tracking-normal opacity-90">
                      {preflight.summary}
                    </p>
                    {preflight.issues.length > 0 && (
                      <div className="mt-1 space-y-1 text-[11px] normal-case tracking-normal opacity-90">
                        {preflight.issues.slice(0, 2).map((issue) => (
                          <p key={issue.code}>{issue.message}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="mt-3 text-sm uppercase tracking-[0.15em] text-white/45">
                  X/Y/Z — габариты модели по осям (мм), не координаты сцены.
                </p>
                {!fitsBed && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm uppercase tracking-[0.2em] text-red-200">
                    Модель больше 200mm
                  </div>
                )}
                {metrics && (
                  <p className="mt-2 text-sm uppercase tracking-[0.15em] text-white/40">
                    Рекомендуемая высота для стола 200мм: до {formatNumber(maxHeightForBedMm, 0)}мм
                  </p>
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
                    disabled={technologyLocked || settingsAuto}
                    className={`rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-60 ${
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
                    disabled={technologyLocked || settingsAuto}
                    className={`rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-60 ${
                      technology === "fdm"
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white"
                    }`}
                    onClick={() => setTechnology("fdm")}
                  >
                    FDM Plastic
                  </button>
                </div>
                {technologyLocked ? (
                  <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                    Технология зафиксирована для этой модели.
                  </p>
                ) : settingsAuto ? (
                  <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                    Чтобы сменить технологию, переведите режим в ручной.
                  </p>
                ) : null}
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
                      settingsAuto ? "bg-[#2ED1FF]/40" : "bg-white/5"
                    }`}
                    onClick={() => {
                      setSettingsAuto((prev) => {
                        const next = !prev;
                        if (next) {
                          applyDefaultSettings();
                        }
                        return next;
                      });
                    }}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-[#2ED1FF] transition ${
                        settingsAuto ? "translate-x-0" : "translate-x-5"
                      }`}
                    />
                  </button>
                  <span>Ручной</span>
                </div>
                {settingsAuto ? (
                  <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                    В авто применяются параметры модели. Ручной режим откроет выбор.
                  </p>
                ) : (
                  <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                    Выбирайте технологию и материалы вручную.
                  </p>
                )}
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
                      disabled={settingsAuto}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-xs uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
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
                      disabled={settingsAuto}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-xs uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
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
              <div className="h-px bg-white/10" />
              {technology === "sla" ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                    Полость модели
                  </p>
                  <p className="text-xs text-white/50">
                    Для фигурок обычно используется полая печать. Это заметно снижает расход смолы.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
                        isHollowModel
                          ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => setIsHollowModel(true)}
                    >
                      Полая
                    </button>
                    <button
                      type="button"
                      className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
                        !isHollowModel
                          ? "border-[#2ED1FF]/60 bg-[#2ED1FF]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => setIsHollowModel(false)}
                    >
                      Цельная
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                    Заполнение (FDM)
                  </p>
                  <p className="text-xs text-white/50">
                    Ниже заполнение — дешевле и легче, выше — прочнее.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={8}
                      max={100}
                      step={1}
                      value={infillPercent}
                      onChange={(event) => setInfillPercent(Number(event.target.value))}
                      className="w-full accent-[#2ED1FF]"
                    />
                    <span className="w-12 text-right text-xs text-white/70">
                      {formatNumber(infillPercent, 0)}%
                    </span>
                  </div>
                </div>
              )}
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
                  {pricing.model === "smart"
                    ? `SMART ESTIMATE • Q:${formatNumber(pricing.queueMultiplier, 2)}`
                    : `BASE ${BASE_FEE} + ОПЦИИ`}
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!canAddToCart || isAdding}
                aria-disabled={!canAddToCart || isAdding}
                className={`w-full rounded-full bg-[#D4AF37] px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition ${
                  canAddToCart ? "hover:bg-[#f5d57a]" : ""
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isAdding ? "Добавляем..." : "ДОБАВИТЬ В КОРЗИНУ"}
              </button>
              {preflight.status === "critical" && (
                <p className="text-xs text-red-200/80">
                  Добавление заблокировано: исправьте критичные ошибки модели.
                </p>
              )}
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










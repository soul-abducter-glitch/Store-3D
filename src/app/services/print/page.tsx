"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MutableRefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MOUSE } from "three";

import ModelView, { type ModelIssueMarker } from "@/components/ModelView";
import { getCartStorageKey, readCartStorage, writeCartStorage } from "@/lib/cartStorage";

type SourceKind = "upload" | "store" | "recent";
type PrintTech = "SLA" | "FDM";
type TechControlMode = "auto" | "manual";
type QualityPreset = "draft" | "standard" | "pro";
type OrientationPreset = "balanced" | "risk" | "speed";
type ViewTool = "orbit" | "pan" | "zoom";
type ViewPreset = "isometric" | "front" | "top" | "left";
type ViewRenderMode = "final" | "base";
type SectionId = "size" | "quality" | "orientation" | "supports" | "hollow" | "autofix" | "diagnostics";

type SelectedModel = {
  id: string;
  name: string;
  units: "mm" | "cm";
  baseScale: number;
  source: SourceKind;
  fileUrl?: string;
  previewUrl?: string;
};

type Issue = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
};

type PrinterProfile = {
  id: string;
  label: string;
  tech: PrintTech;
  maxWidthMm: number;
  maxDepthMm: number;
  maxHeightMm: number;
};

type ModelBounds = {
  size: number;
  boxSize: [number, number, number];
  radius: number;
};

type IssueMarker = ModelIssueMarker;

const STEPS = ["Модель", "Настройка печати", "Подготовка", "Корзина/Оформление"];

const STORE_MODELS: SelectedModel[] = [
  {
    id: "store-bust",
    name: "Modern Bust.glb",
    units: "mm",
    baseScale: 1,
    source: "store",
    fileUrl: "/models/cup.glb",
    previewUrl: "/models/cup.glb",
  },
  {
    id: "store-mecha",
    name: "Mini Mecha.glb",
    units: "mm",
    baseScale: 1,
    source: "store",
    fileUrl: "/models/cup2.glb",
    previewUrl: "/models/cup2.glb",
  },
];

const RECENT_MODELS: SelectedModel[] = [
  {
    id: "recent-vase",
    name: "Vase-v7.glb",
    units: "mm",
    baseScale: 1,
    source: "recent",
    fileUrl: "/models/cup3.glb",
    previewUrl: "/models/cup3.glb",
  },
  {
    id: "recent-drone",
    name: "Drone-shell.glb",
    units: "mm",
    baseScale: 1,
    source: "recent",
    fileUrl: "/models/cup.glb",
    previewUrl: "/models/cup.glb",
  },
];

const MATERIALS_BY_TECH: Record<PrintTech, string[]> = {
  SLA: ["Стандартная смола", "Ударопрочная смола", "Литейная смола"],
  FDM: ["PLA", "PETG", "ABS"],
};

const COLORS_BY_TECH: Record<PrintTech, string[]> = {
  SLA: ["Серый", "Прозрачный", "Черный"],
  FDM: ["Черный", "Белый", "Красный"],
};

const COLOR_HEX_BY_TECH_INDEX: Record<PrintTech, string[]> = {
  SLA: ["#9CA3AF", "#CFE8FF", "#111827"],
  FDM: ["#111827", "#F3F4F6", "#DC2626"],
};

const PRINTER_PROFILES: PrinterProfile[] = [
  { id: "sla-small", label: "SLA 120 x 68 x 155 mm", tech: "SLA", maxWidthMm: 120, maxDepthMm: 68, maxHeightMm: 155 },
  { id: "sla-large", label: "SLA 220 x 130 x 250 mm", tech: "SLA", maxWidthMm: 220, maxDepthMm: 130, maxHeightMm: 250 },
  { id: "fdm-small", label: "FDM 220 x 220 x 250 mm", tech: "FDM", maxWidthMm: 220, maxDepthMm: 220, maxHeightMm: 250 },
  { id: "fdm-xl", label: "FDM 300 x 300 x 320 mm", tech: "FDM", maxWidthMm: 300, maxDepthMm: 300, maxHeightMm: 320 },
];

const QUALITY_LABEL: Record<QualityPreset, string> = {
  draft: "Черновик",
  standard: "Стандарт",
  pro: "Про",
};

const ORIENTATION_LABEL: Record<OrientationPreset, string> = {
  balanced: "Баланс",
  risk: "Мин. риск",
  speed: "Мин. время",
};

const VIEW_LABEL: Record<ViewPreset, string> = {
  isometric: "Изометрия",
  front: "Спереди",
  top: "Сверху",
  left: "Слева",
};

const VIEW_POSITION: Record<ViewPreset, [number, number, number]> = {
  isometric: [3.4, 2.6, 3.8],
  front: [0, 2.1, 6],
  top: [0.01, 6.4, 0.01],
  left: [6, 2, 0],
};

const formatPrice = (value: number) => {
  const rounded = Math.max(0, Math.round(value));
  return `${new Intl.NumberFormat("ru-RU").format(rounded)} руб.`;
};

const formatEta = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `~${mins} мин`;
  if (mins === 0) return `~${hours} ч`;
  return `~${hours} ч ${mins} мин`;
};

const formatDims = (x: number, y: number, z: number) =>
  `${x.toFixed(1)} x ${y.toFixed(1)} x ${z.toFixed(1)} mm`;

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const inferTechFromModel = (model: SelectedModel | null): PrintTech => {
  if (!model) return "SLA";
  const name = model.name.toLowerCase();

  if (/\.(stl|obj)$/i.test(name)) return "FDM";
  if (/(fdm|pla|petg|abs|bracket|gear|case|mount)/i.test(name)) return "FDM";
  if (/(sla|resin|mini|figur|bust|statue|jewel)/i.test(name)) return "SLA";
  return "SLA";
};

function CameraPresetController({
  view,
  fitSignal,
  controlsRef,
}: {
  view: ViewPreset;
  fitSignal: number;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const [x, y, z] = VIEW_POSITION[view];
    camera.position.set(x, y, z);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 1, 0);
      controlsRef.current.update();
    } else {
      camera.lookAt(0, 1, 0);
    }
  }, [camera, controlsRef, fitSignal, view]);

  return null;
}

function ViewportScene({
  modelUrl,
  tool,
  gridOn,
  plateOn,
  issueMarkers,
  showIssues,
  renderMode,
  baseColor,
  analysisSignal,
  view,
  fitSignal,
  rotationDeg,
  mobileOptimized,
  controlsRef,
  onBounds,
  onIssueMarkers,
}: {
  modelUrl?: string;
  tool: ViewTool;
  gridOn: boolean;
  plateOn: boolean;
  issueMarkers: IssueMarker[];
  showIssues: boolean;
  renderMode: ViewRenderMode;
  baseColor: string;
  analysisSignal: number;
  view: ViewPreset;
  fitSignal: number;
  rotationDeg: number;
  mobileOptimized: boolean;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  onBounds: (bounds: ModelBounds) => void;
  onIssueMarkers: (markers: IssueMarker[]) => void;
}) {
  const mouseButtons = useMemo(() => {
    if (tool === "pan") {
      return { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    }
    if (tool === "zoom") {
      return { LEFT: MOUSE.DOLLY, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    }
    return { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  }, [tool]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 6]} intensity={1.2} />
      {!mobileOptimized && <Environment preset="city" />}

      {gridOn && (
        <Grid
          args={mobileOptimized ? [8, 8] : [10, 10]}
          cellSize={mobileOptimized ? 0.7 : 0.5}
          cellThickness={0.4}
          sectionSize={2}
        />
      )}

      {plateOn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
          <circleGeometry args={[2.2, 64]} />
          <meshStandardMaterial color="#12445a" roughness={0.65} metalness={0.1} opacity={0.5} transparent />
        </mesh>
      )}

      {showIssues &&
        issueMarkers.map((marker) => (
          <mesh key={marker.id} position={marker.position}>
            <sphereGeometry args={[0.06, mobileOptimized ? 10 : 16, mobileOptimized ? 10 : 16]} />
            <meshStandardMaterial color={marker.color} emissive={marker.color} emissiveIntensity={0.9} />
          </mesh>
        ))}

      <group rotation={[0, (rotationDeg * Math.PI) / 180, 0]}>
        {modelUrl ? (
          <Suspense fallback={null}>
            <ModelView
              rawModelUrl={modelUrl}
              finish="Raw"
              renderMode={renderMode}
              accentColor="#2ed1ff"
              baseColor={baseColor}
              analysisSignal={analysisSignal}
              onBounds={onBounds}
              onIssueMarkers={onIssueMarkers}
            />
          </Suspense>
        ) : (
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[1.6, 1.6, 0.08, mobileOptimized ? 28 : 48]} />
            <meshStandardMaterial color="#12445a" metalness={0.15} roughness={0.7} opacity={0.45} transparent />
          </mesh>
        )}
      </group>

      <OrbitControls
        ref={controlsRef}
        enableDamping={!mobileOptimized}
        dampingFactor={mobileOptimized ? 0 : 0.08}
        rotateSpeed={mobileOptimized ? 0.8 : 1}
        zoomSpeed={mobileOptimized ? 0.9 : 1}
        panSpeed={mobileOptimized ? 0.9 : 1}
        minDistance={1.2}
        maxDistance={12}
        mouseButtons={mouseButtons}
      />

      <CameraPresetController view={view} fitSignal={fitSignal} controlsRef={controlsRef} />
    </>
  );
}

function PrintOnDemandContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const uploadedUrlRef = useRef<string | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const prefillRef = useRef(false);

  const [notice, setNotice] = useState("Готово: настройте модель и параметры печати.");
  const [cartCount, setCartCount] = useState(0);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceKind>("upload");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceThumb, setSourceThumb] = useState<string | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<{ id: string; url?: string; filename?: string } | null>(
    null
  );
  const [uploadStatus, setUploadStatus] = useState<"idle" | "pending" | "uploading" | "ready">(
    "idle"
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const [tech, setTech] = useState<PrintTech>("SLA");
  const [techControlMode, setTechControlMode] = useState<TechControlMode>("auto");
  const [material, setMaterial] = useState(MATERIALS_BY_TECH.SLA[0]);
  const [color, setColor] = useState(COLORS_BY_TECH.SLA[0]);
  const [quantity, setQuantity] = useState(1);

  const [note, setNote] = useState("");
  const [packaging, setPackaging] = useState<"standard" | "gift">("standard");

  const [viewTool, setViewTool] = useState<ViewTool>("orbit");
  const [viewRenderMode, setViewRenderMode] = useState<ViewRenderMode>("final");
  const [viewPreset, setViewPreset] = useState<ViewPreset>("isometric");
  const [showGrid, setShowGrid] = useState(true);
  const [showBuildPlate, setShowBuildPlate] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [issueMarkers, setIssueMarkers] = useState<IssueMarker[]>([]);
  const [analysisSignal, setAnalysisSignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [bounds, setBounds] = useState<ModelBounds | null>(null);

  const selectedColorHex = useMemo(() => {
    const options = COLORS_BY_TECH[tech];
    const index = Math.max(0, options.indexOf(color));
    return COLOR_HEX_BY_TECH_INDEX[tech][index] ?? "#9CA3AF";
  }, [color, tech]);

  const [heightMm, setHeightMm] = useState(120);
  const [lockProportions, setLockProportions] = useState(true);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("standard");
  const [orientationPreset, setOrientationPreset] = useState<OrientationPreset>("balanced");
  const [supportsEnabled, setSupportsEnabled] = useState(true);
  const [hollowEnabled, setHollowEnabled] = useState(false);
  const [autoFixMesh, setAutoFixMesh] = useState(true);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(true);

  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    size: true,
    quality: true,
    orientation: true,
    supports: false,
    hollow: false,
    autofix: false,
    diagnostics: false,
  });

  const [printerProfileId, setPrinterProfileId] = useState<string>("sla-small");

  const selectedPrinter = useMemo(
    () => PRINTER_PROFILES.find((profile) => profile.id === printerProfileId) ?? PRINTER_PROFILES[0],
    [printerProfileId]
  );
  const autoDetectedTech = useMemo(() => inferTechFromModel(selectedModel), [selectedModel]);

  const diagnostics = useMemo(() => {
    if (!diagnosticsEnabled || !selectedModel?.previewUrl) return [];
    const seen = new Set<string>();
    return issueMarkers
      .filter((item) => {
        const key = `${item.title}:${item.severity}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => ({
        id: item.id,
        title: item.title,
        severity: item.severity,
      }));
  }, [diagnosticsEnabled, issueMarkers, selectedModel?.previewUrl]);

  const cartStorageKey = useMemo(
    () => getCartStorageKey(isLoggedIn ? userId : null),
    [isLoggedIn, userId]
  );

  const syncCartCount = useCallback(() => {
    const cart = readCartStorage(cartStorageKey, { migrateLegacy: true });
    const total = cart.reduce((sum, item) => {
      const qty = typeof (item as { quantity?: unknown }).quantity === "number" ? (item as { quantity: number }).quantity : 1;
      return sum + Math.max(1, Math.trunc(qty));
    }, 0);
    setCartCount(total);
  }, [cartStorageKey]);

  useEffect(() => {
    if (techControlMode !== "auto") return;
    if (tech === autoDetectedTech) return;
    setTech(autoDetectedTech);
  }, [autoDetectedTech, tech, techControlMode]);

  useEffect(() => {
    setMaterial(MATERIALS_BY_TECH[tech][0]);
    setColor(COLORS_BY_TECH[tech][0]);

    const firstProfile = PRINTER_PROFILES.find((profile) => profile.tech === tech);
    if (firstProfile) {
      setPrinterProfileId(firstProfile.id);
      setHeightMm((prev) => Math.min(prev, firstProfile.maxHeightMm));
    }

    if (tech === "FDM") {
      setHollowEnabled(false);
    }
  }, [tech]);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        const response = await fetch("/api/users/me", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setIsLoggedIn(false);
          setUserId(null);
          return;
        }
        const data = await response.json();
        const user = data?.user ?? data?.doc ?? null;
        setIsLoggedIn(Boolean(user?.id));
        setUserId(user?.id ? String(user.id) : null);
      } catch {
        setIsLoggedIn(false);
        setUserId(null);
      }
    };
    run();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1024px), (pointer: coarse)");
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    setShowGrid(false);
    setShowIssues(false);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!selectedModel?.previewUrl) {
      setIssueMarkers([]);
      setShowIssues(false);
      return;
    }
    setAnalysisSignal((prev) => prev + 1);
  }, [selectedModel?.previewUrl]);

  useEffect(() => {
    if (issueMarkers.length > 0) return;
    setShowIssues(false);
  }, [issueMarkers.length]);

  useEffect(() => {
    syncCartCount();
    const onCartUpdate = () => syncCartCount();
    const onStorage = () => syncCartCount();
    window.addEventListener("cart-updated", onCartUpdate);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("cart-updated", onCartUpdate);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncCartCount]);

  useEffect(() => {
    return () => {
      if (uploadedUrlRef.current) {
        URL.revokeObjectURL(uploadedUrlRef.current);
      }
    };
  }, []);

  const toggleSection = (section: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const setNoticeWith = (text: string) => {
    setNotice(text);
  };

  const handleTechControlModeChange = (mode: TechControlMode) => {
    setTechControlMode(mode);
    if (mode === "auto") {
      const detected = inferTechFromModel(selectedModel);
      setTech(detected);
      setNoticeWith(`Авторежим: выбрана технология ${detected}.`);
      return;
    }
    setNoticeWith("Ручной режим: технологию можно менять.");
  };

  const handleUploadOpen = () => {
    setSourceTab("upload");
    uploadRef.current?.click();
  };

  const prepareModelPreview = (file: File, source: SourceKind, fixedId?: string) => {
    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
    }

    const localUrl = URL.createObjectURL(file);
    uploadedUrlRef.current = localUrl;
    const isPreviewable = /\.(glb|gltf)$/i.test(file.name);

    setSourceTab(source);
    setSelectedModel({
      id: fixedId || `${source}-${Date.now()}`,
      name: file.name,
      units: "mm",
      baseScale: 1,
      source,
      fileUrl: localUrl,
      previewUrl: isPreviewable ? localUrl : undefined,
    });
    setUploadError(null);
    setUploadedMedia(null);
    setUploadStatus("pending");
    setBounds(null);
  };

  const resolveExistingUpload = useCallback(async (file: File) => {
    const params = new URLSearchParams();
    params.set("limit", "1");
    params.set("depth", "0");
    params.set("sort", "-createdAt");
    params.set("where[filename][equals]", file.name);
    params.set("where[filesize][equals]", String(file.size));
    params.set("where[isCustomerUpload][equals]", "true");
    try {
      const response = await fetch(`/api/media?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.docs?.[0] ?? null;
    } catch {
      return null;
    }
  }, []);

  const fetchMediaById = useCallback(async (id: string) => {
    if (!id) return null;
    try {
      const response = await fetch(`/api/media/${id}?depth=0`, { credentials: "include" });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }, []);

  const uploadFileToDatabase = useCallback(
    async (file: File, preferredMediaId?: string) => {
      setUploadStatus("uploading");
      setUploadError(null);

      if (preferredMediaId) {
        const existingById = await fetchMediaById(preferredMediaId);
        if (existingById?.id) {
          setUploadedMedia({
            id: String(existingById.id),
            url: existingById.url,
            filename: existingById.filename || file.name,
          });
          setUploadStatus("ready");
          setNoticeWith("Модель уже загружена. Можно добавить в корзину.");
          return;
        }
      }

      const existing = await resolveExistingUpload(file);
      if (existing?.id) {
        setUploadedMedia({
          id: String(existing.id),
          url: existing.url,
          filename: existing.filename || file.name,
        });
        setUploadStatus("ready");
        setNoticeWith("Модель уже загружена. Можно добавить в корзину.");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/customer-upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        let message = "Не удалось загрузить модель.";
        try {
          const data = await response.json();
          message = data?.error || data?.message || message;
        } catch {
          const fallback = await response.text().catch(() => "");
          if (fallback) {
            message = fallback;
          }
        }
        throw new Error(message);
      }

      const data = await response.json();
      if (!data?.doc?.id) {
        throw new Error("Некорректный ответ после загрузки модели.");
      }

      setUploadedMedia({
        id: String(data.doc.id),
        url: data.doc.url,
        filename: data.doc.filename || file.name,
      });
      setUploadStatus("ready");
      setNoticeWith("Модель загружена. Можно добавить в корзину.");
    },
    [fetchMediaById, resolveExistingUpload]
  );

  const loadModelFromUrl = useCallback(
    async (url: string, fallbackName: string, source: SourceKind, mediaId?: string) => {
      const resolved =
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("blob:") ||
        url.startsWith("data:")
          ? url
          : `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;

      const response = await fetch(resolved);
      if (!response.ok) {
        throw new Error(`Не удалось получить модель (${response.status}).`);
      }
      const blob = await response.blob();
      const safeName = (fallbackName || "model").trim() || "model";
      const hasExtension = /\.[a-z0-9]{2,5}$/i.test(safeName);
      const fileName = hasExtension ? safeName : `${safeName}.glb`;
      const file = new File([blob], fileName, {
        type: blob.type || "application/octet-stream",
      });

      prepareModelPreview(file, source, mediaId ? `media-${mediaId}` : undefined);
      await uploadFileToDatabase(file, mediaId);
    },
    [uploadFileToDatabase]
  );

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSourceName(file.name);
    setSourceThumb(null);
    prepareModelPreview(file, "upload");

    setNoticeWith(
      /\.(glb|gltf)$/i.test(file.name)
        ? `Модель загружена: ${file.name}`
        : `Модель загружена: ${file.name}. Предпросмотр пока поддерживает только GLB/GLTF.`
    );
    void uploadFileToDatabase(file);

    event.target.value = "";
  };

  const handlePickStoreModel = (modelId: string) => {
    const next = STORE_MODELS.find((item) => item.id === modelId) ?? STORE_MODELS[0];
    setSourceTab("store");
    setSourceName(next.name);
    setSourceThumb(null);
    if (!next.fileUrl) {
      setNoticeWith(`Выбрано из магазина: ${next.name}`);
      return;
    }
    void loadModelFromUrl(next.fileUrl, next.name, "store").catch((error) => {
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить модель.");
      setUploadStatus("idle");
      setNoticeWith("Не удалось загрузить модель из магазина.");
    });
  };

  const handlePickRecentModel = (modelId: string) => {
    const next = RECENT_MODELS.find((item) => item.id === modelId) ?? RECENT_MODELS[0];
    setSourceTab("recent");
    setSourceName(next.name);
    setSourceThumb(null);
    if (!next.fileUrl) {
      setNoticeWith(`Выбрано из недавних: ${next.name}`);
      return;
    }
    void loadModelFromUrl(next.fileUrl, next.name, "recent").catch((error) => {
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить модель.");
      setUploadStatus("idle");
      setNoticeWith("Не удалось загрузить модель из недавних.");
    });
  };

  const handleClearModel = () => {
    setSelectedModel(null);
    setUploadedMedia(null);
    setUploadStatus("idle");
    setUploadError(null);
    setBounds(null);
    setSourceName(null);
    setSourceThumb(null);
    setNoticeWith("Выбор очищен.");
  };

  const handleDownloadModel = () => {
    if (!selectedModel?.fileUrl) {
      setNoticeWith("Нет файла модели для скачивания.");
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = selectedModel.fileUrl;
    anchor.download = selectedModel.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setNoticeWith(`Скачивание начато: ${selectedModel.name}`);
  };

  useEffect(() => {
    if (prefillRef.current || typeof window === "undefined") return;

    const modelParam = searchParams.get("model");
    if (!modelParam) return;

    prefillRef.current = true;
    const mediaIdParam = searchParams.get("mediaId") || undefined;
    const nameParam = searchParams.get("name") || "model.glb";
    const techParam = (searchParams.get("tech") || "").toLowerCase();
    const thumbParam = searchParams.get("thumb");

    if (techParam) {
      setTechControlMode("manual");
      if (techParam.includes("fdm") || techParam.includes("plastic")) {
        setTech("FDM");
      } else {
        setTech("SLA");
      }
    }

    if (nameParam) {
      setSourceName(nameParam);
    }

    if (thumbParam) {
      const resolvedThumb =
        thumbParam.startsWith("http://") ||
        thumbParam.startsWith("https://") ||
        thumbParam.startsWith("data:") ||
        thumbParam.startsWith("blob:") ||
        thumbParam.startsWith("/")
          ? thumbParam
          : `${window.location.origin}/${thumbParam}`;
      setSourceThumb(resolvedThumb);
    }

    void loadModelFromUrl(modelParam, nameParam, "upload", mediaIdParam).catch((error) => {
      prefillRef.current = false;
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить модель по ссылке.");
      setUploadStatus("idle");
      setNoticeWith("Не удалось подставить модель из источника.");
    });
  }, [loadModelFromUrl, searchParams]);

  const handleAutoFit = () => {
    setHeightMm(Math.min(120, selectedPrinter.maxHeightMm));
    setNoticeWith(`Автоподгонка применена для ${selectedPrinter.label}.`);
  };

  const handleApplyOrientation = () => {
    setNoticeWith(`Применен пресет ориентации: ${ORIENTATION_LABEL[orientationPreset]}.`);
  };

  const handleManualRotate = () => {
    setRotationDeg((prev) => (prev + 15) % 360);
    setNoticeWith("Ручной поворот: +15° применен.");
  };

  const handleResetViewport = () => {
    setViewTool("orbit");
    setViewRenderMode("final");
    setViewPreset("isometric");
    setShowGrid(true);
    setShowBuildPlate(true);
    setMeasureMode(false);
    setShowIssues(false);
    setRotationDeg(0);
    setFitSignal((prev) => prev + 1);
    setNoticeWith("Вьюпорт сброшен.");
  };

  const handleFitToVolume = () => {
    handleAutoFit();
    setFitSignal((prev) => prev + 1);
    setNoticeWith("Модель подогнана под объем печати.");
  };

  const handleRunDiagnostics = () => {
    setDiagnosticsEnabled(true);
    setAnalysisSignal((prev) => prev + 1);
    setNoticeWith("Диагностика пересчитана по текущей геометрии.");
  };

  const handleAutoFixRun = () => {
    setAutoFixMesh(true);
    setNoticeWith("Авто-фикс запрошен. Очистка сетки поставлена в очередь.");
  };

  const price = useMemo(() => {
    const base = tech === "SLA" ? 690 : 470;
    const qualityFactor = qualityPreset === "pro" ? 1.35 : qualityPreset === "draft" ? 0.85 : 1;
    const supportsFactor = supportsEnabled ? 1.08 : 1;
    const hollowFactor = tech === "SLA" && hollowEnabled ? 0.86 : 1;
    const sizeFactor = Math.max(0.68, heightMm / 120);

    return Number((base * qualityFactor * supportsFactor * hollowFactor * sizeFactor * quantity).toFixed(2));
  }, [hollowEnabled, heightMm, qualityPreset, quantity, supportsEnabled, tech]);

  const etaMinutes = useMemo(() => {
    const base = qualityPreset === "pro" ? 430 : qualityPreset === "draft" ? 220 : 330;
    const quantityLoad = quantity * 52;
    const techLoad = tech === "SLA" ? 40 : 25;
    const autoFixLoad = autoFixMesh ? 25 : 0;
    return base + quantityLoad + techLoad + autoFixLoad;
  }, [autoFixMesh, qualityPreset, quantity, tech]);

  const risk = useMemo(() => {
    const diagnosticsPenalty = diagnosticsEnabled ? diagnostics.length * 10 : 20;
    const orientationPenalty = orientationPreset === "speed" ? 22 : orientationPreset === "risk" ? 5 : 12;
    const supportsPenalty = supportsEnabled ? 8 : 18;
    const score = diagnosticsPenalty + orientationPenalty + supportsPenalty;

    if (score >= 54) return "High";
    if (score >= 34) return "Medium";
    return "Low";
  }, [diagnostics.length, diagnosticsEnabled, orientationPreset, supportsEnabled]);

  const riskTone =
    risk === "High" ? "text-rose-300" : risk === "Medium" ? "text-amber-300" : "text-emerald-300";

  const selectedInfo = selectedModel
    ? `Выбрано: ${selectedModel.name} | Ед.: ${selectedModel.units} | Масштаб: ${(
        selectedModel.baseScale *
        (heightMm / 120)
      ).toFixed(2)}`
    : "Выбрано: нет | Ед.: -- | Масштаб: --";

  const printerOptions = PRINTER_PROFILES.filter((profile) => profile.tech === tech);

  const hasPreviewGeometry = Boolean(selectedModel?.previewUrl);
  const scaledDimensionsMm = useMemo(() => {
    if (!bounds) return null;
    const sourceHeight = bounds.boxSize[1];
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) return null;
    const factor = heightMm / sourceHeight;
    return {
      x: bounds.boxSize[0] * factor,
      y: bounds.boxSize[1] * factor,
      z: bounds.boxSize[2] * factor,
    };
  }, [bounds, heightMm]);
  const scaledVolumeCm3 = useMemo(() => {
    if (!scaledDimensionsMm) return undefined;
    const mm3 = Math.max(0, scaledDimensionsMm.x * scaledDimensionsMm.y * scaledDimensionsMm.z);
    return Number((mm3 / 1000).toFixed(2));
  }, [scaledDimensionsMm]);

  const fitsPrinterVolume = useMemo(() => {
    if (!scaledDimensionsMm) return true;
    const tolerance = 0.1;
    const fitsHeight = scaledDimensionsMm.y <= selectedPrinter.maxHeightMm + tolerance;
    const fitsDirect =
      scaledDimensionsMm.x <= selectedPrinter.maxWidthMm + tolerance &&
      scaledDimensionsMm.z <= selectedPrinter.maxDepthMm + tolerance;
    const fitsSwapped =
      scaledDimensionsMm.x <= selectedPrinter.maxDepthMm + tolerance &&
      scaledDimensionsMm.z <= selectedPrinter.maxWidthMm + tolerance;
    return fitsHeight && (fitsDirect || fitsSwapped);
  }, [scaledDimensionsMm, selectedPrinter]);

  const volumeLabel = `${selectedPrinter.maxWidthMm} x ${selectedPrinter.maxDepthMm} x ${selectedPrinter.maxHeightMm} mm`;
  const fitStatus = !selectedModel
    ? "Ожидание модели"
    : !hasPreviewGeometry
      ? "Только оценка"
      : !scaledDimensionsMm
        ? "Вычисление"
        : fitsPrinterVolume
          ? "Помещается"
          : "Слишком большая";
  const fitTone =
    fitStatus === "Помещается"
      ? "text-emerald-300"
      : fitStatus === "Слишком большая"
        ? "text-rose-300"
        : "text-white/65";

  const addToCartValidationError = useMemo(() => {
    if (!selectedModel) return "Сначала выберите и загрузите модель.";
    if (uploadStatus === "pending") return "Файл модели выбран. Дождитесь загрузки в базу.";
    if (uploadStatus === "uploading") return "Идет загрузка. Подождите.";
    if (uploadError) return uploadError;
    if (uploadStatus !== "ready" || !uploadedMedia?.id) {
      return "Перед добавлением в корзину модель должна быть загружена в базу.";
    }
    if (quantity < 1) return "Количество должно быть не меньше 1.";
    if (hasPreviewGeometry && !scaledDimensionsMm) {
      return "Габариты 3D-модели еще рассчитываются. Подождите.";
    }
    if (hasPreviewGeometry && scaledDimensionsMm && !fitsPrinterVolume) {
      return `Модель не помещается в ${volumeLabel}. Уменьшите высоту или выберите больший профиль принтера.`;
    }
    return null;
  }, [
    fitsPrinterVolume,
    hasPreviewGeometry,
    quantity,
    scaledDimensionsMm,
    selectedModel,
    uploadError,
    uploadedMedia?.id,
    uploadStatus,
    volumeLabel,
  ]);

  const checkoutValidationError = cartCount > 0 ? null : addToCartValidationError;

  const measureLabel = scaledDimensionsMm
    ? `X:${scaledDimensionsMm.x.toFixed(1)} Y:${scaledDimensionsMm.y.toFixed(1)} Z:${scaledDimensionsMm.z.toFixed(1)} mm`
    : bounds
      ? `X:${bounds.boxSize[0].toFixed(2)} Y:${bounds.boxSize[1].toFixed(2)} Z:${bounds.boxSize[2].toFixed(2)}`
      : "Измерения недоступны";

  const addCurrentModelToCart = () => {
    if (addToCartValidationError) {
      setNoticeWith(addToCartValidationError);
      return false;
    }

    if (!selectedModel || !uploadedMedia?.id) {
      setNoticeWith("Перед добавлением в корзину модель должна быть загружена в базу.");
      return false;
    }

    const current = readCartStorage(cartStorageKey, { migrateLegacy: true });

    const item = {
      id: `custom-print:${uploadedMedia.id}`,
      productId: "service-print",
      name: sourceName ? `Печать: ${sourceName}` : selectedModel.name,
      formatKey: "physical",
      formatLabel: "Печатная модель",
      priceLabel: formatPrice(price),
      priceValue: Math.max(0, Math.round(price)),
      quantity,
      thumbnailUrl: sourceThumb ?? buildCartThumbnail(selectedModel.name),
      customPrint: {
        uploadId: uploadedMedia.id,
        uploadUrl: uploadedMedia.url ?? selectedModel.fileUrl,
        uploadName: uploadedMedia.filename ?? selectedModel.name,
        sourcePrice: Math.max(0, Math.round(price)),
        technology: tech === "SLA" ? "SLA смола" : "FDM пластик",
        material,
        color,
        quality: qualityPreset === "pro" ? "0.05mm" : qualityPreset === "draft" ? "Черновик" : "0.1mm",
        note: note.trim() || undefined,
        packaging: packaging === "gift" ? "Подарочная" : "Стандартная",
        isHollow: tech === "SLA" ? hollowEnabled : false,
        dimensions: scaledDimensionsMm
          ? {
              x: Number(scaledDimensionsMm.x.toFixed(2)),
              y: Number(scaledDimensionsMm.y.toFixed(2)),
              z: Number(scaledDimensionsMm.z.toFixed(2)),
            }
          : undefined,
        volumeCm3: scaledVolumeCm3,
      },
    };

    const items = Array.isArray(current) ? [...current] : [];
    const existingIndex = items.findIndex((entry: any) => entry?.id === item.id);
    if (existingIndex >= 0) {
      items[existingIndex] = item;
    } else {
      items.push(item);
    }

    writeCartStorage(cartStorageKey, items);
    setNoticeWith(`Добавлено ${quantity} шт. в корзину.`);
    syncCartCount();
    return true;
  };

  const handleAddToCart = () => {
    addCurrentModelToCart();
  };

  const handleContinueCheckout = () => {
    if (checkoutValidationError) {
      setNoticeWith(checkoutValidationError);
      return;
    }
    if (cartCount < 1) {
      const added = addCurrentModelToCart();
      if (!added) return;
    }
    router.push("/checkout");
  };

  const handleCartOpen = () => {
    router.push(isLoggedIn ? "/profile" : "/profile?from=checkout");
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_24%_0%,rgba(46,209,255,0.12)_0%,rgba(5,5,5,0)_45%),radial-gradient(circle_at_85%_8%,rgba(212,175,55,0.08)_0%,rgba(5,5,5,0)_42%)]" />

      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#04080d]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/store")}
            aria-label="Go to store"
            className="rounded-xl border border-[#2ED1FF]/35 bg-[#0b1014]/85 px-3 py-1.5 text-left transition hover:border-[#7FE7FF]/70"
          >
            <p className="text-sm font-semibold tracking-[0.2em] text-[#BFF4FF]">3D STORE</p>
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/55">
              Печать на заказ
            </p>
          </button>

          <nav className="flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] sm:gap-3">
            <button
              type="button"
              onClick={() => router.push("/store")}
              className="rounded-full border border-[#2ED1FF]/40 bg-[#0b1014] px-3 py-1.5 text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
            >
              Магазин
            </button>
            <button
              type="button"
              onClick={handleCartOpen}
              className="rounded-full border border-[#2ED1FF]/40 bg-[#0b1014] px-3 py-1.5 text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
            >
              Корзина {cartCount > 0 ? `(${cartCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="rounded-full border border-[#2ED1FF]/40 bg-[#0b1014] px-3 py-1.5 text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
            >
              Профиль
            </button>
          </nav>
        </div>
      </header>

      <div className="fixed inset-x-0 top-16 z-30 border-b border-white/10 bg-[#04080d]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center px-4 sm:px-6">
          <ol className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {STEPS.map((step, index) => {
              const active = index === 1;
              const done = index < 1;
              return (
                <li
                  key={step}
                  className={`rounded-md border px-2 py-1 text-center text-xs font-semibold uppercase tracking-[0.13em] ${
                    active
                      ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                      : done
                        ? "border-[#D4AF37]/60 bg-[#D4AF37]/10 text-[#F6DFA0]"
                        : "border-white/15 bg-white/5 text-white/55"
                  }`}
                >
                  {index + 1}. {step}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <main className="mx-auto max-w-[1680px] px-4 pb-8 pt-[142px] sm:px-6">
        <div className="mb-4 rounded-xl border border-[#2ED1FF]/35 bg-[#2ED1FF]/10 px-3 py-2 text-sm text-[#BFF4FF]">
          {notice}
          <p className="mt-1 text-xs text-[#BFF4FF]/80">Статус загрузки: {uploadStatus}</p>
          {uploadError && <p className="mt-1 text-xs text-rose-200">{uploadError}</p>}
        </div>

        <input
          ref={uploadRef}
          type="file"
          accept=".stl,.obj,.glb,.gltf"
          onChange={handleUploadChange}
          className="hidden"
        />

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside className="rounded-2xl border border-white/15 bg-[#060a10]/82 p-3 xl:sticky xl:top-[142px] xl:h-[calc(100vh-158px)] xl:overflow-y-auto">
            <h2 className="mb-3 text-lg font-semibold tracking-wide">ЛЕВАЯ КОЛОНКА: МОДЕЛЬ</h2>

            <section className="rounded-xl border border-white/10 bg-[#050a0f]/72 p-3">
              <h3 className="text-base font-semibold text-white">Источник</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadOpen}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                >
                  Загрузить файл
                </button>
                <button
                  type="button"
                  onClick={() => handlePickStoreModel(STORE_MODELS[0].id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                >
                  Из магазина
                </button>
                <button
                  type="button"
                  onClick={() => handlePickRecentModel(RECENT_MODELS[0].id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                >
                  Недавние
                </button>
              </div>

              {sourceTab === "store" && (
                <select
                  value={selectedModel?.source === "store" ? selectedModel.id : STORE_MODELS[0].id}
                  onChange={(event) => handlePickStoreModel(event.target.value)}
                  className="mt-3 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
                >
                  {STORE_MODELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}

              {sourceTab === "recent" && (
                <select
                  value={selectedModel?.source === "recent" ? selectedModel.id : RECENT_MODELS[0].id}
                  onChange={(event) => handlePickRecentModel(event.target.value)}
                  className="mt-3 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
                >
                  {RECENT_MODELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}

              <p className="mt-3 text-xs text-white/65">{selectedInfo}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadOpen}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                >
                  Заменить
                </button>
                <button
                  type="button"
                  onClick={handleClearModel}
                  disabled={!selectedModel}
                  title={!selectedModel ? "Сначала выберите модель" : undefined}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={handleDownloadModel}
                  disabled={!selectedModel?.fileUrl}
                  title={!selectedModel?.fileUrl ? "Сначала выберите модель" : undefined}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Скачать
                </button>
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-white/10 bg-[#050a0f]/72 p-3">
              <h3 className="text-base font-semibold text-white">Базовые настройки</h3>

              <label className="mt-2 block text-xs text-white/55">Режим выбора технологии</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleTechControlModeChange("auto")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    techControlMode === "auto"
                      ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                      : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                  }`}
                >
                  Авто
                </button>
                <button
                  type="button"
                  onClick={() => handleTechControlModeChange("manual")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    techControlMode === "manual"
                      ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                      : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                  }`}
                >
                  Ручной
                </button>
              </div>
              <p className="mt-2 text-xs text-white/55">
                {techControlMode === "auto"
                  ? `Технология определена автоматически: ${autoDetectedTech}.`
                  : "Ручной режим: можно переключать SLA/FDM."}
              </p>

              <label className="mt-3 block text-xs text-white/55">Технология печати</label>
              <div className="mt-1 flex gap-2">
                {(["SLA", "FDM"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTech(option)}
                    disabled={techControlMode === "auto"}
                    title={techControlMode === "auto" ? "Переключите на ручной режим" : undefined}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      tech === option
                        ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                        : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <label className="mt-3 block text-xs text-white/55">Материал</label>
              <select
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
              >
                {MATERIALS_BY_TECH[tech].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-xs text-white/55">Цвет</label>
              <select
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
              >
                {COLORS_BY_TECH[tech].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-xs text-white/55">Количество</label>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                  className="rounded-lg border border-white/20 px-3 py-1 text-sm transition hover:border-white/45"
                >
                  -
                </button>
                <span className="min-w-10 text-center text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => prev + 1)}
                  className="rounded-lg border border-white/20 px-3 py-1 text-sm transition hover:border-white/45"
                >
                  +
                </button>
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-white/10 bg-[#050a0f]/72 p-3">
              <h3 className="text-base font-semibold text-white">Заметки (опционально)</h3>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 400))}
                placeholder="Комментарий для мастерской"
                className="mt-2 min-h-24 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
              />

              <label className="mt-3 block text-xs text-white/55">Упаковка</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPackaging("standard")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    packaging === "standard"
                      ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                      : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                  }`}
                >
                  Стандарт
                </button>
                <button
                  type="button"
                  onClick={() => setPackaging("gift")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    packaging === "gift"
                      ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                      : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                  }`}
                >
                  Подарочная
                </button>
              </div>

              <p className="mt-3 text-xs text-white/55">Доставка и адрес указываются при оформлении.</p>
            </section>
          </aside>

          <section className="rounded-2xl border border-white/15 bg-[#060a10]/82 p-3 xl:h-[calc(100vh-158px)] xl:overflow-y-auto">
            <h2 className="text-lg font-semibold tracking-wide">ЦЕНТР: 3D ВЬЮПОРТ</h2>

            <div className="mt-3 flex h-[560px] flex-col rounded-xl border border-white/10 bg-[#050a0f]/72 p-3 xl:h-full">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/65">Окно предпросмотра</p>
                {issueMarkers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowIssues((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      showIssues
                        ? "border-rose-300/80 bg-rose-500/15 text-rose-100"
                        : "border-amber-300/60 bg-amber-500/10 text-amber-100 hover:border-amber-200"
                    }`}
                  >
                    {showIssues ? "Скрыть проблемы" : "Показать проблемы"}
                  </button>
                )}
              </div>

              <div className="relative mt-3 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,#0c141f_0%,#070d15_100%)]">
                <Canvas
                  frameloop={isMobileViewport ? "demand" : "always"}
                  shadows={!isMobileViewport}
                  dpr={isMobileViewport ? [1, 1.25] : [1, 2]}
                  gl={{
                    antialias: !isMobileViewport,
                    powerPreference: isMobileViewport ? "low-power" : "high-performance",
                  }}
                  performance={{ min: 0.5 }}
                  camera={{ position: VIEW_POSITION[viewPreset], fov: 45 }}
                >
                  <ViewportScene
                    modelUrl={selectedModel?.previewUrl}
                    tool={viewTool}
                    gridOn={showGrid}
                    plateOn={showBuildPlate}
                    issueMarkers={issueMarkers}
                    showIssues={showIssues}
                    renderMode={viewRenderMode}
                    baseColor={selectedColorHex}
                    analysisSignal={analysisSignal}
                    view={viewPreset}
                    fitSignal={fitSignal}
                    rotationDeg={rotationDeg}
                    mobileOptimized={isMobileViewport}
                    controlsRef={controlsRef}
                    onBounds={setBounds}
                    onIssueMarkers={setIssueMarkers}
                  />
                </Canvas>

                {measureMode && (
                  <div className="absolute bottom-16 right-3 rounded-md border border-[#2ED1FF]/45 bg-[#04080d]/85 px-2 py-1 text-[11px] text-[#BFF4FF]">
                    {measureLabel}
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-[#050a0f]/80 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(["orbit", "pan", "zoom"] as const).map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        setViewTool(tool);
                        setNoticeWith(`Режим вьюпорта: ${tool}.`);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase transition ${
                        viewTool === tool
                          ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                          : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                      }`}
                    >
                      {tool}
                    </button>
                  ))}

                  <select
                    value={viewPreset}
                    onChange={(event) => {
                      const next = event.target.value as ViewPreset;
                      setViewPreset(next);
                      setNoticeWith(`Вид камеры: ${VIEW_LABEL[next]}.`);
                    }}
                    className="rounded-lg border border-white/15 bg-[#0b1014] px-2 py-1.5 text-xs uppercase"
                  >
                    <option value="isometric">Вид: Изометрия</option>
                    <option value="front">Вид: Спереди</option>
                    <option value="top">Вид: Сверху</option>
                    <option value="left">Вид: Слева</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGrid((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      showGrid
                        ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                        : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                    }`}
                  >
                    Сетка
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBuildPlate((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      showBuildPlate
                        ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                        : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                    }`}
                  >
                    Стол печати
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewRenderMode((prev) => {
                        const next = prev === "final" ? "base" : "final";
                        setNoticeWith(
                          next === "base"
                            ? "Режим отображения: без текстур."
                            : "Режим отображения: с текстурами."
                        );
                        return next;
                      });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      viewRenderMode === "base"
                        ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                        : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                    }`}
                  >
                    {viewRenderMode === "base" ? "Текстуры: выкл" : "Текстуры: вкл"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeasureMode((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      measureMode
                        ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                        : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                    }`}
                  >
                    Измерить
                  </button>
                  <button
                    type="button"
                    onClick={handleResetViewport}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/45"
                  >
                    Сброс
                  </button>
                  <button
                    type="button"
                    onClick={handleFitToVolume}
                    className="rounded-lg border border-[#2ED1FF]/60 bg-[#2ED1FF]/10 px-3 py-1.5 text-xs text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                  >
                    Подогнать под объем
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-white/15 bg-[#060a10]/82 p-3 xl:sticky xl:top-[142px] xl:h-[calc(100vh-158px)]">
            <h2 className="text-lg font-semibold tracking-wide">ПРАВАЯ КОЛОНКА: НАСТРОЙКА ПЕЧАТИ</h2>

            <div className="mt-3 flex h-[560px] flex-col gap-3 xl:h-full">
              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => toggleSection("size")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Размер и масштаб</span>
                  <span className="text-xs text-white/55">{openSections.size ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.size && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="text-xs text-white/55">Высота: {heightMm} мм</label>
                    <input
                      type="range"
                      min={20}
                      max={selectedPrinter.maxHeightMm}
                      value={heightMm}
                      onChange={(event) => setHeightMm(Number(event.target.value))}
                      className="mt-2 w-full accent-[#2ED1FF]"
                    />

                    <label className="mt-3 flex items-center gap-2 text-xs text-white/65">
                      <input
                        type="checkbox"
                        checked={lockProportions}
                        onChange={() => setLockProportions((prev) => !prev)}
                        className="accent-[#2ED1FF]"
                      />
                      Фиксировать пропорции
                    </label>

                    <label className="mt-3 block text-xs text-white/55">Профиль принтера</label>
                    <select
                      value={printerProfileId}
                      onChange={(event) => setPrinterProfileId(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
                    >
                      {printerOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleAutoFit}
                      className="mt-3 rounded-lg border border-[#2ED1FF]/60 bg-[#2ED1FF]/10 px-3 py-1.5 text-xs font-semibold text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                    >
                      Автоподгонка
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("quality")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Качество</span>
                  <span className="text-xs text-white/55">{openSections.quality ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.quality && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <div className="flex flex-wrap gap-2">
                      {(["draft", "standard", "pro"] as const).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setQualityPreset(preset)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            qualityPreset === preset
                              ? "border-[#2ED1FF]/70 bg-[#2ED1FF]/15 text-[#BFF4FF]"
                              : "border-white/20 text-white/75 hover:border-[#7FE7FF]/70 hover:text-[#BFF4FF]"
                          }`}
                        >
                          {QUALITY_LABEL[preset]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("orientation")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Ориентация</span>
                  <span className="text-xs text-white/55">{openSections.orientation ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.orientation && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="text-xs text-white/55">Рекомендуемый пресет</label>
                    <select
                      value={orientationPreset}
                      onChange={(event) => setOrientationPreset(event.target.value as OrientationPreset)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#0b1014] px-2 py-2 text-sm"
                    >
                      {(["balanced", "risk", "speed"] as const).map((preset) => (
                        <option key={preset} value={preset}>
                          {ORIENTATION_LABEL[preset]}
                        </option>
                      ))}
                    </select>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={handleApplyOrientation}
                        className="rounded-lg border border-[#2ED1FF]/60 bg-[#2ED1FF]/10 px-3 py-1.5 text-xs font-semibold text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                      >
                        Применить пресет
                      </button>
                      <button
                        type="button"
                        onClick={handleManualRotate}
                        className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/45"
                      >
                        Ручной поворот
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("supports")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Поддержки</span>
                  <span className="text-xs text-white/55">{openSections.supports ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.supports && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Включить поддержки</span>
                      <input
                        type="checkbox"
                        checked={supportsEnabled}
                        onChange={() => setSupportsEnabled((prev) => !prev)}
                        className="accent-[#2ED1FF]"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("hollow")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Полая модель (только SLA)</span>
                  <span className="text-xs text-white/55">{openSections.hollow ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.hollow && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Сделать полой</span>
                      <input
                        type="checkbox"
                        checked={hollowEnabled}
                        disabled={tech !== "SLA"}
                        onChange={() => {
                          if (tech !== "SLA") {
                            setNoticeWith("Полая модель доступна только для SLA. Для FDM позже.");
                            return;
                          }
                          setHollowEnabled((prev) => !prev);
                        }}
                        title={tech !== "SLA" ? "скоро" : undefined}
                        className="accent-[#2ED1FF] disabled:cursor-not-allowed"
                      />
                    </label>
                    {tech !== "SLA" && <p className="mt-2 text-xs text-amber-200">Недоступно для FDM. Скоро.</p>}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("autofix")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Авто-фикс сетки</span>
                  <span className="text-xs text-white/55">{openSections.autofix ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.autofix && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Включить авто-фикс</span>
                      <input
                        type="checkbox"
                        checked={autoFixMesh}
                        onChange={() => setAutoFixMesh((prev) => !prev)}
                        className="accent-[#2ED1FF]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoFixRun}
                      className="mt-3 rounded-lg border border-[#2ED1FF]/60 bg-[#2ED1FF]/10 px-3 py-1.5 text-xs font-semibold text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                    >
                      Запустить авто-фикс
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("diagnostics")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#050a0f]/80 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Диагностика</span>
                  <span className="text-xs text-white/55">{openSections.diagnostics ? "Скрыть" : "Показать"}</span>
                </button>
                {openSections.diagnostics && (
                  <div className="rounded-lg border border-white/10 bg-[#050a0f]/72 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Включить диагностику</span>
                      <input
                        type="checkbox"
                        checked={diagnosticsEnabled}
                        onChange={() => setDiagnosticsEnabled((prev) => !prev)}
                        className="accent-[#2ED1FF]"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleRunDiagnostics}
                      className="mt-3 rounded-lg border border-[#2ED1FF]/60 bg-[#2ED1FF]/10 px-3 py-1.5 text-xs font-semibold text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                    >
                      Перезапустить диагностику
                    </button>

                    <ul className="mt-3 space-y-1 text-xs text-white/65">
                      {diagnostics.length === 0 && <li>Проблем не найдено.</li>}
                      {diagnostics.map((issue) => (
                        <li key={issue.id}>
                          {issue.title} ({issue.severity})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <section className="sticky bottom-0 rounded-xl border border-white/15 bg-[#05070a]/94 p-3 backdrop-blur">
                <h3 className="text-base font-semibold text-white">Сводка заказа</h3>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-white/55">Цена</span>
                  <span className="font-semibold text-white">{formatPrice(price)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-white/55">Срок</span>
                  <span className="font-semibold text-white">{formatEta(etaMinutes)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-white/55">Риск</span>
                  <span className={`font-semibold ${riskTone}`}>{risk}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-white/55">Попадание в объем</span>
                  <span className={`font-semibold ${fitTone}`}>{fitStatus}</span>
                </div>
                {scaledDimensionsMm && (
                  <p className="mt-1 text-xs text-white/55">
                    Размер модели: {formatDims(scaledDimensionsMm.x, scaledDimensionsMm.y, scaledDimensionsMm.z)}
                  </p>
                )}

                <p className="mt-3 text-xs text-white/55">Доставка: рассчитывается при оформлении.</p>
                {addToCartValidationError && (
                  <p className="mt-2 text-xs text-amber-200">{addToCartValidationError}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={Boolean(addToCartValidationError)}
                    title={addToCartValidationError ?? undefined}
                    className="flex-1 rounded-lg border border-[#2ED1FF]/70 bg-[#2ED1FF]/10 px-3 py-2 text-sm font-semibold text-[#BFF4FF] transition hover:border-[#7FE7FF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Добавить в корзину
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueCheckout}
                    disabled={Boolean(checkoutValidationError)}
                    title={checkoutValidationError ?? undefined}
                    className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Перейти к оформлению
                  </button>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default function PrintServicePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <PrintOnDemandContent />
    </Suspense>
  );
}




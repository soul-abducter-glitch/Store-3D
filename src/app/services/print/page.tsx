"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MutableRefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MOUSE } from "three";

import ModelView from "@/components/ModelView";
import { getCartStorageKey, readCartStorage, writeCartStorage } from "@/lib/cartStorage";

type SourceKind = "upload" | "store" | "recent";
type PrintTech = "SLA" | "FDM";
type QualityPreset = "draft" | "standard" | "pro";
type OrientationPreset = "balanced" | "risk" | "speed";
type ViewTool = "orbit" | "pan" | "zoom";
type ViewPreset = "isometric" | "front" | "top" | "left";
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

type IssueMarker = {
  id: string;
  position: [number, number, number];
  color: string;
};

const STEPS = ["Model", "Print setup", "Prepare", "Cart/Checkout"];

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
  SLA: ["Standard resin", "Tough resin", "Castable resin"],
  FDM: ["PLA", "PETG", "ABS"],
};

const COLORS_BY_TECH: Record<PrintTech, string[]> = {
  SLA: ["Gray", "Clear", "Black"],
  FDM: ["Black", "White", "Red"],
};

const PRINTER_PROFILES: PrinterProfile[] = [
  { id: "sla-small", label: "SLA 120 x 68 x 155 mm", tech: "SLA", maxWidthMm: 120, maxDepthMm: 68, maxHeightMm: 155 },
  { id: "sla-large", label: "SLA 220 x 130 x 250 mm", tech: "SLA", maxWidthMm: 220, maxDepthMm: 130, maxHeightMm: 250 },
  { id: "fdm-small", label: "FDM 220 x 220 x 250 mm", tech: "FDM", maxWidthMm: 220, maxDepthMm: 220, maxHeightMm: 250 },
  { id: "fdm-xl", label: "FDM 300 x 300 x 320 mm", tech: "FDM", maxWidthMm: 300, maxDepthMm: 300, maxHeightMm: 320 },
];

const QUALITY_LABEL: Record<QualityPreset, string> = {
  draft: "Draft",
  standard: "Standard",
  pro: "Pro",
};

const ORIENTATION_LABEL: Record<OrientationPreset, string> = {
  balanced: "Balanced",
  risk: "Min risk",
  speed: "Min time",
};

const VIEW_LABEL: Record<ViewPreset, string> = {
  isometric: "Isometric",
  front: "Front",
  top: "Top",
  left: "Left",
};

const VIEW_POSITION: Record<ViewPreset, [number, number, number]> = {
  isometric: [3.4, 2.6, 3.8],
  front: [0, 2.1, 6],
  top: [0.01, 6.4, 0.01],
  left: [6, 2, 0],
};

const ISSUE_MARKERS: IssueMarker[] = [
  { id: "issue-1", position: [0.38, 1.75, 0.35], color: "#fb7185" },
  { id: "issue-2", position: [-0.52, 1.22, -0.2], color: "#fbbf24" },
  { id: "issue-3", position: [0.05, 0.82, 0.63], color: "#34d399" },
];

const BASE_DIAGNOSTICS: Issue[] = [
  { id: "wall", title: "Thin walls near base", severity: "medium" },
  { id: "overhang", title: "Overhang above 58°", severity: "high" },
  { id: "hole", title: "Small open contour", severity: "low" },
];

const formatPrice = (value: number) => {
  const rounded = Math.max(0, Math.round(value));
  return `${new Intl.NumberFormat("ru-RU").format(rounded)} ₽`;
};

const formatEta = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `~${mins}m`;
  if (mins === 0) return `~${hours}h`;
  return `~${hours}h ${mins}m`;
};

const formatDims = (x: number, y: number, z: number) =>
  `${x.toFixed(1)} x ${y.toFixed(1)} x ${z.toFixed(1)} mm`;

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
  showIssues,
  view,
  fitSignal,
  rotationDeg,
  controlsRef,
  onBounds,
}: {
  modelUrl?: string;
  tool: ViewTool;
  gridOn: boolean;
  plateOn: boolean;
  showIssues: boolean;
  view: ViewPreset;
  fitSignal: number;
  rotationDeg: number;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  onBounds: (bounds: ModelBounds) => void;
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
      <Environment preset="city" />

      {gridOn && <Grid args={[10, 10]} cellSize={0.5} cellThickness={0.45} sectionSize={2} />}

      {plateOn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
          <circleGeometry args={[2.2, 64]} />
          <meshStandardMaterial color="#12445a" roughness={0.65} metalness={0.1} opacity={0.5} transparent />
        </mesh>
      )}

      {showIssues &&
        ISSUE_MARKERS.map((marker) => (
          <mesh key={marker.id} position={marker.position}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial color={marker.color} emissive={marker.color} emissiveIntensity={0.9} />
          </mesh>
        ))}

      <group rotation={[0, (rotationDeg * Math.PI) / 180, 0]}>
        <Suspense fallback={null}>
          <ModelView
            rawModelUrl={modelUrl ?? null}
            finish="Raw"
            renderMode="final"
            accentColor="#2ed1ff"
            onBounds={onBounds}
          />
        </Suspense>
      </group>

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
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

  const [notice, setNotice] = useState("Ready: configure model and print setup.");
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

  const [tech, setTech] = useState<PrintTech>("SLA");
  const [material, setMaterial] = useState(MATERIALS_BY_TECH.SLA[0]);
  const [color, setColor] = useState(COLORS_BY_TECH.SLA[0]);
  const [quantity, setQuantity] = useState(1);

  const [note, setNote] = useState("");
  const [packaging, setPackaging] = useState<"standard" | "gift">("standard");

  const [viewTool, setViewTool] = useState<ViewTool>("orbit");
  const [viewPreset, setViewPreset] = useState<ViewPreset>("isometric");
  const [showGrid, setShowGrid] = useState(true);
  const [showBuildPlate, setShowBuildPlate] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [bounds, setBounds] = useState<ModelBounds | null>(null);

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

  const diagnostics = useMemo(
    () => (diagnosticsEnabled ? BASE_DIAGNOSTICS : []),
    [diagnosticsEnabled]
  );

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
          setNoticeWith("Model already uploaded. Can add to cart.");
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
        setNoticeWith("Model already uploaded. Can add to cart.");
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
        let message = "Failed to upload model.";
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
        throw new Error("Upload complete response is invalid.");
      }

      setUploadedMedia({
        id: String(data.doc.id),
        url: data.doc.url,
        filename: data.doc.filename || file.name,
      });
      setUploadStatus("ready");
      setNoticeWith("Model uploaded. Can add to cart.");
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
        throw new Error(`Failed to fetch model (${response.status}).`);
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
        ? `Model uploaded: ${file.name}`
        : `Model uploaded: ${file.name}. Preview currently supports GLB/GLTF.`
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
      setNoticeWith(`Picked from store: ${next.name}`);
      return;
    }
    void loadModelFromUrl(next.fileUrl, next.name, "store").catch((error) => {
      setUploadError(error instanceof Error ? error.message : "Failed to load model.");
      setUploadStatus("idle");
      setNoticeWith("Failed to load model from store.");
    });
  };

  const handlePickRecentModel = (modelId: string) => {
    const next = RECENT_MODELS.find((item) => item.id === modelId) ?? RECENT_MODELS[0];
    setSourceTab("recent");
    setSourceName(next.name);
    setSourceThumb(null);
    if (!next.fileUrl) {
      setNoticeWith(`Picked from recent: ${next.name}`);
      return;
    }
    void loadModelFromUrl(next.fileUrl, next.name, "recent").catch((error) => {
      setUploadError(error instanceof Error ? error.message : "Failed to load model.");
      setUploadStatus("idle");
      setNoticeWith("Failed to load model from recent.");
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
    setNoticeWith("Selection cleared.");
  };

  const handleDownloadModel = () => {
    if (!selectedModel?.fileUrl) {
      setNoticeWith("No model file is available for download.");
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = selectedModel.fileUrl;
    anchor.download = selectedModel.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setNoticeWith(`Download started: ${selectedModel.name}`);
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
      setUploadError(error instanceof Error ? error.message : "Failed to load model from URL.");
      setUploadStatus("idle");
      setNoticeWith("Failed to prefill model from source.");
    });
  }, [loadModelFromUrl, searchParams]);

  const handleAutoFit = () => {
    setHeightMm(Math.min(120, selectedPrinter.maxHeightMm));
    setNoticeWith(`Auto-fit applied for ${selectedPrinter.label}.`);
  };

  const handleApplyOrientation = () => {
    setNoticeWith(`Orientation preset applied: ${ORIENTATION_LABEL[orientationPreset]}.`);
  };

  const handleManualRotate = () => {
    setRotationDeg((prev) => (prev + 15) % 360);
    setNoticeWith("Manual rotate: +15° applied.");
  };

  const handleResetViewport = () => {
    setViewTool("orbit");
    setViewPreset("isometric");
    setShowGrid(true);
    setShowBuildPlate(true);
    setMeasureMode(false);
    setShowIssues(false);
    setRotationDeg(0);
    setFitSignal((prev) => prev + 1);
    setNoticeWith("Viewport reset.");
  };

  const handleFitToVolume = () => {
    handleAutoFit();
    setFitSignal((prev) => prev + 1);
    setNoticeWith("Model fitted to build volume.");
  };

  const handleRunDiagnostics = () => {
    setDiagnosticsEnabled(true);
    setNoticeWith("Diagnostics re-run complete.");
  };

  const handleAutoFixRun = () => {
    setAutoFixMesh(true);
    setNoticeWith("Auto-fix requested. Mesh cleanup queued.");
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
    ? `Selected: ${selectedModel.name} | Units: ${selectedModel.units} | Scale: ${(
        selectedModel.baseScale *
        (heightMm / 120)
      ).toFixed(2)}`
    : "Selected: none | Units: -- | Scale: --";

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
    ? "Awaiting model"
    : !hasPreviewGeometry
      ? "Estimate only"
      : !scaledDimensionsMm
        ? "Calculating"
        : fitsPrinterVolume
          ? "Fits"
          : "Too large";
  const fitTone =
    fitStatus === "Fits"
      ? "text-emerald-300"
      : fitStatus === "Too large"
        ? "text-rose-300"
        : "text-slate-300";

  const addToCartValidationError = useMemo(() => {
    if (!selectedModel) return "Select and upload a model first.";
    if (uploadStatus === "pending") return "Model file is selected. Wait for database upload.";
    if (uploadStatus === "uploading") return "Upload is in progress. Please wait.";
    if (uploadError) return uploadError;
    if (uploadStatus !== "ready" || !uploadedMedia?.id) {
      return "Model must be uploaded to database before adding to cart.";
    }
    if (quantity < 1) return "Quantity must be at least 1.";
    if (hasPreviewGeometry && !scaledDimensionsMm) {
      return "3D bounds are still loading. Please wait a moment.";
    }
    if (hasPreviewGeometry && scaledDimensionsMm && !fitsPrinterVolume) {
      return `Model does not fit ${volumeLabel}. Reduce height or choose a larger printer profile.`;
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
      : "Measure unavailable";

  const addCurrentModelToCart = () => {
    if (addToCartValidationError) {
      setNoticeWith(addToCartValidationError);
      return false;
    }

    if (!selectedModel || !uploadedMedia?.id) {
      setNoticeWith("Model must be uploaded to database before adding to cart.");
      return false;
    }

    const current = readCartStorage(cartStorageKey, { migrateLegacy: true });

    const item = {
      id: `custom-print:${uploadedMedia.id}`,
      productId: "service-print",
      name: sourceName ? `Печать: ${sourceName}` : selectedModel.name,
      formatKey: "physical",
      formatLabel: "Printed model",
      priceLabel: formatPrice(price),
      priceValue: Math.max(0, Math.round(price)),
      quantity,
      thumbnailUrl: sourceThumb ?? buildCartThumbnail(selectedModel.name),
      customPrint: {
        uploadId: uploadedMedia.id,
        uploadUrl: uploadedMedia.url ?? selectedModel.fileUrl,
        uploadName: uploadedMedia.filename ?? selectedModel.name,
        sourcePrice: Math.max(0, Math.round(price)),
        technology: tech === "SLA" ? "SLA Resin" : "FDM Plastic",
        material,
        quality: qualityPreset === "pro" ? "0.05mm" : qualityPreset === "draft" ? "Draft" : "0.1mm",
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
    setNoticeWith(`Added ${quantity} item(s) to cart.`);
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_25%_0%,#182533_0%,#090f17_45%,#05080d_100%)] text-slate-100">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/15 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between px-4 sm:px-6">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-cyan-200">3D STORE</p>
            <p className="text-xs text-slate-400">Print on demand</p>
          </div>

          <nav className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => router.push("/store")}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
            >
              Store
            </button>
            <button
              type="button"
              onClick={handleCartOpen}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
            >
              Cart {cartCount > 0 ? `(${cartCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
            >
              Profile
            </button>
          </nav>
        </div>
      </header>

      <div className="fixed inset-x-0 top-16 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur">
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
                      ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                      : done
                        ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-100"
                        : "border-white/15 bg-white/5 text-slate-400"
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
        <div className="mb-4 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
          {notice}
          <p className="mt-1 text-xs text-cyan-200/80">Upload status: {uploadStatus}</p>
          {uploadError && <p className="mt-1 text-xs text-rose-200">{uploadError}</p>}
        </div>

        <input
          ref={uploadRef}
          type="file"
          accept=".stl,.obj,.3mf,.glb,.gltf"
          onChange={handleUploadChange}
          className="hidden"
        />

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside className="rounded-2xl border border-white/15 bg-slate-900/70 p-3 xl:sticky xl:top-[142px] xl:h-[calc(100vh-158px)] xl:overflow-y-auto">
            <h2 className="mb-3 text-lg font-semibold tracking-wide">LEFT: MODEL</h2>

            <section className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <h3 className="text-base font-semibold text-white">Source</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadOpen}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => handlePickStoreModel(STORE_MODELS[0].id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
                >
                  From store
                </button>
                <button
                  type="button"
                  onClick={() => handlePickRecentModel(RECENT_MODELS[0].id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
                >
                  Recent
                </button>
              </div>

              {sourceTab === "store" && (
                <select
                  value={selectedModel?.source === "store" ? selectedModel.id : STORE_MODELS[0].id}
                  onChange={(event) => handlePickStoreModel(event.target.value)}
                  className="mt-3 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
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
                  className="mt-3 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
                >
                  {RECENT_MODELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}

              <p className="mt-3 text-xs text-slate-300">{selectedInfo}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadOpen}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-300/70 hover:text-cyan-100"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={handleClearModel}
                  disabled={!selectedModel}
                  title={!selectedModel ? "Select model first" : undefined}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleDownloadModel}
                  disabled={!selectedModel?.fileUrl}
                  title={!selectedModel?.fileUrl ? "Select model first" : undefined}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download
                </button>
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <h3 className="text-base font-semibold text-white">Basics</h3>

              <label className="mt-2 block text-xs text-slate-400">Tech</label>
              <div className="mt-1 flex gap-2">
                {(["SLA", "FDM"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTech(option)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      tech === option
                        ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <label className="mt-3 block text-xs text-slate-400">Material</label>
              <select
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
              >
                {MATERIALS_BY_TECH[tech].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-xs text-slate-400">Color</label>
              <select
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
              >
                {COLORS_BY_TECH[tech].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-xs text-slate-400">Quantity</label>
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

            <section className="mt-3 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <h3 className="text-base font-semibold text-white">Notes (optional)</h3>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 400))}
                placeholder="Comment for workshop"
                className="mt-2 min-h-24 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
              />

              <label className="mt-3 block text-xs text-slate-400">Packaging</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPackaging("standard")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    packaging === "standard"
                      ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                  }`}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setPackaging("gift")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    packaging === "gift"
                      ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                  }`}
                >
                  Gift
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-400">Delivery and address are set at checkout.</p>
            </section>
          </aside>

          <section className="rounded-2xl border border-white/15 bg-slate-900/70 p-3 xl:h-[calc(100vh-158px)] xl:overflow-hidden">
            <h2 className="text-lg font-semibold tracking-wide">CENTER: 3D VIEWPORT</h2>

            <div className="mt-3 flex h-[560px] flex-col rounded-xl border border-white/10 bg-slate-950/65 p-3 xl:h-full">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-300">Preview window</p>
                {diagnostics.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowIssues((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      showIssues
                        ? "border-rose-300/80 bg-rose-500/15 text-rose-100"
                        : "border-amber-300/60 bg-amber-500/10 text-amber-100 hover:border-amber-200"
                    }`}
                  >
                    {showIssues ? "Hide issues" : "Show issues"}
                  </button>
                )}
              </div>

              <div className="relative mt-3 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,#0c141f_0%,#070d15_100%)]">
                <Canvas shadows camera={{ position: VIEW_POSITION[viewPreset], fov: 45 }}>
                  <ViewportScene
                    modelUrl={selectedModel?.previewUrl}
                    tool={viewTool}
                    gridOn={showGrid}
                    plateOn={showBuildPlate}
                    showIssues={showIssues}
                    view={viewPreset}
                    fitSignal={fitSignal}
                    rotationDeg={rotationDeg}
                    controlsRef={controlsRef}
                    onBounds={setBounds}
                  />
                </Canvas>

                {measureMode && (
                  <div className="absolute bottom-16 right-3 rounded-md border border-cyan-300/50 bg-slate-950/85 px-2 py-1 text-[11px] text-cyan-100">
                    {measureLabel}
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-900/80 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(["orbit", "pan", "zoom"] as const).map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        setViewTool(tool);
                        setNoticeWith(`Viewport mode: ${tool}.`);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase transition ${
                        viewTool === tool
                          ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                          : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
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
                      setNoticeWith(`View preset: ${VIEW_LABEL[next]}.`);
                    }}
                    className="rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-xs uppercase"
                  >
                    <option value="isometric">Views: Isometric</option>
                    <option value="front">Views: Front</option>
                    <option value="top">Views: Top</option>
                    <option value="left">Views: Left</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGrid((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      showGrid
                        ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBuildPlate((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      showBuildPlate
                        ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                    }`}
                  >
                    Build plate
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeasureMode((prev) => !prev)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      measureMode
                        ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
                    }`}
                  >
                    Measure
                  </button>
                  <button
                    type="button"
                    onClick={handleResetViewport}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/45"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleFitToVolume}
                    className="rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:border-cyan-200"
                  >
                    Fit-to-volume
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-white/15 bg-slate-900/70 p-3 xl:sticky xl:top-[142px] xl:h-[calc(100vh-158px)]">
            <h2 className="text-lg font-semibold tracking-wide">RIGHT: PRINT SETUP</h2>

            <div className="mt-3 flex h-[560px] flex-col gap-3 xl:h-full">
              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => toggleSection("size")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Size and scale</span>
                  <span className="text-xs text-slate-400">{openSections.size ? "Hide" : "Show"}</span>
                </button>
                {openSections.size && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="text-xs text-slate-400">Height: {heightMm} mm</label>
                    <input
                      type="range"
                      min={20}
                      max={selectedPrinter.maxHeightMm}
                      value={heightMm}
                      onChange={(event) => setHeightMm(Number(event.target.value))}
                      className="mt-2 w-full accent-cyan-400"
                    />

                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={lockProportions}
                        onChange={() => setLockProportions((prev) => !prev)}
                        className="accent-cyan-400"
                      />
                      Lock proportions
                    </label>

                    <label className="mt-3 block text-xs text-slate-400">Printer profile</label>
                    <select
                      value={printerProfileId}
                      onChange={(event) => setPrinterProfileId(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
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
                      className="mt-3 rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200"
                    >
                      Auto-fit
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("quality")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Quality</span>
                  <span className="text-xs text-slate-400">{openSections.quality ? "Hide" : "Show"}</span>
                </button>
                {openSections.quality && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <div className="flex flex-wrap gap-2">
                      {(["draft", "standard", "pro"] as const).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setQualityPreset(preset)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            qualityPreset === preset
                              ? "border-cyan-300/80 bg-cyan-500/15 text-cyan-100"
                              : "border-white/20 text-slate-200 hover:border-cyan-300/70 hover:text-cyan-100"
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
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Orientation</span>
                  <span className="text-xs text-slate-400">{openSections.orientation ? "Hide" : "Show"}</span>
                </button>
                {openSections.orientation && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="text-xs text-slate-400">Recommended preset</label>
                    <select
                      value={orientationPreset}
                      onChange={(event) => setOrientationPreset(event.target.value as OrientationPreset)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-sm"
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
                        className="rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200"
                      >
                        Apply preset
                      </button>
                      <button
                        type="button"
                        onClick={handleManualRotate}
                        className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/45"
                      >
                        Manual rotate
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("supports")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Supports</span>
                  <span className="text-xs text-slate-400">{openSections.supports ? "Hide" : "Show"}</span>
                </button>
                {openSections.supports && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Enable supports</span>
                      <input
                        type="checkbox"
                        checked={supportsEnabled}
                        onChange={() => setSupportsEnabled((prev) => !prev)}
                        className="accent-cyan-400"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("hollow")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Hollow (SLA only)</span>
                  <span className="text-xs text-slate-400">{openSections.hollow ? "Hide" : "Show"}</span>
                </button>
                {openSections.hollow && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Enable hollow</span>
                      <input
                        type="checkbox"
                        checked={hollowEnabled}
                        disabled={tech !== "SLA"}
                        onChange={() => {
                          if (tech !== "SLA") {
                            setNoticeWith("Hollow is available only for SLA. Coming soon for FDM.");
                            return;
                          }
                          setHollowEnabled((prev) => !prev);
                        }}
                        title={tech !== "SLA" ? "coming soon" : undefined}
                        className="accent-cyan-400 disabled:cursor-not-allowed"
                      />
                    </label>
                    {tech !== "SLA" && <p className="mt-2 text-xs text-amber-200">Disabled for FDM. Coming soon.</p>}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("autofix")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Auto-fix mesh</span>
                  <span className="text-xs text-slate-400">{openSections.autofix ? "Hide" : "Show"}</span>
                </button>
                {openSections.autofix && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Enable auto-fix</span>
                      <input
                        type="checkbox"
                        checked={autoFixMesh}
                        onChange={() => setAutoFixMesh((prev) => !prev)}
                        className="accent-cyan-400"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoFixRun}
                      className="mt-3 rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200"
                    >
                      Run auto-fix
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleSection("diagnostics")}
                  className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">Diagnostics</span>
                  <span className="text-xs text-slate-400">{openSections.diagnostics ? "Hide" : "Show"}</span>
                </button>
                {openSections.diagnostics && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Enable diagnostics</span>
                      <input
                        type="checkbox"
                        checked={diagnosticsEnabled}
                        onChange={() => setDiagnosticsEnabled((prev) => !prev)}
                        className="accent-cyan-400"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleRunDiagnostics}
                      className="mt-3 rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200"
                    >
                      Re-run diagnostics
                    </button>

                    <ul className="mt-3 space-y-1 text-xs text-slate-300">
                      {diagnostics.length === 0 && <li>No issues found.</li>}
                      {diagnostics.map((issue) => (
                        <li key={issue.id}>
                          {issue.title} ({issue.severity})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <section className="sticky bottom-0 rounded-xl border border-white/15 bg-slate-950/95 p-3 backdrop-blur">
                <h3 className="text-base font-semibold text-white">Order summary</h3>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-400">Price</span>
                  <span className="font-semibold text-white">{formatPrice(price)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-400">ETA</span>
                  <span className="font-semibold text-white">{formatEta(etaMinutes)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-400">Risk</span>
                  <span className={`font-semibold ${riskTone}`}>{risk}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-400">Fit</span>
                  <span className={`font-semibold ${fitTone}`}>{fitStatus}</span>
                </div>
                {scaledDimensionsMm && (
                  <p className="mt-1 text-xs text-slate-400">
                    Model size: {formatDims(scaledDimensionsMm.x, scaledDimensionsMm.y, scaledDimensionsMm.z)}
                  </p>
                )}

                <p className="mt-3 text-xs text-slate-400">Delivery: calculated at checkout.</p>
                {addToCartValidationError && (
                  <p className="mt-2 text-xs text-amber-200">{addToCartValidationError}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={Boolean(addToCartValidationError)}
                    title={addToCartValidationError ?? undefined}
                    className="flex-1 rounded-lg border border-cyan-300/75 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add to cart
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueCheckout}
                    disabled={Boolean(checkoutValidationError)}
                    title={checkoutValidationError ?? undefined}
                    className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue to checkout
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
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <PrintOnDemandContent />
    </Suspense>
  );
}


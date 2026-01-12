"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import {
  Box3,
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  DoubleSide,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { UploadCloud, AlertTriangle, ShoppingCart } from "lucide-react";

import { ToastContainer, useToast } from "@/components/Toast";

type TechMode = "sla" | "fdm";
type QualityKey = "pro" | "standard";
type PreviewMode = "hologram" | "resin" | "plastic" | "original";

type ModelMetrics = {
  size: { x: number; y: number; z: number };
  volumeCm3: number;
};

const BED_SIZE = 200;
const BASE_FEE = 350;

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
  const edges = useMemo(() => {
    const geometry = new BoxGeometry(BED_SIZE, BED_SIZE, BED_SIZE);
    return new EdgesGeometry(geometry);
  }, []);

  return (
    <group position={[0, BED_SIZE / 2, 0]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#2ED1FF" transparent opacity={0.7} />
      </lineSegments>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -BED_SIZE / 2 + 0.5, 0]}
        receiveShadow
      >
        <planeGeometry args={[BED_SIZE, BED_SIZE]} />
        <meshStandardMaterial color="#0a141b" transparent opacity={0.25} />
      </mesh>
    </group>
  );
};

const PrintScene = ({ model }: { model: Object3D | null }) => {
  return (
    <Canvas
      shadows
      camera={{ position: [280, 170, 340], fov: 40, near: 1, far: 2000 }}
      dpr={[1, 1.5]}
      className="h-full w-full"
    >
      <color attach="background" args={["#060708"]} />
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
        enablePan={false}
        enableZoom
        minDistance={140}
        maxDistance={520}
        dampingFactor={0.08}
        enableDamping
        target={[0, 80, 0]}
      />
    </Canvas>
  );
};

export default function PrintServicePage() {
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelObject, setModelObject] = useState<Object3D | null>(null);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "analyzing" | "uploading" | "ready">(
    "idle"
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
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
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

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
        setUploadError("Поддерживаются только .stl, .obj, .glb, .gltf");
        setUploadStatus("idle");
        return;
      }

      setUploadedMedia(null);
      setMetrics(null);
      setModelObject(null);
      setUploadError(null);
      setUploadStatus("analyzing");
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

      setUploadStatus("uploading");
      console.log("Uploading file to /api/customer-upload:", file.name);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/customer-upload", {
          method: "POST",
          body: formData,
        });
        console.log("Upload response status:", response.status);

        if (!response.ok) {
          let errorMessage = "Upload failed";
          try {
            const errorData = await response.json();
            errorMessage = errorData?.error || errorData?.message || errorMessage;
            console.warn("Upload error response:", errorData);
          } catch {
            const fallbackText = await response.text().catch(() => "");
            if (fallbackText) {
              errorMessage = fallbackText;
            }
            console.warn("Upload error response (text):", fallbackText);
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log("Upload success payload:", data);
        if (!data?.doc?.id) {
          throw new Error("Upload failed");
        }

        setUploadedMedia({
          id: String(data.doc.id),
          url: data.doc.url,
          filename: data.doc.filename,
        });
        setUploadStatus("ready");
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Не удалось загрузить файл в систему.";
        setUploadError(message);
        setUploadStatus("idle");
      }
    },
    [previewMaterials, previewMode]
  );

  useEffect(() => {
    if (!modelObject) {
      return;
    }
    applyPreviewMaterial(modelObject, previewMode, previewMaterials);
  }, [modelObject, previewMaterials, previewMode]);

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

  const handleAddToCart = async () => {
    if (!uploadedMedia?.id || !metrics || !serviceProductId) {
      showError("Загрузите файл и дождитесь анализа.");
      return;
    }

    setIsAdding(true);

    const cartItem = {
      id: `custom-print:${uploadedMedia.id}`,
      productId: serviceProductId,
      name: "Печать на заказ",
      formatKey: "physical",
      formatLabel: "Печатная модель",
      priceLabel: `${formatPrice(price)} ₽`,
      priceValue: Math.round(price),
      quantity: 1,
      thumbnailUrl: buildCartThumbnail("Печать"),
      customPrint: {
        uploadId: uploadedMedia.id,
        uploadUrl: uploadedMedia.url,
        uploadName: uploadedMedia.filename,
        technology: technology === "sla" ? "SLA Resin" : "FDM Plastic",
        material,
        quality: quality === "pro" ? "0.05mm" : "0.1mm",
        dimensions: metrics.size,
        volumeCm3: metrics.volumeCm3,
      },
    };

    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem("store3d_cart") : null;
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
      showSuccess("Файл добавлен в корзину.");
    } catch {
      showError("Не удалось обновить корзину.");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.22),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />

      <header className="relative z-10 border-b border-white/10 bg-[#050505]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-2xl font-bold tracking-[0.2em] text-white">
              3D-STORE
            </Link>
            <p className="mt-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              Print Terminal
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
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

      <main className="relative z-10 mx-auto max-w-[1400px] px-6 pb-24 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              CAD PRINT SERVICE
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Печать на заказ</h1>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/60">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
            SYSTEM ONLINE
          </div>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section
            className="relative min-h-[520px] overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03] shadow-2xl"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="absolute inset-0 cad-grid-pattern opacity-30" />
            <div className="absolute inset-0">
              <div className="absolute left-10 top-10 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.12),transparent_70%)] blur-xl" />
              <div className="absolute bottom-8 right-10 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.12),transparent_70%)] blur-xl" />
            </div>

            <div className="relative h-full">
              <PrintScene model={modelObject} />
            </div>

            {!modelObject && (
              <div
                className={`pointer-events-none absolute inset-6 flex items-center justify-center rounded-[28px] border border-dashed text-center text-xs uppercase tracking-[0.3em] ${
                  dragActive
                    ? "border-[#2ED1FF] bg-[#2ED1FF]/10 text-[#BFF4FF]"
                    : "border-white/15 bg-black/20 text-white/50"
                }`}
              >
                <div className="max-w-xs space-y-3">
                  <UploadCloud className="mx-auto h-10 w-10 text-[#2ED1FF]" />
                  <p>Бросьте STL или OBJ</p>
                  <p className="text-[10px] tracking-[0.25em] text-white/40">
                    ПОДДЕРЖИВАЕМЫЕ ФОРМАТЫ: .STL, .OBJ (MAX 100MB)
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#2ED1FF]/50 bg-[#050505]/80 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] backdrop-blur transition hover:border-[#7FE7FF]"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="h-4 w-4" />
              {modelObject ? "Заменить файл" : "Загрузить файл"}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".stl,.obj,.glb,.gltf,application/sla,model/stl,model/gltf-binary,text/plain"
              className="hidden"
              onChange={handleFilePick}
            />

            {(uploadError || uploadStatus === "uploading" || uploadStatus === "analyzing") && (
              <div className="absolute left-6 top-6 flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 backdrop-blur">
                {uploadError ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span>{uploadError}</span>
                  </>
                ) : uploadStatus === "analyzing" ? (
                  <span>АНАЛИЗ МОДЕЛИ...</span>
                ) : (
                  <span>ЗАГРУЗКА В ХРАНИЛИЩЕ...</span>
                )}
              </div>
            )}
            {isPreviewScaled && (
              <div className="absolute right-6 top-6 rounded-full border border-[#2ED1FF]/40 bg-[#0b1014]/80 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF]">
                ПРЕДПРОСМОТР МАСШТАБИРОВАН
              </div>
            )}
          </section>

          <aside className="space-y-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
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
                    <span>{metrics ? `${formatNumber(metrics.volumeCm3)} cm³` : "--"}</span>
                  </div>
                </div>
                {!fitsBed && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-red-200">
                    Модель больше 200mm
                  </div>
                )}
              </div>
            </div>

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

            <div className="space-y-3">
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

            <div className="space-y-3">
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
              disabled={!uploadedMedia?.id || uploadStatus !== "ready" || !serviceProductId || isAdding}
              className="w-full rounded-full bg-[#D4AF37] px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition hover:bg-[#f5d57a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAdding ? "Добавляем..." : "ДОБАВИТЬ В КОРЗИНУ"}
            </button>
            {!serviceProductId && (
              <p className="text-xs text-white/50">
                Подключаем сервисный продукт. Обновите страницу через пару секунд.
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}


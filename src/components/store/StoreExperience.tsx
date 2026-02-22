"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, OrbitControls, Stage } from "@react-three/drei";
import type { WebGLRendererParameters } from "three";

import ModelView, { type RenderMode } from "@/components/ModelView";

type ModelBounds = {
  size: number;
  boxSize: [number, number, number];
  radius: number;
};

type FinishMode = "raw" | "pro";
type PreviewMode = "default" | "interior" | "ar";
type LightingMode = "sun" | "side" | "golden";

type StoreExperienceProps = {
  autoRotate: boolean;
  renderMode: RenderMode;
  finish: FinishMode;
  preview: PreviewMode;
  lightingMode: LightingMode;
  accentColor: string;
  rawModelUrl?: string | null;
  paintedModelUrl?: string | null;
  modelScale?: number | null;
  controlsRef: MutableRefObject<any | null>;
  onBounds?: (bounds: ModelBounds) => void;
  onStats?: (stats: { polyCount: number; meshCount: number }) => void;
  onReady?: () => void;
};

type CameraFitterProps = {
  bounds: ModelBounds | null;
  url: string;
  scale: number;
  controlsRef: MutableRefObject<any | null>;
  cameraFitRef: MutableRefObject<string | null>;
};

function CameraFitter({ bounds, url, scale, controlsRef, cameraFitRef }: CameraFitterProps) {
  const { camera } = useThree();

  useEffect(() => {
    if (!bounds) return;
    const fitKey = `${url}:${scale.toFixed(4)}`;
    if (cameraFitRef.current === fitKey) return;
    camera.position.set(5, 5, 5);
    camera.updateProjectionMatrix();
    if (controlsRef.current?.target) {
      controlsRef.current.target.set(0, 1.2, 0);
      controlsRef.current.update?.();
    }
    cameraFitRef.current = fitKey;
  }, [bounds, camera, cameraFitRef, controlsRef, scale, url]);

  return null;
}

export default function StoreExperience({
  autoRotate,
  renderMode,
  finish,
  preview,
  lightingMode,
  accentColor,
  rawModelUrl,
  paintedModelUrl,
  modelScale: _modelScale,
  controlsRef,
  onBounds,
  onStats,
  onReady,
}: StoreExperienceProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [modelBounds, setModelBounds] = useState<ModelBounds | null>(null);
  const [lockedScale, setLockedScale] = useState<number | null>(null);
  const lastModelUrlRef = useRef<string | null>(null);
  const cameraFitRef = useRef<string | null>(null);
  const isAR = preview === "ar";
  const modelFinish = finish === "pro" ? "Painted" : "Raw";
  const modelUrl = rawModelUrl ?? "/models/DamagedHelmet.glb";
  const isWireframe = renderMode === "wireframe";
  const targetSize = 3.5;
  const baseSize = modelBounds?.size ?? targetSize;
  const autoScale = baseSize > 0 ? targetSize / baseSize : 1;
  const clampedAutoScale = Math.min(Math.max(autoScale, 0.2), 8);
  const finalScale = lockedScale ?? clampedAutoScale;
  const boxSize = modelBounds?.boxSize ?? [1, 1, 1];
  const shadowScale = Math.max(boxSize[0], boxSize[2]) * finalScale * 1.2;
  const shadowY = 0;

  const lightingConfig = useMemo(() => {
    switch (lightingMode) {
      case "side":
        return { preset: "city" as const, intensity: 1.4 };
      case "golden":
        return { preset: "sunset" as const, intensity: 1.2 };
      case "sun":
      default:
        return { preset: "studio" as const, intensity: 1.6 };
    }
  }, [lightingMode]);

  const isLowQuality = isMobile;
  const glConfig = useMemo<Partial<WebGLRendererParameters>>(
    () => ({
      antialias: !isLowQuality,
      alpha: true,
      powerPreference: isLowQuality ? "low-power" : "high-performance",
    }),
    [isLowQuality]
  );
  const dpr = useMemo<number | [number, number]>(
    () => (isLowQuality ? 1 : ([1, 2] as [number, number])),
    [isLowQuality]
  );
  const cameraConfig = useMemo(
    () => ({
      position: [5, 5, 5] as [number, number, number],
      fov: 42,
      near: 0.1,
      far: 1000,
    }),
    []
  );
  const environmentIntensity = isLowQuality
    ? Math.max(0.6, lightingConfig.intensity * 0.75)
    : lightingConfig.intensity;
  const environmentResolution = isLowQuality ? 128 : 256;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
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

  const handleBounds = useCallback(
    (bounds: ModelBounds) => {
      setModelBounds(bounds);
      onBounds?.(bounds);
    },
    [onBounds]
  );

  useEffect(() => {
    if (modelUrl !== lastModelUrlRef.current) {
      lastModelUrlRef.current = modelUrl;
      setLockedScale(null);
      cameraFitRef.current = null;
      return;
    }
    if (!modelBounds || lockedScale !== null) return;
    setLockedScale(clampedAutoScale);
  }, [modelUrl, modelBounds, lockedScale, clampedAutoScale]);

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
      frameloop={autoRotate ? "always" : "demand"}
      camera={cameraConfig}
      dpr={dpr}
      className="h-full w-full"
      gl={glConfig}
      style={{
        touchAction: "none",
        cursor: isMobile ? "default" : isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={stopPropagation}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={stopPropagation}
    >
      <CameraFitter
        bounds={modelBounds}
        url={modelUrl}
        scale={finalScale}
        controlsRef={controlsRef}
        cameraFitRef={cameraFitRef}
      />
      {lightingMode === "sun" && (
        <>
          <ambientLight intensity={0.25} />
          <directionalLight position={[3, 6, 2]} intensity={1.2} color="#fff7e8" />
          <directionalLight position={[-3, 1.5, -2]} intensity={0.3} color="#dbe8ff" />
        </>
      )}
      {lightingMode === "side" && (
        <>
          <ambientLight intensity={0.2} />
          <directionalLight position={[6, 3, 0]} intensity={1.3} color="#f0f6ff" />
          <directionalLight position={[-2, 1.5, 4]} intensity={0.35} color="#e8f0ff" />
        </>
      )}
      {lightingMode === "golden" && (
        <>
          <ambientLight intensity={0.15} />
          <directionalLight position={[5, 2.2, 3.5]} intensity={1.1} color="#ffcc8a" />
          <directionalLight position={[-3, 1.5, -2]} intensity={0.25} color="#cfe0ff" />
        </>
      )}
      <Stage environment={null} intensity={1} shadows={false} adjustCamera={false} center={{ disable: true }}>
        <group scale={finalScale}>
          <ModelView
            rawModelUrl={modelUrl}
            paintedModelUrl={paintedModelUrl}
            finish={modelFinish}
            renderMode={renderMode}
            accentColor={accentColor}
            onBounds={handleBounds}
            onStats={onStats}
            onReady={onReady}
          />
        </group>
      </Stage>
      {!isLowQuality && (
        <ContactShadows
          key={`shadow-${shadowScale}`}
          position={[0, shadowY, 0]}
          scale={shadowScale}
          opacity={0.6}
          blur={1.6}
          far={shadowScale * 0.8}
        />
      )}
      {isAR && (
        <Grid
          position={[0, 0, 0]}
          cellSize={0.3}
          cellThickness={0.6}
          cellColor="#2ED1FF"
          sectionSize={Math.max(1.5, shadowScale * 0.6)}
          sectionThickness={1}
          sectionColor="#2ED1FF"
          fadeDistance={Math.max(12, shadowScale * 4)}
          fadeStrength={1}
          infiniteGrid
        />
      )}
      <Environment
        preset={lightingConfig.preset}
        environmentIntensity={environmentIntensity}
        resolution={environmentResolution}
      />
      <OrbitControls
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={isMobile ? 0.35 : isWireframe ? 0.5 : 0.6}
        rotateSpeed={isMobile ? 0.6 : isWireframe ? 0.8 : 1}
        enablePan={false}
        enableDamping
        dampingFactor={0.05}
        enableZoom={false}
        minDistance={2}
        maxDistance={10}
        ref={controlsRef}
      />
    </Canvas>
  );
}

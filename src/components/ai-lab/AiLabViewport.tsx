"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Sparkles } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PointsMaterial,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from "three";

import type { ModelIssueMarker, ModelMaterialOverride, RenderMode } from "@/components/ModelView";

const LazyModelView = dynamic(() => import("@/components/ModelView"), {
  ssr: false,
});

const MODEL_STAGE_OFFSET = -0.95;
const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type AiLabViewportProps = {
  isSynthRunning: boolean;
  viewportAutoRotate: boolean;
  viewerQuality: "performance" | "quality";
  viewportCameraPosition: [number, number, number];
  viewportCameraFov: number;
  viewportShowGrid: boolean;
  activePreviewModel: string | null;
  modelScale: number;
  effectiveViewportRenderMode: RenderMode;
  activeTextureTint: string;
  activeMaterialOverride: ModelMaterialOverride | null;
  onBounds: (bounds: { size: number; boxSize: [number, number, number]; radius: number }) => void;
  onStats: (stats: { polyCount: number; meshCount: number }) => void;
  onIssueMarkers: (markers: ModelIssueMarker[]) => void;
  viewerIssuesOverlay: boolean;
  viewerThicknessPreview: boolean;
  viewportIssueMarkers: ModelIssueMarker[];
  viewportMouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
  viewportEnvironmentPreset: "city" | "studio" | "night";
  displayProgress: number;
};

function NeuralCore({ active, progress = 0 }: { active: boolean; progress?: number }) {
  const groupRef = useRef<Group | null>(null);
  const geometryRef = useRef<BufferGeometry | null>(null);
  const frameGeometryRef = useRef<BufferGeometry | null>(null);
  const materialRef = useRef<PointsMaterial | null>(null);
  const frameMaterialRef = useRef<LineBasicMaterial | null>(null);
  const scanRingRef = useRef<Mesh | null>(null);
  const scanRingMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const pointsCount = 4200;
  const [finalPositions, shapeA, shapeB, streamPositions, phases, colors] = useMemo(() => {
    const finalShape = new Float32Array(pointsCount * 3);
    const phaseA = new Float32Array(pointsCount * 3);
    const phaseB = new Float32Array(pointsCount * 3);
    const stream = new Float32Array(pointsCount * 3);
    const phase = new Float32Array(pointsCount);
    const colorArray = new Float32Array(pointsCount * 3);
    const cold = new Color("#9EDBFF");
    const white = new Color("#FFFFFF");
    const warm = new Color("#BFFCFF");
    const tmp = new Color();

    const sampleFigurePoint = () => {
      const area = Math.random();
      if (area < 0.2) {
        const theta = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * 0.33;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius * 0.82;
        const y = 1.18 + (Math.random() - 0.5) * 0.34;
        return [x, y, z] as const;
      }
      if (area < 0.68) {
        const x = (Math.random() - 0.5) * 0.95;
        const z = (Math.random() - 0.5) * 0.5;
        const y = 0.32 + Math.random() * 0.88;
        return [x, y, z] as const;
      }
      const left = Math.random() > 0.5 ? -1 : 1;
      const x = left * (0.15 + Math.random() * 0.24) + (Math.random() - 0.5) * 0.09;
      const z = (Math.random() - 0.5) * 0.42;
      const y = -0.64 + Math.random() * 1.02;
      return [x, y, z] as const;
    };
    const sampleBrandGlyphPoint = () => {
      const branch = Math.random();
      if (branch < 0.34) {
        const t = Math.random();
        const x = -0.95 + t * 0.78;
        const y = 0.86 - t * 1.55;
        const z = (Math.random() - 0.5) * 0.2;
        return [x, y, z] as const;
      }
      if (branch < 0.68) {
        const t = Math.random();
        const x = 0.95 - t * 0.78;
        const y = 0.86 - t * 1.55;
        const z = (Math.random() - 0.5) * 0.2;
        return [x, y, z] as const;
      }
      const t = Math.random();
      const x = -0.15 + t * 0.3;
      const y = -0.58 + t * 1.05;
      const z = (Math.random() - 0.5) * 0.22;
      return [x, y, z] as const;
    };
    const sampleHelixPoint = () => {
      const t = Math.random();
      const turns = 2.8;
      const angle = t * Math.PI * 2 * turns;
      const radius = 0.2 + (1 - t) * 0.23;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = -0.92 + t * 2.02;
      return [x, y, z] as const;
    };

    for (let i = 0; i < pointsCount; i += 1) {
      const [x, y, z] = sampleFigurePoint();
      const [ax, ay, az] = sampleBrandGlyphPoint();
      const [bx, by, bz] = sampleHelixPoint();
      const base = i * 3;
      finalShape[base] = x;
      finalShape[base + 1] = y;
      finalShape[base + 2] = z;
      phaseA[base] = ax;
      phaseA[base + 1] = ay;
      phaseA[base + 2] = az;
      phaseB[base] = bx;
      phaseB[base + 1] = by;
      phaseB[base + 2] = bz;

      const lane = Math.random() > 0.5 ? 1 : -1;
      stream[base] = lane * (0.95 + Math.random() * 0.95);
      stream[base + 1] = -1.15 + Math.random() * 2.45;
      stream[base + 2] = (Math.random() - 0.5) * 0.95;

      phase[i] = Math.random() * Math.PI * 2;

      const yNorm = clampNumber((y + 1.2) / 2.5, 0, 1);
      tmp.copy(cold).lerp(white, yNorm * 0.65).lerp(warm, Math.random() * 0.25);
      colorArray[base] = tmp.r;
      colorArray[base + 1] = tmp.g;
      colorArray[base + 2] = tmp.b;
    }
    return [finalShape, phaseA, phaseB, stream, phase, colorArray] as const;
  }, []);

  const framePositions = useMemo(() => {
    const lines: number[] = [];
    const add = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      lines.push(x1, y1, z1, x2, y2, z2);
    };
    const radius = 1.12;
    const topY = 1.28;
    const bottomY = -0.95;
    const points = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
    });
    for (let i = 0; i < points.length; i += 1) {
      const [x1, z1] = points[i];
      const [x2, z2] = points[(i + 1) % points.length];
      add(x1, bottomY, z1, x2, bottomY, z2);
      add(x1 * 0.8, topY, z1 * 0.8, x2 * 0.8, topY, z2 * 0.8);
      add(x1, bottomY, z1, x1 * 0.8, topY, z1 * 0.8);
    }
    add(-0.9, 0.2, 0, 0.9, 0.2, 0);
    add(0, -0.7, -0.65, 0, 1.05, 0.65);
    add(-0.55, -0.6, 0.5, 0.55, 0.95, -0.5);
    return new Float32Array(lines);
  }, []);

  const livePositions = useMemo(() => new Float32Array(streamPositions), [streamPositions]);

  useEffect(() => {
    if (!geometryRef.current) return;
    geometryRef.current.setAttribute("position", new BufferAttribute(livePositions, 3));
    geometryRef.current.setAttribute("color", new BufferAttribute(colors, 3));
    geometryRef.current.computeBoundingSphere();
  }, [colors, livePositions]);

  useEffect(() => {
    if (!frameGeometryRef.current) return;
    frameGeometryRef.current.setAttribute("position", new BufferAttribute(framePositions, 3));
    frameGeometryRef.current.computeBoundingSphere();
  }, [framePositions]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const progress01 = active ? clampNumber(progress / 100, 0, 1) : 0;
    const revealBase = 0.1 + progress01 * 1.2;
    const phaseAB = clampNumber((progress01 - 0.02) / 0.34, 0, 1);
    const phaseBC = clampNumber((progress01 - 0.36) / 0.42, 0, 1);

    for (let i = 0; i < pointsCount; i += 1) {
      const base = i * 3;
      const midX = shapeA[base] * (1 - phaseAB) + shapeB[base] * phaseAB;
      const midY = shapeA[base + 1] * (1 - phaseAB) + shapeB[base + 1] * phaseAB;
      const midZ = shapeA[base + 2] * (1 - phaseAB) + shapeB[base + 2] * phaseAB;
      const targetX = midX * (1 - phaseBC) + finalPositions[base] * phaseBC;
      const targetY = midY * (1 - phaseBC) + finalPositions[base + 1] * phaseBC;
      const targetZ = midZ * (1 - phaseBC) + finalPositions[base + 2] * phaseBC;

      const jitterOrder = ((Math.sin(phases[i] * 1.3) + 1) / 2) * 0.1;
      const yOrder = clampNumber((targetY + 1.2) / 2.5, 0, 1);
      const reveal = clampNumber((revealBase - yOrder - jitterOrder) / 0.36, 0, 1);
      const mix = active ? reveal : 0;
      const flutter = (1 - mix) * 0.14 + 0.012;

      const waveX = Math.sin(t * 3.2 + phases[i] * 1.1) * flutter;
      const waveY = Math.cos(t * 3.6 + phases[i] * 0.8) * flutter;
      const waveZ = Math.sin(t * 2.7 + phases[i] * 1.4) * flutter;

      livePositions[base] = streamPositions[base] * (1 - mix) + targetX * mix + waveX;
      livePositions[base + 1] = streamPositions[base + 1] * (1 - mix) + targetY * mix + waveY;
      livePositions[base + 2] = streamPositions[base + 2] * (1 - mix) + targetZ * mix + waveZ;
    }

    const attr = geometryRef.current?.getAttribute("position");
    if (attr) attr.needsUpdate = true;
    if (materialRef.current) {
      materialRef.current.opacity = active ? 0.85 : 0.58;
      materialRef.current.size = active ? 0.025 : 0.018;
    }
    if (frameMaterialRef.current) {
      frameMaterialRef.current.opacity = active ? 0.18 + progress01 * 0.42 : 0.12;
    }
    if (scanRingRef.current) {
      const travel = active ? ((t * 0.45) % 1) : 0;
      scanRingRef.current.position.y = -0.9 + travel * 2.15;
      scanRingRef.current.scale.setScalar(1 + Math.sin(t * 4.6) * 0.02);
    }
    if (scanRingMaterialRef.current) {
      scanRingMaterialRef.current.opacity = active ? 0.18 + Math.sin(t * 4) * 0.05 : 0.08;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.35) * 0.09;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.15, 0]}>
      <lineSegments>
        <bufferGeometry ref={frameGeometryRef} />
        <lineBasicMaterial
          ref={frameMaterialRef}
          color="#8CCBFF"
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
        />
      </lineSegments>
      <mesh ref={scanRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
        <ringGeometry args={[0.22, 0.92, 72]} />
        <meshBasicMaterial
          ref={scanRingMaterialRef}
          color="#BFE9FF"
          transparent
          opacity={0.2}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <points frustumCulled={false}>
        <bufferGeometry ref={geometryRef} />
        <pointsMaterial
          ref={materialRef}
          vertexColors
          size={0.024}
          transparent
          opacity={0.88}
          depthWrite={false}
          blending={AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <Sparkles count={80} scale={2.8} size={1.15} color="#D6ECFF" speed={0.22} opacity={0.22} />
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

function ViewportIssueMarkers({ markers, thinOnly = false }: { markers: ModelIssueMarker[]; thinOnly?: boolean }) {
  const visibleMarkers = useMemo(
    () =>
      (Array.isArray(markers) ? markers : []).filter((marker) =>
        thinOnly ? marker.id.startsWith("thin") : true
      ),
    [markers, thinOnly]
  );

  if (visibleMarkers.length === 0) return null;

  return (
    <group>
      {visibleMarkers.map((marker) => (
        <group key={marker.id} position={marker.position}>
          <mesh>
            <sphereGeometry args={[0.045, 16, 16]} />
            <meshBasicMaterial color={marker.color} transparent opacity={0.95} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <ringGeometry args={[0.07, 0.12, 24]} />
            <meshBasicMaterial
              color={marker.color}
              transparent
              opacity={0.72}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function AiLabViewport({
  isSynthRunning,
  viewportAutoRotate,
  viewerQuality,
  viewportCameraPosition,
  viewportCameraFov,
  viewportShowGrid,
  activePreviewModel,
  modelScale,
  effectiveViewportRenderMode,
  activeTextureTint,
  activeMaterialOverride,
  onBounds,
  onStats,
  onIssueMarkers,
  viewerIssuesOverlay,
  viewerThicknessPreview,
  viewportIssueMarkers,
  viewportMouseButtons,
  viewportEnvironmentPreset,
  displayProgress,
}: AiLabViewportProps) {
  return (
    <Canvas
      frameloop={isSynthRunning || viewportAutoRotate ? "always" : "demand"}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      dpr={viewerQuality === "performance" ? [1, 1.2] : [1, 1.8]}
      camera={{ position: viewportCameraPosition, fov: viewportCameraFov }}
      className="h-full w-full"
    >
      <ambientLight intensity={0.65} />
      <ReactorLights active={isSynthRunning} />
      <FloorPulse active={isSynthRunning} />
      {viewportShowGrid && (
        <Grid
          infiniteGrid
          sectionColor="#152b36"
          cellColor="#0b2230"
          fadeDistance={16}
          fadeStrength={4}
          position={[0, -1.2, 0]}
        />
      )}
      <Suspense fallback={null}>
        {activePreviewModel ? (
          <group position={[0, MODEL_STAGE_OFFSET, 0]} scale={modelScale}>
            <LazyModelView
              rawModelUrl={activePreviewModel}
              paintedModelUrl={null}
              finish="Raw"
              renderMode={effectiveViewportRenderMode}
              accentColor="#2ED1FF"
              baseColor={activeTextureTint}
              materialOverride={activeMaterialOverride}
              onBounds={onBounds}
              onStats={onStats}
              onIssueMarkers={onIssueMarkers}
            />
          </group>
        ) : isSynthRunning ? (
          <NeuralCore active progress={displayProgress} />
        ) : null}
        {(viewerIssuesOverlay || viewerThicknessPreview) && (
          <ViewportIssueMarkers markers={viewportIssueMarkers} thinOnly={viewerThicknessPreview} />
        )}
      </Suspense>
      <OrbitControls
        enableRotate
        enablePan
        enableZoom
        mouseButtons={viewportMouseButtons}
        enableDamping
        autoRotate={viewportAutoRotate}
      />
      <Environment preset={viewportEnvironmentPreset} />
    </Canvas>
  );
}

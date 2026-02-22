"use client";

import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MOUSE } from "three";

import ModelView, { type ModelIssueMarker } from "@/components/ModelView";

type ViewTool = "orbit" | "pan" | "zoom";
type ViewPreset = "isometric" | "front" | "top" | "left";
type ViewRenderMode = "final" | "base";
type ModelBounds = {
  size: number;
  boxSize: [number, number, number];
  radius: number;
};
type IssueMarker = ModelIssueMarker;

const VIEW_POSITION: Record<ViewPreset, [number, number, number]> = {
  isometric: [3.4, 2.6, 3.8],
  front: [0, 2.1, 6],
  top: [0.01, 6.4, 0.01],
  left: [6, 2, 0],
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

type PrintViewportProps = {
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
  onBounds: (bounds: ModelBounds) => void;
  onIssueMarkers: (markers: IssueMarker[]) => void;
};

export default function PrintViewport({
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
  onBounds,
  onIssueMarkers,
}: PrintViewportProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

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
    <Canvas
      frameloop={mobileOptimized ? "demand" : "always"}
      shadows={!mobileOptimized}
      dpr={mobileOptimized ? [1, 1.25] : [1, 1.6]}
      gl={{
        antialias: !mobileOptimized,
        powerPreference: mobileOptimized ? "low-power" : "high-performance",
      }}
      performance={{ min: 0.5 }}
      camera={{ position: VIEW_POSITION[view], fov: 45 }}
    >
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
    </Canvas>
  );
}

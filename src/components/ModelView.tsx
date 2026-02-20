"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import type { Material } from "three";
import { Box3, Color, Mesh, SRGBColorSpace, Sphere, Vector3, type Object3D } from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { resolveAssetUrl, type Finish } from "@/lib/products";

export type RenderMode = "final" | "wireframe" | "base";
export type ModelIssueMarker = {
  id: string;
  position: [number, number, number];
  color: string;
  title: string;
  severity: "low" | "medium" | "high";
};

export type ModelMaterialOverride = {
  baseColor?: string;
  baseColorMapUrl?: string | null;
  roughness?: number;
  metalness?: number;
};

type ModelViewProps = {
  rawModelUrl?: string | null;
  paintedModelUrl?: string | null;
  finish: Finish;
  renderMode: RenderMode;
  accentColor: string;
  baseColor?: string;
  materialOverride?: ModelMaterialOverride | null;
  analysisSignal?: number;
  onBounds?: (bounds: {
    size: number;
    boxSize: [number, number, number];
    radius: number;
  }) => void;
  onStats?: (stats: {
    polyCount: number;
    meshCount: number;
  }) => void;
  onIssueMarkers?: (markers: ModelIssueMarker[]) => void;
  onReady?: () => void;
};

const FALLBACK_MODEL = "https://modelviewer.dev/shared-assets/models/Astronaut.glb";
const TRANSPARENT_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

export default function ModelView({
  rawModelUrl,
  paintedModelUrl,
  finish,
  renderMode,
  accentColor,
  baseColor,
  materialOverride,
  analysisSignal,
  onBounds,
  onStats,
  onIssueMarkers,
  onReady,
}: ModelViewProps) {
  const readyNotifiedRef = useRef(false);
  const activeUrl = useMemo(() => {
    if (finish === "Painted" && paintedModelUrl) {
      return resolveAssetUrl(paintedModelUrl);
    }
    return resolveAssetUrl(rawModelUrl);
  }, [finish, rawModelUrl, paintedModelUrl]);

  const resolvedUrl = activeUrl ?? FALLBACK_MODEL;

  useEffect(() => {
    readyNotifiedRef.current = false;
  }, [resolvedUrl]);
  const gltf = useGLTF(resolvedUrl);
  const scene = useMemo(() => cloneSkeleton(gltf.scene), [gltf.scene]);
  const originalMaterials = useRef<Map<string, Material | Material[]>>(new Map());
  const materialStates = useRef<
    Map<
      string,
      {
        color?: Color;
        map?: any;
        normalMap?: any;
        roughnessMap?: any;
        metalnessMap?: any;
        emissiveMap?: any;
        aoMap?: any;
        alphaMap?: any;
        bumpMap?: any;
        displacementMap?: any;
        lightMap?: any;
        envMap?: any;
        emissive?: Color;
        emissiveIntensity?: number;
        toneMapped?: boolean;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        transparent?: boolean;
      }
    >
  >(new Map());
  const normalizedScenes = useRef<WeakSet<object>>(new WeakSet());
  const baseModeColor = useMemo(() => new Color(baseColor ?? "#4a4a4a"), [baseColor]);
  const overrideColor = useMemo(() => {
    const raw = typeof materialOverride?.baseColor === "string" ? materialOverride.baseColor.trim() : "";
    if (!raw) return null;
    try {
      return new Color(raw);
    } catch {
      return null;
    }
  }, [materialOverride?.baseColor]);
  const overrideMapUrl = useMemo(() => {
    const raw = typeof materialOverride?.baseColorMapUrl === "string" ? materialOverride.baseColorMapUrl.trim() : "";
    if (!raw) return "";
    return resolveAssetUrl(raw) ?? raw;
  }, [materialOverride?.baseColorMapUrl]);
  const hasOverrideMap = Boolean(overrideMapUrl);
  const overrideMap = useTexture(hasOverrideMap ? overrideMapUrl : TRANSPARENT_PIXEL_DATA_URL);
  const baseRoughness = 0.85;
  const baseMetalness = 0.05;
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!hasOverrideMap || !overrideMap) return;
    overrideMap.colorSpace = SRGBColorSpace;
    overrideMap.flipY = false;
    overrideMap.needsUpdate = true;
  }, [hasOverrideMap, overrideMap]);

  const computeMeshBounds = (root: Object3D) => {
    const box = new Box3();
    const tempBox = new Box3();
    box.makeEmpty();

    const meshBounds: Array<{ box: Box3; maxDim: number }> = [];

    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const geometry = child.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }
      if (!geometry.boundingBox) return;
      tempBox.copy(geometry.boundingBox);
      tempBox.applyMatrix4(child.matrixWorld);
      const size = new Vector3();
      tempBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim <= 0) return;
      meshBounds.push({ box: tempBox.clone(), maxDim });
    });

    if (meshBounds.length === 0) {
      return box;
    }

    const sizes = meshBounds.map((entry) => entry.maxDim).sort((a, b) => a - b);
    let threshold = Infinity;
    if (sizes.length >= 2) {
      const secondLargest = sizes[sizes.length - 2];
      threshold = secondLargest * 6;
    }
    if (sizes.length >= 3) {
      const median = sizes[Math.floor(sizes.length / 2)];
      threshold = Math.min(threshold, median * 8);
    }

    const filtered =
      Number.isFinite(threshold) && threshold > 0
        ? meshBounds.filter((entry) => entry.maxDim <= threshold)
        : meshBounds;

    const boundsToUse = filtered.length > 0 ? filtered : meshBounds;
    boundsToUse.forEach((entry) => box.union(entry.box));

    return box;
  };

  const computeIssueMarkers = (root: Object3D, modelSize: number): ModelIssueMarker[] => {
    if (!Number.isFinite(modelSize) || modelSize <= 0) return [];

    const thinCandidates: Array<{ position: [number, number, number]; score: number }> = [];
    const overhangCandidates: Array<{ position: [number, number, number]; score: number }> = [];
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const bc = new Vector3();
    const normal = new Vector3();
    const center = new Vector3();
    const thinThreshold = modelSize * 0.05;

    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const geometry = child.geometry;
      if (!geometry) return;
      const position = geometry.attributes?.position;
      if (!position || typeof position.count !== "number") return;

      const index = geometry.index;
      const triangleCount = Math.floor((index ? index.count : position.count) / 3);
      if (triangleCount < 1) return;

      const stride = Math.max(1, Math.ceil(triangleCount / 16000));

      for (let tri = 0; tri < triangleCount; tri += stride) {
        const i0 = index ? index.getX(tri * 3) : tri * 3;
        const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;

        a.fromBufferAttribute(position, i0).applyMatrix4(child.matrixWorld);
        b.fromBufferAttribute(position, i1).applyMatrix4(child.matrixWorld);
        c.fromBufferAttribute(position, i2).applyMatrix4(child.matrixWorld);

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        bc.subVectors(c, b);
        normal.crossVectors(ab, ac);

        const doubleArea = normal.length();
        if (!Number.isFinite(doubleArea) || doubleArea <= 1e-8) continue;
        const area = doubleArea * 0.5;
        normal.multiplyScalar(1 / doubleArea);
        center.copy(a).add(b).add(c).multiplyScalar(1 / 3);

        const minEdge = Math.min(ab.length(), ac.length(), bc.length());
        if (minEdge < thinThreshold && area < modelSize * modelSize * 0.02) {
          const score = (thinThreshold - minEdge) / thinThreshold + area * 0.05;
          thinCandidates.push({
            position: [center.x, center.y, center.z],
            score,
          });
        }

        if (normal.y < -0.56 && center.y > modelSize * 0.07) {
          const score = (-normal.y) * Math.sqrt(area);
          overhangCandidates.push({
            position: [center.x, center.y, center.z],
            score,
          });
        }
      }
    });

    const result: ModelIssueMarker[] = [];
    const minDistance = modelSize * 0.2;
    const isFarEnough = (p: [number, number, number]) =>
      result.every((item) => {
        const dx = item.position[0] - p[0];
        const dy = item.position[1] - p[1];
        const dz = item.position[2] - p[2];
        return dx * dx + dy * dy + dz * dz > minDistance * minDistance;
      });

    const pick = (
      source: Array<{ position: [number, number, number]; score: number }>,
      limit: number,
      baseId: string,
      title: string,
      color: string,
      severity: "low" | "medium" | "high"
    ) => {
      source
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .forEach((candidate, idx) => {
          if (result.length >= limit) return;
          if (!isFarEnough(candidate.position)) return;
          result.push({
            id: `${baseId}-${idx + 1}`,
            position: candidate.position,
            color,
            title,
            severity,
          });
        });
    };

    pick(overhangCandidates, 2, "overhang", "Свесы: нужен контроль поддержек", "#fb7185", "high");
    pick(thinCandidates, 3, "thin", "Тонкие элементы: риск деформации", "#fbbf24", "medium");

    return result.slice(0, 3);
  };

  useEffect(() => {
    originalMaterials.current = new Map();
    materialStates.current = new Map();

    if (!normalizedScenes.current.has(scene)) {
      scene.updateMatrixWorld(true);

      const initialBox = computeMeshBounds(scene);
      const initialSize = new Vector3();
      initialBox.getSize(initialSize);
      const maxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);

      if (maxDim > 0) {
        const targetScale = 3.5 / maxDim;
        scene.scale.setScalar(targetScale);
        scene.updateMatrixWorld(true);

        const scaledBox = computeMeshBounds(scene);
        const center = new Vector3();
        scaledBox.getCenter(center);
        scene.position.x -= center.x;
        scene.position.y -= center.y;
        scene.position.z -= center.z;
        scene.updateMatrixWorld(true);

        const groundedBox = computeMeshBounds(scene);
        scene.position.y -= groundedBox.min.y;
        scene.updateMatrixWorld(true);
      }

      normalizedScenes.current.add(scene);
    }

    scene.updateMatrixWorld(true);
    const boundsBox = computeMeshBounds(scene);
    const size = new Vector3();
    const sphere = new Sphere();
    boundsBox.getSize(size);
    boundsBox.getBoundingSphere(sphere);
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
      onBounds?.({
        size: maxDim,
        boxSize: [size.x, size.y, size.z],
        radius: sphere.radius,
      });
    }

    let polyCount = 0;
    let meshCount = 0;
    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const geometry = child.geometry;
      if (!geometry) return;
      meshCount += 1;
      const indexCount = geometry.index?.count ?? 0;
      const positionCount = geometry.attributes?.position?.count ?? 0;
      const triangles = indexCount > 0 ? indexCount / 3 : positionCount / 3;
      if (Number.isFinite(triangles)) {
        polyCount += Math.max(0, Math.floor(triangles));
      }
    });
    if (polyCount > 0 || meshCount > 0) {
      onStats?.({ polyCount, meshCount });
    }

    onIssueMarkers?.(computeIssueMarkers(scene, maxDim));
    
    const storeMaterialState = (material: Material) => {
      if (materialStates.current.has(material.uuid)) {
        return;
      }
      const state: {
        color?: Color;
        map?: any;
        normalMap?: any;
        roughnessMap?: any;
        metalnessMap?: any;
        emissiveMap?: any;
        aoMap?: any;
        alphaMap?: any;
        bumpMap?: any;
        displacementMap?: any;
        lightMap?: any;
        envMap?: any;
        emissive?: Color;
        emissiveIntensity?: number;
        toneMapped?: boolean;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        transparent?: boolean;
      } = {};
      const materialColor = (material as Material & { color?: Color }).color;
      if (materialColor) {
        state.color = materialColor.clone();
      }
      if ("map" in material) {
        state.map = (material as any).map ?? null;
      }
      if ("normalMap" in material) {
        state.normalMap = (material as any).normalMap ?? null;
      }
      if ("roughnessMap" in material) {
        state.roughnessMap = (material as any).roughnessMap ?? null;
      }
      if ("metalnessMap" in material) {
        state.metalnessMap = (material as any).metalnessMap ?? null;
      }
      if ("emissiveMap" in material) {
        state.emissiveMap = (material as any).emissiveMap ?? null;
      }
      if ("aoMap" in material) {
        state.aoMap = (material as any).aoMap ?? null;
      }
      if ("alphaMap" in material) {
        state.alphaMap = (material as any).alphaMap ?? null;
      }
      if ("bumpMap" in material) {
        state.bumpMap = (material as any).bumpMap ?? null;
      }
      if ("displacementMap" in material) {
        state.displacementMap = (material as any).displacementMap ?? null;
      }
      if ("lightMap" in material) {
        state.lightMap = (material as any).lightMap ?? null;
      }
      if ("envMap" in material) {
        state.envMap = (material as any).envMap ?? null;
      }
      if ("emissive" in material && (material as any).emissive) {
        state.emissive = (material as any).emissive.clone();
      }
      if ("emissiveIntensity" in material) {
        state.emissiveIntensity = (material as any).emissiveIntensity ?? 0;
      }
      if ("toneMapped" in material) {
        state.toneMapped = (material as any).toneMapped ?? true;
      }
      if ("roughness" in material) {
        state.roughness = (material as any).roughness ?? 1;
      }
      if ("metalness" in material) {
        state.metalness = (material as any).metalness ?? 0;
      }
      if ("opacity" in material) {
        state.opacity = (material as any).opacity ?? 1;
      }
      if ("transparent" in material) {
        state.transparent = (material as any).transparent ?? false;
      }
      materialStates.current.set(material.uuid, state);
    };

    scene.traverse((child) => {
      if (child instanceof Mesh) {
        originalMaterials.current.set(child.uuid, child.material);
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((material) => storeMaterialState(material));
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    setIsReady(true);
    if (!readyNotifiedRef.current) {
      readyNotifiedRef.current = true;
      onReady?.();
    }
  }, [analysisSignal, onBounds, onIssueMarkers, onReady, onStats, scene]);

  useEffect(() => {
    if (!isReady) return;

    const isWireframe = renderMode === "wireframe";
    const useBase = renderMode === "base";
    const overrideRoughness =
      typeof materialOverride?.roughness === "number" && Number.isFinite(materialOverride.roughness)
        ? Math.max(0, Math.min(1, materialOverride.roughness))
        : null;
    const overrideMetalness =
      typeof materialOverride?.metalness === "number" && Number.isFinite(materialOverride.metalness)
        ? Math.max(0, Math.min(1, materialOverride.metalness))
        : null;
    const hasMaterialOverride =
      overrideColor !== null || hasOverrideMap || overrideRoughness !== null || overrideMetalness !== null;

    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;

      let nextMaterial: Material | Material[] | null = null;

      const original = originalMaterials.current.get(child.uuid);

      if (original) {
        nextMaterial = original;
      }

      if (nextMaterial) {
        child.material = nextMaterial;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        const savedState = materialStates.current.get(material.uuid);
        if (useBase) {
          if ("color" in material && material.color) {
            material.color.copy(baseModeColor);
          }
          if ("map" in material) {
            (material as any).map = null;
          }
          if ("normalMap" in material) {
            (material as any).normalMap = null;
          }
          if ("roughnessMap" in material) {
            (material as any).roughnessMap = null;
          }
          if ("metalnessMap" in material) {
            (material as any).metalnessMap = null;
          }
          if ("emissiveMap" in material) {
            (material as any).emissiveMap = null;
          }
          if ("aoMap" in material) {
            (material as any).aoMap = null;
          }
          if ("alphaMap" in material) {
            (material as any).alphaMap = null;
          }
          if ("bumpMap" in material) {
            (material as any).bumpMap = null;
          }
          if ("displacementMap" in material) {
            (material as any).displacementMap = null;
          }
          if ("lightMap" in material) {
            (material as any).lightMap = null;
          }
          if ("envMap" in material) {
            (material as any).envMap = null;
          }
          if ("emissive" in material && (material as any).emissive) {
            (material as any).emissive.set("#000000");
          }
          if ("emissiveIntensity" in material) {
            (material as any).emissiveIntensity = 0;
          }
          if ("toneMapped" in material) {
            (material as any).toneMapped = false;
          }
          if ("roughness" in material) {
            (material as any).roughness = baseRoughness;
          }
          if ("metalness" in material) {
            (material as any).metalness = baseMetalness;
          }
          if ("opacity" in material) {
            (material as any).opacity = 1;
          }
          if ("transparent" in material) {
            (material as any).transparent = false;
          }
          material.needsUpdate = true;
        } else if (savedState) {
          if (savedState.color && "color" in material && material.color) {
            material.color.copy(savedState.color);
          }
          if ("map" in material) {
            (material as any).map = savedState.map ?? null;
          }
          if ("normalMap" in material) {
            (material as any).normalMap = savedState.normalMap ?? null;
          }
          if ("roughnessMap" in material) {
            (material as any).roughnessMap = savedState.roughnessMap ?? null;
          }
          if ("metalnessMap" in material) {
            (material as any).metalnessMap = savedState.metalnessMap ?? null;
          }
          if ("emissiveMap" in material) {
            (material as any).emissiveMap = savedState.emissiveMap ?? null;
          }
          if ("aoMap" in material) {
            (material as any).aoMap = savedState.aoMap ?? null;
          }
          if ("alphaMap" in material) {
            (material as any).alphaMap = savedState.alphaMap ?? null;
          }
          if ("bumpMap" in material) {
            (material as any).bumpMap = savedState.bumpMap ?? null;
          }
          if ("displacementMap" in material) {
            (material as any).displacementMap = savedState.displacementMap ?? null;
          }
          if ("lightMap" in material) {
            (material as any).lightMap = savedState.lightMap ?? null;
          }
          if ("envMap" in material) {
            (material as any).envMap = savedState.envMap ?? null;
          }
          if (savedState.emissive && "emissive" in material && (material as any).emissive) {
            (material as any).emissive.copy(savedState.emissive);
          }
          if ("emissiveIntensity" in material && typeof savedState.emissiveIntensity === "number") {
            (material as any).emissiveIntensity = savedState.emissiveIntensity;
          }
          if ("toneMapped" in material && typeof savedState.toneMapped === "boolean") {
            (material as any).toneMapped = savedState.toneMapped;
          }
          if ("roughness" in material && typeof savedState.roughness === "number") {
            (material as any).roughness = savedState.roughness;
          }
          if ("metalness" in material && typeof savedState.metalness === "number") {
            (material as any).metalness = savedState.metalness;
          }
          if ("opacity" in material && typeof savedState.opacity === "number") {
            (material as any).opacity = savedState.opacity;
          }
          if ("transparent" in material && typeof savedState.transparent === "boolean") {
            (material as any).transparent = savedState.transparent;
          }
          material.needsUpdate = true;
        }
        if ("wireframe" in material) {
          material.wireframe = isWireframe;
        }
        if (hasMaterialOverride) {
          if (overrideColor && "color" in material && material.color) {
            material.color.copy(overrideColor);
          }
          if ("map" in material) {
            (material as any).map = hasOverrideMap ? overrideMap : null;
          }
          if ("roughness" in material && typeof overrideRoughness === "number") {
            (material as any).roughness = overrideRoughness;
          }
          if ("metalness" in material && typeof overrideMetalness === "number") {
            (material as any).metalness = overrideMetalness;
          }
          material.needsUpdate = true;
        }
      });
    });
  }, [
    finish,
    renderMode,
    scene,
    paintedModelUrl,
    isReady,
    accentColor,
    baseModeColor,
    hasOverrideMap,
    materialOverride?.metalness,
    materialOverride?.roughness,
    overrideColor,
    overrideMap,
  ]);

  return <primitive object={scene} dispose={null} />;
}

if (typeof window !== "undefined") {
  useGLTF.preload(FALLBACK_MODEL);
}

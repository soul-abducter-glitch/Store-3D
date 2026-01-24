"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import type { Material } from "three";
import { Box3, Color, Mesh, Sphere, Vector3, type Object3D } from "three";

import { resolveAssetUrl, type Finish } from "@/lib/products";

export type RenderMode = "final" | "wireframe" | "base";

type ModelViewProps = {
  rawModelUrl?: string | null;
  paintedModelUrl?: string | null;
  finish: Finish;
  renderMode: RenderMode;
  accentColor: string;
  onBounds?: (bounds: {
    size: number;
    boxSize: [number, number, number];
    radius: number;
  }) => void;
  onStats?: (stats: {
    polyCount: number;
    meshCount: number;
  }) => void;
};

const FALLBACK_MODEL = "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

export default function ModelView({
  rawModelUrl,
  paintedModelUrl,
  finish,
  renderMode,
  accentColor,
  onBounds,
  onStats,
}: ModelViewProps) {
  const activeUrl = useMemo(() => {
    if (finish === "Painted" && paintedModelUrl) {
      return resolveAssetUrl(paintedModelUrl);
    }
    return resolveAssetUrl(rawModelUrl);
  }, [finish, rawModelUrl, paintedModelUrl]);

  const resolvedUrl = activeUrl ?? FALLBACK_MODEL;
  const gltf = useGLTF(resolvedUrl);
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
  const baseModeColor = useMemo(() => new Color("#4a4a4a"), []);
  const baseRoughness = 0.85;
  const baseMetalness = 0.05;
  const [isReady, setIsReady] = useState(false);

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

  useEffect(() => {
    originalMaterials.current = new Map();
    materialStates.current = new Map();

    if (!normalizedScenes.current.has(gltf.scene)) {
      gltf.scene.updateMatrixWorld(true);

      const initialBox = computeMeshBounds(gltf.scene);
      const initialSize = new Vector3();
      initialBox.getSize(initialSize);
      const maxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);

      if (maxDim > 0) {
        const targetScale = 3.5 / maxDim;
        gltf.scene.scale.setScalar(targetScale);
        gltf.scene.updateMatrixWorld(true);

        const scaledBox = computeMeshBounds(gltf.scene);
        const center = new Vector3();
        scaledBox.getCenter(center);
        gltf.scene.position.x -= center.x;
        gltf.scene.position.y -= center.y;
        gltf.scene.position.z -= center.z;
        gltf.scene.updateMatrixWorld(true);

        const groundedBox = computeMeshBounds(gltf.scene);
        gltf.scene.position.y -= groundedBox.min.y;
        gltf.scene.updateMatrixWorld(true);
      }

      normalizedScenes.current.add(gltf.scene);
    }

    gltf.scene.updateMatrixWorld(true);
    const boundsBox = computeMeshBounds(gltf.scene);
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
    gltf.scene.traverse((child) => {
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
      if ("color" in material && material.color) {
        state.color = material.color.clone();
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

    gltf.scene.traverse((child) => {
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
  }, [gltf.scene, onBounds]);

  useEffect(() => {
    if (!isReady) return;

    const isWireframe = renderMode === "wireframe";
    const useBase = renderMode === "base";

    gltf.scene.traverse((child) => {
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
      });
    });
  }, [
    finish,
    renderMode,
    gltf.scene,
    paintedModelUrl,
    isReady,
    accentColor,
  ]);

  return <primitive object={gltf.scene} dispose={null} />;
}

if (typeof window !== "undefined") {
  useGLTF.preload(FALLBACK_MODEL);
}

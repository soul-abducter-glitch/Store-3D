"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import type { Material } from "three";
import { Mesh, MeshStandardMaterial, Color } from "three";

import { resolveAssetUrl, type Finish } from "@/lib/products";

type ModelViewProps = {
  rawModelUrl?: string | null;
  paintedModelUrl?: string | null;
  finish: Finish;
  wireframe: boolean;
};

const FALLBACK_MODEL = "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

// Vibrant color palette for procedural painting
const PAINT_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F",
  "#BB8FCE", "#85C1E2", "#F8B739", "#52B788", "#E63946", "#A8DADC",
];

export default function ModelView({ rawModelUrl, paintedModelUrl, finish, wireframe }: ModelViewProps) {
  const activeUrl = useMemo(() => {
    if (finish === "Painted" && paintedModelUrl) {
      return resolveAssetUrl(paintedModelUrl);
    }
    return resolveAssetUrl(rawModelUrl);
  }, [finish, rawModelUrl, paintedModelUrl]);

  const resolvedUrl = activeUrl ?? FALLBACK_MODEL;
  const gltf = useGLTF(resolvedUrl);
  const originalMaterials = useRef<Map<string, Material | Material[]>>(new Map());
  const proceduralColors = useRef<Map<string, string>>(new Map());
  const [isReady, setIsReady] = useState(false);

  const baseMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#5b5b5b",
        roughness: 0.85,
        metalness: 0.05,
      }),
    []
  );

  useEffect(() => {
    originalMaterials.current = new Map();
    proceduralColors.current = new Map();
    
    let meshIndex = 0;
    gltf.scene.traverse((child) => {
      if (child instanceof Mesh) {
        originalMaterials.current.set(child.uuid, child.material);
        const colorIndex = meshIndex % PAINT_COLORS.length;
        proceduralColors.current.set(child.uuid, PAINT_COLORS[colorIndex]);
        child.castShadow = true;
        child.receiveShadow = true;
        meshIndex++;
      }
    });

    setIsReady(true);
  }, [gltf.scene]);

  useEffect(() => {
    if (!isReady) return;

    baseMaterial.wireframe = wireframe;
    
    gltf.scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;

      if (finish === "Raw") {
        child.material = baseMaterial;
      } else if (finish === "Painted" && paintedModelUrl) {
        const original = originalMaterials.current.get(child.uuid);
        if (original) child.material = original;
      } else if (finish === "Painted" && !paintedModelUrl) {
        const colorHex = proceduralColors.current.get(child.uuid);
        if (colorHex) {
          child.material = new MeshStandardMaterial({
            color: new Color(colorHex),
            roughness: 0.6,
            metalness: 0.3,
          });
        }
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if ("wireframe" in material) {
          material.wireframe = wireframe;
        }
      });
    });
  }, [finish, wireframe, gltf.scene, baseMaterial, paintedModelUrl, isReady]);

  return <primitive object={gltf.scene} dispose={null} />;
}

if (typeof window !== "undefined") {
  useGLTF.preload(FALLBACK_MODEL);
}

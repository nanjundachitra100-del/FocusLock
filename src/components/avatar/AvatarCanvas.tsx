"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { checkWebGLSupport, type WebGLSupport } from "./webgl-detector";

export type AvatarExpression = "neutral" | "friendly" | "thinking" | "speaking";

export type AvatarCanvasProps = {
  modelUrl?: string;
  expression?: AvatarExpression;
  isSpeaking?: boolean;
  mouthOpen?: number; // 0 (closed) to 1 (wide open)
  enableTracking?: boolean;
  className?: string;
  onLoaded?: () => void;
  onError?: (error: string) => void;
};

export default function AvatarCanvas({
  modelUrl,
  expression = "neutral",
  isSpeaking = false,
  mouthOpen = 0,
  enableTracking = true,
  className = "w-full h-full",
  onLoaded,
  onError,
}: AvatarCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglInfo, setWebglInfo] = useState<WebGLSupport | null>(null);
  const [modelType, setModelType] = useState<"procedural" | "gltf">("procedural");
  const [fps, setFps] = useState<number>(60);

  // State refs to read inside animation loop without restarting effect
  const expressionRef = useRef(expression);
  const isSpeakingRef = useRef(isSpeaking);
  const mouthOpenRef = useRef(mouthOpen);
  const enableTrackingRef = useRef(enableTracking);
  const mousePosRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  expressionRef.current = expression;
  isSpeakingRef.current = isSpeaking;
  mouthOpenRef.current = mouthOpen;
  enableTrackingRef.current = enableTracking;

  // Check WebGL availability on mount
  useEffect(() => {
    const support = checkWebGLSupport();
    setWebglInfo(support);
    if (!support.supported) {
      onError?.(support.errorMessage ?? "WebGL is not supported on this device.");
    }
  }, [onError]);

  // Main Three.js lifecycle
  useEffect(() => {
    if (!webglInfo?.supported || !containerRef.current || !canvasRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;

    // 1. Scene setup
    const scene = new THREE.Scene();

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(
      38,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100
    );
    camera.position.set(0, 0.45, 2.1);
    camera.lookAt(0, 0.35, 0);

    // 3. Renderer setup
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "default", // Balanced for laptop battery
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
    } catch (e) {
      const err = e instanceof Error ? e.message : "Failed to create WebGL context";
      onError?.(err);
      return;
    }

    // 4. Lighting setup (Cinematic FocusLock Violet/Cyan Studio)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    // Key light (soft warm white)
    const keyLight = new THREE.DirectionalLight(0xf5f3ff, 1.4);
    keyLight.position.set(1.2, 1.8, 1.5);
    scene.add(keyLight);

    // Fill light (subtle cool cyan)
    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.7);
    fillLight.position.set(-1.2, 0.5, 1.0);
    scene.add(fillLight);

    // Rim/Backlight (FocusLock signature violet glow)
    const rimLight = new THREE.DirectionalLight(0xa78bfa, 2.0);
    rimLight.position.set(0, 1.2, -1.8);
    scene.add(rimLight);

    // Subtle bottom bounce light
    const bounceLight = new THREE.DirectionalLight(0x4338ca, 0.5);
    bounceLight.position.set(0, -1.5, 0.5);
    scene.add(bounceLight);

    // 5. Build Humanoid Avatar (Procedural Foundation or GLTF)
    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    // References for procedural animation
    let headMesh: THREE.Group | THREE.Mesh | null = null;
    let eyeLeft: THREE.Mesh | null = null;
    let eyeRight: THREE.Mesh | null = null;
    let eyelidLeft: THREE.Mesh | null = null;
    let eyelidRight: THREE.Mesh | null = null;
    let eyebrowLeft: THREE.Mesh | null = null;
    let eyebrowRight: THREE.Mesh | null = null;
    let mouthMesh: THREE.Mesh | null = null;
    let jawMesh: THREE.Mesh | null = null;
    let gltfMorphMeshes: THREE.Mesh[] = [];

    // Helper: Build Procedural Cyber-Humanoid Avatar
    const buildProceduralAvatar = () => {
      // Clear previous children
      while (avatarGroup.children.length > 0) {
        avatarGroup.remove(avatarGroup.children[0]);
      }

      const root = new THREE.Group();
      avatarGroup.add(root);

      // Materials
      const skinMaterial = new THREE.MeshStandardMaterial({
        color: 0xdfc2af,
        roughness: 0.65,
        metalness: 0.05,
      });

      const cyberSuitMaterial = new THREE.MeshStandardMaterial({
        color: 0x11162b,
        roughness: 0.35,
        metalness: 0.5,
      });

      const accentMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5cf6,
        emissive: 0x8b5cf6,
        emissiveIntensity: 0.6,
        roughness: 0.2,
      });

      const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.1,
      });

      const irisMaterial = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.2,
        metalness: 0.1,
      });

      const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x020617 });

      const hairMaterial = new THREE.MeshStandardMaterial({
        color: 0x221a36,
        roughness: 0.7,
      });

      // Shoulders / Torso
      const torsoGeo = new THREE.CylinderGeometry(0.42, 0.48, 0.65, 32);
      const torso = new THREE.Mesh(torsoGeo, cyberSuitMaterial);
      torso.position.set(0, -0.4, 0);
      root.add(torso);

      // Collar accent line
      const collarGeo = new THREE.TorusGeometry(0.24, 0.015, 16, 32);
      const collar = new THREE.Mesh(collarGeo, accentMaterial);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, -0.07, 0);
      root.add(collar);

      // Neck
      const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.24, 24);
      const neck = new THREE.Mesh(neckGeo, skinMaterial);
      neck.position.set(0, 0.04, 0);
      root.add(neck);

      // Head Group (for tilting and nodding)
      const head = new THREE.Group();
      head.position.set(0, 0.26, 0);
      root.add(head);
      headMesh = head;

      // Cranium / Face base
      const craniumGeo = new THREE.SphereGeometry(0.3, 32, 32);
      craniumGeo.scale(0.92, 1.15, 0.98);
      const cranium = new THREE.Mesh(craniumGeo, skinMaterial);
      head.add(cranium);

      // Chin / Jaw base
      const jawGeo = new THREE.ConeGeometry(0.2, 0.22, 24);
      jawGeo.scale(0.9, 1.0, 0.8);
      const jaw = new THREE.Mesh(jawGeo, skinMaterial);
      jaw.rotation.x = Math.PI;
      jaw.position.set(0, -0.16, 0.06);
      head.add(jaw);
      jawMesh = jaw;

      // Stylized Hair
      const hairGeo = new THREE.SphereGeometry(0.32, 24, 24);
      hairGeo.scale(0.96, 1.12, 1.05);
      const hair = new THREE.Mesh(hairGeo, hairMaterial);
      hair.position.set(0, 0.06, -0.04);
      head.add(hair);

      // Bangs / Front hair tuft
      const bangsGeo = new THREE.CylinderGeometry(0.04, 0.18, 0.28, 16);
      bangsGeo.scale(1.4, 1, 0.4);
      const bangs = new THREE.Mesh(bangsGeo, hairMaterial);
      bangs.position.set(0, 0.28, 0.22);
      bangs.rotation.x = 0.5;
      bangs.rotation.z = -0.2;
      head.add(bangs);

      // Left Eye Group
      const eyeL = new THREE.Group();
      eyeL.position.set(-0.105, 0.06, 0.24);
      head.add(eyeL);

      const eyeWhiteL = new THREE.Mesh(new THREE.SphereGeometry(0.046, 20, 20), eyeWhiteMaterial);
      eyeL.add(eyeWhiteL);

      const irisL = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 16), irisMaterial);
      irisL.rotation.x = Math.PI / 2;
      irisL.position.z = 0.04;
      eyeL.add(irisL);

      const pupilL = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), pupilMaterial);
      pupilL.rotation.x = Math.PI / 2;
      pupilL.position.z = 0.042;
      eyeL.add(pupilL);
      eyeLeft = eyeWhiteL;

      // Left Eyelid (blinks by scaling down)
      const eyelidL = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
        skinMaterial
      );
      eyelidL.rotation.x = 0.1;
      eyelidL.position.set(-0.105, 0.065, 0.24);
      head.add(eyelidL);
      eyelidLeft = eyelidL;

      // Right Eye Group
      const eyeR = new THREE.Group();
      eyeR.position.set(0.105, 0.06, 0.24);
      head.add(eyeR);

      const eyeWhiteR = new THREE.Mesh(new THREE.SphereGeometry(0.046, 20, 20), eyeWhiteMaterial);
      eyeR.add(eyeWhiteR);

      const irisR = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 16), irisMaterial);
      irisR.rotation.x = Math.PI / 2;
      irisR.position.z = 0.04;
      eyeR.add(irisR);

      const pupilR = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), pupilMaterial);
      pupilR.rotation.x = Math.PI / 2;
      pupilR.position.z = 0.042;
      eyeR.add(pupilR);
      eyeRight = eyeWhiteR;

      // Right Eyelid
      const eyelidR = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
        skinMaterial
      );
      eyelidR.rotation.x = 0.1;
      eyelidR.position.set(0.105, 0.065, 0.24);
      head.add(eyelidR);
      eyelidRight = eyelidR;

      // Eyebrows — thin flattened boxes, reusing hairMaterial so they always match the hair
      const browGeo = new THREE.BoxGeometry(0.085, 0.012, 0.018);
      // Slight arch: rotate each brow so the outer edge lifts a touch
      const browL = new THREE.Mesh(browGeo, hairMaterial);
      browL.position.set(-0.105, 0.118, 0.255);
      browL.rotation.z = 0.08;   // subtle natural arch (inner end slightly lower)
      browL.rotation.x = -0.18;  // follow face curvature
      head.add(browL);
      eyebrowLeft = browL;

      const browR = new THREE.Mesh(browGeo.clone(), hairMaterial);
      browR.position.set(0.105, 0.118, 0.255);
      browR.rotation.z = -0.08;  // mirror
      browR.rotation.x = -0.18;
      head.add(browR);
      eyebrowRight = browR;

      // Mouth / Lips
      const mouthGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.09, 16);
      mouthGeo.scale(1.0, 0.5, 0.7);
      const mouthMat = new THREE.MeshStandardMaterial({
        color: 0xa8556f,
        roughness: 0.4,
      });
      const mouth = new THREE.Mesh(mouthGeo, mouthMat);
      mouth.rotation.z = Math.PI / 2;
      mouth.position.set(0, -0.14, 0.25);
      head.add(mouth);
      mouthMesh = mouth;

      // Headset / Audio Ear Nodes (Visual cue for listening/speaking companion)
      const earNodeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24);
      const earNodeL = new THREE.Mesh(earNodeGeo, cyberSuitMaterial);
      earNodeL.rotation.z = Math.PI / 2;
      earNodeL.position.set(-0.29, 0.05, 0.02);
      head.add(earNodeL);

      const earRingL = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 16, 24), accentMaterial);
      earRingL.rotation.y = Math.PI / 2;
      earRingL.position.set(-0.315, 0.05, 0.02);
      head.add(earRingL);

      const earNodeR = earNodeL.clone();
      earNodeR.position.set(0.29, 0.05, 0.02);
      head.add(earNodeR);

      const earRingR = earRingL.clone();
      earRingR.position.set(0.315, 0.05, 0.02);
      head.add(earRingR);

      setModelType("procedural");
      onLoaded?.();
    };

    // If a model URL was specified, attempt to load GLTF
    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          while (avatarGroup.children.length > 0) {
            avatarGroup.remove(avatarGroup.children[0]);
          }
          avatarGroup.add(gltf.scene);

          // Find morph targets (visemes / facial blendshapes)
          gltfMorphMeshes = [];
          gltf.scene.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              const m = node as THREE.Mesh;
              if (m.morphTargetDictionary && m.morphTargetInfluences) {
                gltfMorphMeshes.push(m);
              }
            }
          });

          // Center and scale avatar model
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const scale = 1.6 / Math.max(size.y, 0.001);
          gltf.scene.scale.setScalar(scale);
          gltf.scene.position.sub(center.multiplyScalar(scale));
          gltf.scene.position.y += 0.2;

          setModelType("gltf");
          onLoaded?.();
        },
        undefined,
        (error) => {
          console.warn("[AvatarCanvas] GLTF load fallback to procedural model:", error);
          buildProceduralAvatar();
        }
      );
    } else {
      buildProceduralAvatar();
    }

    // 6. Resize handling
    const handleResize = () => {
      if (!container || !renderer) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);

    // 7. Mouse movement tracking (Interactive parallax gaze)
    const handleMouseMove = (event: MouseEvent) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      mousePosRef.current.targetX = Math.max(-1, Math.min(1, x));
      mousePosRef.current.targetY = Math.max(-1, Math.min(1, y));
    };

    if (enableTracking) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
    }

    // 8. Resource-saving rendering loop (Battery & CPU conservation)
    let isVisible = true;
    let animationFrameId = 0;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();

    // Natural blinking state
    let nextBlinkTime = performance.now() + 2500 + Math.random() * 2000;
    let blinkProgress = 0;
    let isBlinking = false;

    // Speech articulation phase
    let speechPhase = 0;

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate);

      // Skip render if offscreen or tab is hidden
      if (!isVisible || document.hidden) return;

      const delta = (time - lastTime) / 1000;
      lastTime = time;

      // Track FPS periodically
      frameCount++;
      if (time - fpsTimer >= 1000) {
        setFps(Math.round((frameCount * 1000) / (time - fpsTimer)));
        frameCount = 0;
        fpsTimer = time;
      }

      // Smooth gaze interpolation
      const mouse = mousePosRef.current;
      mouse.x += (mouse.targetX - mouse.x) * 0.08;
      mouse.y += (mouse.targetY - mouse.y) * 0.08;

      // Subtle breathing motion
      const breathing = Math.sin(time * 0.002) * 0.015;

      // Procedural Head Motion
      if (headMesh) {
        // Base head tilt from mouse
        const targetRotY = enableTrackingRef.current ? mouse.x * 0.35 : 0;
        const targetRotX = enableTrackingRef.current ? -mouse.y * 0.25 : 0;
        headMesh.rotation.y += (targetRotY - headMesh.rotation.y) * 0.1;
        headMesh.rotation.x += (targetRotX - headMesh.rotation.x) * 0.1;
        headMesh.position.y = 0.26 + breathing;

        // Expressive tilt based on current expression
        if (expressionRef.current === "thinking") {
          headMesh.rotation.z += (0.12 - headMesh.rotation.z) * 0.08;
          headMesh.rotation.y += (0.15 - headMesh.rotation.y) * 0.08;
        } else {
          headMesh.rotation.z += (0 - headMesh.rotation.z) * 0.08;
        }
      }

      // Natural Periodic Blinking
      if (time >= nextBlinkTime && !isBlinking) {
        isBlinking = true;
        blinkProgress = 0;
      }

      if (isBlinking) {
        blinkProgress += delta * 12; // Fast realistic blink (~150ms)
        const blinkValue = Math.sin(Math.min(blinkProgress, 1) * Math.PI);

        if (eyelidLeft && eyelidRight) {
          // Slide eyelids down to cover eye
          eyelidLeft.scale.y = 1 + blinkValue * 1.2;
          eyelidRight.scale.y = 1 + blinkValue * 1.2;
        }

        // GLTF blendshape blink
        if (gltfMorphMeshes.length > 0) {
          for (const mesh of gltfMorphMeshes) {
            const dict = mesh.morphTargetDictionary;
            const inf = mesh.morphTargetInfluences;
            if (dict && inf) {
              const idxL = dict["eyeBlinkLeft"] ?? dict["blink_l"] ?? dict["blink"];
              const idxR = dict["eyeBlinkRight"] ?? dict["blink_r"] ?? dict["blink"];
              if (idxL !== undefined) inf[idxL] = blinkValue;
              if (idxR !== undefined) inf[idxR] = blinkValue;
            }
          }
        }

        if (blinkProgress >= 1) {
          isBlinking = false;
          nextBlinkTime = time + 2500 + Math.random() * 3000;
          if (eyelidLeft && eyelidRight) {
            eyelidLeft.scale.y = 1;
            eyelidRight.scale.y = 1;
          }
        }
      }

      // Eyebrow Expression Animation
      if (eyebrowLeft && eyebrowRight) {
        // Target Y offset and Z-rotation per expression
        // Positive deltaY = raised brows; negative inner rotation = furrowed
        let targetBrowY = 0;
        let targetBrowInnerTilt = 0; // extra Z rotation on inner edge (furrowing)

        switch (expressionRef.current) {
          case "friendly":
            targetBrowY = 0.013;       // raised — open/welcoming
            targetBrowInnerTilt = 0.0;
            break;
          case "thinking":
            targetBrowY = 0.004;       // slightly raised on outer, inner drops
            targetBrowInnerTilt = 0.18; // furrow inward
            break;
          case "speaking":
            targetBrowY = 0.006;       // mild raise during speech
            targetBrowInnerTilt = 0.0;
            break;
          default: // neutral
            targetBrowY = 0;
            targetBrowInnerTilt = 0;
        }

        const browLerpSpeed = 0.07;

        // Base Y positions for each brow
        const browBaseY = 0.118;
        eyebrowLeft.position.y  += (browBaseY + targetBrowY - eyebrowLeft.position.y)  * browLerpSpeed;
        eyebrowRight.position.y += (browBaseY + targetBrowY - eyebrowRight.position.y) * browLerpSpeed;

        // Arch tilt: left brow +inner tilt lowers inner edge (furrowing)
        // Base z-rotation is ±0.08 (set at build time); we add the expression tilt on top
        const baseTiltL =  0.08;
        const baseTiltR = -0.08;
        eyebrowLeft.rotation.z  += (baseTiltL + targetBrowInnerTilt - eyebrowLeft.rotation.z)  * browLerpSpeed;
        eyebrowRight.rotation.z += (baseTiltR - targetBrowInnerTilt - eyebrowRight.rotation.z) * browLerpSpeed;

        // Subtle idle micro-movement so the face doesn't look frozen
        const idleBrowWave = Math.sin(time * 0.0008) * 0.003;
        eyebrowLeft.position.y  += idleBrowWave;
        eyebrowRight.position.y += idleBrowWave;
      }

      // Mouth / Speech Animation
      let effectiveMouthOpen = mouthOpenRef.current;
      if (isSpeakingRef.current) {
        // Natural speech cadence — dual-frequency oscillation, clamped to avoid over-extension
        speechPhase += delta * 14;
        const speechOscillation =
          Math.max(0, Math.sin(speechPhase) * 0.55 + Math.sin(speechPhase * 0.47) * 0.35) * 0.85;
        effectiveMouthOpen = Math.max(effectiveMouthOpen, speechOscillation);
      }

      if (mouthMesh && jawMesh) {
        // Procedural jaw & mouth open (local X is vertical opening due to rotation.z = PI/2)
        mouthMesh.scale.x = 1.0 + effectiveMouthOpen * 2.8;
        mouthMesh.scale.y = 1.0 + effectiveMouthOpen * 0.4;
        jawMesh.position.y = -0.16 - effectiveMouthOpen * 0.05;
      }

      // GLTF blendshape mouth articulation
      if (gltfMorphMeshes.length > 0) {
        for (const mesh of gltfMorphMeshes) {
          const dict = mesh.morphTargetDictionary;
          const inf = mesh.morphTargetInfluences;
          if (dict && inf) {
            const mouthIdx = dict["jawOpen"] ?? dict["mouthOpen"] ?? dict["viseme_aa"] ?? dict["mouth_open"];
            if (mouthIdx !== undefined) {
              inf[mouthIdx] = effectiveMouthOpen;
            }
          }
        }
      }

      renderer?.render(scene, camera);
    };

    // Pause rendering when canvas is scrolled out of viewport
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isVisible = entry ? entry.isIntersecting : true;
      },
      { threshold: 0.1 }
    );
    intersectionObserver.observe(container);

    // Pause rendering when tab is hidden
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Start loop
    animationFrameId = requestAnimationFrame(animate);

    // 9. Teardown & cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (enableTracking) {
        window.removeEventListener("mousemove", handleMouseMove);
      }

      // Dispose 3D scene objects
      scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });

      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
    };
  }, [webglInfo?.supported, modelUrl, onLoaded, onError, enableTracking]);

  // If WebGL is unsupported, render graceful fallback
  if (webglInfo && !webglInfo.supported) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-6 text-center ${className}`}>
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
          <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h4 className="text-sm font-semibold text-slate-200">3D Acceleration Unavailable</h4>
        <p className="mt-1 max-w-xs text-xs text-slate-400 leading-relaxed">
          {webglInfo.errorMessage || "WebGL is disabled on your device. The voice assistant remains fully functional in audio/text mode."}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="block w-full h-full touch-none" />

      {/* Subtle overlay badges */}
      <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-2">
        <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-slate-400 backdrop-blur-md">
          {modelType === "procedural" ? "Cyber-Humanoid" : "Custom GLTF"}
        </span>
        <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-mono text-emerald-400/90 backdrop-blur-md">
          {fps} FPS
        </span>
      </div>
    </div>
  );
}

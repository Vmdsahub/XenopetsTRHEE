import { useEffect, useRef } from "react";
import * as THREE from "three";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  parallax: number;
  twinkle: number;
  color: string;
  type: "normal" | "bright" | "giant";
  drift: { x: number; y: number };
  pulse: number;
  baseX: number;
  baseY: number;
  floatAmplitude: { x: number; y: number };
  floatPhase: { x: number; y: number };
}

interface MobileOptimizedWebGLStarsProps {
  stars: Star[];
  cameraX: number;
  cameraY: number;
  width: number;
  height: number;
  className?: string;
}

export const MobileOptimizedWebGLStars: React.FC<
  MobileOptimizedWebGLStarsProps
> = ({ stars, cameraX, cameraY, width, height, className = "" }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.OrthographicCamera>();
  const animationIdRef = useRef<number>();
  const pointsRef = useRef<THREE.Points>();
  const materialRef = useRef<THREE.PointsMaterial>();
  const lastFrameTime = useRef(0);

  // Initialize Three.js scene with mobile optimizations
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();

    // Camera setup
    const camera = new THREE.OrthographicCamera(
      -width / 2,
      width / 2,
      height / 2,
      -height / 2,
      0.1,
      1000,
    );
    camera.position.z = 1;

    // Renderer setup - heavily optimized for mobile
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "default", // Don't force high-performance on mobile
      precision: "lowp", // Low precision for mobile
      stencil: false,
      depth: false,
      premultipliedAlpha: true,
    });

    // Very conservative settings for mobile
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2)); // Even more conservative
    renderer.setClearColor(0x000000, 0);

    // Disable expensive features
    renderer.shadowMap.enabled = false;
    renderer.sortObjects = false;

    mountRef.current.appendChild(renderer.domElement);

    // Store references
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [width, height]);

  // Create simplified star geometry for mobile
  useEffect(() => {
    if (!sceneRef.current || !stars.length) return;

    const scene = sceneRef.current;

    // Remove existing points
    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      if (pointsRef.current.material instanceof THREE.Material) {
        pointsRef.current.material.dispose();
      }
    }

    // Sample only a subset of stars for mobile performance
    const maxStars = 3000; // Hard limit for mobile
    const sampledStars =
      stars.length > maxStars
        ? stars
            .filter((_, i) => i % Math.ceil(stars.length / maxStars) === 0)
            .slice(0, maxStars)
        : stars;

    // Create simplified geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sampledStars.length * 3);
    const colors = new Float32Array(sampledStars.length * 3);
    const sizes = new Float32Array(sampledStars.length);

    sampledStars.forEach((star, i) => {
      // Simple static positions (no complex animations on mobile)
      const screenX = (star.x - cameraX) * star.parallax + width / 2;
      const screenY = (star.y - cameraY) * star.parallax + height / 2;

      positions[i * 3] = screenX - width / 2;
      positions[i * 3 + 1] = height / 2 - screenY;
      positions[i * 3 + 2] = 0;

      // Simplified colors (only white and blue)
      if (star.color === "#ffffff" || Math.random() > 0.8) {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 1;
      } else {
        colors[i * 3] = 0.7;
        colors[i * 3 + 1] = 0.8;
        colors[i * 3 + 2] = 1;
      }

      // Smaller, simpler sizes
      sizes[i] = Math.max(1, star.size * 1.5);
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Use simple point material instead of shaders
    const material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false, // Disable size attenuation for performance
    });

    // Create points
    const points = new THREE.Points(geometry, material);
    pointsRef.current = points;
    materialRef.current = material;
    scene.add(points);
  }, [stars, cameraX, cameraY, width, height]);

  // Optimized animation loop with conservative frame timing for mobile
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    // More conservative frame limiting for mobile WebGL
    const targetFPS = 30; // Fixed 30 FPS for mobile stability
    const frameInterval = 1000 / targetFPS;

    const animate = (currentTime: number) => {
      // Strict frame limiting for mobile performance and battery life
      if (currentTime - lastFrameTime.current < frameInterval) {
        animationIdRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameTime.current = currentTime;

      // Render frame at consistent 30 FPS regardless of display refresh rate
      rendererRef.current!.render(sceneRef.current!, cameraRef.current!);
      animationIdRef.current = requestAnimationFrame(animate);
    };

    animate(performance.now());

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, []);

  // Update camera when dimensions change
  useEffect(() => {
    if (cameraRef.current && rendererRef.current) {
      const camera = cameraRef.current;
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();

      rendererRef.current.setSize(width, height);
    }
  }, [width, height]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: width + "px",
        height: height + "px",
        pointerEvents: "none",
        zIndex: 0,
        background: `
          linear-gradient(135deg, #1a2845 0%, #0f1c38 40%, #0a1228 70%, #050a18 100%)
        `, // Simplified background for mobile
      }}
    />
  );
};

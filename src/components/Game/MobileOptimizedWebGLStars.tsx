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

    // Renderer setup - optimized for mobile with better compatibility
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "high-performance", // Use high-performance for 120Hz support
        precision: "mediump", // Better precision for mobile
        stencil: false,
        depth: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false, // Better for mobile
        failIfMajorPerformanceCaveat: false, // Don't fail on mobile
      });

      // Debug WebGL context
      const gl = renderer.getContext();
      console.log(`WebGL context created successfully on mobile:`, {
        version: gl.getParameter(gl.VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        supportedExtensions: gl.getSupportedExtensions?.()?.length || 0,
      });
    } catch (error) {
      console.error("Failed to create WebGL context on mobile:", error);
      return;
    }

    // Better mobile settings that preserve 120Hz capability
    renderer.setSize(width, height);
    // Support full device pixel ratio for crisp rendering on high-DPI displays
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    renderer.setClearColor(0x000000, 0);

    // Disable expensive features but keep essential ones
    renderer.shadowMap.enabled = false;
    renderer.sortObjects = false;

    // Ensure canvas is properly styled for mobile
    const canvas = renderer.domElement;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.display = "block";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";

    mountRef.current.appendChild(canvas);

    // Store references
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (mountRef.current && canvas.parentNode === mountRef.current) {
        mountRef.current.removeChild(canvas);
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
      // Fixed positioning calculation for mobile
      const parallaxX = (star.x - cameraX) * star.parallax;
      const parallaxY = (star.y - cameraY) * star.parallax;

      // Convert to screen coordinates properly
      positions[i * 3] = parallaxX;
      positions[i * 3 + 1] = parallaxY;
      positions[i * 3 + 2] = 0;

      // Better color handling with proper hex color parsing
      const color = star.color || "#ffffff";
      if (
        color === "#ffffff" ||
        star.type === "bright" ||
        star.type === "giant"
      ) {
        colors[i * 3] = 1.0; // R
        colors[i * 3 + 1] = 1.0; // G
        colors[i * 3 + 2] = 1.0; // B
      } else if (color === "#4fc3f7" || color.includes("blue")) {
        colors[i * 3] = 0.31; // R
        colors[i * 3 + 1] = 0.76; // G
        colors[i * 3 + 2] = 0.97; // B
      } else {
        colors[i * 3] = 0.8; // R
        colors[i * 3 + 1] = 0.9; // G
        colors[i * 3 + 2] = 1.0; // B
      }

      // Larger, more visible sizes for mobile
      let sizeMultiplier = 1.0;
      if (star.type === "giant") sizeMultiplier = 4.0;
      else if (star.type === "bright") sizeMultiplier = 2.5;
      else sizeMultiplier = 1.5;

      sizes[i] = Math.max(2.0, star.size * sizeMultiplier * 2.0); // Make stars bigger on mobile
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Use optimized point material for mobile with better visibility
    const material = new THREE.PointsMaterial({
      size: 4.0, // Larger base size for mobile visibility
      vertexColors: true,
      transparent: true,
      opacity: 1.0, // Full opacity for better visibility
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true, // Enable size attenuation for better depth perception
      alphaTest: 0.1, // Prevent tiny fragments
    });

    // Create points
    const points = new THREE.Points(geometry, material);
    pointsRef.current = points;
    materialRef.current = material;
    scene.add(points);

    // Debug logging for mobile
    console.log(
      `Mobile WebGL Stars: Created ${sampledStars.length} stars from ${stars.length} total stars`,
    );
    console.log(
      `Canvas size: ${width}x${height}, Device pixel ratio: ${window.devicePixelRatio}`,
    );
  }, [stars, cameraX, cameraY, width, height]);

  // Optimized animation loop with unlimited FPS for 120Hz+ mobile displays
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const animate = (currentTime: number) => {
      // FPS completely uncapped - supports full 120Hz on iPhone 16 Pro Max
      // No frame limiting whatsoever for maximum performance and refresh rate

      // Update positions for camera movement
      if (pointsRef.current && pointsRef.current.geometry) {
        const positions = pointsRef.current.geometry.attributes.position
          .array as Float32Array;
        const originalStars =
          stars.length > 3000
            ? stars
                .filter((_, i) => i % Math.ceil(stars.length / 3000) === 0)
                .slice(0, 3000)
            : stars;

        originalStars.forEach((star, i) => {
          const parallaxX = (star.x - cameraX) * star.parallax;
          const parallaxY = (star.y - cameraY) * star.parallax;

          positions[i * 3] = parallaxX;
          positions[i * 3 + 1] = parallaxY;
        });

        pointsRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // Render at maximum refresh rate (uncapped)
      rendererRef.current!.render(sceneRef.current!, cameraRef.current!);
      animationIdRef.current = requestAnimationFrame(animate);
    };

    animate(performance.now());

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [stars, cameraX, cameraY]);

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
    <>
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
          backgroundColor: "transparent", // Transparent background to show stars
          overflow: "hidden", // Ensure content doesn't overflow
        }}
      />
      {/* Debug info overlay for mobile */}
      {process.env.NODE_ENV === "development" && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "rgba(0,0,0,0.8)",
            color: "white",
            padding: "5px",
            fontSize: "10px",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          Mobile Stars: {stars.length} → {Math.min(stars.length, 3000)}
          <br />
          Canvas: {width}×{height}
          <br />
          DPR: {window.devicePixelRatio}
        </div>
      )}
    </>
  );
};

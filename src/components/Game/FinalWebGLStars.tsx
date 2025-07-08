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

interface FinalWebGLStarsProps {
  stars: Star[];
  cameraX: number;
  cameraY: number;
  width: number;
  height: number;
  className?: string;
}

export const FinalWebGLStars: React.FC<FinalWebGLStarsProps> = ({
  stars,
  cameraX,
  cameraY,
  width,
  height,
  className = "",
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.OrthographicCamera>();
  const animationIdRef = useRef<number>();
  const pointsRef = useRef<THREE.Points>();
  const materialRef = useRef<THREE.ShaderMaterial>();

  // Convert hex color to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        }
      : { r: 1, g: 1, b: 1 };
  };

  // Initialize Three.js scene
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

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

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

  // Create star geometry when stars data changes
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

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(stars.length * 3);
    const colors = new Float32Array(stars.length * 3);
    const sizes = new Float32Array(stars.length);
    const parallaxValues = new Float32Array(stars.length);
    const opacities = new Float32Array(stars.length);
    const basePositionsX = new Float32Array(stars.length);
    const basePositionsY = new Float32Array(stars.length);
    const floatAmplitudesX = new Float32Array(stars.length);
    const floatAmplitudesY = new Float32Array(stars.length);
    const floatPhasesX = new Float32Array(stars.length);
    const floatPhasesY = new Float32Array(stars.length);
    const speeds = new Float32Array(stars.length);
    const twinklePhases = new Float32Array(stars.length);

    stars.forEach((star, i) => {
      // Positions will be calculated in shader
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;

      // Color
      const rgb = hexToRgb(star.color);
      colors[i * 3] = rgb.r;
      colors[i * 3 + 1] = rgb.g;
      colors[i * 3 + 2] = rgb.b;

      // Properties
      let sizeMult = 1;
      if (star.type === "giant") sizeMult = 3.2;
      else if (star.type === "bright") sizeMult = 2.4;

      sizes[i] = star.size * sizeMult * 3.5; // Bigger stars to prevent flickering
      parallaxValues[i] = star.parallax;
      opacities[i] = star.opacity;
      basePositionsX[i] = star.baseX;
      basePositionsY[i] = star.baseY;
      floatAmplitudesX[i] = star.floatAmplitude.x;
      floatAmplitudesY[i] = star.floatAmplitude.y;
      floatPhasesX[i] = star.floatPhase.x;
      floatPhasesY[i] = star.floatPhase.y;
      speeds[i] = star.speed;
      twinklePhases[i] = star.twinkle;
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute(
      "parallax",
      new THREE.BufferAttribute(parallaxValues, 1),
    );
    geometry.setAttribute("opacity", new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute(
      "basePositionX",
      new THREE.BufferAttribute(basePositionsX, 1),
    );
    geometry.setAttribute(
      "basePositionY",
      new THREE.BufferAttribute(basePositionsY, 1),
    );
    geometry.setAttribute(
      "floatAmplitudeX",
      new THREE.BufferAttribute(floatAmplitudesX, 1),
    );
    geometry.setAttribute(
      "floatAmplitudeY",
      new THREE.BufferAttribute(floatAmplitudesY, 1),
    );
    geometry.setAttribute(
      "floatPhaseX",
      new THREE.BufferAttribute(floatPhasesX, 1),
    );
    geometry.setAttribute(
      "floatPhaseY",
      new THREE.BufferAttribute(floatPhasesY, 1),
    );
    geometry.setAttribute("speed", new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute(
      "twinklePhase",
      new THREE.BufferAttribute(twinklePhases, 1),
    );

    // Create shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        cameraX: { value: cameraX },
        cameraY: { value: cameraY },
        worldSize: { value: 10000 },
        centerX: { value: width / 2 },
        centerY: { value: height / 2 },
      },
      vertexShader: `
        attribute float size;
        attribute float parallax;
        attribute float opacity;
        attribute float basePositionX;
        attribute float basePositionY;
        attribute float floatAmplitudeX;
        attribute float floatAmplitudeY;
        attribute float floatPhaseX;
        attribute float floatPhaseY;
        attribute float speed;
        attribute float twinklePhase;

        uniform float time;
        uniform float cameraX;
        uniform float cameraY;
        uniform float worldSize;
        uniform float centerX;
        uniform float centerY;

        varying vec3 vColor;
        varying float vOpacity;
        varying float vTwinkle;

        float normalizeCoord(float coord) {
          return mod(coord + worldSize * 0.5, worldSize) - worldSize * 0.5;
        }

        float getWrappedDistance(float pos1, float pos2) {
          float delta = pos1 - pos2;
          return mod(delta + worldSize * 0.5, worldSize) - worldSize * 0.5;
        }

        void main() {
          vColor = color;

          // Simplified floating motion to prevent disappearing
          float timeOffset = time * 0.0005;
          float floatX = sin(timeOffset + floatPhaseX) * floatAmplitudeX * 0.3;
          float floatY = cos(timeOffset + floatPhaseY) * floatAmplitudeY * 0.3;

          // Calculate star world position
          float starX = normalizeCoord(basePositionX + floatX);
          float starY = normalizeCoord(basePositionY + floatY);

          // Apply parallax (simplified)
          float wrappedDeltaX = getWrappedDistance(starX, cameraX);
          float wrappedDeltaY = getWrappedDistance(starY, cameraY);

          float parallaxX = wrappedDeltaX * parallax;
          float parallaxY = wrappedDeltaY * parallax;

          float screenX = centerX + parallaxX;
          float screenY = centerY + parallaxY;

          // Ensure stars stay visible - clamp to reasonable bounds
          screenX = clamp(screenX, -centerX * 2.0, centerX * 3.0);
          screenY = clamp(screenY, -centerY * 2.0, centerY * 3.0);

          // Convert to world space (relative to center)
          vec3 worldPos = vec3(screenX - centerX, centerY - screenY, 0.0);
          vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // No twinkling - static opacity and size
          vOpacity = opacity;
          vTwinkle = 1.0;

          gl_PointSize = size * 1.4;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;
        varying float vTwinkle;

        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float distance = length(center);

          // Create bright core
          float core = 1.0 - smoothstep(0.0, 0.2, distance);
          core = pow(core, 0.5);

          // Create soft glow
          float glow = 1.0 - smoothstep(0.0, 0.5, distance);
          glow = pow(glow, 2.0);

          // Combine with different intensities
          float intensity = core * 0.8 + glow * 0.4;

          // Add twinkle variation
          intensity *= (0.7 + 0.3 * vTwinkle);

          float finalAlpha = intensity * vOpacity;

          gl_FragColor = vec4(vColor, finalAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    // Create points
    const points = new THREE.Points(geometry, material);
    pointsRef.current = points;
    materialRef.current = material;
    scene.add(points);
  }, [stars, width, height]);

  // Animation loop
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const animate = () => {
      const time = performance.now();

      // Update uniforms
      if (materialRef.current) {
        materialRef.current.uniforms.time.value = time;
        materialRef.current.uniforms.cameraX.value = cameraX;
        materialRef.current.uniforms.cameraY.value = cameraY;
      }

      rendererRef.current!.render(sceneRef.current!, cameraRef.current!);
      animationIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [cameraX, cameraY]);

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

      // Update uniforms
      if (materialRef.current) {
        materialRef.current.uniforms.centerX.value = width / 2;
        materialRef.current.uniforms.centerY.value = height / 2;
      }
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
          radial-gradient(ellipse at 20% 30%, rgba(50, 80, 150, 0.4) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(70, 120, 180, 0.3) 0%, transparent 50%),
          radial-gradient(ellipse at 40% 80%, rgba(60, 100, 160, 0.3) 0%, transparent 50%),
          radial-gradient(ellipse at 70% 70%, rgba(40, 90, 140, 0.2) 0%, transparent 50%),
          linear-gradient(135deg, #1a2845 0%, #0f1c38 40%, #0a1228 70%, #050a18 100%)
        `, // Beautiful galaxy background with blue nebula effects
      }}
    />
  );
};

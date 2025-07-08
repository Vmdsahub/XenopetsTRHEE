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

interface WebGLStarFieldProps {
  stars: Star[];
  cameraX: number;
  cameraY: number;
  width: number;
  height: number;
  className?: string;
}

export const WebGLStarField: React.FC<WebGLStarFieldProps> = ({
  stars,
  cameraX,
  cameraY,
  width,
  height,
  className = "",
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>();
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const cameraRef = useRef<THREE.OrthographicCamera>();
  const animationIdRef = useRef<number>();
  const starSystemsRef = useRef<{
    normal: THREE.Points;
    bright: THREE.Points;
    giant: THREE.Points;
  }>();
  const timeRef = useRef<number>(0);

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

  // Normalize world coordinates to screen space
  const getWrappedDistance = (
    pos1: number,
    pos2: number,
    worldSize = 10000,
  ) => {
    const delta = pos1 - pos2;
    const wrappedDelta = ((delta + worldSize / 2) % worldSize) - worldSize / 2;
    return wrappedDelta;
  };

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = null; // Transparent background

    // Camera setup - orthographic for 2D-like rendering
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

    // Enable blending for proper transparency
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

  // Create star systems when stars data changes
  useEffect(() => {
    if (!sceneRef.current || !stars.length) return;

    const scene = sceneRef.current;

    // Clear existing star systems
    if (starSystemsRef.current) {
      scene.remove(starSystemsRef.current.normal);
      scene.remove(starSystemsRef.current.bright);
      scene.remove(starSystemsRef.current.giant);
    }

    // Group stars by type
    const starGroups = {
      normal: stars.filter((star) => star.type === "normal"),
      bright: stars.filter((star) => star.type === "bright"),
      giant: stars.filter((star) => star.type === "giant"),
    };

    const starSystems = {} as any;

    Object.entries(starGroups).forEach(([type, typeStars]) => {
      if (typeStars.length === 0) return;

      // Create geometry for this star type
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(typeStars.length * 3);
      const colors = new Float32Array(typeStars.length * 3);
      const sizes = new Float32Array(typeStars.length);
      const parallaxValues = new Float32Array(typeStars.length);
      const opacities = new Float32Array(typeStars.length);
      const twinklePhases = new Float32Array(typeStars.length);
      const pulsePhases = new Float32Array(typeStars.length);
      const floatAmplitudesX = new Float32Array(typeStars.length);
      const floatAmplitudesY = new Float32Array(typeStars.length);
      const floatPhasesX = new Float32Array(typeStars.length);
      const floatPhasesY = new Float32Array(typeStars.length);
      const basePositionsX = new Float32Array(typeStars.length);
      const basePositionsY = new Float32Array(typeStars.length);
      const speeds = new Float32Array(typeStars.length);

      typeStars.forEach((star, i) => {
        // Position (will be updated in animation loop)
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        // Color
        const rgb = hexToRgb(star.color);
        colors[i * 3] = rgb.r;
        colors[i * 3 + 1] = rgb.g;
        colors[i * 3 + 2] = rgb.b;

        // Size and properties
        sizes[i] =
          star.size * (type === "giant" ? 2.5 : type === "bright" ? 1.5 : 1);
        parallaxValues[i] = star.parallax;
        opacities[i] = star.opacity;
        twinklePhases[i] = star.twinkle;
        pulsePhases[i] = star.pulse;
        floatAmplitudesX[i] = star.floatAmplitude.x;
        floatAmplitudesY[i] = star.floatAmplitude.y;
        floatPhasesX[i] = star.floatPhase.x;
        floatPhasesY[i] = star.floatPhase.y;
        basePositionsX[i] = star.baseX;
        basePositionsY[i] = star.baseY;
        speeds[i] = star.speed;
      });

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute(
        "parallax",
        new THREE.BufferAttribute(parallaxValues, 1),
      );
      geometry.setAttribute("opacity", new THREE.BufferAttribute(opacities, 1));
      geometry.setAttribute(
        "twinklePhase",
        new THREE.BufferAttribute(twinklePhases, 1),
      );
      geometry.setAttribute(
        "pulsePhase",
        new THREE.BufferAttribute(pulsePhases, 1),
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
      geometry.setAttribute(
        "basePositionX",
        new THREE.BufferAttribute(basePositionsX, 1),
      );
      geometry.setAttribute(
        "basePositionY",
        new THREE.BufferAttribute(basePositionsY, 1),
      );
      geometry.setAttribute("speed", new THREE.BufferAttribute(speeds, 1));

      // Create shader material
      const material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          cameraX: { value: 0 },
          cameraY: { value: 0 },
          worldSize: { value: 10000 },
          centerX: { value: width / 2 },
          centerY: { value: height / 2 },
        },
        vertexShader: `
          attribute float size;
          attribute float parallax;
          attribute float opacity;
          attribute float twinklePhase;
          attribute float pulsePhase;
          attribute float floatAmplitudeX;
          attribute float floatAmplitudeY;
          attribute float floatPhaseX;
          attribute float floatPhaseY;
          attribute float basePositionX;
          attribute float basePositionY;
          attribute float speed;

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

            // Calculate floating motion
            float timeOffset = time * 0.0008;
            float baseSpeed = 0.8 + speed * 0.4;
            float primaryTime = timeOffset * baseSpeed;

            float floatX = sin(primaryTime + floatPhaseX) * floatAmplitudeX * 0.3;
            float floatY = cos(primaryTime + floatPhaseY) * floatAmplitudeY * 0.3;

            // Calculate star world position
            float starX = normalizeCoord(basePositionX + floatX);
            float starY = normalizeCoord(basePositionY + floatY);

            // Apply parallax effect
            float wrappedDeltaX = getWrappedDistance(starX, cameraX);
            float wrappedDeltaY = getWrappedDistance(starY, cameraY);

            float parallaxX = wrappedDeltaX * parallax;
            float parallaxY = wrappedDeltaY * parallax;

            float screenX = centerX + parallaxX;
            float screenY = centerY + parallaxY;

            // Convert to world space position (simplified)
            vec3 worldPos = vec3(screenX - centerX, centerY - screenY, 0.0);
            vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // Calculate effects
            float twinkleAlpha = sin(twinklePhase + time * speed * 0.4) * 0.3 + 0.7;
            float pulseSize = sin(pulsePhase + time * speed * 0.3) * 0.2 + 1.0;

            vOpacity = opacity * twinkleAlpha;
            vTwinkle = twinkleAlpha;

            gl_PointSize = size * pulseSize * 3.0;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;
          varying float vTwinkle;

          void main() {
            vec2 center = gl_PointCoord - vec2(0.5);
            float distance = length(center);

            // Create bright star core
            float core = 1.0 - smoothstep(0.0, 0.15, distance);
            core = pow(core, 0.5);

            // Create soft glow
            float glow = 1.0 - smoothstep(0.0, 0.5, distance);
            glow = pow(glow, 3.0);

            // Create extended aura
            float aura = 1.0 - smoothstep(0.0, 0.8, distance);
            aura = pow(aura, 6.0);

            // Combine layers with different intensities
            float intensity = core * 0.9 + glow * 0.5 + aura * 0.2;

            // Add twinkle variation to the intensity
            intensity *= (0.7 + 0.3 * vTwinkle);

            float finalAlpha = intensity * vOpacity;

            // Enhance colors slightly
            vec3 enhancedColor = vColor * (1.0 + 0.2 * vTwinkle);

            gl_FragColor = vec4(enhancedColor, finalAlpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      // Create points system
      const points = new THREE.Points(geometry, material);
      starSystems[type] = points;
      scene.add(points);
      console.log(
        `WebGL Star Field: Added ${typeStars.length} ${type} stars to scene`,
      );
    });

    starSystemsRef.current = starSystems;
  }, [stars, width, height]);

  // Animation loop
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const animate = () => {
      timeRef.current = performance.now();

      // Update uniforms for all star systems
      if (starSystemsRef.current) {
        Object.values(starSystemsRef.current).forEach((points) => {
          if (points.material instanceof THREE.ShaderMaterial) {
            points.material.uniforms.time.value = timeRef.current;
            points.material.uniforms.cameraX.value = cameraX;
            points.material.uniforms.cameraY.value = cameraY;
          }
        });
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

  // Update camera and renderer size when dimensions change
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
      if (starSystemsRef.current) {
        Object.values(starSystemsRef.current).forEach((points) => {
          if (points.material instanceof THREE.ShaderMaterial) {
            points.material.uniforms.centerX.value = width / 2;
            points.material.uniforms.centerY.value = height / 2;
          }
        });
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
      }}
    />
  );
};

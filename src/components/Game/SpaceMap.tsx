import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useGameStore } from "../../store/gameStore";
import { useShipStatePersistence } from "../../hooks/useShipStatePersistence";
import { PlanetLandingModal } from "./PlanetLandingModal";
import { useNPCShip } from "./NPCShip";
import { NPCModal } from "./NPCModal";
import { gameService } from "../../services/gameService";
import { FinalWebGLStars } from "./FinalWebGLStars";
import { MobileOptimizedWebGLStars } from "./MobileOptimizedWebGLStars";
import {
  playLaserShootSound,
  playLandingSound,
  startContinuousMovementSound,
  updateContinuousMovementSound,
  stopContinuousMovementSound,
  playSonarPingSound,
} from "../../utils/soundManager";

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
  baseX: number; // Posição base para movimento oscilatório
  baseY: number; // Posição base para movimento oscilatório
  floatAmplitude: { x: number; y: number }; // Amplitude do movimento de flutua���ão
  floatPhase: { x: number; y: number }; // Fase do movimento senoidal
}

interface Planet {
  id: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  name: string;
  interactionRadius: number;
  imageUrl: string;
  // Floating animation properties
  baseX?: number;
  baseY?: number;
  floatAmplitude?: { x: number; y: number };
  floatPhase?: { x: number; y: number };
  floatSpeed?: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  opacity: number;
  color: string;
  tailLength: number;
}

interface RadarPulse {
  planetId: string;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  opacity: number;
}

interface TrailPoint {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  intensity: number;
}

interface GameState {
  ship: {
    x: number;
    y: number;
    angle: number;
    vx: number;
    vy: number;
  };
  camera: {
    x: number;
    y: number;
  };
}

const WORLD_SIZE = 100000;
const SHIP_MAX_SPEED = 2;
const FRICTION = 0.88;
const CENTER_X = WORLD_SIZE / 2;
const CENTER_Y = WORLD_SIZE / 2;
const BARRIER_RADIUS = 600;
const PROJECTILE_SPEED = 600; // pixels per second (consistent across all FPS)
const PROJECTILE_LIFETIME = 4.0; // seconds

// Pre-render buffer size
const RENDER_BUFFER = 200;

// Trail constants
const TRAIL_MAX_POINTS = 25;
const TRAIL_POINT_DISTANCE = 6;
const TRAIL_LIFETIME = 1200; // milliseconds
const TRAIL_WIDTH = 12;

const SpaceMapComponent: React.FC = () => {
  const {
    getShipState,
    setCurrentScreen,
    setCurrentPlanet,
    currentScreen,
    isWorldEditMode,
    setWorldEditMode,
    isBarrierCollisionEnabled,
    setBarrierCollisionEnabled,
    user,
    worldPositions,
    loadWorldPositions,
    updateWorldPosition,
  } = useGameStore();
  const { saveShipState, forceSaveShipState } = useShipStatePersistence();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();
  const mouseRef = useRef({ x: 0, y: 0 });
  const hasMouseMoved = useRef(false);
  const starsRef = useRef<Star[]>([]);
  const planetsRef = useRef<Planet[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const shootingStarsRef = useRef<ShootingStar[]>([]);
  const radarPulsesRef = useRef<RadarPulse[]>([]);
  const trailPointsRef = useRef<TrailPoint[]>([]);
  const lastTrailTime = useRef<number>(0);
  const lastShootingStarTime = useRef(0);
  const lastShootTime = useRef(0);
  const lastStarUpdateTime = useRef(0);
  const STAR_UPDATE_INTERVAL = 200; // 5 FPS = 200ms interval
  const lastRadarCheckRef = useRef<Set<string>>(new Set());
  const shootingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFrameTimeRef = useRef(performance.now());
  const frameCounter = useRef(0);
  const [isMousePressed, setIsMousePressed] = useState(false);

  // Mobile device detection for performance optimization
  const isMobile = useMemo(() => {
    // Check for mobile user agents
    const mobileUA =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    // Check for touch capability and smaller screens
    const touchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const smallScreen = window.innerWidth <= 1024; // Increased threshold for tablets

    return mobileUA || (touchDevice && smallScreen);
  }, []);

  // Adaptive frame rate management - FPS uncapped for all devices
  const targetFrameTime = 0; // Unlimited FPS for both mobile and desktop
  const lastFrameTimeForMobile = useRef(0);
  const refreshRateRef = useRef(60); // Default to 60Hz
  const frameTimeHistoryRef = useRef<number[]>([]);
  const refreshRateDetectedRef = useRef(false);

  const [canvasDimensions, setCanvasDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const lastRadarPulseTime = useRef<Map<string, number>>(new Map());
  const planetImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const shipImageRef = useRef<HTMLImageElement | null>(null);
  const movementSoundActiveRef = useRef<boolean>(false);
  const shouldHideShipRef = useRef<boolean>(false);

  // Detect monitor refresh rate for optimal frame timing
  const detectRefreshRate = useCallback(() => {
    if (refreshRateDetectedRef.current) return;

    const frameHistory = frameTimeHistoryRef.current;
    if (frameHistory.length >= 60) {
      // Collect 60 frames for accurate measurement
      const avgFrameTime =
        frameHistory.reduce((a, b) => a + b, 0) / frameHistory.length;
      const detectedRefreshRate = Math.round(1000 / avgFrameTime);

      // Validate detected refresh rate (common rates: 60, 75, 90, 120, 144, 165, 240Hz)
      const commonRates = [60, 75, 90, 120, 144, 165, 240];
      const closestRate = commonRates.reduce((prev, curr) =>
        Math.abs(curr - detectedRefreshRate) <
        Math.abs(prev - detectedRefreshRate)
          ? curr
          : prev,
      );

      refreshRateRef.current = closestRate;
      refreshRateDetectedRef.current = true;

      console.log(
        `🖥️ Detected monitor refresh rate: ${closestRate}Hz (measured: ${detectedRefreshRate}Hz)`,
      );
    }
  }, []);

  // Initialize state from store or use defaults
  const getInitialGameState = useCallback((): GameState => {
    const savedState = getShipState();
    if (savedState) {
      return {
        ship: {
          x: savedState.x,
          y: savedState.y,
          angle: 0, // Reset angle to neutral position
          vx: 0, // Reset velocity to stop movement
          vy: 0, // Reset velocity to stop movement
        },
        camera: {
          x: savedState.cameraX,
          y: savedState.cameraY,
        },
      };
    }
    return {
      ship: {
        x: CENTER_X,
        y: CENTER_Y + 200,
        angle: 0,
        vx: 0,
        vy: 0,
      },
      camera: {
        x: CENTER_X,
        y: CENTER_Y + 200,
      },
    };
  }, [getShipState]);

  const [gameState, setGameState] = useState<GameState>(getInitialGameState);

  // Reset velocities on component mount to ensure ship starts stationary
  useEffect(() => {
    setGameState((prevState) => ({
      ...prevState,
      ship: {
        ...prevState.ship,
        vx: 0,
        vy: 0,
        angle: 0,
      },
    }));
  }, []); // Empty dependency array ensures this runs only on mount

  // FPS tracking
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({
    frameCount: 0,
    lastTime: 0,
    frameTimes: [] as number[],
  });

  // FPS history for graph (keep last 60 FPS values)
  const [fpsHistory, setFpsHistory] = useState<number[]>(Array(60).fill(60));
  const fpsGraphRef = useRef<HTMLCanvasElement>(null);

  // Mouse state tracking
  const [mouseInWindow, setMouseInWindow] = useState(true);

  // Modal state
  const [showLandingModal, setShowLandingModal] = useState(false);
  const [selectedPlanet, setSelectedPlanet] = useState<Planet | null>(null);
  const [showNPCModal, setShowNPCModal] = useState(false);

  // Landing animation state
  const [isLandingAnimationActive, setIsLandingAnimationActive] =
    useState(false);
  const [landingAnimationData, setLandingAnimationData] = useState<{
    planet: Planet;
    startTime: number;
    duration: number;
    initialShipX: number;
    initialShipY: number;
  } | null>(null);

  // Ship rendering state - persists across renders
  const [shipRenderState, setShipRenderState] = useState<{
    shouldRender: boolean;
    scale: number;
    angle: number;
  }>({
    shouldRender: true,
    scale: 1,
    angle: 0,
  });

  // Effect to handle landing animation completion
  useEffect(() => {
    if (!isLandingAnimationActive && currentScreen === "planet") {
      // Force ship to not render when on planet screen
      shouldHideShipRef.current = true;
      setShipRenderState({
        shouldRender: false,
        scale: 0,
        angle: 0,
      });
    } else if (!isLandingAnimationActive && currentScreen === "world") {
      // Reset to normal rendering when back to world
      shouldHideShipRef.current = false;
      setShipRenderState({
        shouldRender: true,
        scale: 1,
        angle: gameState.ship.angle,
      });
    }
  }, [isLandingAnimationActive, currentScreen, gameState.ship.angle]);

  // World editing state
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [barrierFlashTime, setBarrierFlashTime] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Helper function for seamless wrapping distance calculation
  const getWrappedDistance = useCallback(
    (coord: number, cameraCoord: number) => {
      let delta = coord - cameraCoord;
      if (delta > WORLD_SIZE / 2) delta -= WORLD_SIZE;
      else if (delta < -WORLD_SIZE / 2) delta += WORLD_SIZE;
      return delta;
    },
    [],
  );

  // Helper function to normalize coordinates within world bounds
  const normalizeCoord = useCallback((coord: number) => {
    return ((coord % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
  }, []);

  // Initialize NPC Ship
  const npcShip = useNPCShip({
    planets: planetsRef.current,
    getWrappedDistance,
    normalizeCoord,
    isPaused: showNPCModal,
  });

  // Função de tiro que pode ser reutilizada
  const shootProjectile = useCallback(() => {
    const currentTime = Date.now();
    const SHOOT_COOLDOWN = 333; // 333ms entre tiros (3 tiros/segundo)

    // Verificar cooldown
    if (currentTime - lastShootTime.current >= SHOOT_COOLDOWN) {
      const newProjectile: Projectile = {
        x: gameState.ship.x,
        y: gameState.ship.y,
        vx: Math.cos(gameState.ship.angle) * PROJECTILE_SPEED,
        vy: Math.sin(gameState.ship.angle) * PROJECTILE_SPEED,
        life: PROJECTILE_LIFETIME,
        maxLife: PROJECTILE_LIFETIME,
      };
      projectilesRef.current.push(newProjectile);
      lastShootTime.current = currentTime;

      // Tocar som de laser
      playLaserShootSound().catch(() => {
        // Som não é crítico, ignora erro
      });

      return true; // Tiro disparado
    }
    return false; // Cooldown ainda ativo
  }, [gameState.ship.x, gameState.ship.y, gameState.ship.angle]);

  // Function to check if click is on visible pixel of planet image
  const isClickOnPlanetPixel = useCallback(
    (
      planet: Planet,
      clickWorldX: number,
      clickWorldY: number,
      canvas: HTMLCanvasElement,
    ): boolean => {
      const img = planetImagesRef.current.get(planet.id);
      if (!img || !img.complete) {
        // Fallback to circle detection if image not loaded
        const dx = getWrappedDistance(planet.x, clickWorldX);
        const dy = getWrappedDistance(planet.y, clickWorldY);
        return Math.sqrt(dx * dx + dy * dy) <= planet.size;
      }

      // Create temporary canvas to check pixel data
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return false;

      const imageSize = planet.size * 2; // Diameter
      tempCanvas.width = imageSize;
      tempCanvas.height = imageSize;

      // Draw the image on temp canvas
      tempCtx.drawImage(img, 0, 0, imageSize, imageSize);

      // Calculate relative position within the image
      const dx = getWrappedDistance(planet.x, clickWorldX);
      const dy = getWrappedDistance(planet.y, clickWorldY);

      // Convert to image coordinates (center the image)
      const imgX = dx + imageSize / 2;
      const imgY = dy + imageSize / 2;

      // Check if within image bounds
      if (imgX < 0 || imgX >= imageSize || imgY < 0 || imgY >= imageSize) {
        return false;
      }

      // Get pixel data at the click position
      try {
        const pixelData = tempCtx.getImageData(imgX, imgY, 1, 1).data;
        const alpha = pixelData[3]; // Alpha channel
        return alpha > 50; // Consider pixel visible if alpha > 50
      } catch (e) {
        // Fallback to circle detection if there's an error
        return Math.sqrt(dx * dx + dy * dy) <= planet.size;
      }
    },
    [getWrappedDistance],
  );

  // Create shooting star
  const createShootingStar = useCallback((canvas: HTMLCanvasElement) => {
    const colors = ["#ffffff", "#ffe4b5", "#ffd700", "#87ceeb", "#ff69b4"];
    const side = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
    const speed = 3 + Math.random() * 4;
    const angle = Math.random() * Math.PI * 0.4 + Math.PI * 0.3; // Diagonal direction

    let startX, startY, vx, vy;

    // Start from edges and move diagonally across screen
    switch (side) {
      case 0: // from top
        startX = Math.random() * canvas.width;
        startY = -50;
        vx = (Math.random() - 0.5) * speed;
        vy = speed;
        break;
      case 1: // from right
        startX = canvas.width + 50;
        startY = Math.random() * canvas.height;
        vx = -speed;
        vy = (Math.random() - 0.5) * speed;
        break;
      case 2: // from bottom
        startX = Math.random() * canvas.width;
        startY = canvas.height + 50;
        vx = (Math.random() - 0.5) * speed;
        vy = -speed;
        break;
      default: // from left
        startX = -50;
        startY = Math.random() * canvas.height;
        vx = speed;
        vy = (Math.random() - 0.5) * speed;
        break;
    }

    const newShootingStar: ShootingStar = {
      x: startX,
      y: startY,
      vx,
      vy,
      life: 120 + Math.random() * 60, // 2-3 seconds at 60fps
      maxLife: 120 + Math.random() * 60,
      size: 0.8 + Math.random() * 1.2,
      opacity: 0.6 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      tailLength: 15 + Math.random() * 20,
    };

    shootingStarsRef.current.push(newShootingStar);
  }, []);

  // Helper function to draw shooting star with tail
  const drawShootingStar = useCallback(
    (ctx: CanvasRenderingContext2D, shootingStar: ShootingStar) => {
      const fadeRatio = shootingStar.life / shootingStar.maxLife;
      const currentOpacity = shootingStar.opacity * fadeRatio;

      // Draw tail
      const tailPoints = 8;
      ctx.save();
      ctx.globalAlpha = currentOpacity * 0.6;

      for (let i = 0; i < tailPoints; i++) {
        const ratio = i / tailPoints;
        const tailX =
          shootingStar.x - shootingStar.vx * ratio * shootingStar.tailLength;
        const tailY =
          shootingStar.y - shootingStar.vy * ratio * shootingStar.tailLength;
        const tailSize = shootingStar.size * (1 - ratio) * 0.8;
        const tailAlpha = currentOpacity * (1 - ratio) * 0.5;

        ctx.globalAlpha = tailAlpha;
        ctx.fillStyle = shootingStar.color;
        ctx.beginPath();
        ctx.arc(tailX, tailY, tailSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw main star
      ctx.globalAlpha = currentOpacity;
      ctx.fillStyle = shootingStar.color;
      ctx.beginPath();
      ctx.arc(
        shootingStar.x,
        shootingStar.y,
        shootingStar.size,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // Add bright core
      ctx.globalAlpha = currentOpacity * 1.2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(
        shootingStar.x,
        shootingStar.y,
        shootingStar.size * 0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      ctx.restore();
    },
    [],
  );

  // Create radar pulse towards planet
  const createRadarPulse = useCallback((planet: Planet) => {
    const newPulse: RadarPulse = {
      planetId: planet.id,
      radius: 8, // Raio inicial original
      maxRadius: 40, // Expans��o menor
      life: 160, // Vida mais longa para compensar expansão lenta
      maxLife: 160,
      opacity: 1.2, // Opacidade muito alta para verde ser mais visível
    };

    radarPulsesRef.current.push(newPulse);

    // Play modern sonar sound when radar pulse is created
    playSonarPingSound().catch((error) => {
      console.warn("Failed to play sonar sound:", error);
    });
  }, []);

  // Helper function to draw directional radar pulse
  const drawRadarPulse = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      pulse: RadarPulse,
      shipScreenX: number,
      shipScreenY: number,
      currentShipX: number,
      currentShipY: number,
    ) => {
      // Buscar o planeta correspondente a este pulse
      const planet = planetsRef.current.find((p) => p.id === pulse.planetId);
      if (!planet) return;

      // Calcular ângulo dinamicamente baseado na posição atual da nave
      const dx = getWrappedDistance(planet.x, currentShipX);
      const dy = getWrappedDistance(planet.y, currentShipY);
      const dynamicAngle = Math.atan2(dy, dx);

      const fadeRatio = pulse.life / pulse.maxLife;
      const expandRatio = (pulse.maxRadius - pulse.radius) / pulse.maxRadius;

      // Better fade out for improved visibility
      const currentOpacity =
        pulse.opacity * fadeRatio * (0.5 + expandRatio * 0.5);

      ctx.save();

      // Gradiente verde 3D mais vibrante
      const gradient = ctx.createRadialGradient(
        shipScreenX,
        shipScreenY,
        0,
        shipScreenX,
        shipScreenY,
        pulse.radius,
      );
      gradient.addColorStop(0, `rgba(150, 255, 150, ${currentOpacity})`); // Verde muito claro centro
      gradient.addColorStop(0.4, `rgba(50, 255, 50, ${currentOpacity})`); // Verde claro
      gradient.addColorStop(0.7, `rgba(0, 255, 0, ${currentOpacity * 0.9})`); // Verde puro vibrante
      gradient.addColorStop(1, `rgba(0, 200, 0, ${currentOpacity * 0.6})`); // Verde médio

      // Arco original
      const arcWidth = Math.PI / 3; // 60 graus original
      const startAngle = dynamicAngle - arcWidth / 2;
      const endAngle = dynamicAngle + arcWidth / 2;

      // Linha principal mais fina
      ctx.globalAlpha = currentOpacity;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3; // Linha mais fina
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.arc(shipScreenX, shipScreenY, pulse.radius, startAngle, endAngle);
      ctx.stroke();

      // Brilho interno verde mais forte para efeito 3D
      ctx.globalAlpha = currentOpacity;
      ctx.strokeStyle = `rgba(200, 255, 200, ${currentOpacity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(shipScreenX, shipScreenY, pulse.radius, startAngle, endAngle);
      ctx.stroke();

      ctx.restore();
    },
    [getWrappedDistance],
  );

  // Create trail point function
  const createTrailPoint = useCallback(
    (x: number, y: number, currentTime: number, shipVelocity: number) => {
      const intensity = Math.min(shipVelocity / SHIP_MAX_SPEED, 1);

      trailPointsRef.current.push({
        x,
        y,
        life: TRAIL_LIFETIME,
        maxLife: TRAIL_LIFETIME,
        intensity,
      });

      // Keep only the most recent trail points - fewer on mobile
      const maxPoints = isMobile
        ? Math.floor(TRAIL_MAX_POINTS / 2)
        : TRAIL_MAX_POINTS;
      if (trailPointsRef.current.length > maxPoints) {
        trailPointsRef.current.shift();
      }
    },
    [],
  );

  // Update trail points function
  const updateTrailPoints = useCallback((deltaTime: number) => {
    // Limit deltaTime to prevent trail from disappearing with uncapped FPS
    const safeDeltaTime = Math.min(deltaTime, 33); // Cap at ~30 FPS equivalent

    trailPointsRef.current.forEach((point) => {
      point.life -= safeDeltaTime;
    });

    // Remove dead trail points
    trailPointsRef.current = trailPointsRef.current.filter(
      (point) => point.life > 0,
    );
  }, []);

  // Draw trail function
  const drawShipTrail = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      shipScreenX: number,
      shipScreenY: number,
      shipWorldX: number,
      shipWorldY: number,
    ) => {
      if (trailPointsRef.current.length < 2) return;

      ctx.save();

      // Enable global shadow for intense glow effect
      const time = Date.now() * 0.003;
      const pulseIntensity = 0.7 + 0.3 * Math.sin(time); // Pulsing effect

      // Draw each segment of the trail
      for (let i = 0; i < trailPointsRef.current.length - 1; i++) {
        const current = trailPointsRef.current[i];
        const next = trailPointsRef.current[i + 1];

        const currentLifeRatio = current.life / current.maxLife;
        const nextLifeRatio = next.life / next.maxLife;

        // Calculate screen positions using wrapped distance
        const currentDx = getWrappedDistance(current.x, shipWorldX);
        const currentDy = getWrappedDistance(current.y, shipWorldY);
        const currentScreenX = shipScreenX + currentDx;
        const currentScreenY = shipScreenY + currentDy;

        const nextDx = getWrappedDistance(next.x, shipWorldX);
        const nextDy = getWrappedDistance(next.y, shipWorldY);
        const nextScreenX = shipScreenX + nextDx;
        const nextScreenY = shipScreenY + nextDy;

        // Create gradient for the trail segment
        const distance = Math.sqrt(
          Math.pow(nextScreenX - currentScreenX, 2) +
            Math.pow(nextScreenY - currentScreenY, 2),
        );

        if (distance > 0) {
          const gradient = ctx.createLinearGradient(
            currentScreenX,
            currentScreenY,
            nextScreenX,
            nextScreenY,
          );

          // Yellow glow effect with intensity-based strength - ultra bright
          const currentAlpha = Math.min(
            currentLifeRatio * current.intensity * 0.95,
            0.9,
          );
          const nextAlpha = Math.min(
            nextLifeRatio * next.intensity * 0.95,
            0.9,
          );
          const avgAlpha = (currentAlpha + nextAlpha) / 2;
          const avgIntensity = (current.intensity + next.intensity) / 2;

          gradient.addColorStop(0, `rgba(255, 235, 59, ${currentAlpha})`); // Soft yellow
          gradient.addColorStop(1, `rgba(255, 193, 7, ${nextAlpha})`); // Slightly orange yellow

          // Ultra bright outer glow with shadow
          ctx.shadowColor = "#ffeb3b";
          ctx.shadowBlur = 25 * pulseIntensity * avgIntensity;
          ctx.strokeStyle = `rgba(255, 215, 0, ${avgAlpha * 0.8 * pulseIntensity})`;
          ctx.lineWidth =
            TRAIL_WIDTH *
            2.5 *
            ((currentLifeRatio + nextLifeRatio) / 2) *
            avgIntensity;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          ctx.beginPath();
          ctx.moveTo(currentScreenX, currentScreenY);
          ctx.lineTo(nextScreenX, nextScreenY);
          ctx.stroke();

          // Medium glow layer
          ctx.shadowBlur = 15 * pulseIntensity * avgIntensity;
          ctx.strokeStyle = `rgba(255, 235, 59, ${avgAlpha * 0.9 * pulseIntensity})`;
          ctx.lineWidth =
            TRAIL_WIDTH *
            1.8 *
            ((currentLifeRatio + nextLifeRatio) / 2) *
            avgIntensity;

          ctx.beginPath();
          ctx.moveTo(currentScreenX, currentScreenY);
          ctx.lineTo(nextScreenX, nextScreenY);
          ctx.stroke();

          // Main trail segment with bright glow
          ctx.shadowBlur = 10 * pulseIntensity * avgIntensity;
          ctx.strokeStyle = gradient;
          ctx.lineWidth =
            TRAIL_WIDTH *
            ((currentLifeRatio + nextLifeRatio) / 2) *
            avgIntensity;
          ctx.beginPath();
          ctx.moveTo(currentScreenX, currentScreenY);
          ctx.lineTo(nextScreenX, nextScreenY);
          ctx.stroke();

          // Ultra bright inner core with white hot center
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 8 * pulseIntensity * avgIntensity;
          ctx.strokeStyle = `rgba(255, 255, 255, ${avgAlpha * 0.9 * pulseIntensity})`;
          ctx.lineWidth =
            TRAIL_WIDTH *
            0.6 *
            ((currentLifeRatio + nextLifeRatio) / 2) *
            avgIntensity;
          ctx.beginPath();
          ctx.moveTo(currentScreenX, currentScreenY);
          ctx.lineTo(nextScreenX, nextScreenY);
          ctx.stroke();

          // Final bright yellow core
          ctx.shadowColor = "#ffff00";
          ctx.shadowBlur = 5 * pulseIntensity * avgIntensity;
          ctx.strokeStyle = `rgba(255, 255, 150, ${avgAlpha * pulseIntensity})`;
          ctx.lineWidth =
            TRAIL_WIDTH *
            0.3 *
            ((currentLifeRatio + nextLifeRatio) / 2) *
            avgIntensity;
          ctx.beginPath();
          ctx.moveTo(currentScreenX, currentScreenY);
          ctx.lineTo(nextScreenX, nextScreenY);
          ctx.stroke();
        }
      }

      // Reset shadow effects to not affect other elements
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      ctx.restore();
    },
    [getWrappedDistance],
  );

  // Helper function to draw pure light points
  const drawPureLightStar = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      color: string,
      intensity: number,
      type: "normal" | "bright" | "giant",
    ) => {
      // Convert hex color to rgba for proper alpha handling
      const hexToRgba = (hex: string, alpha: number) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      // Enhanced glow effect for all stars
      const glowRadius = size * 3;
      const glowIntensity =
        type === "giant" ? 0.8 : type === "bright" ? 0.6 : 0.4;

      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      const outerGradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
      outerGradient.addColorStop(
        0,
        hexToRgba(color, intensity * glowIntensity),
      );
      outerGradient.addColorStop(0.4, hexToRgba(color, intensity * 0.3));
      outerGradient.addColorStop(0.8, hexToRgba(color, intensity * 0.1));
      outerGradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = outerGradient;
      ctx.fill();

      // Inner bright glow
      const innerGlowRadius = size * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, innerGlowRadius, 0, Math.PI * 2);
      const innerGradient = ctx.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        innerGlowRadius,
      );
      innerGradient.addColorStop(0, hexToRgba(color, intensity * 0.9));
      innerGradient.addColorStop(0.6, hexToRgba(color, intensity * 0.5));
      innerGradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = innerGradient;
      ctx.fill();

      // Bright core - pure light point
      ctx.beginPath();
      ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Ultra-bright center
      ctx.beginPath();
      ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    },
    [],
  );

  // Generate optimized star field with reduced star count for better performance
  const generateRichStarField = useCallback(() => {
    const stars: Star[] = [];

    // Generate infinite color tonalities for stars
    const generateRandomStarColor = () => {
      const colors = [
        // Greens
        "#90EE90",
        "#98FB98",
        "#00FF7F",
        "#32CD32",
        "#00FA9A",
        "#7CFC00",
        // Purples
        "#DA70D6",
        "#BA55D3",
        "#9370DB",
        "#8A2BE2",
        "#9932CC",
        "#DDA0DD",
        // Pinks
        "#FF69B4",
        "#FFB6C1",
        "#FFC0CB",
        "#FF1493",
        "#FF6347",
        "#FFE4E1",
        // Reds
        "#FF6B6B",
        "#FF4444",
        "#FF7F7F",
        "#FF5555",
        "#FF8888",
        "#FFA0A0",
        // Oranges
        "#FFA500",
        "#FF8C00",
        "#FFB347",
        "#FF7F50",
        "#FFA07A",
        "#FFAB91",
        // Blues
        "#87CEEB",
        "#87CEFA",
        "#4169E1",
        "#6495ED",
        "#00BFFF",
        "#1E90FF",
      ];
      return colors[Math.floor(Math.random() * colors.length)];
    };

    // Layer 1: Deep background (parallax 0.3) - ABAIXO do jogador - Reduced for mobile
    const layer1Count = isMobile ? 1200 : 4000;
    for (let i = 0; i < layer1Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 0.7 + Math.random() * 1.0,
        opacity: 0.5 + Math.random() * 0.6,
        speed: Math.random() * 0.015 + 0.005,
        parallax: 0.3, // Camada mais distante
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: "normal",
        drift: {
          x: 0, // Movimento será calculado via seno/cosseno
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 3 + 1, // Movimento mais sutil para camada distante
          y: Math.random() * 3 + 1,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2, // Fase inicial aleatória
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 2: Mid background (parallax 0.6) - ABAIXO do jogador - Reduced for mobile
    const layer2Count = isMobile ? 1000 : 3500;
    for (let i = 0; i < layer2Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 0.9 + Math.random() * 1.2,
        opacity: 0.6 + Math.random() * 0.5,
        speed: Math.random() * 0.018 + 0.007,
        parallax: 0.6, // Paralaxe distinta
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: Math.random() < 0.1 ? "bright" : "normal",
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 2.5 + 0.8,
          y: Math.random() * 2.5 + 0.8,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 3: Near background (parallax 1.0) - ABAIXO do jogador - Reduced for mobile
    const layer3Count = isMobile ? 900 : 3000;
    for (let i = 0; i < layer3Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 1.1 + Math.random() * 1.6,
        opacity: 0.7 + Math.random() * 0.4,
        speed: Math.random() * 0.022 + 0.009,
        parallax: 1.0, // Paralaxe distinta
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: Math.random() < 0.15 ? "bright" : "normal",
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 2 + 0.6,
          y: Math.random() * 2 + 0.6,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 4: Close background (parallax 1.4) - ABAIXO do jogador - Reduced for mobile
    const layer4Count = isMobile ? 750 : 2500;
    for (let i = 0; i < layer4Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 1.3 + Math.random() * 1.8,
        opacity: 0.7 + Math.random() * 0.4,
        speed: Math.random() * 0.025 + 0.012,
        parallax: 1.4, // Paralaxe distinta
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: Math.random() < 0.2 ? "bright" : "normal",
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 1.8 + 0.5,
          y: Math.random() * 1.8 + 0.5,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 5: Cosmic dust foreground (parallax 1.8) - ACIMA do jogador - Reduced for mobile
    const layer5Count = isMobile ? 600 : 2000;
    for (let i = 0; i < layer5Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 0.5 + Math.random() * 0.9, // Tamanhos menores para poeira cósmica
        opacity: 0.4 + Math.random() * 0.4,
        speed: Math.random() * 0.01 + 0.005, // Velocidade reduzida
        parallax: 1.8, // Paralaxe de primeiro plano
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: Math.random() < 0.15 ? "bright" : "normal", // Menos estrelas giant
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 1.5 + 0.4, // Movimento mais sutil para poeira cósmica
          y: Math.random() * 1.5 + 0.4,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 6: Close cosmic dust (parallax 2.2) - ACIMA do jogador - Reduced for mobile
    const layer6Count = isMobile ? 400 : 1500;
    for (let i = 0; i < layer6Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 0.4 + Math.random() * 0.7, // Ainda menores para camada mais próxima
        opacity: 0.3 + Math.random() * 0.3, // Mais transparentes
        speed: Math.random() * 0.008 + 0.003, // Muito lento
        parallax: 2.2, // Máximo paralaxe
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: Math.random() < 0.1 ? "bright" : "normal", // Principalmente normais
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 1.3 + 0.3, // Movimento muito sutil
          y: Math.random() * 1.3 + 0.3,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 7: Micro stars (parallax 0.8) - Additional density layer - Reduced for mobile
    const layer7Count = isMobile ? 750 : 2500;
    for (let i = 0; i < layer7Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 0.3 + Math.random() * 0.5, // Very small stars
        opacity: 0.3 + Math.random() * 0.4,
        speed: Math.random() * 0.012 + 0.004,
        parallax: 0.8, // Between layers 1 and 2
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type: "normal",
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 1.2 + 0.3,
          y: Math.random() * 1.2 + 0.3,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    // Layer 8: Bright accent stars (parallax 1.2) - Brighter stars for contrast - Reduced for mobile
    const layer8Count = isMobile ? 250 : 800;
    for (let i = 0; i < layer8Count; i++) {
      const baseX = Math.random() * WORLD_SIZE;
      const baseY = Math.random() * WORLD_SIZE;
      stars.push({
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        size: 1.5 + Math.random() * 2.0, // Larger bright stars
        opacity: 0.7 + Math.random() * 0.3,
        speed: Math.random() * 0.02 + 0.01,
        parallax: 1.2,
        twinkle: Math.random() * 100,
        color: Math.random() < 0.92 ? "#ffffff" : generateRandomStarColor(),
        type:
          Math.random() < 0.4
            ? "bright"
            : Math.random() < 0.8
              ? "normal"
              : "giant",
        drift: {
          x: 0,
          y: 0,
        },
        pulse: Math.random() * 100,
        floatAmplitude: {
          x: Math.random() * 2.2 + 0.8,
          y: Math.random() * 2.2 + 0.8,
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
      });
    }

    starsRef.current = stars;
  }, []);

  // Update planets when worldPositions change
  const updatePlanetsFromStore = useCallback(() => {
    if (worldPositions.length > 0) {
      // Use store positions with floating properties
      const planets: Planet[] = worldPositions.map((position) => ({
        id: position.id,
        x: position.x,
        y: position.y,
        size: position.size,
        rotation: position.rotation,
        color: position.color,
        name: position.name,
        interactionRadius: position.interactionRadius,
        imageUrl: position.imageUrl || "",
        // Add floating animation properties
        baseX: position.x,
        baseY: position.y,
        floatAmplitude: {
          x: Math.random() * 4 + 2, // 2-6 pixels (intermediário)
          y: Math.random() * 4 + 2, // 2-6 pixels (intermediário)
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
        floatSpeed: Math.random() * 0.8 + 0.5, // 0.5-1.3 speed multiplier (moderado)
      }));

      // Preload planet images
      worldPositions.forEach((position) => {
        if (position.imageUrl) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = position.imageUrl;
          img.onload = () => {
            planetImagesRef.current.set(position.id, img);
          };
        }
      });

      planetsRef.current = planets;
    } else {
      // Fallback to default positions if no data in store
      generateDefaultPlanets();
    }
  }, [worldPositions]);

  // Generate default planets (fallback)
  const generateDefaultPlanets = useCallback(() => {
    const planets: Planet[] = [];
    const colors = [
      "#ff6b6b",
      "#4ecdc4",
      "#45b7d1",
      "#96ceb4",
      "#ffeaa7",
      "#dda0dd",
    ];

    const planetImages = [
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2Fdfdbc589c3f344eea7b33af316e83b41?format=webp&width=800",
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2Fd42810aa3d45429d93d8c58c52827326?format=webp&width=800",
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2Fdfce7132f868407eb4d7afdf27d09a77?format=webp&width=800",
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2F8e6b96287f6448089ed602d82e2839bc?format=webp&width=800",
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2F7a1b7c8172a5446b9a22ffd65d22a6f7?format=webp&width=800",
      "https://cdn.builder.io/api/v1/image/assets%2Ff94d2a386a444693b9fbdff90d783a66%2F76c4f943e6e045938d8e5efb84a2a969?format=webp&width=800",
    ];

    const planetNames = [
      "Estaç��o Gal��ctica",
      "Base Orbital",
      "Mundo Alienígena",
      "Terra Verdejante",
      "Reino Gelado",
      "Vila Ancestral",
    ];

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const radius = 250;
      const planetX = CENTER_X + Math.cos(angle) * radius;
      const planetY = CENTER_Y + Math.sin(angle) * radius;

      planets.push({
        id: `planet-${i}`,
        x: planetX,
        y: planetY,
        size: 60,
        rotation: 0,
        color: colors[i],
        name: planetNames[i],
        interactionRadius: 90,
        imageUrl: planetImages[i],
        // Add floating animation properties
        baseX: planetX,
        baseY: planetY,
        floatAmplitude: {
          x: Math.random() * 4 + 2, // 2-6 pixels (intermediário)
          y: Math.random() * 4 + 2, // 2-6 pixels (intermediário)
        },
        floatPhase: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
        },
        floatSpeed: Math.random() * 0.8 + 0.5, // 0.5-1.3 speed multiplier (moderado)
      });
    }

    // Preload planet images
    planetImages.forEach((imageUrl, index) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        planetImagesRef.current.set(`planet-${index}`, img);
      };
    });

    planetsRef.current = planets;
  }, []);

  // Load ship image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src =
      "https://cdn.builder.io/api/v1/image/assets%2F927080298e954d2fba85d9a91618627d%2Fd89cbfd7d2604752a995652efb832852?format=webp&width=800";
    img.onload = () => {
      shipImageRef.current = img;
    };
  }, []);

  // Initialize game objects once
  useEffect(() => {
    generateRichStarField();
    loadWorldPositions();
  }, [generateRichStarField, loadWorldPositions]);

  // Update planets when worldPositions from store change
  useEffect(() => {
    updatePlanetsFromStore();
  }, [updatePlanetsFromStore]);

  // Reload world positions when component becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Reload world positions when tab becomes active again
        loadWorldPositions();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadWorldPositions]);

  // Save any pending changes when component unmounts
  useEffect(() => {
    return () => {
      // Clear any pending timeouts and save immediately if editing
      const timeouts = [
        (window as any).worldDragTimeout,
        (window as any).worldSizeTimeout,
        (window as any).worldRotationTimeout,
        (window as any).worldInteractionTimeout,
      ];

      timeouts.forEach((timeout) => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });

      if (selectedWorldId) {
        const planet = planetsRef.current.find((p) => p.id === selectedWorldId);
        if (planet) {
          // Save immediately on unmount
          updateWorldPosition(selectedWorldId, {
            x: planet.x,
            y: planet.y,
            size: planet.size,
            rotation: planet.rotation,
            interactionRadius: planet.interactionRadius,
          });
        }
      }
    };
  }, [selectedWorldId]);

  // Handle mouse movement
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const newMousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      // Handle world dragging in edit mode
      if (user?.isAdmin && isWorldEditMode && isDragging && selectedWorldId) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const worldX =
          newMousePos.x - centerX + gameState.camera.x - dragOffset.x;
        const worldY =
          newMousePos.y - centerY + gameState.camera.y - dragOffset.y;

        // Update world position immediately for responsive feedback
        planetsRef.current = planetsRef.current.map((planet) =>
          planet.id === selectedWorldId
            ? { ...planet, x: worldX, y: worldY }
            : planet,
        );

        // Save to database with throttling
        clearTimeout((window as any).worldDragTimeout);
        (window as any).worldDragTimeout = setTimeout(() => {
          console.log("����� Saving world drag position:", {
            selectedWorldId,
            worldX,
            worldY,
          });
          updateWorldPosition(selectedWorldId, {
            x: worldX,
            y: worldY,
          });
        }, 200);
      }

      mouseRef.current = newMousePos;
      hasMouseMoved.current = true;
    },
    [
      isWorldEditMode,
      isDragging,
      selectedWorldId,
      gameState.camera,
      dragOffset,
    ],
  );

  // Handle mouse leaving canvas
  const handleMouseLeave = useCallback(() => {
    setMouseInWindow(false);
    hasMouseMoved.current = false; // Reset mouse movement flag
  }, []);

  // Handle mouse entering canvas
  const handleMouseEnter = useCallback(() => {
    setMouseInWindow(true);
  }, []);

  // Handle shooting and world editing
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || isLandingAnimationActive) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Convert click position to world coordinates
      const worldClickX = clickX - centerX + gameState.camera.x;
      const worldClickY = clickY - centerY + gameState.camera.y;

      // World editing mode
      if (user?.isAdmin && isWorldEditMode) {
        let worldClicked = false;

        planetsRef.current.forEach((planet) => {
          const dx = getWrappedDistance(planet.x, worldClickX);
          const dy = getWrappedDistance(planet.y, worldClickY);
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance <= planet.size) {
            // Se já está selecionado e dragging, pare o drag
            if (selectedWorldId === planet.id && isDragging) {
              setIsDragging(false);
              setDragOffset({ x: 0, y: 0 });
            } else if (selectedWorldId === planet.id && !isDragging) {
              // Se já est������� selecionado mas não dragging, inicie o drag
              setIsDragging(true);
              setDragOffset({ x: dx, y: dy });
            } else {
              // Selecione novo mundo
              setSelectedWorldId(planet.id);
              setIsDragging(false);
            }
            worldClicked = true;
          }
        });

        // Clique fora de qualquer mundo - desseleciona tudo
        if (!worldClicked) {
          setSelectedWorldId(null);
          setIsDragging(false);
          setDragOffset({ x: 0, y: 0 });
        }
        return;
      }

      // Check if click was on NPC ship first
      const clickedOnNPCShip = npcShip.isClickOnShip(
        clickX,
        clickY,
        gameState.camera.x,
        gameState.camera.y,
        canvas.width,
        canvas.height,
      );

      if (clickedOnNPCShip) {
        setShowNPCModal(true);
        return;
      }

      // Check if click was on a planet
      let clickedOnPlanet = false;

      planetsRef.current.forEach((planet) => {
        const shipToPlanetX = getWrappedDistance(planet.x, gameState.ship.x);
        const shipToPlanetY = getWrappedDistance(planet.y, gameState.ship.y);
        const shipToPlanetDistance = Math.sqrt(
          shipToPlanetX * shipToPlanetX + shipToPlanetY * shipToPlanetY,
        );

        // Only check for planet click if ship is within interaction radius
        if (shipToPlanetDistance <= planet.interactionRadius) {
          // Check if the click was specifically on a visible pixel of the planet image
          if (isClickOnPlanetPixel(planet, worldClickX, worldClickY, canvas)) {
            setSelectedPlanet(planet);
            setShowLandingModal(true);
            clickedOnPlanet = true;
          }
        }
      });

      // Only shoot if we didn't click on a planet
      if (!clickedOnPlanet) {
        shootProjectile();
      }
    },
    [
      gameState,
      getWrappedDistance,
      isClickOnPlanetPixel,
      isWorldEditMode,
      isLandingAnimationActive,
      user?.isAdmin,
      shootProjectile,
      updateWorldPosition,
      setSelectedPlanet,
      setShowLandingModal,
      npcShip.isClickOnShip,
    ],
  );

  // Handle mouse up to stop dragging
  // Handler para mousedown - inicia tiro contínuo
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isLandingAnimationActive) return;

      if (!user?.isAdmin || !isWorldEditMode) {
        setIsMousePressed(true);

        // Primeiro tiro imediato
        shootProjectile();

        // Iniciar timer para tiros contínuos
        if (shootingIntervalRef.current) {
          clearInterval(shootingIntervalRef.current);
        }

        shootingIntervalRef.current = setInterval(() => {
          shootProjectile();
        }, 333); // 3 tiros por segundo
      }
    },
    [user?.isAdmin, isWorldEditMode, shootProjectile, isLandingAnimationActive],
  );

  const handleMouseUp = useCallback(() => {
    // Parar tiro contínuo
    setIsMousePressed(false);
    if (shootingIntervalRef.current) {
      clearInterval(shootingIntervalRef.current);
      shootingIntervalRef.current = null;
    }

    // Lógica original de edição de mundos
    if (user?.isAdmin && isWorldEditMode && isDragging && selectedWorldId) {
      const planet = planetsRef.current.find((p) => p.id === selectedWorldId);
      if (planet) {
        updateWorldPosition(selectedWorldId, {
          x: planet.x,
          y: planet.y,
        });
      }

      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
    }
  }, [user?.isAdmin, isWorldEditMode, isDragging, selectedWorldId]);

  // Handle ESC key to cancel editing
  // Draw FPS graph
  const drawFpsGraph = useCallback(() => {
    if (!fpsGraphRef.current) return;

    const canvas = fpsGraphRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;

    // Horizontal lines (FPS levels)
    for (let fps = 60; fps <= 300; fps += 60) {
      const y = height - (fps / 300) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw FPS line with gradient
    if (fpsHistory.length > 1) {
      ctx.lineWidth = 1.5;

      for (let i = 1; i < fpsHistory.length; i++) {
        const x1 = ((i - 1) / (fpsHistory.length - 1)) * width;
        const y1 = height - (Math.min(fpsHistory[i - 1], 300) / 300) * height;
        const x2 = (i / (fpsHistory.length - 1)) * width;
        const y2 = height - (Math.min(fpsHistory[i], 300) / 300) * height;

        // Color based on current FPS
        if (fpsHistory[i] < 30) {
          ctx.strokeStyle = "#ff4444";
        } else if (fpsHistory[i] < 50) {
          ctx.strokeStyle = "#ffaa00";
        } else {
          ctx.strokeStyle = "#00ff00";
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw FPS labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "8px monospace";
    ctx.fillText("300", 2, 10);
    ctx.fillText("180", 2, height / 3 + 3);
    ctx.fillText("60", 2, (height * 2) / 3 + 3);

    // Draw target FPS line (60 FPS)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    const targetY = height - (60 / 300) * height;
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [fpsHistory]);

  // Update FPS graph when history changes
  useEffect(() => {
    drawFpsGraph();
  }, [drawFpsGraph]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && user?.isAdmin && isWorldEditMode) {
        setSelectedWorldId(null);
        setIsDragging(false);
        setDragOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [user?.isAdmin, isWorldEditMode]);

  // Modal handlers
  const handleLandingConfirm = useCallback(() => {
    if (selectedPlanet) {
      // Start landing animation
      setLandingAnimationData({
        planet: selectedPlanet,
        startTime: performance.now(),
        duration: 1500, // 1.5 seconds animation - more responsive
        initialShipX: gameState.ship.x,
        initialShipY: gameState.ship.y,
      });
      setIsLandingAnimationActive(true);

      // Play landing sound
      playLandingSound().catch(() => {
        // Sound is not critical, ignore errors
      });
    }
    setShowLandingModal(false);
    setSelectedPlanet(null);
  }, [selectedPlanet, gameState.ship.x, gameState.ship.y]);

  const handleLandingCancel = useCallback(() => {
    setShowLandingModal(false);
    setSelectedPlanet(null);
    // Force reset mouse state to ensure ship responds immediately
    hasMouseMoved.current = true;
    setMouseInWindow(true);
  }, []);

  // Cleanup do timer de tiro quando componente desmonta
  useEffect(() => {
    return () => {
      if (shootingIntervalRef.current) {
        clearInterval(shootingIntervalRef.current);
        shootingIntervalRef.current = null;
      }
    };
  }, []);

  // Parar tiro quando mouse sai da ��rea do canvas
  const handleMouseLeaveCanvas = useCallback(() => {
    setIsMousePressed(false);
    if (shootingIntervalRef.current) {
      clearInterval(shootingIntervalRef.current);
      shootingIntervalRef.current = null;
    }
  }, []);

  // Optimized game loop with maximum GPU acceleration
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get 2D context with GPU-optimized settings
    const ctx = canvas.getContext("2d", {
      alpha: true, // Enable alpha channel for transparency over WebGL stars
      desynchronized: true, // Allow asynchronous rendering for better GPU usage
      willReadFrequently: false, // Optimize for GPU rendering, not CPU reading
    });
    if (!ctx) return;

    // Set GPU-optimized context properties
    ctx.imageSmoothingEnabled = false; // Disable smoothing for pixel-perfect rendering
    ctx.globalCompositeOperation = "source-over"; // Default, most GPU-optimized blend mode

    let lastTime = 0;
    let frameStartTime = performance.now();

    const gameLoop = (currentTime: number) => {
      // Stop game loop immediately if we're not on world screen
      if (currentScreen !== "world") {
        return;
      }

      // Collect frame timing data for refresh rate detection (first 60 frames)
      if (!refreshRateDetectedRef.current && lastTime > 0) {
        const frameTime = currentTime - lastTime;
        if (frameTime > 0 && frameTime < 50) {
          // Filter out invalid measurements
          frameTimeHistoryRef.current.push(frameTime);
          if (frameTimeHistoryRef.current.length >= 60) {
            detectRefreshRate();
          }
        }
      }

      // FPS uncapped - no frame rate limiting for any device

      // Calculate delta time with safeguards for high refresh rates
      const rawDeltaTime = currentTime - lastTime;
      const deltaTime = lastTime === 0 ? 16.67 : Math.min(rawDeltaTime, 33.33); // Cap to prevent huge jumps

      // Intelligent frame skipping based on canvas size and refresh rate
      const isLargeCanvas = canvas.width > 1000 || canvas.height > 600;
      const currentRefreshRate = refreshRateRef.current;

      // Adaptive frame skipping: skip more frames on high refresh rates for large canvas
      let frameSkip = 1;
      if (isLargeCanvas) {
        if (currentRefreshRate >= 144)
          frameSkip = 3; // Skip 2 out of 3 frames at 144Hz+
        else if (currentRefreshRate >= 120)
          frameSkip = 2; // Skip 1 out of 2 frames at 120Hz
        else frameSkip = 1; // No skipping at 60-90Hz
      }

      const skipFrame = frameCounter.current % frameSkip !== 0;
      frameCounter.current++;

      // Calculate FPS less frequently for better performance
      if (fpsRef.current.lastTime > 0) {
        const frameTime = currentTime - fpsRef.current.lastTime;
        fpsRef.current.frameTimes.push(frameTime);

        // Keep only last 30 frames for average (reduced from 60)
        if (fpsRef.current.frameTimes.length > 30) {
          fpsRef.current.frameTimes.shift();
        }

        // Update FPS every 60 frames (less frequent)
        fpsRef.current.frameCount++;
        if (fpsRef.current.frameCount >= 60) {
          const avgFrameTime =
            fpsRef.current.frameTimes.reduce((a, b) => a + b, 0) /
            fpsRef.current.frameTimes.length;
          const currentFps = Math.round(1000 / avgFrameTime);
          setFps(currentFps);

          // Update FPS history for graph
          setFpsHistory((prev) => {
            const newHistory = [...prev.slice(1), currentFps];
            return newHistory;
          });

          fpsRef.current.frameCount = 0;
        }
      }

      fpsRef.current.lastTime = currentTime;
      lastTime = currentTime;

      if (
        canvas.width !== canvas.offsetWidth ||
        canvas.height !== canvas.offsetHeight
      ) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        setCanvasDimensions({ width: canvas.width, height: canvas.height });
      }

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Update game state
      setGameState((prevState) => {
        const newState = { ...prevState };

        // Only respond to mouse if it has actually moved and modal is not open and not landing
        if (
          hasMouseMoved.current &&
          !showLandingModal &&
          !isLandingAnimationActive
        ) {
          const worldMouseX = mouseRef.current.x - centerX + newState.camera.x;
          const worldMouseY = mouseRef.current.y - centerY + newState.camera.y;

          const dx = getWrappedDistance(worldMouseX, newState.ship.x);
          const dy = getWrappedDistance(worldMouseY, newState.ship.y);
          const distance = Math.sqrt(dx * dx + dy * dy);

          newState.ship.angle = Math.atan2(dy, dx);

          if (mouseInWindow && distance > 10) {
            const speedMultiplier = Math.min(distance / 300, 1);
            const targetSpeed = SHIP_MAX_SPEED * speedMultiplier;
            newState.ship.vx += (dx / distance) * targetSpeed * 0.067;
            newState.ship.vy += (dy / distance) * targetSpeed * 0.067;
          }
        }

        // Apply physics only when not landing
        if (!isLandingAnimationActive) {
          // Apply less friction when mouse is outside window to maintain momentum
          const currentFriction = mouseInWindow ? FRICTION : 0.995;
          newState.ship.vx *= currentFriction;
          newState.ship.vy *= currentFriction;

          // Calculate potential new position
          const newX = newState.ship.x + newState.ship.vx;
          const newY = newState.ship.y + newState.ship.vy;

          // Check barrier collision only if enabled
          if (isBarrierCollisionEnabled) {
            const distanceFromCenter = Math.sqrt(
              Math.pow(newX - CENTER_X, 2) + Math.pow(newY - CENTER_Y, 2),
            );

            if (distanceFromCenter <= BARRIER_RADIUS) {
              // Ship can move normally within barrier
              newState.ship.x = newX;
              newState.ship.y = newY;
            } else {
              // Ship trying to move outside barrier
              setBarrierFlashTime(currentTime);

              // Calculate the direction from center to the ship's current position
              const centerToShipX = newState.ship.x - CENTER_X;
              const centerToShipY = newState.ship.y - CENTER_Y;
              const centerToShipDist = Math.sqrt(
                centerToShipX * centerToShipX + centerToShipY * centerToShipY,
              );

              if (centerToShipDist > 0) {
                // Normalize the vector from center to ship (this is the normal to the barrier)
                const normalX = centerToShipX / centerToShipDist;
                const normalY = centerToShipY / centerToShipDist;

                // Project the movement vector onto the normal and tangent
                const movementX = newX - newState.ship.x;
                const movementY = newY - newState.ship.y;

                // Calculate radial component (toward/away from center)
                const radialComponent =
                  movementX * normalX + movementY * normalY;

                // Calculate tangential component (parallel to barrier)
                const tangentX = movementX - radialComponent * normalX;
                const tangentY = movementY - radialComponent * normalY;

                // Always allow tangential movement
                newState.ship.x += tangentX;
                newState.ship.y += tangentY;

                // Allow radial movement only if it's toward the center (negative radial component)
                if (radialComponent < 0) {
                  // Moving toward center - allow this movement
                  newState.ship.x += radialComponent * normalX;
                  newState.ship.y += radialComponent * normalY;
                }

                // Adjust velocity to prevent moving outward
                const velocityDotNormal =
                  newState.ship.vx * normalX + newState.ship.vy * normalY;
                if (velocityDotNormal > 0) {
                  // Remove outward velocity component
                  newState.ship.vx -= velocityDotNormal * normalX;
                  newState.ship.vy -= velocityDotNormal * normalY;
                }
              }
            }
          } else {
            // Barrier collision disabled - allow free movement
            newState.ship.x = newX;
            newState.ship.y = newY;
          }

          newState.ship.x = normalizeCoord(newState.ship.x);
          newState.ship.y = normalizeCoord(newState.ship.y);
        }

        return newState;
      });

      // Create trail points after ship position update
      const currentShipVelocity = Math.sqrt(
        gameState.ship.vx * gameState.ship.vx +
          gameState.ship.vy * gameState.ship.vy,
      );

      // Continuous movement sound control - stop during landing animation
      const velocityThreshold = 0.05;
      const isShipMoving =
        currentShipVelocity > velocityThreshold && !isLandingAnimationActive;

      if (isShipMoving && !movementSoundActiveRef.current) {
        // Start continuous movement sound
        startContinuousMovementSound();
        movementSoundActiveRef.current = true;
      } else if (
        (!isShipMoving || isLandingAnimationActive) &&
        movementSoundActiveRef.current
      ) {
        // Stop continuous movement sound
        stopContinuousMovementSound();
        movementSoundActiveRef.current = false;
      }

      // Update sound parameters in real-time when moving (only if not landing)
      if (movementSoundActiveRef.current && !isLandingAnimationActive) {
        updateContinuousMovementSound(currentShipVelocity, SHIP_MAX_SPEED);
      }

      // Only create trail points if ship is moving and enough time has passed
      if (
        currentShipVelocity > 0.1 &&
        currentTime - lastTrailTime.current > 35
      ) {
        // Calculate trail position at the back of the ship
        const trailOffset = 12; // Distance from ship center to back
        const trailX =
          gameState.ship.x - Math.cos(gameState.ship.angle) * trailOffset;
        const trailY =
          gameState.ship.y - Math.sin(gameState.ship.angle) * trailOffset;

        createTrailPoint(trailX, trailY, currentTime, currentShipVelocity);
        lastTrailTime.current = currentTime;
      }

      // Update trail points
      updateTrailPoints(deltaTime);

      // Continue with game state update
      setGameState((prevState) => {
        const newState = { ...prevState };

        // Camera follows ship (use current ship position for landing animation)
        const targetX =
          isLandingAnimationActive && landingAnimationData
            ? (function () {
                const currentTime = performance.now();
                const elapsed = currentTime - landingAnimationData.startTime;
                const progress = Math.min(
                  elapsed / landingAnimationData.duration,
                  1,
                );
                const planet = landingAnimationData.planet;
                const initialDx = landingAnimationData.initialShipX - planet.x;
                const initialDy = landingAnimationData.initialShipY - planet.y;
                const initialRadius = Math.sqrt(
                  initialDx * initialDx + initialDy * initialDy,
                );
                const orbitSpeed = 1;
                const initialAngle = Math.atan2(initialDy, initialDx);
                const angleProgress =
                  initialAngle + progress * orbitSpeed * Math.PI * 2;
                const currentRadius = initialRadius * (1 - progress * 0.9);
                return planet.x + Math.cos(angleProgress) * currentRadius;
              })()
            : newState.ship.x;

        const targetY =
          isLandingAnimationActive && landingAnimationData
            ? (function () {
                const currentTime = performance.now();
                const elapsed = currentTime - landingAnimationData.startTime;
                const progress = Math.min(
                  elapsed / landingAnimationData.duration,
                  1,
                );
                const planet = landingAnimationData.planet;
                const initialDx = landingAnimationData.initialShipX - planet.x;
                const initialDy = landingAnimationData.initialShipY - planet.y;
                const initialRadius = Math.sqrt(
                  initialDx * initialDx + initialDy * initialDy,
                );
                const orbitSpeed = 1;
                const initialAngle = Math.atan2(initialDy, initialDx);
                const angleProgress =
                  initialAngle + progress * orbitSpeed * Math.PI * 2;
                const currentRadius = initialRadius * (1 - progress * 0.9);
                return planet.y + Math.sin(angleProgress) * currentRadius;
              })()
            : newState.ship.y;

        const cameraFollowSpeed = 0.08;
        const deltaX = getWrappedDistance(targetX, newState.camera.x);
        const deltaY = getWrappedDistance(targetY, newState.camera.y);

        newState.camera.x += deltaX * cameraFollowSpeed;
        newState.camera.y += deltaY * cameraFollowSpeed;

        newState.camera.x = normalizeCoord(newState.camera.x);
        newState.camera.y = normalizeCoord(newState.camera.y);

        return newState;
      });

      // Save to store for persistence (throttled) - moved outside setState
      saveShipState({
        x: gameState.ship.x,
        y: gameState.ship.y,
        angle: gameState.ship.angle,
        vx: gameState.ship.vx,
        vy: gameState.ship.vy,
        cameraX: gameState.camera.x,
        cameraY: gameState.camera.y,
      });

      // Check for planets in range and create radar pulses
      const currentShipState = gameState;
      const currentPlanetsInRange = new Set<string>();

      planetsRef.current.forEach((planet) => {
        const shipToPlanetX = getWrappedDistance(
          planet.x,
          currentShipState.ship.x,
        );
        const shipToPlanetY = getWrappedDistance(
          planet.y,
          currentShipState.ship.y,
        );
        const shipToPlanetDistance = Math.sqrt(
          shipToPlanetX * shipToPlanetX + shipToPlanetY * shipToPlanetY,
        );

        if (shipToPlanetDistance <= planet.interactionRadius) {
          currentPlanetsInRange.add(planet.id);

          // Create radar pulse every 1200ms for much slower waves
          const lastPulseTime = lastRadarPulseTime.current.get(planet.id) || 0;
          if (currentTime - lastPulseTime >= 1200) {
            // 1.2 seconds = 1200ms for slower spacing
            createRadarPulse(planet);
            lastRadarPulseTime.current.set(planet.id, currentTime);
          }
        } else {
          // Remove pulse timing when out of range
          lastRadarPulseTime.current.delete(planet.id);
        }
      });

      // Update the tracking set
      lastRadarCheckRef.current = currentPlanetsInRange;

      // Update radar pulses
      radarPulsesRef.current = radarPulsesRef.current
        .map((pulse) => ({
          ...pulse,
          radius: pulse.radius + 0.4, // Expansão muito mais lenta
          life: pulse.life - 1,
        }))
        .filter((pulse) => pulse.life > 0 && pulse.radius <= pulse.maxRadius);

      // Stars are now updated entirely on GPU in WebGL shaders for better performance

      // Update planet floating positions
      const planets = planetsRef.current;
      const planetTime = currentTime * 0.001; // Slower movement for planets

      planets.forEach((planet) => {
        if (
          planet.baseX !== undefined &&
          planet.baseY !== undefined &&
          planet.floatAmplitude &&
          planet.floatPhase &&
          planet.floatSpeed
        ) {
          const floatTime = planetTime * planet.floatSpeed;
          const floatX =
            Math.sin(floatTime + planet.floatPhase.x) * planet.floatAmplitude.x;
          const floatY =
            Math.cos(floatTime * 0.8 + planet.floatPhase.y) *
            planet.floatAmplitude.y;

          planet.x = planet.baseX + floatX;
          planet.y = planet.baseY + floatY;
        }
      });

      // Update projectiles with uncapped delta time for unlimited FPS
      const currentFrameTime = performance.now();
      const projectileDeltaTime =
        (currentFrameTime - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = currentFrameTime;

      // Use for loop for better performance than map/filter
      const projectiles = projectilesRef.current;
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.x = normalizeCoord(proj.x + proj.vx * projectileDeltaTime);
        proj.y = normalizeCoord(proj.y + proj.vy * projectileDeltaTime);
        proj.life -= projectileDeltaTime;

        if (proj.life <= 0) {
          projectiles.splice(i, 1);
        }
      }

      // Update NPC ship
      npcShip.updateShip(projectileDeltaTime * 1000); // Convert to milliseconds

      // Create shooting stars less frequently for better performance - much less on mobile
      const shootingStarInterval = isMobile
        ? 40000 + Math.random() * 50000 // Very infrequent on mobile
        : isLargeCanvas
          ? 25000 + Math.random() * 35000
          : 15000 + Math.random() * 20000;
      if (currentTime - lastShootingStarTime.current > shootingStarInterval) {
        createShootingStar(canvas);
        lastShootingStarTime.current = currentTime;
      }

      // Update shooting stars with optimized loop
      const shootingStars = shootingStarsRef.current;
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const star = shootingStars[i];
        star.x += star.vx;
        star.y += star.vy;
        star.life -= 1;

        // Remove if dead or outside extended viewport
        if (
          star.life <= 0 ||
          star.x < -150 ||
          star.x > canvas.width + 150 ||
          star.y < -150 ||
          star.y > canvas.height + 150
        ) {
          shootingStars.splice(i, 1);
        }
      }

      // Clear canvas to show WebGL stars underneath
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Create subtle transparent nebula background that lets WebGL stars show through
      // Base subtle space gradient for depth, much more transparent
      const gradient = ctx.createRadialGradient(
        canvas.width * 0.3,
        canvas.height * 0.2,
        0,
        canvas.width * 0.7,
        canvas.height * 0.8,
        Math.max(canvas.width, canvas.height) * 1.5,
      );
      gradient.addColorStop(0, "rgba(5, 5, 16, 0.3)"); // Very transparent center
      gradient.addColorStop(0.2, "rgba(10, 15, 30, 0.25)"); // Transparent navy
      gradient.addColorStop(0.4, "rgba(7, 10, 21, 0.2)"); // More transparent
      gradient.addColorStop(0.6, "rgba(5, 8, 16, 0.15)"); // Even more transparent
      gradient.addColorStop(0.8, "rgba(2, 5, 8, 0.1)"); // Very transparent
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.05)"); // Almost fully transparent edges

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add very subtle nebula layers for depth, letting WebGL stars shine through
      // Purple-pink nebula (distant) - much more transparent
      const nebulaGradient1 = ctx.createRadialGradient(
        canvas.width * 0.8,
        canvas.height * 0.2,
        0,
        canvas.width * 0.8,
        canvas.height * 0.2,
        canvas.width * 0.6,
      );
      nebulaGradient1.addColorStop(0, "rgba(120, 60, 150, 0.02)");
      nebulaGradient1.addColorStop(0.3, "rgba(80, 40, 120, 0.015)");
      nebulaGradient1.addColorStop(0.6, "rgba(60, 30, 90, 0.01)");
      nebulaGradient1.addColorStop(1, "rgba(120, 60, 150, 0)");

      ctx.fillStyle = nebulaGradient1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Blue-cyan nebula (mid distance) - much more transparent
      const nebulaGradient2 = ctx.createRadialGradient(
        canvas.width * 0.15,
        canvas.height * 0.7,
        0,
        canvas.width * 0.15,
        canvas.height * 0.7,
        canvas.width * 0.5,
      );
      nebulaGradient2.addColorStop(0, "rgba(60, 120, 180, 0.02)");
      nebulaGradient2.addColorStop(0.4, "rgba(40, 90, 140, 0.015)");
      nebulaGradient2.addColorStop(0.7, "rgba(20, 60, 100, 0.008)");
      nebulaGradient2.addColorStop(1, "rgba(60, 120, 180, 0)");

      ctx.fillStyle = nebulaGradient2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Green-teal nebula (closer) - much more transparent
      const nebulaGradient3 = ctx.createRadialGradient(
        canvas.width * 0.6,
        canvas.height * 0.8,
        0,
        canvas.width * 0.6,
        canvas.height * 0.8,
        canvas.width * 0.4,
      );
      nebulaGradient3.addColorStop(0, "rgba(60, 150, 120, 0.015)");
      nebulaGradient3.addColorStop(0.3, "rgba(40, 120, 90, 0.01)");
      nebulaGradient3.addColorStop(0.6, "rgba(20, 80, 60, 0.005)");
      nebulaGradient3.addColorStop(1, "rgba(60, 150, 120, 0)");

      ctx.fillStyle = nebulaGradient3;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Warm orange nebula (accent) - much more transparent
      const nebulaGradient4 = ctx.createRadialGradient(
        canvas.width * 0.4,
        canvas.height * 0.1,
        0,
        canvas.width * 0.4,
        canvas.height * 0.1,
        canvas.width * 0.3,
      );
      nebulaGradient4.addColorStop(0, "rgba(200, 120, 60, 0.01)");
      nebulaGradient4.addColorStop(0.4, "rgba(160, 90, 40, 0.008)");
      nebulaGradient4.addColorStop(0.7, "rgba(120, 60, 20, 0.005)");
      nebulaGradient4.addColorStop(1, "rgba(200, 120, 60, 0)");

      ctx.fillStyle = nebulaGradient4;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Aggressive viewport culling for larger canvas
      const renderBuffer = Math.min(RENDER_BUFFER, 50); // Further reduce buffer for large canvas
      const renderViewport = {
        left: -renderBuffer,
        right: canvas.width + renderBuffer,
        top: -renderBuffer,
        bottom: canvas.height + renderBuffer,
      };

      // Stars are now rendered using WebGL in the WebGLStarField component

      // Render barrier circle (rotating, gray, transparent)
      const barrierWrappedDeltaX = getWrappedDistance(
        CENTER_X,
        gameState.camera.x,
      );
      const barrierWrappedDeltaY = getWrappedDistance(
        CENTER_Y,
        gameState.camera.y,
      );
      const barrierScreenX = centerX + barrierWrappedDeltaX;
      const barrierScreenY = centerY + barrierWrappedDeltaY;

      ctx.save();
      // Check if barrier should flash red
      const timeSinceFlash = currentTime - barrierFlashTime;
      const isFlashing = timeSinceFlash < 500; // Flash for 500ms

      if (isFlashing) {
        // Red flash effect
        const flashIntensity = Math.max(0, 1 - timeSinceFlash / 500);
        ctx.globalAlpha = 0.3 + flashIntensity * 0.4; // More visible when flashing
        ctx.strokeStyle = `rgba(255, 0, 0, ${0.8 + flashIntensity * 0.2})`; // Red with varying intensity
        ctx.lineWidth = 3 + flashIntensity * 2; // Thicker line when flashing
      } else {
        // Normal appearance
        ctx.globalAlpha = 0.15; // Muito transparente
        ctx.strokeStyle = "#888888"; // Cinza
        ctx.lineWidth = 2;
      }

      // Rotaç��o lenta baseada no tempo
      const rotationTime = currentTime * 0.0005; // Muito lenta
      const dashOffset = (rotationTime * 50) % 20; // Offset dos tra��os para simular rotação

      ctx.setLineDash([10, 10]);
      ctx.lineDashOffset = -dashOffset; // Anima os traços
      ctx.beginPath();
      ctx.arc(barrierScreenX, barrierScreenY, BARRIER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Render planets
      planetsRef.current.forEach((planet) => {
        const wrappedDeltaX = getWrappedDistance(planet.x, gameState.camera.x);
        const wrappedDeltaY = getWrappedDistance(planet.y, gameState.camera.y);

        const screenX = centerX + wrappedDeltaX;
        const screenY = centerY + wrappedDeltaY;

        // Always render planets regardless of viewport position
        {
          // Check if ship is within interaction radius for visual feedback
          const shipToPlanetX = getWrappedDistance(planet.x, gameState.ship.x);
          const shipToPlanetY = getWrappedDistance(planet.y, gameState.ship.y);
          const shipToPlanetDistance = Math.sqrt(
            shipToPlanetX * shipToPlanetX + shipToPlanetY * shipToPlanetY,
          );
          const isInRange = shipToPlanetDistance <= planet.interactionRadius;
          const isSelected =
            user?.isAdmin && isWorldEditMode && selectedWorldId === planet.id;

          // Render interaction circle (only visible to admins)
          if (user?.isAdmin) {
            ctx.save();
            if (isWorldEditMode) {
              // Edit mode styling
              ctx.globalAlpha = isSelected ? 0.8 : 0.3;
              ctx.strokeStyle = isSelected ? "#ffff00" : "#ffffff";
              ctx.lineWidth = isSelected ? 4 : 2;
              ctx.setLineDash(isSelected ? [] : [8, 8]);
            } else {
              // Normal mode styling
              ctx.globalAlpha = isInRange ? 0.4 : 0.15;
              ctx.strokeStyle = isInRange ? "#00ff00" : "#ffffff";
              ctx.lineWidth = isInRange ? 3 : 1;
              ctx.setLineDash(isInRange ? [] : [5, 5]);
            }
            ctx.beginPath();
            ctx.arc(screenX, screenY, planet.interactionRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Render planet image with rotation and antialiasing
          const img = planetImagesRef.current.get(planet.id);
          if (img && img.complete) {
            ctx.save();
            ctx.globalAlpha = 1;

            // Enable image smoothing for antialiasing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";

            // Apply rotation if planet has rotation
            if (planet.rotation && planet.rotation !== 0) {
              ctx.translate(screenX, screenY);
              ctx.rotate(planet.rotation);
              ctx.translate(-screenX, -screenY);
            }

            const imageSize = planet.size * 2; // Use diameter as image size
            const drawX = screenX - imageSize / 2;
            const drawY = screenY - imageSize / 2;

            // Draw the planet image with antialiasing (no glow)
            ctx.drawImage(img, drawX, drawY, imageSize, imageSize);

            // Reset smoothing
            ctx.imageSmoothingEnabled = false; // Reset for other elements
            ctx.restore();
          } else {
            // Fallback to colored circle (no glow)
            ctx.globalAlpha = 1;
            ctx.fillStyle = planet.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, planet.size, 0, Math.PI * 2);
            ctx.fill();

            // Planet highlight
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(
              screenX - planet.size * 0.2,
              screenY - planet.size * 0.2,
              planet.size * 0.3,
              0,
              Math.PI * 2,
            );
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      });

      // Render projectiles as bright energy beams - optimized with for loop
      const projectilesForRender = projectilesRef.current;
      for (let i = 0; i < projectilesForRender.length; i++) {
        const proj = projectilesForRender[i];
        const wrappedDeltaX = getWrappedDistance(proj.x, gameState.camera.x);
        const wrappedDeltaY = getWrappedDistance(proj.y, gameState.camera.y);
        const screenX = centerX + wrappedDeltaX;
        const screenY = centerY + wrappedDeltaY;

        ctx.save();

        const lifeRatio = proj.life / proj.maxLife;
        const angle = Math.atan2(proj.vy, proj.vx);
        const length = 8;
        const time = Date.now() * 0.01; // Para efeito pulsante
        const pulse = 0.8 + 0.2 * Math.sin(time);

        // Calcular pontos da linha do tracinho
        const endX = screenX + Math.cos(angle) * length;
        const endY = screenY + Math.sin(angle) * length;

        // Glow externo mais sutil (aura de energia amarela mais fraca)
        ctx.globalAlpha = lifeRatio * 0.2 * pulse;
        ctx.strokeStyle = "#e6c200";
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.shadowColor = "#e6c200";
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Glow médio amarelo-dourado mais suave
        ctx.globalAlpha = lifeRatio * 0.5;
        ctx.strokeStyle = "#f0d633";
        ctx.lineWidth = 3;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Core energético amarelo mais suave
        ctx.globalAlpha = lifeRatio * 0.7 * pulse;
        ctx.strokeStyle = "#f5e033";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#f5e033";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Centro brilhante amarelo-branco mais sutil
        ctx.globalAlpha = lifeRatio * 0.8;
        ctx.strokeStyle = "#f8f8cc";
        ctx.lineWidth = 1;
        ctx.shadowColor = "#f8f8cc";
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Reset shadow para não afetar outros elementos
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        ctx.restore();
      }

      // Render shooting stars - optimized with for loop
      const shootingStarsForRender = shootingStarsRef.current;
      for (let i = 0; i < shootingStarsForRender.length; i++) {
        drawShootingStar(ctx, shootingStarsForRender[i]);
      }

      // Render ship trail before ship (so trail appears behind ship)
      let shipWorldX = gameState.ship.x;
      let shipWorldY = gameState.ship.y;

      // Handle landing animation for trail positioning
      if (isLandingAnimationActive && landingAnimationData) {
        const currentTime = performance.now();
        const elapsed = currentTime - landingAnimationData.startTime;
        const progress = Math.min(elapsed / landingAnimationData.duration, 1);

        const planet = landingAnimationData.planet;

        if (progress < 1) {
          const initialDx = landingAnimationData.initialShipX - planet.x;
          const initialDy = landingAnimationData.initialShipY - planet.y;
          const initialRadius = Math.sqrt(
            initialDx * initialDx + initialDy * initialDy,
          );
          const orbitSpeed = 1;
          const initialAngle = Math.atan2(initialDy, initialDx);
          const angleProgress =
            initialAngle + progress * orbitSpeed * Math.PI * 2;
          const currentRadius = initialRadius * (1 - progress * 0.9);

          shipWorldX = planet.x + Math.cos(angleProgress) * currentRadius;
          shipWorldY = planet.y + Math.sin(angleProgress) * currentRadius;
        } else {
          // Animation complete - keep ship at planet position
          shipWorldX = planet.x;
          shipWorldY = planet.y;
        }
      }

      // Create trail points during landing animation (moved outside the progress check)
      if (isLandingAnimationActive && landingAnimationData) {
        const currentTime = performance.now();
        const trailUpdateInterval = isMobile ? 70 : 35; // Less frequent on mobile
        if (currentTime - lastTrailTime.current > trailUpdateInterval) {
          const elapsed = currentTime - landingAnimationData.startTime;
          const progress = Math.min(elapsed / landingAnimationData.duration, 1);

          if (progress < 1) {
            const planet = landingAnimationData.planet;
            const initialDx = landingAnimationData.initialShipX - planet.x;
            const initialDy = landingAnimationData.initialShipY - planet.y;
            const initialRadius = Math.sqrt(
              initialDx * initialDx + initialDy * initialDy,
            );
            const orbitSpeed = 1;
            const initialAngle = Math.atan2(initialDy, initialDx);
            const angleProgress =
              initialAngle + progress * orbitSpeed * Math.PI * 2;

            // Calculate orbital velocity for proportional trail intensity
            const currentRadius = initialRadius * (1 - progress * 0.9);
            const orbitalSpeed =
              (2 * Math.PI * currentRadius) / landingAnimationData.duration;
            const normalizedOrbitalSpeed = Math.min(
              orbitalSpeed / (SHIP_MAX_SPEED * 300),
              1,
            );
            const landingIntensity = Math.max(normalizedOrbitalSpeed, 0.4);

            // Calculate trail position at the back of the ship during landing
            const trailOffset = 12;
            const currentShipAngle = angleProgress + Math.PI / 2;
            const trailX =
              shipWorldX - Math.cos(currentShipAngle) * trailOffset;
            const trailY =
              shipWorldY - Math.sin(currentShipAngle) * trailOffset;

            createTrailPoint(trailX, trailY, currentTime, landingIntensity);
            lastTrailTime.current = currentTime;
          }
        }
      }

      const shipWrappedDeltaX = getWrappedDistance(
        shipWorldX,
        gameState.camera.x,
      );
      const shipWrappedDeltaY = getWrappedDistance(
        shipWorldY,
        gameState.camera.y,
      );
      const shipScreenX = centerX + shipWrappedDeltaX;
      const shipScreenY = centerY + shipWrappedDeltaY;

      // Draw the trail
      drawShipTrail(ctx, shipScreenX, shipScreenY, shipWorldX, shipWorldY);

      // Render ship (with landing animation support)
      let shipScale = 1;
      let shipAngle = gameState.ship.angle;
      let shouldRenderShip = true;

      // Handle landing animation
      if (isLandingAnimationActive && landingAnimationData) {
        const currentTime = performance.now();
        const elapsed = currentTime - landingAnimationData.startTime;
        const progress = Math.min(elapsed / landingAnimationData.duration, 1);

        if (progress >= 1) {
          // Animation complete - immediately hide ship using ref
          shouldHideShipRef.current = true;

          // Animation complete - immediately transition without visual artifacts
          setIsLandingAnimationActive(false);
          const planetData = landingAnimationData.planet;
          setLandingAnimationData(null);

          // Update the game state to keep ship at planet position before transition
          setGameState((prevState) => ({
            ...prevState,
            ship: {
              ...prevState.ship,
              x: planetData.x,
              y: planetData.y,
              vx: 0,
              vy: 0,
            },
          }));

          // Immediate transition to prevent visual glitches
          setCurrentPlanet(planetData);
          setCurrentScreen("planet");
        } else {
          // Calculate orbital animation
          const planet = landingAnimationData.planet;

          // Calculate initial distance from player to planet
          const initialDx = landingAnimationData.initialShipX - planet.x;
          const initialDy = landingAnimationData.initialShipY - planet.y;
          const initialRadius = Math.sqrt(
            initialDx * initialDx + initialDy * initialDy,
          );

          const orbitSpeed = 1; // Only 1 orbit per animation

          // Calculate initial angle based on player's starting position relative to planet
          const initialAngle = Math.atan2(initialDy, initialDx);

          const angleProgress =
            initialAngle + progress * orbitSpeed * Math.PI * 2;

          // Gradually spiral inward from initial radius to planet center
          const currentRadius = initialRadius * (1 - progress * 0.9); // Spiral 90% closer

          // Calculate orbital position around planet
          shipWorldX = planet.x + Math.cos(angleProgress) * currentRadius;
          shipWorldY = planet.y + Math.sin(angleProgress) * currentRadius;

          // Ship points in trajectory direction (tangent to the orbit)
          shipAngle = angleProgress + Math.PI / 2; // Tangent is perpendicular to radius

          // Smooth scale transition with accelerated fade at the end
          const fadeStart = 0.7; // Start fading at 70% progress
          if (progress < fadeStart) {
            shipScale = 1; // Keep full size for most of the animation
          } else {
            const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
            shipScale = Math.max(0, 1 - Math.pow(fadeProgress, 2) * 2); // Quadratic fade out
          }
        }
      }

      // Use persistent state for ship rendering on planet screen
      if (currentScreen === "planet") {
        shouldRenderShip = shipRenderState.shouldRender;
        shipScale = shipRenderState.scale;
        shipAngle = shipRenderState.angle;
      }

      // Immediate check using ref - overrides everything else
      if (shouldHideShipRef.current || currentScreen === "planet") {
        shouldRenderShip = false;
        shipScale = 0;
      }

      // Only render ship if it should be rendered and has visible scale and NOT on planet screen
      if (shouldRenderShip && shipScale > 0 && currentScreen !== "planet") {
        ctx.save();
        ctx.translate(shipScreenX, shipScreenY);
        ctx.rotate(shipAngle);
        ctx.scale(shipScale, shipScale);
        ctx.globalAlpha = 1;

        // Render ship image if loaded, otherwise fallback to original drawing
        if (shipImageRef.current && shipImageRef.current.complete) {
          const shipSize = 30; // Adjust size as needed

          // Enable antialiasing for smooth ship rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          ctx.drawImage(
            shipImageRef.current,
            -shipSize / 2,
            -shipSize / 2,
            shipSize,
            shipSize,
          );
        } else {
          // Fallback to original ship drawing
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#00aaff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(15, 0);
          ctx.lineTo(-10, -8);
          ctx.lineTo(-6, 0);
          ctx.lineTo(-10, 8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#ff4400";
          ctx.beginPath();
          ctx.arc(-8, -4, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-8, 4, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // Render radar pulses
      radarPulsesRef.current.forEach((pulse) => {
        drawRadarPulse(
          ctx,
          pulse,
          shipScreenX,
          shipScreenY,
          shipWorldX,
          shipWorldY,
        );
      });

      // Render NPC ship
      npcShip.renderShip(
        ctx,
        gameState.camera.x,
        gameState.camera.y,
        canvas.width,
        canvas.height,
      );

      // Continue at monitor's native refresh rate (adaptive)
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    // Initialize frame timing measurement
    frameStartTime = performance.now();

    // Start adaptive game loop synchronized with monitor refresh rate
    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
      // Stop continuous movement sound when component unmounts
      if (movementSoundActiveRef.current) {
        stopContinuousMovementSound();
        movementSoundActiveRef.current = false;
      }
      // Force save final state when component unmounts
      forceSaveShipState({
        x: gameState.ship.x,
        y: gameState.ship.y,
        angle: gameState.ship.angle,
        vx: gameState.ship.vx,
        vy: gameState.ship.vy,
        cameraX: gameState.camera.x,
        cameraY: gameState.camera.y,
      });
    };
  }, [
    gameState,
    getWrappedDistance,
    normalizeCoord,
    drawPureLightStar,
    saveShipState,
    forceSaveShipState,
    createRadarPulse,
    drawRadarPulse,
    showLandingModal,
    mouseInWindow,
    createShootingStar,
    drawShootingStar,
    isClickOnPlanetPixel,
    isLandingAnimationActive,
    landingAnimationData,
    setCurrentPlanet,
    setCurrentScreen,
    createTrailPoint,
    updateTrailPoints,
    drawShipTrail,
  ]);

  return (
    <div className="w-full h-full relative bg-gradient-to-br from-slate-950 via-blue-950 to-black rounded-lg overflow-hidden shadow-2xl border border-blue-900/10 game-container gpu-accelerated force-gpu-layer">
      <PlanetLandingModal
        isOpen={showLandingModal}
        planet={selectedPlanet}
        onConfirm={handleLandingConfirm}
        onCancel={handleLandingCancel}
      />

      <NPCModal isOpen={showNPCModal} onClose={() => setShowNPCModal(false)} />

      {/* WebGL Stars - use mobile-optimized version on mobile devices */}
      {isMobile ? (
        <MobileOptimizedWebGLStars
          stars={starsRef.current}
          cameraX={gameState.camera.x}
          cameraY={gameState.camera.y}
          width={canvasDimensions.width}
          height={canvasDimensions.height}
          className="absolute inset-0 pointer-events-none z-0"
        />
      ) : (
        <FinalWebGLStars
          stars={starsRef.current}
          cameraX={gameState.camera.x}
          cameraY={gameState.camera.y}
          width={canvasDimensions.width}
          height={canvasDimensions.height}
          className="absolute inset-0 pointer-events-none z-0"
        />
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full game-canvas gpu-accelerated hardware-canvas force-gpu-layer"
        style={{
          position: "relative",
          zIndex: 1,
          cursor:
            user?.isAdmin && isWorldEditMode
              ? isDragging
                ? "grabbing"
                : "grab"
              : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='3' fill='%230080ff' stroke='%23ffffff' stroke-width='1'/%3E%3C/svg%3E") 8 8, auto`,
          imageRendering: "optimizeSpeed",
          transform: "translate3d(0, 0, 0) scale3d(1, 1, 1)",
          willChange: "transform, contents",
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={(e) => {
          handleMouseLeave(e);
          handleMouseLeaveCanvas();
        }}
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={(e) => {
          e.preventDefault();
          const touch = e.touches[0];
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const mouseEvent = {
              clientX: touch.clientX,
              clientY: touch.clientY,
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent<HTMLCanvasElement>;
            handleMouseDown(mouseEvent);
          }
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          const touch = e.touches[0];
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const mouseEvent = {
              clientX: touch.clientX,
              clientY: touch.clientY,
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent<HTMLCanvasElement>;
            handleMouseMove(mouseEvent);
          }
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          const touch = e.changedTouches[0];
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const mouseEvent = {
              clientX: touch.clientX,
              clientY: touch.clientY,
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent<HTMLCanvasElement>;
            handleMouseUp(mouseEvent);
            // Also trigger click for tap actions
            handleClick(mouseEvent);
          }
        }}
      />

      {/* Admin Controls - Mobile Responsive */}
      {user?.isAdmin && (
        <div className="absolute top-2 right-2 space-y-2 z-50">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log("Button clicked, current mode:", isWorldEditMode);
              console.log("setWorldEditMode function:", setWorldEditMode);

              setWorldEditMode(!isWorldEditMode);

              if (isWorldEditMode) {
                setSelectedWorldId(null);
                setIsDragging(false);
              }
            }}
            className={`block w-full px-4 py-2 text-sm rounded-lg font-medium transition-all touch-manipulation min-h-[44px] ${
              isWorldEditMode
                ? "bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
                : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
            }`}
            style={{ pointerEvents: "auto", minWidth: "120px" }}
          >
            {isWorldEditMode ? "Sair Edição" : "Editar Mundos"}
          </button>

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBarrierCollisionEnabled(!isBarrierCollisionEnabled);
            }}
            className={`block w-full px-4 py-2 text-sm rounded-lg font-medium transition-all touch-manipulation min-h-[44px] ${
              isBarrierCollisionEnabled
                ? "bg-green-600 text-white hover:bg-green-700 active:bg-green-800"
                : "bg-orange-600 text-white hover:bg-orange-700 active:bg-orange-800"
            }`}
            style={{ pointerEvents: "auto", minWidth: "120px" }}
          >
            {isBarrierCollisionEnabled ? "🚧 Barreira ON" : "⚡ Barreira OFF"}
          </button>
        </div>
      )}

      {/* World Controls when selected */}
      {user?.isAdmin && isWorldEditMode && selectedWorldId && (
        <div
          className="absolute top-24 right-2 bg-white rounded-lg p-4 shadow-lg border border-gray-200 w-72 sm:w-64 z-50 max-h-[70vh] overflow-y-auto"
          style={{ pointerEvents: "auto" }}
        >
          <h4 className="text-sm font-bold text-gray-900 mb-3">
            Mundo:{" "}
            {planetsRef.current.find((p) => p.id === selectedWorldId)?.name}
          </h4>

          {/* Size Control */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tamanho:{" "}
              {planetsRef.current.find((p) => p.id === selectedWorldId)?.size ||
                60}
            </label>
            <input
              type="range"
              min="20"
              max="1000"
              value={
                planetsRef.current.find((p) => p.id === selectedWorldId)
                  ?.size || 60
              }
              onChange={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newSize = Number(e.target.value);
                console.log("📏 Size control changed to:", newSize);

                // Update immediately for responsive feedback
                planetsRef.current = planetsRef.current.map((planet) =>
                  planet.id === selectedWorldId
                    ? {
                        ...planet,
                        size: newSize,
                        interactionRadius: Math.max(90, newSize + 30),
                      }
                    : planet,
                );

                // Save to database with throttling to avoid too many calls
                clearTimeout((window as any).worldSizeTimeout);
                (window as any).worldSizeTimeout = setTimeout(async () => {
                  if (selectedWorldId) {
                    console.log("📏 Saving world size:", {
                      selectedWorldId,
                      newSize,
                    });
                    try {
                      updateWorldPosition(selectedWorldId, {
                        size: newSize,
                      });
                      console.log("📏 Size saved successfully");
                    } catch (error) {
                      console.error("📏 Error saving size:", error);
                    }
                  }
                }, 300);
              }}
              className="w-full h-4 bg-blue-200 rounded-lg appearance-none cursor-pointer touch-manipulation"
              style={{ minHeight: "20px" }}
            />
          </div>

          {/* Rotation Control */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Rotaç��o:{" "}
              {Math.round(
                ((planetsRef.current.find((p) => p.id === selectedWorldId)
                  ?.rotation || 0) *
                  180) /
                  Math.PI,
              )}
              ��
            </label>
            <input
              type="range"
              min="0"
              max={Math.PI * 2}
              step="0.1"
              value={
                planetsRef.current.find((p) => p.id === selectedWorldId)
                  ?.rotation || 0
              }
              onChange={async (e) => {
                const newRotation = Number(e.target.value);

                // Update immediately for responsive feedback
                planetsRef.current = planetsRef.current.map((planet) =>
                  planet.id === selectedWorldId
                    ? { ...planet, rotation: newRotation }
                    : planet,
                );

                // Save to database with throttling to avoid too many calls
                clearTimeout((window as any).worldRotationTimeout);
                (window as any).worldRotationTimeout = setTimeout(() => {
                  if (selectedWorldId) {
                    console.log("��� Saving world rotation:", {
                      selectedWorldId,
                      newRotation,
                    });
                    updateWorldPosition(selectedWorldId, {
                      rotation: newRotation,
                    });
                  }
                }, 300);
              }}
              className="w-full h-4 bg-purple-200 rounded-lg appearance-none cursor-pointer touch-manipulation"
              style={{ minHeight: "20px" }}
            />
          </div>

          {/* Interaction Radius Control */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              �����rea de Pouso:{" "}
              {Math.round(
                planetsRef.current.find((p) => p.id === selectedWorldId)
                  ?.interactionRadius || 90,
              )}
              px
            </label>
            <input
              type="range"
              min="50"
              max="1000"
              step="5"
              value={
                planetsRef.current.find((p) => p.id === selectedWorldId)
                  ?.interactionRadius || 90
              }
              onChange={(e) => {
                const newRadius = Number(e.target.value);

                // Update local state immediately
                planetsRef.current = planetsRef.current.map((planet) =>
                  planet.id === selectedWorldId
                    ? { ...planet, interactionRadius: newRadius }
                    : planet,
                );

                // Save to store with throttling
                clearTimeout((window as any).worldInteractionTimeout);
                (window as any).worldInteractionTimeout = setTimeout(() => {
                  if (selectedWorldId) {
                    console.log("🎯 Saving interaction radius:", {
                      selectedWorldId,
                      newRadius,
                    });
                    updateWorldPosition(selectedWorldId, {
                      interactionRadius: newRadius,
                    });
                  }
                }, 300);
              }}
              className="w-full h-4 bg-green-200 rounded-lg appearance-none cursor-pointer touch-manipulation"
              style={{ minHeight: "20px" }}
            />
          </div>

          <div className="flex space-x-2 mt-4">
            <button
              onClick={() => {
                setIsDragging(true);
                setDragOffset({ x: 0, y: 0 });
              }}
              className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-all touch-manipulation min-h-[44px] ${
                isDragging
                  ? "bg-red-100 text-red-700 border border-red-300"
                  : "bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 active:bg-green-300"
              }`}
              disabled={isDragging}
            >
              {isDragging ? "Arrastando..." : "Mover Mundo"}
            </button>

            {isDragging && (
              <button
                onClick={() => {
                  // Save final position
                  if (selectedWorldId) {
                    const planet = planetsRef.current.find(
                      (p) => p.id === selectedWorldId,
                    );
                    if (planet) {
                      console.log("✅ Confirming world position:", {
                        selectedWorldId,
                        x: planet.x,
                        y: planet.y,
                      });
                      updateWorldPosition(selectedWorldId, {
                        x: planet.x,
                        y: planet.y,
                      });
                    }
                  }

                  setIsDragging(false);
                  setDragOffset({ x: 0, y: 0 });
                }}
                className="flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-all touch-manipulation min-h-[44px] bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200 active:bg-blue-300"
              >
                Confirmar
              </button>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-2">
            ✅ Alterações salvas automaticamente
            <br />
            ESC para cancelar • Clique fora para desselecionar
          </p>
        </div>
      )}

      <div className="absolute top-2 left-2 text-white text-xs bg-black bg-opacity-70 p-2 rounded gpu-ui-overlay optimized-text">
        <div>X: {Math.round(gameState.ship.x)}</div>
        <div>Y: {Math.round(gameState.ship.y)}</div>
        <div>
          Vel:{" "}
          {Math.round(
            Math.sqrt(gameState.ship.vx ** 2 + gameState.ship.vy ** 2) * 10,
          ) / 10}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={
              fps < 30
                ? "text-red-400"
                : fps < 50
                  ? "text-yellow-400"
                  : "text-green-400"
            }
          >
            FPS: {fps} {isMobile && "(Mobile)"}{" "}
            {refreshRateDetectedRef.current && `| ${refreshRateRef.current}Hz`}
          </div>
          <canvas
            ref={fpsGraphRef}
            width={80}
            height={30}
            className="border border-gray-600 rounded"
            style={{
              imageRendering: "pixelated",
              background: "rgba(0, 0, 0, 0.5)",
            }}
          />
        </div>
      </div>

      <div className="absolute bottom-2 left-2 text-white text-xs bg-black bg-opacity-70 p-2 rounded gpu-ui-overlay optimized-text">
        {user?.isAdmin && isWorldEditMode ? (
          <>
            <div className="text-yellow-400 font-bold mb-1">
              ��� MODO EDIÇÃO
            </div>
            <div>�� 1º Click: Selecionar mundo</div>
            <div>
              • 2�� Click:{" "}
              {isDragging ? "Confirmar posição" : "Ativar arrastar"}
            </div>
            <div>• ESC: Cancelar</div>
            <div>• Painel: Tamanho/Rotação</div>
          </>
        ) : (
          <>
            <div>• Mouse: Mover nave</div>
            <div>• Click: Atirar/Planeta</div>
          </>
        )}
      </div>
    </div>
  );
};

// Memoize component for performance optimization
export const SpaceMap = memo(SpaceMapComponent);

'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { SystemDetailResponse } from '@/lib/sde-types';
import {
  getTypeImageUrl,
  getStarRenderColor,
  metersToSolarRadii,
  formatAge,
  getPlanetTypeColor,
  formatTemperature,
  formatOrbitalPeriod,
  formatRotationPeriod,
  metersToAU,
  formatMass,
} from '@/lib/eve-images';

interface SystemDetailProps {
  systemId: number;
  onClose: () => void;
}

export default function SystemDetail({ systemId, onClose }: SystemDetailProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [systemData, setSystemData] = useState<SystemDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  const systemSecurityRound = useCallback((security: number) => {
    if (security >= 0 && security <= 0.05) {
      return Math.ceil(security * 10) / 10;
    } else {
      return Math.round(security * 10) / 10;
    }
  }, []);

  const getSecurityClass = useCallback(
    (security: number) => {
      const rounded = systemSecurityRound(security);
      if (rounded >= 0.5) {
        return 'High-Sec';
      } else if (rounded > 0.0) {
        return 'Low-Sec';
      } else {
        return 'Null-Sec';
      }
    },
    [systemSecurityRound]
  );

  const cameraRef = useRef({
    x: 0,
    y: 0,
    zoom: 1,
  });

  const [camera, setCamera] = useState({
    x: 0,
    y: 0,
    zoom: 1,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const [cameraInitialized, setCameraInitialized] = useState(false);

  const rafId = useRef<number>();
  const renderRequested = useRef(false);

  const [hoveredObject, setHoveredObject] = useState<{
    type: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  const [selectedObject, setSelectedObject] = useState<{
    type: 'star' | 'planet' | 'moon' | 'asteroidBelt' | 'stargate' | 'station';
    data: any;
  } | null>(null);

  const [openListPanel, setOpenListPanel] = useState<'planets' | 'stargates' | 'stations' | null>(
    null
  );

  const [openedFromList, setOpenedFromList] = useState<'planets' | 'stargates' | 'stations' | null>(
    null
  );

  const [expandedMoonsList, setExpandedMoonsList] = useState(false);

  const [expandedAsteroidBeltsList, setExpandedAsteroidBeltsList] = useState(false);

  const imageCache = useRef<Map<number, HTMLImageElement>>(new Map());
  const [imageLoadTrigger, setImageLoadTrigger] = useState(0);

  const imageLoadRafId = useRef<number | null>(null);
  const pendingImageUpdates = useRef(0);

  const adjustedPositions = useRef<Map<any, { x: number; y: number; radius: number }>>(new Map());

  const loadImage = useCallback((typeID: number): HTMLImageElement | null => {
    if (imageCache.current.has(typeID)) {
      return imageCache.current.get(typeID)!;
    }

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = getTypeImageUrl(typeID, { size: 64, type: 'icon' });

    img.onload = () => {
      imageCache.current.set(typeID, img);
      pendingImageUpdates.current += 1;

      if (imageLoadRafId.current === null) {
        imageLoadRafId.current = requestAnimationFrame(() => {
          setImageLoadTrigger((prev) => prev + pendingImageUpdates.current);
          pendingImageUpdates.current = 0;
          imageLoadRafId.current = null;
        });
      }
    };

    imageCache.current.set(typeID, img);
    return img;
  }, []);

  useEffect(() => {
    return () => {
      if (imageLoadRafId.current !== null) {
        cancelAnimationFrame(imageLoadRafId.current);
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  useEffect(() => {
    setExpandedMoonsList(false);
    setExpandedAsteroidBeltsList(false);
  }, [selectedObject]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    async function loadSystemData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/map/system/${systemId}`);
        if (!response.ok) throw new Error('Failed to load system data');
        const data = await response.json();
        setSystemData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadSystemData();
  }, [systemId]);

  const objectBounds = useMemo(() => {
    if (!systemData) return { minA: 0, minB: 0, maxA: 0, maxB: 0 };

    const { star, planets, moons, stargates, stations } = systemData;

    let minA = Infinity,
      maxA = -Infinity;
    let minB = Infinity,
      maxB = -Infinity;

    const processPosition = (pos: { x: number; z: number } | undefined) => {
      if (!pos) return;
      minA = Math.min(minA, pos.x);
      maxA = Math.max(maxA, pos.x);
      minB = Math.min(minB, pos.z);
      maxB = Math.max(maxB, pos.z);
    };

    if (star) processPosition(star.position || { x: 0, z: 0 });
    planets.forEach((p) => processPosition(p.position));
    moons.forEach((m) => processPosition(m.position));
    stargates.forEach((g) => processPosition(g.position));
    stations.forEach((s) => processPosition(s.position));

    if (minA === Infinity) return { minA: 0, minB: 0, maxA: 0, maxB: 0 };

    return { minA, minB, maxA, maxB };
  }, [systemData]);

  const coordinateData = useMemo(() => {
    const padding = 100;
    const scaleA = (dimensions.width - padding * 2) / (objectBounds.maxA - objectBounds.minA || 1);
    const scaleB = (dimensions.height - padding * 2) / (objectBounds.maxB - objectBounds.minB || 1);
    const scale = Math.min(scaleA, scaleB);

    return {
      ...objectBounds,
      scale,
      padding,
    };
  }, [objectBounds, dimensions]);

  useEffect(() => {
    if (!systemData) return;

    const { minA, minB, scale, padding } = coordinateData;

    const starCanvasX = (0 - minA) * scale + padding;
    const starCanvasY = dimensions.height - ((0 - minB) * scale + padding);

    const zoom = 1;
    const screenCenterX = dimensions.width / 2;
    const screenCenterY = dimensions.height / 2;

    const initialCamera = {
      x: -(starCanvasX - screenCenterX) * zoom,
      y: -(starCanvasY - screenCenterY) * zoom,
      zoom: zoom,
    };
    setCamera(initialCamera);
    cameraRef.current = { ...initialCamera };
    setCameraInitialized(true);
  }, [systemData, dimensions, coordinateData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cameraInitialized) return;

    let wheelRafId: number | null = null;
    let pendingZoomDelta = 0;
    let lastWheelMouse = { x: 0, y: 0 };

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();

      pendingZoomDelta += e.deltaY > 0 ? -0.1 : 0.1;
      lastWheelMouse = { x: e.clientX, y: e.clientY };

      if (wheelRafId !== null) return;

      wheelRafId = requestAnimationFrame(() => {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = lastWheelMouse.x - canvasRect.left;
        const mouseY = lastWheelMouse.y - canvasRect.top;

        const cam = cameraRef.current;
        const newZoom = Math.max(0.1, Math.min(10, cam.zoom * (1 + pendingZoomDelta)));

        const worldX = (mouseX - dimensions.width / 2 - cam.x) / cam.zoom;
        const worldY = (mouseY - dimensions.height / 2 - cam.y) / cam.zoom;

        const newX = mouseX - dimensions.width / 2 - worldX * newZoom;
        const newY = mouseY - dimensions.height / 2 - worldY * newZoom;

        cameraRef.current = {
          x: newX,
          y: newY,
          zoom: newZoom,
        };

        setCamera({ ...cameraRef.current });

        wheelRafId = null;
        pendingZoomDelta = 0;
      });
    };

    canvas.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheelEvent);
  }, [dimensions, cameraInitialized]); // Wait for camera initialization

  useEffect(() => {
    if (!systemData || !canvasRef.current || !cameraInitialized) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { star, planets, stargates, stations } = systemData;
    const { minA, minB, scale, padding } = coordinateData;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(dimensions.width / 2 + camera.x, dimensions.height / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-dimensions.width / 2, -dimensions.height / 2);

    const toCanvasCoords = (pos: { x: number; y: number; z: number }) => {
      return {
        x: (pos.x - minA) * scale + padding,
        y: canvas.height - ((pos.z - minB) * scale + padding),
      };
    };

    let maxDistance = 0;
    const starPos = { x: 0, y: 0, z: 0 };

    [...planets, ...stargates, ...stations].forEach((obj) => {
      if (obj.position) {
        const dx = obj.position.x - starPos.x;
        const dz = obj.position.z - starPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        maxDistance = Math.max(maxDistance, distance);
      }
    });

    const starCoords = toCanvasCoords(starPos);
    const AU_METERS = 149597870700; // 1 AU in meters
    const maxAU = Math.ceil(maxDistance / AU_METERS);

    ctx.strokeStyle = 'rgba(100, 100, 100, 0.2)';
    ctx.lineWidth = 1 / camera.zoom;

    for (let i = 1; i <= maxAU; i++) {
      const auDistance = i * AU_METERS;
      const radiusInPixels = auDistance * scale;

      ctx.beginPath();
      ctx.arc(starCoords.x, starCoords.y, radiusInPixels, 0, Math.PI * 2);
      ctx.stroke();

      const fontSize = Math.max(8, 10 / camera.zoom);
      ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(`${i} AU`, starCoords.x, starCoords.y - radiusInPixels - 5 / camera.zoom);
    }

    adjustedPositions.current.clear();

    const objectsToRender: Array<{
      x: number;
      y: number;
      type: 'star' | 'planet' | 'moon' | 'stargate' | 'station';
      label: string;
      color: string;
      radius: number;
      typeID?: number;
      dataRef: any; // Reference to the original data object for position mapping
    }> = [];

    if (star) {
      const starPos = star.position || { x: 0, y: 0, z: 0 };
      const coords = toCanvasCoords(starPos);

      const starColor = star.statistics?.spectralClass
        ? getStarRenderColor(star.statistics.spectralClass)
        : '#FFD700';

      let starRadius = 12;
      if (star.radius) {
        const solarRadii = metersToSolarRadii(star.radius);
        starRadius = Math.max(8, Math.min(20, 8 + solarRadii * 4));
      }

      objectsToRender.push({
        x: coords.x,
        y: coords.y,
        type: 'star',
        label: star.statistics?.spectralClass ? `Star (${star.statistics.spectralClass})` : 'Star',
        color: starColor,
        radius: starRadius,
        typeID: star.typeID,
        dataRef: star,
      });
    }

    planets.forEach((planet) => {
      if (planet.position) {
        const coords = toCanvasCoords(planet.position);

        const planetColor = getPlanetTypeColor(planet.statistics?.temperature);

        objectsToRender.push({
          x: coords.x,
          y: coords.y,
          type: 'planet',
          label: (planet as any).fullName || `Planet ${planet.celestialIndex || planet._key}`,
          color: planetColor,
          radius: 6,
          typeID: planet.typeID,
          dataRef: planet,
        });
      }
    });

    stargates.forEach((gate) => {
      if (gate.position) {
        const coords = toCanvasCoords(gate.position);
        objectsToRender.push({
          x: coords.x,
          y: coords.y,
          type: 'stargate',
          label: (gate as any).fullName || `Stargate ${gate._key}`,
          color: '#00FFFF', // Cyan - distinct from star/planet colors
          radius: 5,
          dataRef: gate,
        });
      }
    });

    stations.forEach((station) => {
      if (station.position) {
        const coords = toCanvasCoords(station.position);
        objectsToRender.push({
          x: coords.x,
          y: coords.y,
          type: 'station',
          label: (station as any).fullName || `Station ${station._key}`,
          color: '#FF00FF', // Magenta - distinct from star/planet colors
          radius: 4,
          dataRef: station,
        });
      }
    });

    const minSeparation = 15; // Minimum pixels between object centers
    const maxIterations = 5;
    const cellSize = minSeparation * 2; // Cell size for spatial hash grid

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let hadCollision = false;

      type IndexedObject = { obj: typeof objectsToRender[number]; index: number };
      const grid = new Map<string, IndexedObject[]>();

      const getCellKey = (x: number, y: number): string => {
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        return `${cellX},${cellY}`;
      };

      objectsToRender.forEach((obj, index) => {
        const key = getCellKey(obj.x, obj.y);
        if (!grid.has(key)) {
          grid.set(key, []);
        }
        grid.get(key)!.push({ obj, index });
      });

      const checkedPairs = new Set<string>();

      objectsToRender.forEach((obj1, i) => {
        const cellX = Math.floor(obj1.x / cellSize);
        const cellY = Math.floor(obj1.y / cellSize);

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const neighborKey = `${cellX + dx},${cellY + dy}`;
            const neighbors = grid.get(neighborKey);
            if (!neighbors) continue;

            for (const { obj: obj2, index: j } of neighbors) {
              if (i === j) continue;

              const pairKey = i < j ? `${i},${j}` : `${j},${i}`;

              if (checkedPairs.has(pairKey)) continue;
              checkedPairs.add(pairKey);

              const dx = obj2.x - obj1.x;
              const dy = obj2.y - obj1.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < minSeparation && distance > 0) {
                hadCollision = true;

                const pushStrength = (minSeparation - distance) / 2;
                const angle = Math.atan2(dy, dx);

                obj1.x -= Math.cos(angle) * pushStrength;
                obj1.y -= Math.sin(angle) * pushStrength;
                obj2.x += Math.cos(angle) * pushStrength;
                obj2.y += Math.sin(angle) * pushStrength;
              }
            }
          }
        }
      });

      if (!hadCollision) break;
    }

    objectsToRender.forEach((obj) => {
      adjustedPositions.current.set(obj.dataRef, {
        x: obj.x,
        y: obj.y,
        radius: obj.radius,
      });
    });

    for (const obj of objectsToRender) {
      const size = obj.radius / camera.zoom;

      ctx.fillStyle = obj.color;
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 2 / camera.zoom;

      switch (obj.type) {
        case 'star':
          if (obj.typeID) {
            const img = loadImage(obj.typeID);
            if (img && img.complete) {
              ctx.globalAlpha = 0.3;
              ctx.fillStyle = obj.color;
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size * 1.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1.0;

              ctx.save();
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(img, obj.x - size, obj.y - size, size * 2, size * 2);
              ctx.restore();

              ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
              ctx.lineWidth = 1 / camera.zoom;
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;

        case 'planet':
          if (obj.typeID) {
            const img = loadImage(obj.typeID);
            if (img && img.complete) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(img, obj.x - size, obj.y - size, size * 2, size * 2);
              ctx.restore();

              ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
              ctx.lineWidth = 1 / camera.zoom;
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
              ctx.stroke();
            }
          }
          break;

        case 'stargate':
          ctx.beginPath();
          ctx.moveTo(obj.x, obj.y - size);
          ctx.lineTo(obj.x + size, obj.y);
          ctx.lineTo(obj.x, obj.y + size);
          ctx.lineTo(obj.x - size, obj.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.stroke();
          break;

        case 'station':
          ctx.beginPath();
          ctx.moveTo(obj.x, obj.y - size);
          ctx.lineTo(obj.x + size * 0.866, obj.y + size * 0.5);
          ctx.lineTo(obj.x - size * 0.866, obj.y + size * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.stroke();
          break;

        default:
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
          ctx.fill();
      }
    }

    ctx.restore();
  }, [
    systemData,
    camera,
    coordinateData,
    cameraInitialized,
    imageLoadTrigger,
  ]);

  const findObjectAtPosition = useCallback(
    (
      mouseX: number,
      mouseY: number,
      detectionBuffer: number
    ): {
      star?: any;
      planet?: any;
      stargate?: any;
      station?: any;
      distance: number;
    } | null => {
      if (!systemData || !canvasRef.current) return null;

      const cam = cameraRef.current;
      const worldX = (mouseX - dimensions.width / 2 - cam.x) / cam.zoom + dimensions.width / 2;
      const worldY = (mouseY - dimensions.height / 2 - cam.y) / cam.zoom + dimensions.height / 2;

      const { star, planets, stargates, stations } = systemData;

      let nearestObject: {
        star?: any;
        planet?: any;
        stargate?: any;
        station?: any;
        distance: number;
      } | null = null;
      let nearestDistance = Infinity;

      if (star) {
        const adjusted = adjustedPositions.current.get(star);
        if (adjusted) {
          const actualSize = adjusted.radius / cam.zoom;
          const detectionRadius = actualSize + detectionBuffer;

          const dx = worldX - adjusted.x;
          const dy = worldY - adjusted.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < detectionRadius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestObject = { star, distance };
          }
        }
      }

      for (const planet of planets) {
        const adjusted = adjustedPositions.current.get(planet);
        if (adjusted) {
          const actualSize = adjusted.radius / cam.zoom;
          const detectionRadius = actualSize + detectionBuffer;

          const dx = worldX - adjusted.x;
          const dy = worldY - adjusted.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < detectionRadius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestObject = { planet, distance };
          }
        }
      }

      for (const stargate of stargates) {
        const adjusted = adjustedPositions.current.get(stargate);
        if (adjusted) {
          const actualSize = adjusted.radius / cam.zoom;
          const detectionRadius = actualSize + detectionBuffer;

          const dx = worldX - adjusted.x;
          const dy = worldY - adjusted.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < detectionRadius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestObject = { stargate, distance };
          }
        }
      }

      for (const station of stations) {
        const adjusted = adjustedPositions.current.get(station);
        if (adjusted) {
          const actualSize = adjusted.radius / cam.zoom;
          const detectionRadius = actualSize + detectionBuffer;

          const dx = worldX - adjusted.x;
          const dy = worldY - adjusted.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < detectionRadius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestObject = { station, distance };
          }
        }
      }

      return nearestObject;
    },
    [systemData, dimensions]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - cameraRef.current.x, y: e.clientY - cameraRef.current.y });
    setMouseDownPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      cameraRef.current.x = e.clientX - dragStart.x;
      cameraRef.current.y = e.clientY - dragStart.y;

      if (!renderRequested.current) {
        renderRequested.current = true;
        rafId.current = requestAnimationFrame(() => {
          renderRequested.current = false;
          setCamera({ ...cameraRef.current });
        });
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const found = findObjectAtPosition(mouseX, mouseY, 3); // 3px buffer for hover

    let hoveredObject: { type: string; label: string; x: number; y: number } | null = null;

    if (found && systemData) {
      if (found.star) {
        hoveredObject = {
          type: 'Star',
          label: systemData.star?.statistics?.spectralClass
            ? `${systemData.star.statistics.spectralClass} Class`
            : 'Star',
          x: mouseX,
          y: mouseY,
        };
      } else if (found.planet) {
        hoveredObject = {
          type: 'Planet',
          label:
            (found.planet as any).fullName ||
            `Planet ${found.planet.celestialIndex || found.planet._key}`,
          x: mouseX,
          y: mouseY,
        };
      } else if (found.stargate) {
        hoveredObject = {
          type: 'Stargate',
          label: (found.stargate as any).fullName || `Stargate ${found.stargate._key}`,
          x: mouseX,
          y: mouseY,
        };
      } else if (found.station) {
        hoveredObject = {
          type: 'Station',
          label: (found.station as any).fullName || `Station ${found.station._key}`,
          x: mouseX,
          y: mouseY,
        };
      }
    }

    setHoveredObject(hoveredObject);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setCamera({ ...cameraRef.current });
    }
    setIsDragging(false);

    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5 && systemData && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const found = findObjectAtPosition(mouseX, mouseY, 5); // 5px buffer for click

      if (found) {
        if (found.star) {
          setSelectedObject({ type: 'star', data: found.star });
        } else if (found.planet) {
          setSelectedObject({ type: 'planet', data: found.planet });
        } else if (found.stargate) {
          setSelectedObject({ type: 'stargate', data: found.stargate });
        } else if (found.station) {
          setSelectedObject({ type: 'station', data: found.station });
        }
      }
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredObject(null);
  };

  if (loading || !cameraInitialized) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 bg-black flex items-center justify-center z-50"
      >
        <div className="text-white">Loading system data...</div>
      </div>
    );
  }

  if (error || !systemData) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 bg-black flex items-center justify-center z-50"
      >
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">Error</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
              ×
            </button>
          </div>
          <div className="text-red-500">{error || 'Failed to load system data'}</div>
        </div>
      </div>
    );
  }

  const { system, region, star, planets, stargates, stations } = systemData;

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="cursor-move block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Header with system info and close button */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none">
        <div className="flex gap-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 shadow-lg pointer-events-auto">
            <h2 className="text-2xl font-bold text-white">{system.name.en}</h2>
            <div className="text-gray-400 text-sm mt-1">{region.name.en}</div>
            <div className="text-gray-400 text-sm mt-1">
              {getSecurityClass(system.securityStatus)} (
              {systemSecurityRound(system.securityStatus).toFixed(1)})
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors shadow-lg pointer-events-auto"
        >
          ← Back to Galaxy Map
        </button>
      </div>

      {/* Object counts - bottom left */}
      <div className="absolute bottom-4 left-4 bg-gray-900 border border-gray-700 rounded-lg p-4 shadow-lg">
        <div className="grid grid-cols-4 gap-4 text-center text-sm">
          {star && (
            <button
              onClick={() => {
                setSelectedObject({ type: 'star', data: star });
                setOpenListPanel(null); // Close any open list panels
              }}
              className="bg-gray-800 hover:bg-gray-700 rounded p-2 transition-colors cursor-pointer"
            >
              <div className="text-yellow-400 font-semibold">1</div>
              <div className="text-gray-400">Star</div>
            </button>
          )}
          <button
            onClick={() => {
              if (planets.length === 1) {
                setSelectedObject({ type: 'planet', data: planets[0] });
                setOpenListPanel(null);
              } else if (planets.length > 1) {
                setOpenListPanel('planets');
                setSelectedObject(null);
              }
            }}
            className="bg-gray-800 hover:bg-gray-700 rounded p-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={planets.length === 0}
          >
            <div className="text-blue-400 font-semibold">{planets.length}</div>
            <div className="text-gray-400">Planets</div>
          </button>
          <button
            onClick={() => {
              if (stargates.length === 1) {
                setSelectedObject({ type: 'stargate', data: stargates[0] });
                setOpenListPanel(null);
              } else if (stargates.length > 1) {
                setOpenListPanel('stargates');
                setSelectedObject(null);
              }
            }}
            className="bg-gray-800 hover:bg-gray-700 rounded p-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={stargates.length === 0}
          >
            <div className="text-cyan-400 font-semibold">{stargates.length}</div>
            <div className="text-gray-400">Stargates</div>
          </button>
          <button
            onClick={() => {
              if (stations.length === 1) {
                setSelectedObject({ type: 'station', data: stations[0] });
                setOpenListPanel(null);
              } else if (stations.length > 1) {
                setOpenListPanel('stations');
                setSelectedObject(null);
              }
            }}
            className="bg-gray-800 hover:bg-gray-700 rounded p-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={stations.length === 0}
          >
            <div className="text-fuchsia-400 font-semibold">{stations.length}</div>
            <div className="text-gray-400">Stations</div>
          </button>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredObject && (
        <div
          className="absolute pointer-events-none bg-gray-900 border border-gray-700 rounded px-3 py-2 shadow-lg z-20"
          style={{
            left: `${hoveredObject.x + 15}px`,
            top: `${hoveredObject.y + 15}px`,
          }}
        >
          <div className="text-white font-semibold text-sm">{hoveredObject.type}</div>
          <div className="text-gray-400 text-xs">{hoveredObject.label}</div>
        </div>
      )}

      {/* Planets list panel */}
      {openListPanel === 'planets' && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <h3 className="text-white font-semibold text-lg">Planets ({planets.length})</h3>
            <button
              onClick={() => {
                setOpenListPanel(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>
          <div className="p-2">
            {planets.map((planet) => (
              <button
                key={planet._key}
                onClick={() => {
                  setSelectedObject({ type: 'planet', data: planet });
                  setOpenListPanel(null);
                  setOpenedFromList('planets');
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-800 rounded transition-colors border-b border-gray-800 last:border-b-0"
              >
                <div className="text-white font-medium">
                  {(planet as any).fullName || `Planet ${planet.celestialIndex || planet._key}`}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {(planet as any).typeName || 'Planet'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stargates list panel */}
      {openListPanel === 'stargates' && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <h3 className="text-white font-semibold text-lg">Stargates ({stargates.length})</h3>
            <button
              onClick={() => {
                setOpenListPanel(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>
          <div className="p-2">
            {stargates.map((stargate) => (
              <button
                key={stargate._key}
                onClick={() => {
                  setSelectedObject({ type: 'stargate', data: stargate });
                  setOpenListPanel(null);
                  setOpenedFromList('stargates');
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-800 rounded transition-colors border-b border-gray-800 last:border-b-0"
              >
                <div className="text-white font-medium">
                  {(stargate as any).fullName || `Stargate ${stargate._key}`}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  Jump to: {(stargate as any).destinationName || 'Unknown'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stations list panel */}
      {openListPanel === 'stations' && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <h3 className="text-white font-semibold text-lg">Stations ({stations.length})</h3>
            <button
              onClick={() => {
                setOpenListPanel(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>
          <div className="p-2">
            {stations.map((station) => (
              <button
                key={station._key}
                onClick={() => {
                  setSelectedObject({ type: 'station', data: station });
                  setOpenListPanel(null);
                  setOpenedFromList('stations');
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-800 rounded transition-colors border-b border-gray-800 last:border-b-0"
              >
                <div className="text-white font-medium">
                  {(station as any).fullName || `Station ${station._key}`}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {(station as any).typeName || 'Station'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Star detail panel */}
      {selectedObject?.type === 'star' && selectedObject.data && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with close button */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <h3 className="text-white font-semibold text-lg">Star Details</h3>
            <button
              onClick={() => setSelectedObject(null)}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Star image */}
          <div className="bg-black p-4 flex justify-center">
            <Image
              src={getTypeImageUrl(selectedObject.data.typeID, { size: 256, type: 'render' })}
              alt="Star"
              width={256}
              height={256}
              className="w-64 h-64 object-contain"
              unoptimized
            />
          </div>

          {/* Star information */}
          <div className="p-4 space-y-3">
            {/* Spectral class */}
            {selectedObject.data.statistics?.spectralClass && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Spectral Class</div>
                <div className="text-white text-lg font-semibold">
                  {selectedObject.data.statistics.spectralClass}
                </div>
              </div>
            )}

            {/* Temperature */}
            {selectedObject.data.statistics?.temperature && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Temperature</div>
                <div className="text-white">
                  {selectedObject.data.statistics.temperature.toLocaleString()} K
                </div>
              </div>
            )}

            {/* Luminosity */}
            {selectedObject.data.statistics?.luminosity !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Luminosity</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.luminosity * 100).toFixed(1)}% of Sol
                </div>
              </div>
            )}

            {/* Radius */}
            {selectedObject.data.radius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Radius</div>
                <div className="text-white">
                  {metersToSolarRadii(selectedObject.data.radius).toFixed(2)} R☉
                  <span className="text-gray-500 text-sm ml-2">
                    ({(selectedObject.data.radius / 1000).toLocaleString()} km)
                  </span>
                </div>
              </div>
            )}

            {/* Age and lifespan */}
            {selectedObject.data.statistics?.age && selectedObject.data.statistics?.life && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Age</div>
                <div className="text-white">
                  {formatAge(selectedObject.data.statistics.age)} billion years
                </div>
                <div className="text-gray-500 text-sm mt-1">
                  {(
                    (selectedObject.data.statistics.age / selectedObject.data.statistics.life) *
                    100
                  ).toFixed(1)}
                  % through lifespan
                </div>
                <div className="mt-2 bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-yellow-500 h-full"
                    style={{
                      width: `${(selectedObject.data.statistics.age / selectedObject.data.statistics.life) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Planet detail panel */}
      {selectedObject?.type === 'planet' && selectedObject.data && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with back and close buttons */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {openedFromList === 'planets' && (
                <button
                  onClick={() => {
                    setSelectedObject(null);
                    setOpenListPanel('planets');
                    setOpenedFromList(null);
                  }}
                  className="text-gray-400 hover:text-white text-xl"
                  title="Back to planets list"
                >
                  ←
                </button>
              )}
              <h3 className="text-white font-semibold text-lg">
                {(selectedObject.data as any).fullName ||
                  `Planet ${selectedObject.data.celestialIndex}`}
              </h3>
            </div>
            <button
              onClick={() => {
                setSelectedObject(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Planet image */}
          <div className="bg-gradient-to-br from-gray-900 to-black p-6 flex justify-center items-center">
            <div className="relative">
              <Image
                src={getTypeImageUrl(selectedObject.data.typeID, { size: 128, type: 'icon' })}
                alt="Planet"
                width={96}
                height={96}
                className="w-24 h-24 rounded-full object-cover border-2 border-gray-700 shadow-lg shadow-blue-500/20"
                unoptimized
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (img.src.includes('icon')) {
                    img.src = getTypeImageUrl(selectedObject.data.typeID, {
                      size: 128,
                      type: 'render',
                    });
                  }
                }}
              />
            </div>
          </div>

          {/* Planet information */}
          <div className="p-4 space-y-3">
            {/* Planet Type */}
            {(() => {
              const getPlanetTypeInfo = (typeID: number): { name: string; resources: string } => {
                const types: Record<number, { name: string; resources: string }> = {
                  11: {
                    name: 'Temperate Planet',
                    resources: 'Rich in Carbon Compounds, Complex Organisms, and Aqueous Liquids',
                  },
                  12: {
                    name: 'Ice Planet',
                    resources: 'Rich in Aqueous Liquids, Heavy Water, and Noble Gas',
                  },
                  13: {
                    name: 'Gas Giant',
                    resources: 'Rich in Noble Gas, Ionic Solutions, and Electrolytes',
                  },
                  2014: {
                    name: 'Oceanic Planet',
                    resources: 'Rich in Aqueous Liquids, Complex Organisms, and Carbon Compounds',
                  },
                  2015: {
                    name: 'Lava Planet',
                    resources: 'Rich in Base Metals, Heavy Metals, and Non-CS Crystals',
                  },
                  2016: {
                    name: 'Barren Planet',
                    resources: 'Rich in Base Metals, Carbon Compounds, and Heavy Metals',
                  },
                  2017: {
                    name: 'Storm Planet',
                    resources: 'Rich in Noble Gas, Suspended Plasma, and Ionic Solutions',
                  },
                  2063: {
                    name: 'Plasma Planet',
                    resources: 'Rich in Suspended Plasma, Noble Gas, and Non-CS Crystals',
                  },
                  30889: {
                    name: 'Shattered Planet',
                    resources: 'Mixed resources from fractured planetary remnants',
                  },
                  73911: {
                    name: 'Scorched Barren Planet',
                    resources: 'Rich in Base Metals and Heavy Metals',
                  },
                };
                return types[typeID] || { name: 'Unknown Planet Type', resources: '' };
              };

              const typeInfo = getPlanetTypeInfo(selectedObject.data.typeID);
              return (
                <div className="bg-gray-800 rounded p-3 -mt-1">
                  <div className="text-gray-400 text-xs uppercase">Planet Type</div>
                  <div className="text-white font-semibold">{typeInfo.name}</div>
                  {typeInfo.resources && (
                    <div className="text-gray-400 text-xs mt-2 leading-relaxed">
                      {typeInfo.resources}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Temperature */}
            {selectedObject.data.statistics?.temperature && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Temperature</div>
                <div className="text-white">
                  {formatTemperature(selectedObject.data.statistics.temperature)}
                </div>
              </div>
            )}

            {/* Radius */}
            {selectedObject.data.radius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Radius</div>
                <div className="text-white">
                  {(selectedObject.data.radius / 1000).toLocaleString()} km
                </div>
              </div>
            )}

            {/* Orbital Period */}
            {selectedObject.data.statistics?.orbitPeriod && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Period</div>
                <div className="text-white">
                  {formatOrbitalPeriod(selectedObject.data.statistics.orbitPeriod)}
                </div>
              </div>
            )}

            {/* Orbital Radius */}
            {selectedObject.data.statistics?.orbitRadius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Distance</div>
                <div className="text-white">
                  {metersToAU(selectedObject.data.statistics.orbitRadius).toFixed(3)} AU
                  <span className="text-gray-500 text-sm ml-2">
                    ({(selectedObject.data.statistics.orbitRadius / 1000000).toLocaleString()} Mm)
                  </span>
                </div>
              </div>
            )}

            {/* Rotation Period */}
            {selectedObject.data.statistics?.rotationRate && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Rotation Period</div>
                <div className="text-white">
                  {formatRotationPeriod(selectedObject.data.statistics.rotationRate)}
                  {selectedObject.data.statistics.locked && (
                    <span className="text-yellow-400 text-sm ml-2">(Tidally Locked)</span>
                  )}
                </div>
              </div>
            )}

            {/* Surface Gravity */}
            {selectedObject.data.statistics?.surfaceGravity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Surface Gravity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.surfaceGravity.toFixed(2)} m/s²
                  <span className="text-gray-500 text-sm ml-2">
                    ({(selectedObject.data.statistics.surfaceGravity / 9.81).toFixed(2)}g)
                  </span>
                </div>
              </div>
            )}

            {/* Escape Velocity */}
            {selectedObject.data.statistics?.escapeVelocity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Escape Velocity</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.escapeVelocity / 1000).toFixed(2)} km/s
                </div>
              </div>
            )}

            {/* Atmospheric Pressure */}
            {selectedObject.data.statistics?.pressure !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Atmospheric Pressure</div>
                <div className="text-white">
                  {selectedObject.data.statistics.pressure.toFixed(2)} atm
                </div>
              </div>
            )}

            {/* Mass */}
            {selectedObject.data.statistics?.massDust && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Mass</div>
                <div className="text-white">
                  {formatMass(selectedObject.data.statistics.massDust, 'planet')}
                  {selectedObject.data.statistics.massGas && (
                    <div className="text-gray-500 text-sm mt-1">
                      Atmosphere: {formatMass(selectedObject.data.statistics.massGas, 'atmosphere')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Density */}
            {selectedObject.data.statistics?.density && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Density</div>
                <div className="text-white">
                  {selectedObject.data.statistics.density.toFixed(2)} kg/m³
                </div>
              </div>
            )}

            {/* Eccentricity */}
            {selectedObject.data.statistics?.eccentricity !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Eccentricity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.eccentricity.toFixed(4)}
                </div>
              </div>
            )}

            {/* Moons */}
            {selectedObject.data.moonIDs && selectedObject.data.moonIDs.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Moons</div>
                <button
                  onClick={() => setExpandedMoonsList(!expandedMoonsList)}
                  className="text-white hover:text-blue-400 transition-colors text-left w-full"
                >
                  {selectedObject.data.moonIDs.length} moon
                  {selectedObject.data.moonIDs.length !== 1 ? 's' : ''}{' '}
                  <span className="text-gray-500">{expandedMoonsList ? '▼' : '▶'}</span>
                </button>

                {/* Expanded moons list */}
                {expandedMoonsList && systemData && (
                  <div className="mt-2 space-y-1 bg-gray-800 rounded p-2">
                    {systemData.moons
                      .filter((moon) => selectedObject.data.moonIDs.includes(moon._key))
                      .sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0))
                      .map((moon) => (
                        <button
                          key={moon._key}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedObject({ type: 'moon', data: moon });
                            setExpandedMoonsList(false);
                          }}
                          className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm text-gray-300 hover:text-white transition-colors"
                        >
                          {(moon as any).fullName || `Moon ${moon.orbitIndex || moon._key}`}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Asteroid Belts */}
            {selectedObject.data.asteroidBeltIDs &&
              selectedObject.data.asteroidBeltIDs.length > 0 && (
                <div>
                  <div className="text-gray-400 text-xs uppercase">Asteroid Belts</div>
                  <button
                    onClick={() => setExpandedAsteroidBeltsList(!expandedAsteroidBeltsList)}
                    className="text-white hover:text-blue-400 transition-colors text-left w-full"
                  >
                    {selectedObject.data.asteroidBeltIDs.length} belt
                    {selectedObject.data.asteroidBeltIDs.length !== 1 ? 's' : ''}{' '}
                    <span className="text-gray-500">{expandedAsteroidBeltsList ? '▼' : '▶'}</span>
                  </button>

                  {/* Expanded asteroid belts list */}
                  {expandedAsteroidBeltsList && systemData && (
                    <div className="mt-2 space-y-1 bg-gray-800 rounded p-2">
                      {systemData.asteroidBelts
                        .filter((belt) => selectedObject.data.asteroidBeltIDs.includes(belt._key))
                        .sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0))
                        .map((belt) => (
                          <button
                            key={belt._key}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedObject({ type: 'asteroidBelt', data: belt });
                              setExpandedAsteroidBeltsList(false);
                            }}
                            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm text-gray-300 hover:text-white transition-colors"
                          >
                            {(belt as any).fullName ||
                              `Asteroid Belt ${belt.orbitIndex || belt._key}`}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

            {/* Population */}
            {selectedObject.data.attributes?.population !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Inhabited</div>
                <div className="text-white">
                  {selectedObject.data.attributes.population ? 'Yes' : 'No'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Moon detail panel */}
      {selectedObject?.type === 'moon' && selectedObject.data && systemData && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with back and close buttons */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const parentPlanet = systemData.planets.find(
                    (p) => p._key === selectedObject.data.orbitID
                  );
                  if (parentPlanet) {
                    setSelectedObject({ type: 'planet', data: parentPlanet });
                  }
                }}
                className="text-gray-400 hover:text-white text-xl"
                title="Back to planet"
              >
                ←
              </button>
              <h3 className="text-white font-semibold text-lg">
                {(selectedObject.data as any).fullName || `Moon ${selectedObject.data.orbitIndex}`}
              </h3>
            </div>
            <button
              onClick={() => setSelectedObject(null)}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Moon image */}
          <div className="bg-gradient-to-br from-gray-900 to-black p-6 flex justify-center items-center">
            <div className="relative">
              <Image
                src={getTypeImageUrl(selectedObject.data.typeID, { size: 128, type: 'icon' })}
                alt="Moon"
                width={96}
                height={96}
                className="w-24 h-24 rounded-full object-cover border-2 border-gray-700 shadow-lg shadow-gray-500/20"
                unoptimized
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (img.src.includes('icon')) {
                    img.src = getTypeImageUrl(selectedObject.data.typeID, {
                      size: 128,
                      type: 'render',
                    });
                  }
                }}
              />
            </div>
          </div>

          {/* Moon information */}
          <div className="p-4 space-y-3">
            {/* Temperature */}
            {selectedObject.data.statistics?.temperature && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Temperature</div>
                <div className="text-white">
                  {formatTemperature(selectedObject.data.statistics.temperature)}
                </div>
              </div>
            )}

            {/* Radius */}
            {selectedObject.data.radius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Radius</div>
                <div className="text-white">
                  {(selectedObject.data.radius / 1000).toLocaleString()} km
                </div>
              </div>
            )}

            {/* Orbital Period */}
            {selectedObject.data.statistics?.orbitPeriod && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Period</div>
                <div className="text-white">
                  {formatOrbitalPeriod(selectedObject.data.statistics.orbitPeriod)}
                </div>
              </div>
            )}

            {/* Orbital Radius */}
            {selectedObject.data.statistics?.orbitRadius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Distance</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.orbitRadius / 1000).toLocaleString()} km
                </div>
              </div>
            )}

            {/* Rotation Period */}
            {selectedObject.data.statistics?.rotationRate && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Rotation Period</div>
                <div className="text-white">
                  {formatRotationPeriod(selectedObject.data.statistics.rotationRate)}
                  {selectedObject.data.statistics.locked && (
                    <span className="text-yellow-400 text-sm ml-2">(Tidally Locked)</span>
                  )}
                </div>
              </div>
            )}

            {/* Surface Gravity */}
            {selectedObject.data.statistics?.surfaceGravity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Surface Gravity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.surfaceGravity.toFixed(2)} m/s²
                  <span className="text-gray-500 text-sm ml-2">
                    ({(selectedObject.data.statistics.surfaceGravity / 9.81).toFixed(2)}g)
                  </span>
                </div>
              </div>
            )}

            {/* Escape Velocity */}
            {selectedObject.data.statistics?.escapeVelocity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Escape Velocity</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.escapeVelocity / 1000).toFixed(2)} km/s
                </div>
              </div>
            )}

            {/* Atmospheric Pressure */}
            {selectedObject.data.statistics?.pressure !== undefined &&
              selectedObject.data.statistics.pressure > 0 && (
                <div>
                  <div className="text-gray-400 text-xs uppercase">Atmospheric Pressure</div>
                  <div className="text-white">
                    {selectedObject.data.statistics.pressure.toFixed(2)} atm
                  </div>
                </div>
              )}

            {/* Mass */}
            {selectedObject.data.statistics?.massDust && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Mass</div>
                <div className="text-white">
                  {formatMass(selectedObject.data.statistics.massDust, 'moon')}
                  {selectedObject.data.statistics.massGas &&
                    selectedObject.data.statistics.massGas > 0 && (
                      <div className="text-gray-500 text-sm mt-1">
                        Atmosphere:{' '}
                        {formatMass(selectedObject.data.statistics.massGas, 'atmosphere')}
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Density */}
            {selectedObject.data.statistics?.density && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Density</div>
                <div className="text-white">
                  {selectedObject.data.statistics.density.toFixed(2)} kg/m³
                </div>
              </div>
            )}

            {/* Eccentricity */}
            {selectedObject.data.statistics?.eccentricity !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Eccentricity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.eccentricity.toFixed(4)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Asteroid Belt detail panel */}
      {selectedObject?.type === 'asteroidBelt' && selectedObject.data && systemData && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with back and close buttons */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const parentPlanet = systemData.planets.find(
                    (p) => p._key === selectedObject.data.orbitID
                  );
                  if (parentPlanet) {
                    setSelectedObject({ type: 'planet', data: parentPlanet });
                  }
                }}
                className="text-gray-400 hover:text-white text-xl"
                title="Back to planet"
              >
                ←
              </button>
              <h3 className="text-white font-semibold text-lg">
                {(selectedObject.data as any).fullName ||
                  `Asteroid Belt ${selectedObject.data.orbitIndex}`}
              </h3>
            </div>
            <button
              onClick={() => setSelectedObject(null)}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Asteroid Belt image */}
          <div className="bg-gradient-to-br from-gray-900 to-black p-6 flex justify-center items-center">
            <div className="relative">
              <Image
                src={getTypeImageUrl(selectedObject.data.typeID, { size: 128, type: 'icon' })}
                alt="Asteroid Belt"
                width={96}
                height={96}
                className="w-24 h-24 rounded-full object-cover border-2 border-gray-700 shadow-lg shadow-orange-500/20"
                unoptimized
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (img.src.includes('icon')) {
                    img.src = getTypeImageUrl(selectedObject.data.typeID, {
                      size: 128,
                      type: 'render',
                    });
                  }
                }}
              />
            </div>
          </div>

          {/* Asteroid Belt information */}
          <div className="p-4 space-y-3">
            {/* Temperature */}
            {selectedObject.data.statistics?.temperature && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Temperature</div>
                <div className="text-white">
                  {formatTemperature(selectedObject.data.statistics.temperature)}
                </div>
              </div>
            )}

            {/* Radius */}
            {selectedObject.data.radius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Radius</div>
                <div className="text-white">
                  {(selectedObject.data.radius / 1000).toLocaleString()} km
                </div>
              </div>
            )}

            {/* Orbital Period */}
            {selectedObject.data.statistics?.orbitPeriod && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Period</div>
                <div className="text-white">
                  {formatOrbitalPeriod(selectedObject.data.statistics.orbitPeriod)}
                </div>
              </div>
            )}

            {/* Orbital Radius */}
            {selectedObject.data.statistics?.orbitRadius && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Distance</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.orbitRadius / 1000).toLocaleString()} km
                </div>
              </div>
            )}

            {/* Rotation Period */}
            {selectedObject.data.statistics?.rotationRate && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Rotation Period</div>
                <div className="text-white">
                  {formatRotationPeriod(selectedObject.data.statistics.rotationRate)}
                  {selectedObject.data.statistics.locked && (
                    <span className="text-yellow-400 text-sm ml-2">(Tidally Locked)</span>
                  )}
                </div>
              </div>
            )}

            {/* Surface Gravity */}
            {selectedObject.data.statistics?.surfaceGravity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Surface Gravity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.surfaceGravity.toFixed(2)} m/s²
                  <span className="text-gray-500 text-sm ml-2">
                    ({(selectedObject.data.statistics.surfaceGravity / 9.81).toFixed(2)}g)
                  </span>
                </div>
              </div>
            )}

            {/* Escape Velocity */}
            {selectedObject.data.statistics?.escapeVelocity && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Escape Velocity</div>
                <div className="text-white">
                  {(selectedObject.data.statistics.escapeVelocity / 1000).toFixed(2)} km/s
                </div>
              </div>
            )}

            {/* Mass */}
            {selectedObject.data.statistics?.massDust && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Mass</div>
                <div className="text-white">
                  {formatMass(selectedObject.data.statistics.massDust, 'atmosphere')}
                  {selectedObject.data.statistics.massGas &&
                    selectedObject.data.statistics.massGas > 0 && (
                      <div className="text-gray-500 text-sm mt-1">
                        Gas: {formatMass(selectedObject.data.statistics.massGas, 'atmosphere')}
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Density */}
            {selectedObject.data.statistics?.density && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Density</div>
                <div className="text-white">
                  {selectedObject.data.statistics.density.toFixed(2)} kg/m³
                </div>
              </div>
            )}

            {/* Eccentricity */}
            {selectedObject.data.statistics?.eccentricity !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Orbital Eccentricity</div>
                <div className="text-white">
                  {selectedObject.data.statistics.eccentricity.toFixed(4)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stargate detail panel */}
      {selectedObject?.type === 'stargate' && selectedObject.data && systemData && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with back and close buttons */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {openedFromList === 'stargates' && (
                <button
                  onClick={() => {
                    setSelectedObject(null);
                    setOpenListPanel('stargates');
                    setOpenedFromList(null);
                  }}
                  className="text-gray-400 hover:text-white text-xl"
                  title="Back to stargates list"
                >
                  ←
                </button>
              )}
              <h3 className="text-white font-semibold text-lg">Stargate</h3>
            </div>
            <button
              onClick={() => {
                setSelectedObject(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Stargate image */}
          <div className="bg-black p-4 flex justify-center">
            <Image
              src={getTypeImageUrl(selectedObject.data.typeID, { size: 256, type: 'render' })}
              alt="Stargate"
              width={256}
              height={256}
              className="w-64 h-64 object-contain"
              unoptimized
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (img.src.includes('render')) {
                  img.src = getTypeImageUrl(selectedObject.data.typeID, {
                    size: 256,
                    type: 'icon',
                  });
                }
              }}
            />
          </div>

          {/* Stargate information */}
          <div className="p-4 space-y-3">
            {/* Current System */}
            <div>
              <div className="text-gray-400 text-xs uppercase">Current System</div>
              <div className="text-white">{systemData.system.name.en}</div>
            </div>

            {/* Destination - Clickable */}
            {(selectedObject.data as any).destinationName &&
              selectedObject.data.destination?.solarSystemID && (
                <div>
                  <div className="text-gray-400 text-xs uppercase">Jump To</div>
                  <button
                    onClick={() => {
                      const destSystemId = selectedObject.data.destination.solarSystemID;
                      router.push(`/system/${destSystemId}`);
                    }}
                    className="text-blue-400 hover:text-blue-300 text-lg font-semibold transition-colors underline"
                  >
                    {(selectedObject.data as any).destinationName} →
                  </button>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Station detail panel */}
      {selectedObject?.type === 'station' && selectedObject.data && (
        <div className="absolute top-1/2 right-4 transform -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-w-md w-80 overflow-hidden max-h-[90vh] overflow-y-auto detail-panel-scroll">
          {/* Header with back and close buttons */}
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {openedFromList === 'stations' && (
                <button
                  onClick={() => {
                    setSelectedObject(null);
                    setOpenListPanel('stations');
                    setOpenedFromList(null);
                  }}
                  className="text-gray-400 hover:text-white text-xl"
                  title="Back to stations list"
                >
                  ←
                </button>
              )}
              <h3 className="text-white font-semibold text-lg">Station</h3>
            </div>
            <button
              onClick={() => {
                setSelectedObject(null);
                setOpenedFromList(null);
              }}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {/* Station image */}
          <div className="bg-black p-4 flex justify-center">
            <Image
              src={getTypeImageUrl(selectedObject.data.typeID, { size: 256, type: 'render' })}
              alt="Station"
              width={256}
              height={256}
              className="w-64 h-64 object-contain"
              unoptimized
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (img.src.includes('render')) {
                  img.src = getTypeImageUrl(selectedObject.data.typeID, {
                    size: 256,
                    type: 'icon',
                  });
                }
              }}
            />
          </div>

          {/* Station information */}
          <div className="p-4 space-y-3">
            {/* Station Name */}
            <div>
              <div className="text-gray-400 text-xs uppercase">Name</div>
              <div className="text-white text-lg font-semibold">
                {(selectedObject.data as any).fullName || 'Station'}
              </div>
            </div>

            {/* Station Type */}
            {(selectedObject.data as any).typeName && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Type</div>
                <div className="text-white">{(selectedObject.data as any).typeName}</div>
              </div>
            )}

            {/* Reprocessing Efficiency */}
            {selectedObject.data.reprocessingEfficiency !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Reprocessing Efficiency</div>
                <div className="text-white">
                  {(selectedObject.data.reprocessingEfficiency * 100).toFixed(1)}%
                </div>
              </div>
            )}

            {/* Reprocessing Station's Take */}
            {selectedObject.data.reprocessingStationsTake !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Station&apos;s Take</div>
                <div className="text-white">
                  {(selectedObject.data.reprocessingStationsTake * 100).toFixed(1)}%
                </div>
              </div>
            )}

            {/* Security Level */}
            {selectedObject.data.security !== undefined && (
              <div>
                <div className="text-gray-400 text-xs uppercase">Security Level</div>
                <div className="text-white">{selectedObject.data.security.toFixed(1)}</div>
              </div>
            )}

            {/* Services */}
            {(selectedObject.data as any).services &&
              (selectedObject.data as any).services.length > 0 && (
                <div>
                  <div className="text-gray-400 text-xs uppercase">Available Services</div>
                  <div className="text-white text-sm space-y-1">
                    {(selectedObject.data as any).services.map((service: string, index: number) => (
                      <div key={index} className="flex items-start">
                        <span className="text-green-400 mr-2">•</span>
                        <span>{service}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { MapDataResponse } from '@/lib/sde-types';

export default function StarMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [mapData, setMapData] = useState<MapDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  const cameraRef = useRef({
    x: 0,
    y: 0,
    zoom: 2,
  });
  const [camera, setCamera] = useState({
    x: 0,
    y: 0,
    zoom: 2,
  });

  const rafId = useRef<number>();
  const renderRequested = useRef(false);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const [colorMode, setColorMode] = useState<'region' | 'security' | 'faction' | 'alliance'>(
    'region'
  );
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const [sovereigntyData, setSovereigntyData] = useState<Record<number, number> | null>(null);
  const [allianceData, setAllianceData] = useState<Record<
    number,
    { alliance_id: number; alliance_name: string }
  > | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [filteredResults, setFilteredResults] = useState<
    Array<{ type: 'system' | 'region'; name: string; id: number }>
  >([]);
  const searchDebounceRef = useRef<NodeJS.Timeout>();

  const [hoveredSystem, setHoveredSystem] = useState<{
    name: string;
    security: number;
    x: number;
    y: number;
    regionName?: string;
    factionName?: string;
    allianceName?: string;
  } | null>(null);

  const systemSecurityRound = useCallback((security: number) => {
    if (security >= 0 && security <= 0.05) {
      return Math.ceil(security * 10) / 10;
    } else {
      return Math.round(security * 10) / 10;
    }
  }, []);

  const getSecurityColor = useCallback(
    (security: number) => {
      const rounded = systemSecurityRound(security);
      if (rounded >= 0.5) {
        const intensity = (rounded - 0.5) / 0.5;
        const hue = 60 + intensity * 180;
        const lightness = 50 - intensity * 20;
        return `hsl(${hue}, 100%, ${lightness}%)`;
      } else if (rounded > 0) {
        const intensity = (rounded - 0.1) / 0.3;
        const saturation = 60 + intensity * 40;
        const lightness = 30 + intensity * 20;
        return `hsl(30, ${saturation}%, ${lightness}%)`;
      } else {
        return `hsl(0, 100%, 40%)`;
      }
    },
    [systemSecurityRound]
  );

  const getRegionColor = useCallback((regionId: number) => {
    const hue = (regionId * 137.508) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }, []);

  const getFactionColor = useCallback((factionId: number | undefined) => {
    if (!factionId) {
      return 'hsl(0, 0%, 30%)';
    }

    const factionColors: Record<number, string> = {
      500001: 'hsl(210, 100%, 50%)',
      500002: 'hsl(0, 100%, 50%)',
      500003: 'hsl(45, 100%, 50%)',
      500004: 'hsl(120, 60%, 45%)',
    };

    return factionColors[factionId] || `hsl(${(factionId * 137.508) % 360}, 70%, 60%)`;
  }, []);

  const getAllianceColor = useCallback((allianceId: number | undefined) => {
    if (!allianceId) {
      return 'hsl(0, 0%, 30%)';
    }

    const hue = (allianceId * 137.508) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }, []);

  const systemMap = useMemo(() => {
    if (!mapData) return new Map();
    return new Map(mapData.systems.map((s) => [s._key, s]));
  }, [mapData]);

  const regionMap = useMemo(() => {
    if (!mapData) return new Map();
    return new Map(mapData.regions.map((r) => [r._key, r]));
  }, [mapData]);

  const bounds = useMemo(() => {
    if (!mapData || mapData.systems.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const system of mapData.systems) {
      const x = system.position2D?.x || system.position.x;
      const y = system.position2D?.y || system.position.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    return { minX, minY, maxX, maxY };
  }, [mapData]);

  const coordinateData = useMemo(() => {
    const padding = 50;
    const scaleX = (dimensions.width - padding * 2) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (dimensions.height - padding * 2) / (bounds.maxY - bounds.minY || 1);
    const scale = Math.min(scaleX, scaleY);

    return {
      ...bounds,
      scale,
      padding,
    };
  }, [bounds, dimensions]);

  const toCanvasX = useCallback(
    (x: number) => (x - coordinateData.minX) * coordinateData.scale + coordinateData.padding,
    [coordinateData]
  );

  const toCanvasY = useCallback(
    (y: number) =>
      dimensions.height -
      ((y - coordinateData.minY) * coordinateData.scale + coordinateData.padding),
    [coordinateData, dimensions.height]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      if (!query.trim() || !mapData) {
        setFilteredResults([]);
        setShowAutocomplete(false);
        return;
      }

      searchDebounceRef.current = setTimeout(() => {
        const lowerQuery = query.toLowerCase();
        const results: Array<{ type: 'system' | 'region'; name: string; id: number }> = [];

        for (const system of mapData.systems) {
          if (system.name.en.toLowerCase().includes(lowerQuery)) {
            results.push({
              type: 'system',
              name: system.name.en,
              id: system._key,
            });
            if (results.length >= 10) break;
          }
        }

        if (results.length < 10) {
          for (const region of mapData.regions) {
            if (region.name.en.toLowerCase().includes(lowerQuery)) {
              results.push({
                type: 'region',
                name: region.name.en,
                id: region._key,
              });
              if (results.length >= 10) break;
            }
          }
        }

        setFilteredResults(results);
        setShowAutocomplete(results.length > 0);
      }, 300);
    },
    [mapData]
  );

  const handleSelectResult = useCallback(
    (result: { type: 'system' | 'region'; name: string; id: number }) => {
      if (!mapData) return;

      if (result.type === 'system') {
        const system = systemMap.get(result.id);
        if (system) {
          const x = system.position2D?.x || system.position.x;
          const y = system.position2D?.y || system.position.y;

          const canvasX = toCanvasX(x);
          const canvasY = toCanvasY(y);

          const zoom = 8;
          const screenCenterX = dimensions.width / 2;
          const screenCenterY = dimensions.height / 2;

          setCamera({
            x: -(canvasX - screenCenterX) * zoom,
            y: -(canvasY - screenCenterY) * zoom,
            zoom: zoom,
          });
        }
      } else {
        const regionSystems = mapData.systems.filter((s) => s.regionID === result.id);
        if (regionSystems.length > 0) {
          let sumX = 0,
            sumY = 0;

          for (const system of regionSystems) {
            sumX += system.position2D?.x || system.position.x;
            sumY += system.position2D?.y || system.position.y;
          }

          const centerX = sumX / regionSystems.length;
          const centerY = sumY / regionSystems.length;

          const canvasX = toCanvasX(centerX);
          const canvasY = toCanvasY(centerY);

          const zoom = 4;
          const screenCenterX = dimensions.width / 2;
          const screenCenterY = dimensions.height / 2;

          setCamera({
            x: -(canvasX - screenCenterX) * zoom,
            y: -(canvasY - screenCenterY) * zoom,
            zoom: zoom,
          });
        }
      }

      setSearchQuery('');
      setShowAutocomplete(false);
      setFilteredResults([]);
    },
    [mapData, systemMap, toCanvasX, toCanvasY, dimensions]
  );

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
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function loadMap() {
      try {
        const response = await fetch('/api/map/data');
        if (!response.ok) throw new Error('Failed to load map data');
        const data = await response.json();
        setMapData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    loadMap();
  }, []);

  useEffect(() => {
    async function loadSovereignty() {
      try {
        const response = await fetch('/api/sovereignty');
        if (!response.ok) throw new Error('Failed to load sovereignty data');
        const data = await response.json();
        setSovereigntyData(data);
      } catch (err) {
        console.error('Error loading sovereignty data:', err);
        setSovereigntyData({});
      }
    }

    if (!sovereigntyData) {
      loadSovereignty();
    }
  }, [sovereigntyData]);

  useEffect(() => {
    async function loadAllianceSovereignty() {
      try {
        const response = await fetch('/api/alliance-sovereignty');
        if (!response.ok) throw new Error('Failed to load alliance sovereignty data');
        const data = await response.json();
        setAllianceData(data);
      } catch (err) {
        console.error('Error loading alliance sovereignty data:', err);
        setAllianceData({});
      }
    }

    if (!allianceData) {
      loadAllianceSovereignty();
    }
  }, [allianceData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cameraInitialized) return;

    let wheelRafId: number | null = null;
    let pendingZoomDelta = 0;
    let lastWheelMouse = { x: 0, y: 0 };

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      pendingZoomDelta += delta;
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
  }, [dimensions, cameraInitialized]);

  useEffect(() => {
    if (!mapData || mapData.systems.length === 0) return;

    const { minX, minY, maxX, maxY, scale, padding } = coordinateData;

    const renderedMinX = padding;
    const renderedMaxX = (maxX - minX) * scale + padding;
    const renderedMinY = dimensions.height - ((maxY - minY) * scale + padding);
    const renderedMaxY = dimensions.height - padding;

    const mapCenterX = (renderedMinX + renderedMaxX) / 2;
    const mapCenterY = (renderedMinY + renderedMaxY) / 2;

    const zoom = 2;
    const screenCenterX = dimensions.width / 2;
    const screenCenterY = dimensions.height / 2;

    const initialCamera = {
      x: -(mapCenterX - screenCenterX) * zoom,
      y: -(mapCenterY - screenCenterY) * zoom,
      zoom: zoom,
    };
    setCamera(initialCamera);
    cameraRef.current = { ...initialCamera };
    setCameraInitialized(true);
  }, [mapData, dimensions, coordinateData]);

  useEffect(() => {
    if (!mapData || !canvasRef.current || !cameraInitialized) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    ctx.save();
    ctx.translate(dimensions.width / 2 + camera.x, dimensions.height / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-dimensions.width / 2, -dimensions.height / 2);

    ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();

    for (const conn of mapData.stargateConnections) {
      const fromSystem = systemMap.get(conn.from);
      const toSystem = systemMap.get(conn.to);

      if (fromSystem && toSystem) {
        const x1 = toCanvasX(fromSystem.position2D?.x || fromSystem.position.x);
        const y1 = toCanvasY(fromSystem.position2D?.y || fromSystem.position.y);
        const x2 = toCanvasX(toSystem.position2D?.x || toSystem.position.x);
        const y2 = toCanvasY(toSystem.position2D?.y || toSystem.position.y);

        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    }
    ctx.stroke();

    for (const system of mapData.systems) {
      const x = toCanvasX(system.position2D?.x || system.position.x);
      const y = toCanvasY(system.position2D?.y || system.position.y);

      let color: string;
      if (colorMode === 'region') {
        color = getRegionColor(system.regionID);
      } else if (colorMode === 'security') {
        color = getSecurityColor(system.securityStatus);
      } else if (colorMode === 'faction') {
        const factionId = sovereigntyData?.[system._key];

        if (factionId) {
          color = getFactionColor(factionId);
        } else {
          color = 'hsl(0, 0%, 30%)';
        }
      } else if (colorMode === 'alliance') {
        const allianceInfo = allianceData?.[system._key];

        if (allianceInfo) {
          color = getAllianceColor(allianceInfo.alliance_id);
        } else {
          color = 'hsl(0, 0%, 30%)';
        }
      } else {
        color = getRegionColor(system.regionID);
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    const centerMap = new Map<
      number,
      { x: number; y: number; count: number; name: string; allianceId?: number }
    >();

    if (colorMode === 'faction' && sovereigntyData) {
      const factionNames: Record<number, string> = {
        500001: 'Caldari State',
        500002: 'Minmatar Republic',
        500003: 'Amarr Empire',
        500004: 'Gallente Federation',
      };

      for (const system of mapData.systems) {
        const factionId = sovereigntyData[system._key];
        if (!factionId) continue;

        const x = toCanvasX(system.position2D?.x || system.position.x);
        const y = toCanvasY(system.position2D?.y || system.position.y);

        if (!centerMap.has(factionId)) {
          centerMap.set(factionId, {
            x,
            y,
            count: 1,
            name: factionNames[factionId] || `Faction ${factionId}`,
          });
        } else {
          const center = centerMap.get(factionId)!;
          center.x += x;
          center.y += y;
          center.count += 1;
        }
      }
    } else if (colorMode === 'alliance' && allianceData) {
      const allianceSystems = new Map<number, Array<{ x: number; y: number; name: string }>>();

      for (const system of mapData.systems) {
        const allianceInfo = allianceData[system._key];
        if (!allianceInfo) continue;

        const x = toCanvasX(system.position2D?.x || system.position.x);
        const y = toCanvasY(system.position2D?.y || system.position.y);

        if (!allianceSystems.has(allianceInfo.alliance_id)) {
          allianceSystems.set(allianceInfo.alliance_id, []);
        }
        allianceSystems.get(allianceInfo.alliance_id)!.push({
          x,
          y,
          name: allianceInfo.alliance_name,
        });
      }

      let clusterIndex = 0;
      const proximityThreshold = 150;

      for (const [allianceId, systems] of allianceSystems) {
        const clusters: Array<Array<{ x: number; y: number }>> = [];
        const visited = new Set<number>();

        for (let i = 0; i < systems.length; i++) {
          if (visited.has(i)) continue;

          const cluster: Array<{ x: number; y: number }> = [systems[i]];
          visited.add(i);

          for (let j = i + 1; j < systems.length; j++) {
            if (visited.has(j)) continue;

            const isNearby = cluster.some((clusterSystem) => {
              const dx = clusterSystem.x - systems[j].x;
              const dy = clusterSystem.y - systems[j].y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              return distance < proximityThreshold;
            });

            if (isNearby) {
              cluster.push(systems[j]);
              visited.add(j);
              j = i;
            }
          }

          clusters.push(cluster);
        }

        for (const cluster of clusters) {
          const centerX = cluster.reduce((sum, s) => sum + s.x, 0) / cluster.length;
          const centerY = cluster.reduce((sum, s) => sum + s.y, 0) / cluster.length;

          centerMap.set(clusterIndex++, {
            x: centerX * cluster.length,
            y: centerY * cluster.length,
            count: cluster.length,
            name: systems[0].name,
            allianceId: allianceId,
          });
        }
      }
    } else {
      for (const system of mapData.systems) {
        const x = toCanvasX(system.position2D?.x || system.position.x);
        const y = toCanvasY(system.position2D?.y || system.position.y);

        if (!centerMap.has(system.regionID)) {
          const region = mapData.regions.find((r) => r._key === system.regionID);
          centerMap.set(system.regionID, {
            x,
            y,
            count: 1,
            name: region?.name.en || 'Unknown',
          });
        } else {
          const center = centerMap.get(system.regionID)!;
          center.x += x;
          center.y += y;
          center.count += 1;
        }
      }
    }

    const maxScreenSize = 16;
    const minScreenSize = 8;
    const screenSize = Math.max(minScreenSize, maxScreenSize - Math.log(camera.zoom) * 8);

    const fontSize = screenSize / camera.zoom;

    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const opacity = camera.zoom < 5 ? 1 : Math.max(0.2, 1 - (camera.zoom - 5) / 10);

    for (const [id, data] of centerMap) {
      const centerX = data.x / data.count;
      const centerY = data.y / data.count;

      const text = data.name;
      const metrics = ctx.measureText(text);
      const padding = Math.max(1.5, 4 / camera.zoom);

      ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * opacity})`;
      ctx.fillRect(
        centerX - metrics.width / 2 - padding,
        centerY - fontSize / 2 - padding,
        metrics.width + padding * 2,
        fontSize + padding * 2
      );

      let color: string;
      if (colorMode === 'faction') {
        color = getFactionColor(id);
      } else if (colorMode === 'alliance') {
        color = getAllianceColor(data.allianceId);
      } else {
        color = getRegionColor(id);
      }

      const rgbMatch = color.match(/hsl\(([\d.]+),\s*(\d+)%,\s*(\d+)%\)/);
      if (rgbMatch) {
        ctx.fillStyle = `hsla(${rgbMatch[1]}, ${rgbMatch[2]}%, ${rgbMatch[3]}%, ${opacity})`;
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillText(text, centerX, centerY);
    }

    ctx.restore();
  }, [
    mapData,
    camera,
    dimensions,
    systemMap,
    toCanvasX,
    toCanvasY,
    getRegionColor,
    getSecurityColor,
    getFactionColor,
    getAllianceColor,
    colorMode,
    cameraInitialized,
    sovereigntyData,
    allianceData,
  ]);

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

    if (!mapData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const cam = cameraRef.current;
    const worldX = (mouseX - dimensions.width / 2 - cam.x) / cam.zoom + dimensions.width / 2;
    const worldY = (mouseY - dimensions.height / 2 - cam.y) / cam.zoom + dimensions.height / 2;

    const hoverRadius = 10 / cam.zoom;
    let nearestSystem: {
      name: string;
      security: number;
      x: number;
      y: number;
      regionName?: string;
      factionName?: string;
      allianceName?: string;
    } | null = null;
    let nearestDistance = hoverRadius;
    let nearestSystemData: (typeof mapData.systems)[0] | null = null;

    for (const system of mapData.systems) {
      const systemX = toCanvasX(system.position2D?.x || system.position.x);
      const systemY = toCanvasY(system.position2D?.y || system.position.y);

      const dx = worldX - systemX;
      const dy = worldY - systemY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSystemData = system;
      }
    }

    if (nearestSystemData) {
      const region = regionMap.get(nearestSystemData.regionID);
      const regionName = region?.name.en;

      let factionName: string | undefined;
      if (sovereigntyData) {
        const factionId = sovereigntyData[nearestSystemData._key];
        if (factionId) {
          const factionNames: Record<number, string> = {
            500001: 'Caldari State',
            500002: 'Minmatar Republic',
            500003: 'Amarr Empire',
            500004: 'Gallente Federation',
          };
          factionName = factionNames[factionId] || `Faction ${factionId}`;
        }
      }

      let allianceName: string | undefined;
      if (allianceData) {
        const allianceInfo = allianceData[nearestSystemData._key];
        if (allianceInfo) {
          allianceName = allianceInfo.alliance_name;
        }
      }

      nearestSystem = {
        name: nearestSystemData.name.en,
        security: nearestSystemData.securityStatus,
        x: mouseX,
        y: mouseY,
        regionName,
        factionName,
        allianceName,
      };
    }

    if (nearestSystem?.name !== hoveredSystem?.name) {
      setHoveredSystem(nearestSystem);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setCamera({ ...cameraRef.current });
    }
    setIsDragging(false);

    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5 && mapData && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const cam = cameraRef.current;
      const worldX = (mouseX - dimensions.width / 2 - cam.x) / cam.zoom + dimensions.width / 2;
      const worldY = (mouseY - dimensions.height / 2 - cam.y) / cam.zoom + dimensions.height / 2;

      const clickRadius = 10 / cam.zoom;

      for (const system of mapData.systems) {
        const systemX = toCanvasX(system.position2D?.x || system.position.x);
        const systemY = toCanvasY(system.position2D?.y || system.position.y);

        const dx = worldX - systemX;
        const dy = worldY - systemY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < clickRadius) {
          router.push(`/system/${system._key}`);
          break;
        }
      }
    }

    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredSystem(null);
  };

  if (loading || !cameraInitialized) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <p className="text-white">Loading map data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
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

      {hoveredSystem && (
        <div
          className="absolute pointer-events-none bg-gray-900 border border-gray-700 rounded px-3 py-2 shadow-lg z-20"
          style={{
            left: `${hoveredSystem.x + 15}px`,
            top: `${hoveredSystem.y + 15}px`,
          }}
        >
          <div className="text-white font-semibold text-sm">{hoveredSystem.name}</div>
          <div className="text-gray-400 text-xs">
            Security: {systemSecurityRound(hoveredSystem.security).toFixed(1)}
          </div>
          {hoveredSystem.regionName && (
            <div className="text-blue-400 text-xs mt-1">Region: {hoveredSystem.regionName}</div>
          )}
          {hoveredSystem.factionName && (
            <div className="text-purple-400 text-xs mt-1">Faction: {hoveredSystem.factionName}</div>
          )}
          {hoveredSystem.allianceName && (
            <div className="text-green-400 text-xs mt-1">
              Sovereignty: {hoveredSystem.allianceName}
            </div>
          )}
        </div>
      )}

      <div className="absolute top-4 left-4 w-80">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={() => {
              if (filteredResults.length > 0) setShowAutocomplete(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowAutocomplete(false), 200);
            }}
            placeholder="Search systems or regions..."
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          {showAutocomplete && filteredResults.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-96 overflow-y-auto z-10">
              {filteredResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleSelectResult(result)}
                  className="w-full px-4 py-2 text-left hover:bg-gray-800 transition-colors flex items-center justify-between"
                >
                  <span className="text-white text-sm">{result.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      result.type === 'system'
                        ? 'bg-blue-900 text-blue-300'
                        : 'bg-purple-900 text-purple-300'
                    }`}
                  >
                    {result.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-gray-300 text-sm font-medium">Color by:</span>
          <button
            onClick={() => setColorMode('region')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              colorMode === 'region'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Region
          </button>
          <button
            onClick={() => setColorMode('security')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              colorMode === 'security'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Security
          </button>
          <button
            onClick={() => setColorMode('faction')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              colorMode === 'faction'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Faction Warfare
          </button>
          <button
            onClick={() => setColorMode('alliance')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              colorMode === 'alliance'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Alliance Sovereignty
          </button>
        </div>
      </div>
    </div>
  );
}

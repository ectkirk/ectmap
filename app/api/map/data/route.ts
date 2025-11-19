import { NextResponse } from 'next/server';
import { loadAllRecords } from '@/lib/sde-loader';
import type {
  Region,
  Constellation,
  SolarSystem,
  Stargate,
  MapDataResponse,
} from '@/lib/sde-types';

const ALLOWED_REGION_IDS = new Set([
  10000054, // Aridia
  10000069, // Black Rise
  10000055, // Branch
  10000007, // Cache
  10000014, // Catch
  10000051, // Cloud Ring
  10000053, // Cobalt Edge
  10000012, // Curse
  10000035, // Deklein
  10000060, // Delve
  10000001, // Derelik
  10000005, // Detorid
  10000036, // Devoid
  10000043, // Domain
  10000039, // Esoteria
  10000064, // Essence
  10000027, // Etherium Reach
  10000037, // Everyshore
  10000046, // Fade
  10000056, // Feythabolis
  10000058, // Fountain
  10000029, // Geminate
  10000067, // Genesis
  10000011, // Great Wildlands
  10000030, // Heimatar
  10000025, // Immensea
  10000031, // Impass
  10000009, // Insmother
  10000052, // Kador
  10000049, // Khanid
  10000065, // Kor-Azor
  10000016, // Lonetrek
  10000013, // Malpais
  10000042, // Metropolis
  10000028, // Molden Heath
  10000040, // Oasa
  10000062, // Omist
  10000021, // Outer Passage
  10000057, // Outer Ring
  10000059, // Paragon Soul
  10000063, // Period Basis
  10000066, // Perrigen Falls
  10000048, // Placid
  10000070, // Pochven
  10000047, // Providence
  10000023, // Pure Blind
  10000050, // Querious
  10000008, // Scalding Pass
  10000032, // Sinq Laison
  10000044, // Solitude
  10000022, // Stain
  10000041, // Syndicate
  10000020, // Tash-Murkon
  10000045, // Tenal
  10000061, // Tenerifis
  10000038, // The Bleak Lands
  10000033, // The Citadel
  10000002, // The Forge
  10000034, // The Kalevala Expanse
  10000018, // The Spire
  10000010, // Tribute
  10000003, // Vale of the Silent
  10000015, // Venal
  10000068, // Verge Vendor
  10000006, // Wicked Creek
  10001000, // Yasna Zakh
  10000004, // UUA-F4
  10000017, // J7HZ-F
  10000019, // A821-A
]);

let cachedMapData: MapDataResponse | null = null;

export async function GET() {
  try {
    if (cachedMapData) {
      return NextResponse.json(cachedMapData, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    const [regionsMap, constellationsMap] = await Promise.all([
      loadAllRecords<Region>('mapRegions.jsonl', (r) => ALLOWED_REGION_IDS.has(r._key)),
      loadAllRecords<Constellation>('mapConstellations.jsonl', (c) =>
        ALLOWED_REGION_IDS.has(c.regionID)
      ),
    ]);

    const allowedConstellationIds = new Set(
      Array.from(constellationsMap.values()).map((c) => c._key)
    );

    const systemsMap = await loadAllRecords<SolarSystem>('mapSolarSystems.jsonl', (s) =>
      allowedConstellationIds.has(s.constellationID)
    );

    const allowedSystemIds = new Set(Array.from(systemsMap.values()).map((s) => s._key));

    const stargatesMap = await loadAllRecords<Stargate>('mapStargates.jsonl', (sg) =>
      allowedSystemIds.has(sg.solarSystemID)
    );

    const regions = Array.from(regionsMap.values());
    const constellations = Array.from(constellationsMap.values());
    const systems = Array.from(systemsMap.values());

    const stargates = Array.from(stargatesMap.values());

    const connectionSet = new Set<string>();
    const stargateConnections: Array<{ from: number; to: number }> = [];

    for (const gate of stargates) {
      const from = gate.solarSystemID;
      const to = gate.destination.solarSystemID;

      if (!allowedSystemIds.has(from) || !allowedSystemIds.has(to)) {
        continue;
      }

      const key = from < to ? `${from}-${to}` : `${to}-${from}`;

      if (!connectionSet.has(key)) {
        connectionSet.add(key);
        stargateConnections.push({ from, to });
      }
    }

    cachedMapData = {
      regions,
      constellations,
      systems,
      stargateConnections,
    };

    return NextResponse.json(cachedMapData, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('Error loading map data:', error);
    return NextResponse.json({ error: 'Failed to load map data' }, { status: 500 });
  }
}

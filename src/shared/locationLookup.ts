import { ACJU_DISTRICTS, ACJU_ZONES } from './acjuSeed.ts';
import type { AcjuDistrict, AcjuZone, LocationResolution } from './types.ts';

// Approximate geographic bounding box for Sri Lanka
const SRI_LANKA_BOUNDS = {
  minLat: 5.75,
  maxLat: 9.95,
  minLng: 79.4,
  maxLng: 82.0,
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPointInPolygon(
  lng: number,
  lat: number,
  polygon: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isWithinSriLanka(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SRI_LANKA_BOUNDS.minLat &&
    lat <= SRI_LANKA_BOUNDS.maxLat &&
    lng >= SRI_LANKA_BOUNDS.minLng &&
    lng <= SRI_LANKA_BOUNDS.maxLng
  );
}

/**
 * Resolves GPS coordinates against the normalized ACJU district & special-area dataset.
 * Area overrides (Gampola -> Zone 7, Nallur -> Zone 2, Padiyatalawa/Dehiaththekandiya -> Zone 10)
 * are evaluated before broader district polygons.
 */
export function resolveLocationFromCoordinates(
  lat: number,
  lng: number,
  districts: readonly AcjuDistrict[] = ACJU_DISTRICTS,
  zones: readonly AcjuZone[] = ACJU_ZONES
): LocationResolution {
  if (!isWithinSriLanka(lat, lng)) {
    return {
      matched: false,
      district: null,
      zone: null,
      detectionMethod: 'gps',
      confidence: 'out_of_bounds',
      message:
        'Detected coordinates appear outside Sri Lanka. Please select your Sri Lankan district or town manually.',
    };
  }

  // Sort overrides first so Gampola, Nallur, Padiyatalawa, Dehiaththekandiya match before parent district
  const ordered = [...districts].sort((a, b) => Number(b.isAreaOverride) - Number(a.isAreaOverride));

  for (const d of ordered) {
    if (d.polygon && isPointInPolygon(lng, lat, d.polygon)) {
      const zone = zones.find((z) => z.id === d.zoneId) ?? null;
      const dist = haversineKm(lat, lng, d.centerLat, d.centerLng);
      return {
        matched: true,
        district: d,
        zone,
        detectionMethod: 'gps',
        confidence: 'polygon_exact',
        distanceKm: Math.round(dist * 10) / 10,
        message: `Detected ${d.name} (${d.parentDistrict} district) → ${zone?.name ?? `Zone ${d.zoneId}`}.`,
      };
    }
  }

  // Fallback to nearest centroid within reasonable boundary radius
  let nearest: AcjuDistrict | null = null;
  let nearestKm = Infinity;
  for (const d of ordered) {
    const dist = haversineKm(lat, lng, d.centerLat, d.centerLng);
    if (dist < nearestKm) {
      nearestKm = dist;
      nearest = d;
    }
  }

  if (nearest && nearestKm <= 75) {
    const zone = zones.find((z) => z.id === nearest!.zoneId) ?? null;
    return {
      matched: true,
      district: nearest,
      zone,
      detectionMethod: 'gps',
      confidence: 'nearest_boundary',
      distanceKm: Math.round(nearestKm * 10) / 10,
      message: `Approximate match: ${nearest.name} (${Math.round(nearestKm)} km from centre) → ${zone?.name ?? `Zone ${nearest.zoneId}`}. Please confirm or adjust.`,
    };
  }

  return {
    matched: false,
    district: null,
    zone: null,
    detectionMethod: 'gps',
    confidence: 'out_of_bounds',
    message: 'Could not confidently map coordinates to an ACJU zone. Please choose your area manually.',
  };
}

/**
 * Resolves a manual district/area ID or search term (e.g. "Gampola", "Nallur", "Padiyatalawa")
 * against the ACJU district/area table.
 */
export function resolveLocationManually(
  queryOrId: string,
  districts: readonly AcjuDistrict[] = ACJU_DISTRICTS,
  zones: readonly AcjuZone[] = ACJU_ZONES
): LocationResolution {
  const normalized = queryOrId.trim().toLowerCase();
  if (!normalized) {
    return {
      matched: false,
      district: null,
      zone: null,
      detectionMethod: 'manual',
      confidence: 'out_of_bounds',
      message: 'Please choose a district or town.',
    };
  }

  const exact =
    districts.find((d) => d.id.toLowerCase() === normalized) ||
    districts.find((d) => d.name.toLowerCase() === normalized) ||
    districts.find((d) => d.searchAliases.some((a) => a.toLowerCase() === normalized)) ||
    districts.find(
      (d) =>
        d.name.toLowerCase().includes(normalized) ||
        d.searchAliases.some((a) => a.toLowerCase().includes(normalized))
    );

  if (!exact) {
    return {
      matched: false,
      district: null,
      zone: null,
      detectionMethod: 'manual',
      confidence: 'out_of_bounds',
      message: `No matching Sri Lankan district or area found for "${queryOrId}".`,
    };
  }

  const zone = zones.find((z) => z.id === exact.zoneId) ?? null;
  return {
    matched: true,
    district: exact,
    zone,
    detectionMethod: 'manual',
    confidence: 'manual_selection',
    message: `Selected ${exact.name} (${exact.parentDistrict}) → ${zone?.name ?? `Zone ${exact.zoneId}`}.`,
  };
}

import type { AcjuDistrict, AcjuZone, ReferencePrayerRecord } from './types';

export const ACJU_ZONES: readonly AcjuZone[] = [
  { id: 1, zoneCode: 'ZONE_01', name: 'Zone 1 — Western Coast', officialDescription: 'Colombo, Gampaha, Kalutara' },
  { id: 2, zoneCode: 'ZONE_02', name: 'Zone 2 — Jaffna & Nallur', officialDescription: 'Jaffna, Nallur' },
  { id: 3, zoneCode: 'ZONE_03', name: 'Zone 3 — Northern Vanni', officialDescription: 'Mullaitivu (except Nallur), Kilinochchi, Vavuniya' },
  { id: 4, zoneCode: 'ZONE_04', name: 'Zone 4 — North-West Coast', officialDescription: 'Mannar, Puttalam' },
  { id: 5, zoneCode: 'ZONE_05', name: 'Zone 5 — North Central', officialDescription: 'Anuradhapura, Polonnaruwa' },
  { id: 6, zoneCode: 'ZONE_06', name: 'Zone 6 — Wayamba Interior', officialDescription: 'Kurunegala' },
  { id: 7, zoneCode: 'ZONE_07', name: 'Zone 7 — Central Highlands', officialDescription: 'Kandy, Matale, Nuwara Eliya (including Gampola)' },
  { id: 8, zoneCode: 'ZONE_08', name: 'Zone 8 — Eastern Coast', officialDescription: 'Batticaloa, Ampara' },
  { id: 9, zoneCode: 'ZONE_09', name: 'Zone 9 — Trincomalee', officialDescription: 'Trincomalee' },
  { id: 10, zoneCode: 'ZONE_10', name: 'Zone 10 — Uva & Mahaweli East', officialDescription: 'Badulla, Monaragala, Padiyatalawa, Dehiaththekandiya' },
  { id: 11, zoneCode: 'ZONE_11', name: 'Zone 11 — Sabaragamuwa', officialDescription: 'Ratnapura, Kegalle' },
  { id: 12, zoneCode: 'ZONE_12', name: 'Zone 12 — Southern Coast', officialDescription: 'Galle, Matara' },
  { id: 13, zoneCode: 'ZONE_13', name: 'Zone 13 — Hambantota', officialDescription: 'Hambantota' },
] as const;

/**
 * Normalized district and special-area mapping for all 13 ACJU groups.
 * Polygons use [lng, lat] coordinates for point-in-polygon detection;
 * override areas (Gampola, Nallur, Padiyatalawa, Dehiaththekandiya) are checked first.
 */
export const ACJU_DISTRICTS: readonly AcjuDistrict[] = [
  // Zone 1: Colombo, Gampaha, Kalutara
  {
    id: 'colombo',
    name: 'Colombo',
    parentDistrict: 'Colombo',
    zoneId: 1,
    isAreaOverride: false,
    centerLat: 6.9271,
    centerLng: 79.8612,
    radiusKm: 24,
    polygon: [
      [79.82, 6.99], [80.12, 6.98], [80.18, 6.82], [79.90, 6.77], [79.84, 6.86],
    ],
    searchAliases: ['Dehiwala', 'Mount Lavinia', 'Moratuwa', 'Maharagama', 'Kotte', 'Kolonnawa', 'Malwana', 'Wellawatte', 'Maradana'],
  },
  {
    id: 'gampaha',
    name: 'Gampaha',
    parentDistrict: 'Gampaha',
    zoneId: 1,
    isAreaOverride: false,
    centerLat: 7.0873,
    centerLng: 79.999,
    radiusKm: 28,
    polygon: [
      [79.80, 7.28], [80.18, 7.28], [80.18, 6.98], [79.82, 6.99],
    ],
    searchAliases: ['Negombo', 'Wattala', 'Ja-Ela', 'Kelaniya', 'Kadawatha', 'Minuwangoda', 'Thihariya'],
  },
  {
    id: 'kalutara',
    name: 'Kalutara',
    parentDistrict: 'Kalutara',
    zoneId: 1,
    isAreaOverride: false,
    centerLat: 6.5854,
    centerLng: 79.9607,
    radiusKm: 30,
    polygon: [
      [79.88, 6.77], [80.28, 6.75], [80.26, 6.38], [79.96, 6.40],
    ],
    searchAliases: ['Beruwala', 'Aluthgama', 'Panadura', 'Horana', 'Dharga Town'],
  },

  // Zone 2: Jaffna, Nallur (Nallur checked as override)
  {
    id: 'nallur',
    name: 'Nallur',
    parentDistrict: 'Jaffna',
    zoneId: 2,
    isAreaOverride: true,
    centerLat: 9.6745,
    centerLng: 80.0294,
    radiusKm: 8,
    polygon: [
      [80.01, 9.70], [80.06, 9.70], [80.06, 9.65], [80.01, 9.65],
    ],
    searchAliases: ['Nallur Town', 'Nallur Jaffna'],
  },
  {
    id: 'jaffna',
    name: 'Jaffna',
    parentDistrict: 'Jaffna',
    zoneId: 2,
    isAreaOverride: false,
    centerLat: 9.6615,
    centerLng: 80.0255,
    radiusKm: 25,
    polygon: [
      [79.80, 9.85], [80.32, 9.83], [80.30, 9.52], [79.85, 9.55],
    ],
    searchAliases: ['Chavakachcheri', 'Point Pedro', 'Kayts'],
  },

  // Zone 3: Mullaitivu (except Nallur), Kilinochchi, Vavuniya
  {
    id: 'mullaitivu',
    name: 'Mullaitivu',
    parentDistrict: 'Mullaitivu',
    zoneId: 3,
    isAreaOverride: false,
    centerLat: 9.2671,
    centerLng: 80.8142,
    radiusKm: 34,
    polygon: [
      [80.48, 9.50], [81.05, 9.40], [81.02, 8.95], [80.50, 8.95],
    ],
    searchAliases: ['Puthukkudiyiruppu', 'Oddusuddan', 'Mulliyawalai'],
  },
  {
    id: 'kilinochchi',
    name: 'Kilinochchi',
    parentDistrict: 'Kilinochchi',
    zoneId: 3,
    isAreaOverride: false,
    centerLat: 9.3803,
    centerLng: 80.377,
    radiusKm: 30,
    polygon: [
      [80.05, 9.55], [80.52, 9.55], [80.52, 9.18], [80.05, 9.18],
    ],
    searchAliases: ['Paranthan', 'Pallai', 'Poonakary'],
  },
  {
    id: 'vavuniya',
    name: 'Vavuniya',
    parentDistrict: 'Vavuniya',
    zoneId: 3,
    isAreaOverride: false,
    centerLat: 8.7542,
    centerLng: 80.4982,
    radiusKm: 32,
    polygon: [
      [80.22, 9.02], [80.82, 9.02], [80.82, 8.58], [80.22, 8.58],
    ],
    searchAliases: ['Cheddikulam', 'Nedunkeni'],
  },

  // Zone 4: Mannar, Puttalam
  {
    id: 'mannar',
    name: 'Mannar',
    parentDistrict: 'Mannar',
    zoneId: 4,
    isAreaOverride: false,
    centerLat: 8.981,
    centerLng: 79.9044,
    radiusKm: 34,
    polygon: [
      [79.70, 9.18], [80.24, 9.15], [80.24, 8.68], [79.80, 8.68],
    ],
    searchAliases: ['Murunkan', 'Madhu', 'Erukkalampiddy'],
  },
  {
    id: 'puttalam',
    name: 'Puttalam',
    parentDistrict: 'Puttalam',
    zoneId: 4,
    isAreaOverride: false,
    centerLat: 8.0362,
    centerLng: 79.8283,
    radiusKm: 40,
    polygon: [
      [79.68, 8.60], [80.12, 8.60], [80.06, 7.30], [79.75, 7.30],
    ],
    searchAliases: ['Chilaw', 'Marawila', 'Kalpitiya', 'Wennappuwa', 'Norochcholai'],
  },

  // Zone 5: Anuradhapura, Polonnaruwa
  {
    id: 'anuradhapura',
    name: 'Anuradhapura',
    parentDistrict: 'Anuradhapura',
    zoneId: 5,
    isAreaOverride: false,
    centerLat: 8.3114,
    centerLng: 80.4037,
    radiusKm: 48,
    polygon: [
      [80.08, 8.75], [80.88, 8.75], [80.85, 7.88], [80.10, 7.88],
    ],
    searchAliases: ['Kekirawa', 'Medawachchiya', 'Thambuttegama', 'Mihintale'],
  },
  {
    id: 'polonnaruwa',
    name: 'Polonnaruwa',
    parentDistrict: 'Polonnaruwa',
    zoneId: 5,
    isAreaOverride: false,
    centerLat: 7.9403,
    centerLng: 81.0188,
    radiusKm: 42,
    polygon: [
      [80.78, 8.32], [81.32, 8.32], [81.28, 7.72], [80.78, 7.72],
    ],
    searchAliases: ['Kaduruwela', 'Hingurakgoda', 'Medirigiriya', 'Sungawila'],
  },

  // Zone 6: Kurunegala
  {
    id: 'kurunegala',
    name: 'Kurunegala',
    parentDistrict: 'Kurunegala',
    zoneId: 6,
    isAreaOverride: false,
    centerLat: 7.4863,
    centerLng: 80.3647,
    radiusKm: 45,
    polygon: [
      [79.96, 8.05], [80.58, 8.05], [80.52, 7.26], [79.95, 7.26],
    ],
    searchAliases: ['Kuliyapitiya', 'Narammala', 'Mawathagama', 'Nikaweratiya', 'Polgahawela'],
  },

  // Zone 7: Kandy, Matale, Nuwara Eliya — Gampola explicitly maps to Zone 7!
  {
    id: 'gampola',
    name: 'Gampola',
    parentDistrict: 'Kandy',
    zoneId: 7,
    isAreaOverride: true,
    centerLat: 7.1643,
    centerLng: 80.5696,
    radiusKm: 12,
    polygon: [
      [80.49, 7.23], [80.65, 7.23], [80.65, 7.08], [80.49, 7.08],
    ],
    searchAliases: ['Gampola Town', 'Ulapane', 'Nawalapitiya', 'Pussellawa', 'Kahatapitiya'],
  },
  {
    id: 'kandy',
    name: 'Kandy',
    parentDistrict: 'Kandy',
    zoneId: 7,
    isAreaOverride: false,
    centerLat: 7.2906,
    centerLng: 80.6337,
    radiusKm: 28,
    polygon: [
      [80.45, 7.45], [80.98, 7.45], [80.98, 7.05], [80.45, 7.05],
    ],
    searchAliases: ['Peradeniya', 'Katugastota', 'Akurana', 'Kundasale', 'Gelioya', 'Madawala'],
  },
  {
    id: 'matale',
    name: 'Matale',
    parentDistrict: 'Matale',
    zoneId: 7,
    isAreaOverride: false,
    centerLat: 7.4675,
    centerLng: 80.6234,
    radiusKm: 32,
    polygon: [
      [80.48, 7.98], [80.95, 7.98], [80.95, 7.44], [80.48, 7.44],
    ],
    searchAliases: ['Dambulla', 'Galewela', 'Ukuwela', 'Rattota'],
  },
  {
    id: 'nuwara-eliya',
    name: 'Nuwara Eliya',
    parentDistrict: 'Nuwara Eliya',
    zoneId: 7,
    isAreaOverride: false,
    centerLat: 6.9497,
    centerLng: 80.7891,
    radiusKm: 32,
    polygon: [
      [80.48, 7.08], [80.96, 7.08], [80.96, 6.72], [80.48, 6.72],
    ],
    searchAliases: ['Hatton', 'Talawakelle', 'Maskeliya', 'Ragala'],
  },

  // Zone 10 Special Area Overrides inside Ampara/Mahaweli East (checked BEFORE Ampara Zone 8)
  {
    id: 'padiyatalawa',
    name: 'Padiyatalawa',
    parentDistrict: 'Ampara',
    zoneId: 10,
    isAreaOverride: true,
    centerLat: 7.3867,
    centerLng: 81.1965,
    radiusKm: 16,
    polygon: [
      [81.10, 7.50], [81.32, 7.50], [81.32, 7.27], [81.10, 7.27],
    ],
    searchAliases: ['Padiyatalawa Town', 'Mahaoya'],
  },
  {
    id: 'dehiaththekandiya',
    name: 'Dehiaththekandiya',
    parentDistrict: 'Ampara',
    zoneId: 10,
    isAreaOverride: true,
    centerLat: 7.6716,
    centerLng: 81.0448,
    radiusKm: 16,
    polygon: [
      [80.95, 7.78], [81.20, 7.78], [81.20, 7.52], [80.95, 7.52],
    ],
    searchAliases: ['Dehiattakandiya', 'Aralaganwila Border'],
  },

  // Zone 8: Batticaloa, Ampara
  {
    id: 'batticaloa',
    name: 'Batticaloa',
    parentDistrict: 'Batticaloa',
    zoneId: 8,
    isAreaOverride: false,
    centerLat: 7.731,
    centerLng: 81.6747,
    radiusKm: 36,
    polygon: [
      [81.32, 8.20], [81.86, 8.20], [81.86, 7.52], [81.32, 7.52],
    ],
    searchAliases: ['Kattankudy', 'Eravur', 'Valaichchenai', 'Oddamavadi', 'Kathankudy'],
  },
  {
    id: 'ampara',
    name: 'Ampara',
    parentDistrict: 'Ampara',
    zoneId: 8,
    isAreaOverride: false,
    centerLat: 7.2975,
    centerLng: 81.6724,
    radiusKm: 38,
    polygon: [
      [81.32, 7.52], [81.90, 7.52], [81.90, 6.70], [81.32, 6.70],
    ],
    searchAliases: ['Kalmunai', 'Sainthamaruthu', 'Sammanthurai', 'Akkaraipattu', 'Pottuvil', 'Nintavur'],
  },

  // Zone 9: Trincomalee
  {
    id: 'trincomalee',
    name: 'Trincomalee',
    parentDistrict: 'Trincomalee',
    zoneId: 9,
    isAreaOverride: false,
    centerLat: 8.5874,
    centerLng: 81.2152,
    radiusKm: 36,
    polygon: [
      [80.85, 8.95], [81.48, 8.95], [81.48, 8.22], [80.85, 8.22],
    ],
    searchAliases: ['Kinniya', 'Mutur', 'Kantale', 'Kuchchaveli', 'Thoppur'],
  },

  // Zone 10: Badulla, Monaragala
  {
    id: 'badulla',
    name: 'Badulla',
    parentDistrict: 'Badulla',
    zoneId: 10,
    isAreaOverride: false,
    centerLat: 6.9934,
    centerLng: 81.055,
    radiusKm: 34,
    polygon: [
      [80.88, 7.42], [81.22, 7.42], [81.22, 6.68], [80.88, 6.68],
    ],
    searchAliases: ['Bandarawela', 'Welimada', 'Mahiyanganaya', 'Haputale'],
  },
  {
    id: 'monaragala',
    name: 'Monaragala',
    parentDistrict: 'Monaragala',
    zoneId: 10,
    isAreaOverride: false,
    centerLat: 6.8728,
    centerLng: 81.3507,
    radiusKm: 42,
    polygon: [
      [81.10, 7.25], [81.58, 7.25], [81.58, 6.32], [81.10, 6.32],
    ],
    searchAliases: ['Wellawaya', 'Bibile', 'Buttala', 'Kataragama'],
  },

  // Zone 11: Ratnapura, Kegalle
  {
    id: 'ratnapura',
    name: 'Ratnapura',
    parentDistrict: 'Ratnapura',
    zoneId: 11,
    isAreaOverride: false,
    centerLat: 6.6828,
    centerLng: 80.3992,
    radiusKm: 40,
    polygon: [
      [80.18, 6.90], [80.92, 6.90], [80.92, 6.32], [80.18, 6.32],
    ],
    searchAliases: ['Balangoda', 'Embilipitiya', 'Pelmadulla', 'Eheliyagoda', 'Kahawatta'],
  },
  {
    id: 'kegalle',
    name: 'Kegalle',
    parentDistrict: 'Kegalle',
    zoneId: 11,
    isAreaOverride: false,
    centerLat: 7.2513,
    centerLng: 80.3464,
    radiusKm: 30,
    polygon: [
      [80.15, 7.38], [80.52, 7.38], [80.52, 6.92], [80.15, 6.92],
    ],
    searchAliases: ['Mawanella', 'Warakapola', 'Rambukkana', 'Ruwanwella', 'Hemmathagama'],
  },

  // Zone 12: Galle, Matara
  {
    id: 'galle',
    name: 'Galle',
    parentDistrict: 'Galle',
    zoneId: 12,
    isAreaOverride: false,
    centerLat: 6.0535,
    centerLng: 80.221,
    radiusKm: 32,
    polygon: [
      [79.98, 6.40], [80.45, 6.40], [80.45, 5.95], [79.98, 5.95],
    ],
    searchAliases: ['Ambalangoda', 'Hikkaduwa', 'Elpitiya', 'Karapitiya', 'Gintota'],
  },
  {
    id: 'matara',
    name: 'Matara',
    parentDistrict: 'Matara',
    zoneId: 12,
    isAreaOverride: false,
    centerLat: 5.9549,
    centerLng: 80.555,
    radiusKm: 30,
    polygon: [
      [80.40, 6.32], [80.78, 6.32], [80.78, 5.90], [80.40, 5.90],
    ],
    searchAliases: ['Weligama', 'Akuressa', 'Dikwella', 'Hakmana'],
  },

  // Zone 13: Hambantota
  {
    id: 'hambantota',
    name: 'Hambantota',
    parentDistrict: 'Hambantota',
    zoneId: 13,
    isAreaOverride: false,
    centerLat: 6.1241,
    centerLng: 81.1185,
    radiusKm: 42,
    polygon: [
      [80.75, 6.45], [81.55, 6.45], [81.55, 5.98], [80.75, 5.98],
    ],
    searchAliases: ['Tangalle', 'Tissamaharama', 'Ambalantota', 'Beliatta'],
  },
] as const;

export function getZoneById(zoneId: number): AcjuZone | undefined {
  return ACJU_ZONES.find((z) => z.id === zoneId);
}

/**
 * Clearly-labelled LOCAL DEMO SAMPLE records used ONLY when Supabase credentials
 * are unavailable AND the user explicitly enables demo preview.
 * NEVER marked as verified ACJU data and NEVER used for live reminders.
 */
export function buildDemoSampleMonthRecords(
  zoneId: number,
  year: number,
  month: number
): ReferencePrayerRecord[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Slight deterministic regional offset for sample preview clarity (explicitly NOT official ACJU)
  const zoneOffsetMinutes = ((zoneId % 5) - 2) * 2;
  const shift = (baseMin: number) => {
    const m = baseMin + zoneOffsetMinutes;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const rows: ReferencePrayerRecord[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const refDate = `${year}-${mm}-${dd}`;
    rows.push({
      id: `demo-${zoneId}-${refDate}`,
      versionId: 'demo-sample-only',
      zoneId,
      referenceYear: year,
      month,
      day: d,
      referenceDate: refDate,
      fajr: shift(4 * 60 + 50),
      sunrise: shift(6 * 60 + 20),
      dhuhr: shift(12 * 60 + 6),
      asr: shift(15 * 60 + 28),
      maghrib: shift(18 * 60 + 4),
      isha: shift(19 * 60 + 18),
      verificationStatus: 'pending',
      isDemoSample: true,
    });
  }
  return rows;
}

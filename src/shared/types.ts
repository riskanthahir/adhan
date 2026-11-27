export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export const PRAYER_NAMES: readonly PrayerName[] = [
  'fajr',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
] as const;

export const PRAYER_LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export interface AcjuZone {
  id: number; // 1..13
  zoneCode: string;
  name: string;
  officialDescription: string;
}

export interface AcjuDistrict {
  id: string;
  name: string;
  parentDistrict: string;
  zoneId: number;
  isAreaOverride: boolean;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  /** Optional bounding polygon [lng, lat][] for exact area/district containment */
  polygon?: ReadonlyArray<readonly [number, number]>;
  searchAliases: string[];
}

export interface LocationResolution {
  matched: boolean;
  district: AcjuDistrict | null;
  zone: AcjuZone | null;
  detectionMethod: 'gps' | 'manual';
  confidence: 'polygon_exact' | 'nearest_boundary' | 'manual_selection' | 'out_of_bounds';
  distanceKm?: number;
  message: string;
}

export type VerificationStatus =
  | 'pending'
  | 'verified'
  | 'approved'
  | 'superseded'
  | 'rejected';

export type ScheduleSource =
  | 'official_reference'
  | 'annual_repeat_2026'
  | 'unavailable_leap_day'
  | 'demo_sample'
  | 'missing_timetable';

export interface PrayerTimesRow {
  month: number; // 1..12
  day: number; // 1..31
  referenceDate: string; // YYYY-MM-DD
  fajr: string; // HH:MM (24h)
  sunrise?: string; // HH:MM (24h)
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

export interface ReferencePrayerRecord extends PrayerTimesRow {
  id: string;
  versionId: string;
  importJobId?: string;
  sourceDocumentId?: string;
  zoneId: number;
  referenceYear: number;
  verificationStatus: VerificationStatus;
  isDemoSample: boolean;
}

export interface ResolvedDaySchedule {
  targetDate: string; // YYYY-MM-DD
  targetYear: number;
  month: number;
  day: number;
  zoneId: number;
  scheduleSource: ScheduleSource;
  isVerified: boolean;
  isDemoSample: boolean;
  isAnnualRepeat: boolean;
  sourceYear: number | null;
  versionId: string | null;
  statusMessage: string;
  times: {
    fajr: string;
    sunrise?: string;
    dhuhr: string;
    asr: string;
    maghrib: string;
    isha: string;
  } | null;
}

export interface ValidationIssue {
  rowIndex: number;
  date?: string;
  field?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface SourceDocumentRecord {
  id: string;
  zoneId: number;
  year: number;
  month: number;
  sourceUrl: string | null;
  fileName: string;
  fileType: 'pdf' | 'csv';
  sha256Checksum: string;
  extractionStatus: 'pending' | 'extracted' | 'partial' | 'failed';
  uploadedBy: string;
  createdAt: string;
}

export interface ImportJobRecord {
  id: string;
  sourceDocumentId: string;
  sourceFileName: string;
  sourceFileType: 'pdf' | 'csv';
  sourceUrl: string | null;
  sha256Checksum: string;
  zoneId: number;
  year: number;
  month: number;
  verificationStatus: 'pending' | 'needs_review' | 'approved' | 'rejected';
  extractedRows: PrayerTimesRow[];
  validationErrors: ValidationIssue[];
  checksumMatchesExisting: boolean;
  existingApprovedChecksum: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableVersionRecord {
  id: string;
  versionNumber: number;
  referenceYear: number;
  zoneId: number;
  month: number;
  status: 'draft' | 'approved' | 'superseded' | 'archived';
  sourceChecksum: string;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AdhanAudioTrack {
  id: string;
  title: string;
  reciter: string;
  licenseType: string;
  licenseUrl: string | null;
  storagePath: string;
  durationSeconds: number;
  isShortChime: boolean;
  isLocalUpload?: boolean;
}

export type AdvanceMinutesOption = 0 | 5 | 10 | 15 | 30;

export interface UserPreferences {
  timezone: 'Asia/Colombo';
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
  selectedAudioId: string;
  playbackMode: 'full_adhan' | 'short_chime';
  volume: number; // 0..1
  theme: 'light' | 'dark' | 'system';
  allowDemoSamplePreview: boolean;
}

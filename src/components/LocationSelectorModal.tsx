import React, { useMemo, useState } from 'react';
import { Compass, MapPin, Search, X } from 'lucide-react';
import { resolveLocationFromCoordinates } from '../shared/locationLookup';
import type { AcjuDistrict, AcjuZone, LocationResolution } from '../shared/types';

interface LocationSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  districts: readonly AcjuDistrict[];
  zones: readonly AcjuZone[];
  currentDistrictId: string;
  autoUpdateLocation: boolean;
  onToggleAutoUpdate: (enabled: boolean) => void;
  onSelectLocation: (resolution: LocationResolution) => void;
}

export const LocationSelectorModal: React.FC<LocationSelectorModalProps> = ({
  isOpen,
  onClose,
  districts,
  zones,
  currentDistrictId,
  autoUpdateLocation,
  onToggleAutoUpdate,
  onSelectLocation,
}) => {
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<number | 'all'>('all');
  const [gpsStatus, setGpsStatus] = useState<{
    loading: boolean;
    error: string | null;
    result: LocationResolution | null;
  }>({ loading: false, error: null, result: null });

  const filteredDistricts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return districts.filter((d) => {
      if (zoneFilter !== 'all' && d.zoneId !== zoneFilter) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.parentDistrict.toLowerCase().includes(q) ||
        d.searchAliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [districts, search, zoneFilter]);

  if (!isOpen) return null;

  const handleDetectGPS = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus({
        loading: false,
        error: 'Geolocation is not supported by this browser. Please select your district or area below.',
        result: null,
      });
      return;
    }

    setGpsStatus({ loading: true, error: null, result: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const resolved = resolveLocationFromCoordinates(latitude, longitude, districts, zones);
        if (resolved.matched && resolved.district && resolved.zone) {
          setGpsStatus({ loading: false, error: null, result: resolved });
          onSelectLocation(resolved);
        } else {
          setGpsStatus({
            loading: false,
            error: resolved.message,
            result: resolved,
          });
        }
      },
      (err) => {
        let message = 'Location detection failed. Please select your district or area manually below.';
        if (err.code === err.PERMISSION_DENIED) {
          onToggleAutoUpdate(false);
          message =
            'Location permission was denied. Auto-update is paused — please enable location access in browser settings or pick your area below.';
        } else if (err.code === err.TIMEOUT) {
          message = 'GPS request timed out. Please choose your area manually below.';
        }
        setGpsStatus({ loading: false, error: message, result: null });
      },
      {
        enableHighAccuracy: false,
        timeout: 9000,
        maximumAge: 60000,
      }
    );
  };

  const handleManualPick = (district: AcjuDistrict) => {
    const zone = zones.find((z) => z.id === district.zoneId) ?? null;
    onSelectLocation({
      matched: true,
      district,
      zone,
      detectionMethod: 'manual',
      confidence: 'manual_selection',
      message: `Selected ${district.name} (${district.parentDistrict}) → ${zone?.name ?? `Zone ${district.zoneId}`}.`,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-3xl border border-stone-200 bg-white shadow-xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="location-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Select Sri Lanka Location &amp; ACJU Zone
            </h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              Location permission is asked once on first visit and periodically checked when auto-update is on.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close location selector"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 hover:bg-stone-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          {/* GPS Detection & Periodic Auto-Update */}
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Automatic District &amp; Zone Lookup
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Matches your coordinates against the 13 ACJU district boundaries (including Gampola, Nallur, Padiyatalawa, and Dehiaththekandiya).
                </p>
              </div>
              <button
                type="button"
                onClick={handleDetectGPS}
                disabled={gpsStatus.loading}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                <Compass className="h-4 w-4" aria-hidden="true" />
                <span>{gpsStatus.loading ? 'Detecting…' : 'Detect My Location'}</span>
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 dark:border-slate-800">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Auto-update ACJU group via GPS
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Checks periodically and when reopening the app to switch zones as you travel
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoUpdateLocation}
                aria-label="Auto-update ACJU group via GPS"
                onClick={() => {
                  const next = !autoUpdateLocation;
                  onToggleAutoUpdate(next);
                  if (next && !gpsStatus.loading) {
                    handleDetectGPS();
                  }
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  autoUpdateLocation ? 'bg-emerald-700' : 'bg-stone-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                    autoUpdateLocation ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {gpsStatus.error && (
              <p className="mt-3 text-sm text-amber-800 dark:text-amber-300" role="alert">
                {gpsStatus.error}
              </p>
            )}

            {gpsStatus.result?.matched && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 text-sm dark:border-slate-800">
                <span className="text-emerald-800 dark:text-emerald-300">{gpsStatus.result.message}</span>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 whitespace-nowrap shrink-0 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  Confirm &amp; Close
                </button>
              </div>
            )}
          </div>

          {/* Search & Zone Filter */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search town or district (e.g., Gampola, Nallur)"
                aria-label="Search district or town"
                className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              aria-label="Filter by ACJU Zone"
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="all">All 13 ACJU Groups</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  Group {z.id} — {z.officialDescription}
                </option>
              ))}
            </select>
          </div>

          {/* District / Area List */}
          <div className="divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-slate-800 dark:border-slate-800">
            {filteredDistricts.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No Sri Lankan district or town matched &ldquo;{search}&rdquo;.
              </div>
            ) : (
              filteredDistricts.map((d) => {
                const zone = zones.find((z) => z.id === d.zoneId);
                const isSelected = d.id === currentDistrictId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleManualPick(d)}
                    className={`flex min-h-[56px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                        : 'hover:bg-stone-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <MapPin className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        <span className="truncate">{d.name}</span>
                        {d.isAreaOverride && (
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            · {d.parentDistrict} district area
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate pl-6 text-xs text-slate-500 dark:text-slate-400">
                        Includes {d.searchAliases.slice(0, 4).join(', ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        Group {d.zoneId}
                      </span>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {zone?.name.split('—')[1]?.trim()}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { LoaderCircle, LocateFixed, MapPin } from 'lucide-react';
import { LocationInfo, POPULAR_LOCATIONS } from '../../models/household';

interface LocationPickerProps {
  location: LocationInfo;
  onChange: (location: LocationInfo) => void;
  variant?: 'light' | 'dark';
}

const getLocationName = async (latitude: number, longitude: number) => {
  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    );
    if (!response.ok) return '';
    const result = await response.json();
    const city = result.city || result.locality || result.principalSubdivision;
    const country = result.countryName;
    return [city, country].filter(Boolean).join(', ');
  } catch {
    return '';
  }
};

const getPositionError = (error: GeolocationPositionError) => {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location permission is blocked. Allow location access in your browser or device settings, then try again.';
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return 'Your device could not determine a location. Turn on device location services and try again.';
  }
  return 'Location request timed out. Check that device location is on and try again.';
};

export const LocationPicker: React.FC<LocationPickerProps> = ({ location, onChange, variant = 'light' }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mapVisible, setMapVisible] = useState(false);
  const [mapPoint, setMapPoint] = useState({ latitude: location.latitude, longitude: location.longitude });
  const dark = variant === 'dark';
  const controlClass = dark
    ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-amber-500'
    : 'bg-slate-50 border-slate-200/80 text-slate-900 focus:bg-white focus:border-emerald-600';

  const locateMe = () => {
    setMapPoint({ latitude: location.latitude, longitude: location.longitude });
    setMapVisible(true);
    setMessage('');
    if (!navigator.geolocation) {
      setMessage('Location is not supported by this browser. Your saved location is still in use.');
      return;
    }

    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const latitude = coords.latitude;
        const longitude = coords.longitude;
        setMapPoint({ latitude, longitude });
        const name = await getLocationName(latitude, longitude);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || location.timezone || 'auto';
        onChange({
          name: name || `Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
          latitude,
          longitude,
          timezone,
        });
        setMessage(name ? `Location updated to ${name}.` : 'Precise coordinates found and saved.');
        setBusy(false);
      },
      (error) => {
        setMessage(`${getPositionError(error)} Your saved location, ${location.name}, remains in use.`);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  return (
    <div>
      <label className={`block text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${dark ? 'text-slate-300' : 'text-slate-700'}`}>
        <MapPin className={`w-3.5 h-3.5 ${dark ? 'text-amber-400' : 'text-slate-500'}`} />
        Installation Location
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={POPULAR_LOCATIONS.some((candidate) => candidate.name === location.name) ? location.name : ''}
          onChange={(event) => {
            const selected = POPULAR_LOCATIONS.find((candidate) => candidate.name === event.target.value);
            if (selected) {
              setMessage('');
              onChange(selected);
            }
          }}
          className={`min-w-0 flex-1 border rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none transition-colors ${controlClass}`}
        >
          {!POPULAR_LOCATIONS.some((candidate) => candidate.name === location.name) && (
            <option value="">{location.name}</option>
          )}
          {POPULAR_LOCATIONS.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>{candidate.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={locateMe}
          disabled={busy}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${dark
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          {busy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
          {busy ? 'Locating…' : 'Locate me'}
        </button>
      </div>
      <span className={`text-[11px] mt-1 block ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
        {message || 'Used to query local solar irradiance and weather forecast for tomorrow.'}
      </span>
      {mapVisible && (() => {
        const { latitude, longitude } = mapPoint;
        const padding = 0.015;
        const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - padding}%2C${latitude - padding}%2C${longitude + padding}%2C${latitude + padding}&layer=mapnik&marker=${latitude}%2C${longitude}`;
        return (
          <div className={`mt-3 overflow-hidden rounded-xl border ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
            <iframe
              title="Selected location map"
              src={mapUrl}
              className="block h-56 w-full"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className={`px-3 py-2 text-[11px] ${dark ? 'bg-slate-900 text-slate-300' : 'bg-white text-slate-600'}`}>
              {busy ? 'Finding your precise location…' : `Map pin: ${mapPoint.latitude.toFixed(5)}, ${mapPoint.longitude.toFixed(5)}`}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

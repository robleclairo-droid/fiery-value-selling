'use strict';
/*
 * Outside-world extras, both optional:
 *  - Weather for JARVIS_CITY (Open-Meteo, no key).
 *  - Real drive times between event addresses (OpenStreetMap Nominatim + OSRM), only when JARVIS_DRIVE_TIMES=1,
 *    because it sends event addresses to those public services.
 */
function createWorld({ cfg, env, store, writeStore, log }) {
  const U = {
    geo: env.OPENMETEO_GEO_URL || 'https://geocoding-api.open-meteo.com/v1/search',
    wx: env.OPENMETEO_URL || 'https://api.open-meteo.com/v1/forecast',
    nominatim: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
    osrm: env.OSRM_URL || 'https://router.project-osrm.org',
  };
  const headers = { 'user-agent': 'jarvis-hud/1.0 (self-hosted personal dashboard)' };
  const pause = Number(env.GEOCODE_PAUSE_MS || 1100); // Nominatim allows at most 1 request per second
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getJson(url) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return r.json();
  }

  async function home() {
    if (!cfg.city) return null;
    if (store.home && store.home.q === cfg.city) return store.home;
    const [name, ...rest] = cfg.city.split(',').map(s => s.trim()).filter(Boolean);
    const j = await getJson(`${U.geo}?${new URLSearchParams({ name, count: '10', language: 'en', format: 'json' })}`);
    const list = j.results || [];
    const want = rest.map(s => s.toLowerCase());
    const hit = list.find(r => want.every(w => [r.admin1, r.country, r.country_code].some(v => String(v || '').toLowerCase().includes(w)))) || list[0];
    if (!hit) throw new Error(`could not find the city "${cfg.city}"`);
    store.home = { q: cfg.city, lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.admin1].filter(Boolean).join(', ') };
    writeStore();
    return store.home;
  }

  let wx = null, wxAt = 0;
  async function weather() {
    const h = await home();
    if (!h) return null;
    if (wx && Date.now() - wxAt < 30 * 60e3) return wx;
    const imperial = cfg.units === 'imperial';
    const j = await getJson(`${U.wx}?${new URLSearchParams({
      latitude: h.lat.toFixed(3), longitude: h.lon.toFixed(3), timezone: 'auto', forecast_days: '7',
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum',
      ...(imperial ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph' } : {}),
    })}`);
    const c = j.current || {}, d = j.daily || {};
    wx = {
      place: h.name, unit: imperial ? '°F' : '°C', wind_unit: imperial ? 'mph' : 'km/h',
      current: { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), code: c.weather_code, wind: Math.round(c.wind_speed_10m) },
      days: (d.time || []).map((date, i) => ({
        date, code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
        pop: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null, snow: d.snowfall_sum ? d.snowfall_sum[i] : 0,
      })),
    };
    wxAt = Date.now();
    return wx;
  }

  let travel = null, travelKey = '';
  async function driveTimes(calendars) {
    if (!cfg.driveTimes) return null;
    const h = await home();
    if (!h) return null;
    store.geo = store.geo || {};
    const places = [...new Set(calendars.flatMap(c => c.events.map(e => (e.location || '').trim())).filter(Boolean))];
    let looked = 0;
    for (const loc of places) {
      if (loc in store.geo || looked >= 15) continue;
      if (looked++) await sleep(pause);
      try {
        const q = new URLSearchParams({
          q: loc, format: 'jsonv2', limit: '1', bounded: '1',
          viewbox: [h.lon - 0.9, h.lat + 0.6, h.lon + 0.9, h.lat - 0.6].map(n => n.toFixed(3)).join(','), // only look near home
        });
        const r = await getJson(`${U.nominatim}?${q}`);
        store.geo[loc] = r[0] ? [Number(r[0].lat), Number(r[0].lon)] : null;
      } catch (e) { log('geocode failed:', e.message); break; }
    }
    if (looked) writeStore();
    const known = places.filter(p => store.geo[p]);
    if (known.length < 2) return (travel = null);
    const key = known.map(p => store.geo[p].join(',')).join(';');
    if (key === travelKey && travel) return travel;
    const coords = known.map(p => `${store.geo[p][1].toFixed(5)},${store.geo[p][0].toFixed(5)}`).join(';');
    const j = await getJson(`${U.osrm}/table/v1/driving/${coords}?annotations=duration`);
    if (j.code !== 'Ok') throw new Error('routing service returned ' + j.code);
    travelKey = key;
    travel = { places: known, minutes: j.durations.map(row => row.map(s => (s === null ? null : Math.round(s / 60)))) };
    return travel;
  }

  // Returns { weather, travel }; a failure in one never blocks the other.
  async function update(calendars) {
    const out = { weather: wx, travel };
    try { out.weather = await weather(); } catch (e) { log('weather failed:', e.message); }
    try { out.travel = await driveTimes(calendars); } catch (e) { log('drive times failed:', e.message); }
    return out;
  }
  return { update, enabled: !!cfg.city };
}

module.exports = { createWorld };

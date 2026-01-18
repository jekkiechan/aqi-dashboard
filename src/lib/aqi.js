const MIN_HOURLY_COUNT = 10

const MOLAR_MASS = {
  o3: 48,
  no2: 46,
  so2: 64.066,
  co: 28.01,
}

const POLLUTANTS = [
  {
    id: 'pm25',
    label: 'PM2.5',
    hourly: 'pm2_5',
    unit: 'ug/m3',
    breakpoints: [
      [0, 12.0, 0, 50],
      [12.1, 35.4, 51, 100],
      [35.5, 55.4, 101, 150],
      [55.5, 150.4, 151, 200],
      [150.5, 250.4, 201, 300],
      [250.5, 500.4, 301, 500],
    ],
  },
  {
    id: 'pm10',
    label: 'PM10',
    hourly: 'pm10',
    unit: 'ug/m3',
    breakpoints: [
      [0, 54, 0, 50],
      [55, 154, 51, 100],
      [155, 254, 101, 150],
      [255, 354, 151, 200],
      [355, 424, 201, 300],
      [425, 604, 301, 500],
    ],
  },
  {
    id: 'o3',
    label: 'O3',
    hourly: 'ozone',
    unit: 'ppb',
    breakpoints: [
      [0, 54, 0, 50],
      [55, 70, 51, 100],
      [71, 85, 101, 150],
      [86, 105, 151, 200],
      [106, 200, 201, 300],
      [201, 604, 301, 500],
    ],
  },
  {
    id: 'no2',
    label: 'NO2',
    hourly: 'nitrogen_dioxide',
    unit: 'ppb',
    breakpoints: [
      [0, 53, 0, 50],
      [54, 100, 51, 100],
      [101, 360, 101, 150],
      [361, 649, 151, 200],
      [650, 1249, 201, 300],
      [1250, 2049, 301, 400],
      [2050, 4049, 401, 500],
    ],
  },
  {
    id: 'so2',
    label: 'SO2',
    hourly: 'sulphur_dioxide',
    unit: 'ppb',
    breakpoints: [
      [0, 35, 0, 50],
      [36, 75, 51, 100],
      [76, 185, 101, 150],
      [186, 304, 151, 200],
      [305, 604, 201, 300],
      [605, 804, 301, 400],
      [805, 1004, 401, 500],
    ],
  },
  {
    id: 'co',
    label: 'CO',
    hourly: 'carbon_monoxide',
    unit: 'ppm',
    breakpoints: [
      [0.0, 4.4, 0, 50],
      [4.5, 9.4, 51, 100],
      [9.5, 12.4, 101, 150],
      [12.5, 15.4, 151, 200],
      [15.5, 30.4, 201, 300],
      [30.5, 40.4, 301, 400],
      [40.5, 50.4, 401, 500],
    ],
  },
]

const toPpb = (ugm3, molarMass) => (ugm3 * 24.45) / molarMass
const toPpm = (ugm3, molarMass) => (ugm3 * 24.45) / (molarMass * 1000)

const formatNumber = (value, digits = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null

const computeAqi = (concentration, breakpoints) => {
  if (!Number.isFinite(concentration)) return null
  for (const [cLow, cHigh, iLow, iHigh] of breakpoints) {
    if (concentration >= cLow && concentration <= cHigh) {
      const aqi =
        ((iHigh - iLow) / (cHigh - cLow)) * (concentration - cLow) + iLow
      return Math.round(aqi)
    }
  }
  const last = breakpoints[breakpoints.length - 1]
  if (concentration > last[1]) {
    const [cLow, cHigh, iLow, iHigh] = last
    const aqi =
      ((iHigh - iLow) / (cHigh - cLow)) * (concentration - cLow) + iLow
    return Math.round(Math.min(aqi, 500))
  }
  return null
}

const normalizeConcentration = (pollutant, value) => {
  if (!Number.isFinite(value)) return null
  if (pollutant.id === 'o3') {
    return toPpb(value, MOLAR_MASS.o3)
  }
  if (pollutant.id === 'no2') {
    return toPpb(value, MOLAR_MASS.no2)
  }
  if (pollutant.id === 'so2') {
    return toPpb(value, MOLAR_MASS.so2)
  }
  if (pollutant.id === 'co') {
    return toPpm(value, MOLAR_MASS.co)
  }
  return value
}

export const buildDailyAverages = (hourly) => {
  const days = {}
  const times = hourly?.time || []

  for (let i = 0; i < times.length; i += 1) {
    const dateKey = times[i].slice(0, 10)
    if (!days[dateKey]) {
      days[dateKey] = {
        sums: {},
        counts: {},
        mins: {},
        maxs: {},
        hourlyMinAqi: null,
        hourlyMaxAqi: null,
      }
    }
    const entry = days[dateKey]
    let hourlyPeakAqi = null
    for (const pollutant of POLLUTANTS) {
      const values = hourly[pollutant.hourly]
      const value = values?.[i]
      if (Number.isFinite(value)) {
        entry.sums[pollutant.id] = (entry.sums[pollutant.id] || 0) + value
        entry.counts[pollutant.id] = (entry.counts[pollutant.id] || 0) + 1
        entry.mins[pollutant.id] =
          entry.mins[pollutant.id] === undefined
            ? value
            : Math.min(entry.mins[pollutant.id], value)
        entry.maxs[pollutant.id] =
          entry.maxs[pollutant.id] === undefined
            ? value
            : Math.max(entry.maxs[pollutant.id], value)

        const normalized = normalizeConcentration(pollutant, value)
        const aqi = computeAqi(normalized, pollutant.breakpoints)
        if (Number.isFinite(aqi)) {
          hourlyPeakAqi = hourlyPeakAqi === null ? aqi : Math.max(hourlyPeakAqi, aqi)
        }
      }
    }

    if (Number.isFinite(hourlyPeakAqi)) {
      entry.hourlyMinAqi =
        entry.hourlyMinAqi === null
          ? hourlyPeakAqi
          : Math.min(entry.hourlyMinAqi, hourlyPeakAqi)
      entry.hourlyMaxAqi =
        entry.hourlyMaxAqi === null
          ? hourlyPeakAqi
          : Math.max(entry.hourlyMaxAqi, hourlyPeakAqi)
    }
  }

  const daily = {}
  for (const [dateKey, entry] of Object.entries(days)) {
    const pollutants = {}
    const pollutantAqis = []

    for (const pollutant of POLLUTANTS) {
      const count = entry.counts[pollutant.id] || 0
      if (count >= MIN_HOURLY_COUNT) {
        const avgRaw = entry.sums[pollutant.id] / count
        const minRaw = entry.mins[pollutant.id]
        const maxRaw = entry.maxs[pollutant.id]
        const avg = normalizeConcentration(pollutant, avgRaw)
        const min = normalizeConcentration(pollutant, minRaw)
        const max = normalizeConcentration(pollutant, maxRaw)
        const aqi = computeAqi(avg, pollutant.breakpoints)
        pollutants[pollutant.id] = {
          avg: formatNumber(avg, 1),
          min: formatNumber(min, 1),
          max: formatNumber(max, 1),
          aqi,
        }
        if (Number.isFinite(aqi)) {
          pollutantAqis.push(aqi)
        }
      } else {
        pollutants[pollutant.id] = null
      }
    }

    const aqiAvg = pollutantAqis.length ? Math.max(...pollutantAqis) : null

    daily[dateKey] = {
      aqi: aqiAvg,
      aqiStats: Number.isFinite(entry.hourlyMinAqi)
        ? {
            avg: aqiAvg,
            min: entry.hourlyMinAqi,
            max: entry.hourlyMaxAqi,
          }
        : null,
      pollutants,
    }
  }

  return daily
}

export const getPollutantMeta = () =>
  POLLUTANTS.map((pollutant) => ({
    id: pollutant.id,
    label: pollutant.label,
    unit: pollutant.unit,
  }))

const formatDateInTimeZone = (date, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

const CACHE_PREFIX = 'aqi-cache-v3'
const PRECOMPUTED_YEARS = new Set([2024, 2025])
const PRECOMPUTED_DAILY_PREFIX = '/aqi/daily'
const PRECOMPUTED_MAP_PREFIX = '/aqi/map'
const MAP_CACHE_PREFIX = 'aqi-map-cache-v1'
const CACHE_TTL_MS = 1000 * 60 * 60 * 6
const MS_PER_DAY = 24 * 60 * 60 * 1000
const precomputedDailyCache = new Map()
const precomputedMapCache = new Map()

const readCache = (key) => {
  if (typeof window === 'undefined' || !key) return null
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.timestamp || !parsed?.data) return null
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${CACHE_PREFIX}:${key}`)
      return null
    }
    return parsed.data
  } catch (error) {
    return null
  }
}

const readMapCache = (key) => {
  if (typeof window === 'undefined' || !key) return null
  try {
    const raw = window.localStorage.getItem(`${MAP_CACHE_PREFIX}:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.timestamp || !parsed?.data) return null
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${MAP_CACHE_PREFIX}:${key}`)
      return null
    }
    return parsed.data
  } catch (error) {
    return null
  }
}

const writeCache = (key, data) => {
  if (typeof window === 'undefined' || !key) return
  try {
    window.localStorage.setItem(
      `${CACHE_PREFIX}:${key}`,
      JSON.stringify({ timestamp: Date.now(), data })
    )
  } catch (error) {
    // Ignore cache write failures.
  }
}

const writeMapCache = (key, data) => {
  if (typeof window === 'undefined' || !key) return
  try {
    window.localStorage.setItem(
      `${MAP_CACHE_PREFIX}:${key}`,
      JSON.stringify({ timestamp: Date.now(), data })
    )
  } catch (error) {
    // Ignore cache write failures.
  }
}

const getDayIndexFromKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  if (!year || !month || !day) return -1
  const utcDate = Date.UTC(year, month - 1, day)
  const utcStart = Date.UTC(year, 0, 1)
  return Math.floor((utcDate - utcStart) / MS_PER_DAY)
}

export const buildMonthlyAverages = (days, year) => {
  const sums = Array(12).fill(0)
  const counts = Array(12).fill(0)

  for (let i = 0; i < days.length; i += 1) {
    const value = days[i]
    if (!Number.isFinite(value)) continue
    const date = new Date(Date.UTC(year, 0, 1 + i))
    const monthIndex = date.getUTCMonth()
    sums[monthIndex] += value
    counts[monthIndex] += 1
  }

  return sums.map((sum, index) =>
    counts[index] ? Math.round(sum / counts[index]) : null
  )
}

export const buildDailyAqiSeries = (dailyData, year) => {
  const daysInYear = Math.round(
    (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / MS_PER_DAY
  )
  const days = Array(daysInYear).fill(null)

  for (const [dateKey, entry] of Object.entries(dailyData)) {
    const index = getDayIndexFromKey(dateKey)
    if (index < 0 || index >= days.length) continue
    const value = entry?.aqi
    if (Number.isFinite(value)) {
      days[index] = value
    }
  }

  return {
    days,
    monthly: buildMonthlyAverages(days, year),
  }
}

export const isPrecomputedYear = (year) => PRECOMPUTED_YEARS.has(Number(year))

const fetchPrecomputedJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Precomputed data not found (${response.status})`)
  }
  return response.json()
}

export const fetchPrecomputedDailyAqi = async ({ districtId, year }) => {
  const cacheKey = `${districtId}-${year}`
  if (precomputedDailyCache.has(cacheKey)) {
    return precomputedDailyCache.get(cacheKey)
  }
  const url = `${PRECOMPUTED_DAILY_PREFIX}-${year}/${districtId}.json`
  const data = await fetchPrecomputedJson(url)
  precomputedDailyCache.set(cacheKey, data)
  return data
}

export const fetchPrecomputedMapSeries = async (year) => {
  const cacheKey = Number(year)
  if (precomputedMapCache.has(cacheKey)) {
    return precomputedMapCache.get(cacheKey)
  }
  const url = `${PRECOMPUTED_MAP_PREFIX}-${year}.json`
  const payload = await fetchPrecomputedJson(url)
  const districts = payload?.districts || {}
  const series = Object.fromEntries(
    Object.entries(districts).map(([id, days]) => [
      id,
      {
        days,
        monthly: buildMonthlyAverages(days, year),
      },
    ])
  )
  precomputedMapCache.set(cacheKey, series)
  return series
}

export const fetchDailyAqi = async ({
  latitude,
  longitude,
  year,
  cacheKey,
  districtId,
  skipPrecomputed = false,
}) => {
  if (!skipPrecomputed && districtId && isPrecomputedYear(year)) {
    try {
      const precomputed = await fetchPrecomputedDailyAqi({ districtId, year })
      if (precomputed) return precomputed
    } catch (error) {
      // Fall back to live fetch if precomputed data is unavailable.
    }
  }

  const cached = readCache(cacheKey)
  if (cached) return cached

  const startDate = `${year}-01-01`
  const timeZone = 'Asia/Bangkok'
  const today = new Date()
  const isCurrentYear = today.getFullYear() === year
  const endDate = isCurrentYear
    ? formatDateInTimeZone(today, timeZone)
    : `${year}-12-31`
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    timezone: timeZone,
    start_date: startDate,
    end_date: endDate,
    hourly: POLLUTANTS.map((pollutant) => pollutant.hourly).join(','),
  })

  const response = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`
  )

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status})`)
  }

  const payload = await response.json()
  const data = buildDailyAverages(payload.hourly)
  writeCache(cacheKey, data)
  return data
}

export const fetchDailyAqiSeries = async ({
  latitude,
  longitude,
  year,
  cacheKey,
  districtId,
}) => {
  const cached = readMapCache(cacheKey)
  if (cached) return cached

  const dailyData = await fetchDailyAqi({
    latitude,
    longitude,
    year,
    cacheKey: null,
    districtId,
  })
  const series = buildDailyAqiSeries(dailyData, year)
  writeMapCache(cacheKey, series)
  return series
}

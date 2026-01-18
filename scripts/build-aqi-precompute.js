import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDailyAqiSeries, fetchDailyAqi } from '../src/lib/aqi.js'
import { buildDistrictData } from '../src/lib/geo.js'

const YEARS = [2024, 2025]
const CONCURRENCY = 2

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const outputRoot = path.join(projectRoot, 'public', 'aqi')

const geoPath = path.join(projectRoot, 'src', 'assets', 'bangkok-districts.json')
const geoRaw = await readFile(geoPath, 'utf8')
const districtGeo = JSON.parse(geoRaw)
const { districts } = buildDistrictData(districtGeo)

const writeJson = async (filePath, data) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data))
}

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchWithRetry = async (fn, label) => {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const message = error?.message || ''
      const isRateLimited = message.includes('(429)') || message.includes('429')
      if (attempt === maxAttempts || !isRateLimited) {
        throw error
      }
      const waitMs = 1200 * attempt + Math.floor(Math.random() * 400)
      console.warn(`  ↻ ${label} rate-limited, retrying in ${waitMs}ms`)
      await sleep(waitMs)
    }
  }
  return null
}

const buildYear = async (year) => {
  console.log(`Precomputing AQI for ${year}...`)
  const mapData = {}
  const queue = [...districts]
  const errors = []

  const worker = async () => {
    while (queue.length) {
      const district = queue.shift()
      if (!district) return
      const dailyPath = path.join(
        outputRoot,
        `daily-${year}`,
        `${district.id}.json`
      )
      try {
        const cached = await readJsonIfExists(dailyPath)
        const daily =
          cached ||
          (await fetchWithRetry(
            () =>
              fetchDailyAqi({
                latitude: district.latitude,
                longitude: district.longitude,
                year,
                cacheKey: null,
                districtId: district.id,
                skipPrecomputed: true,
              }),
            district.name
          ))
        if (!cached) {
          await writeJson(dailyPath, daily)
        }
        const series = buildDailyAqiSeries(daily, year)
        mapData[district.id] = series.days
        console.log(`  ✓ ${district.name}`)
        await sleep(300)
      } catch (error) {
        errors.push({ district: district.name, error })
        console.warn(`  ✕ ${district.name}: ${error?.message || error}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  if (errors.length) {
    throw new Error(`Failed to precompute ${errors.length} districts for ${year}.`)
  }

  const mapPath = path.join(outputRoot, `map-${year}.json`)
  await writeJson(mapPath, { year, districts: mapData })
}

const run = async () => {
  for (const year of YEARS) {
    await buildYear(year)
  }
  console.log('Precompute complete.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

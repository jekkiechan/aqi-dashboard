const splitCamelCase = (name) =>
  name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const ringAreaCentroid = (ring) => {
  let area = 0
  let cx = 0
  let cy = 0

  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }

  area *= 0.5
  if (area === 0) {
    const total = ring.length || 1
    const sum = ring.reduce(
      (acc, point) => {
        acc[0] += point[0]
        acc[1] += point[1]
        return acc
      },
      [0, 0]
    )
    return { area: 0, centroid: [sum[0] / total, sum[1] / total] }
  }

  return { area, centroid: [cx / (6 * area), cy / (6 * area)] }
}

const geometryCentroid = (geometry) => {
  const candidates = []
  if (geometry.type === 'Polygon') {
    const outerRing = geometry.coordinates[0]
    if (outerRing) {
      candidates.push(ringAreaCentroid(outerRing))
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      const outerRing = polygon[0]
      if (outerRing) {
        candidates.push(ringAreaCentroid(outerRing))
      }
    }
  }

  if (!candidates.length) {
    return { latitude: 0, longitude: 0 }
  }

  const best = candidates.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  return { longitude: best.centroid[0], latitude: best.centroid[1] }
}

const geometryBounds = (geometry) => {
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity

  const addPoint = (point) => {
    const [lon, lat] = point
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  const visitRing = (ring) => ring.forEach(addPoint)

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(visitRing)
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) => polygon.forEach(visitRing))
  }

  return { minLon, maxLon, minLat, maxLat }
}

const projectRing = (ring) =>
  ring
    .map(([lon, lat], index) => `${index === 0 ? 'M' : 'L'}${lon} ${-lat}`)
    .join(' ') + ' Z'

const geometryPath = (geometry) => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(projectRing).join(' ')
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) => polygon.map(projectRing).join(' ')).join(' ')
  }
  return ''
}

export const buildDistrictData = (geojson) => {
  const bounds = {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  }

  const districts = geojson.features.map((feature) => {
    const rawName = feature.properties.name
    const name = splitCamelCase(rawName)
    const id = slugify(rawName)
    const centroid = geometryCentroid(feature.geometry)
    const geomBounds = geometryBounds(feature.geometry)
    bounds.minLon = Math.min(bounds.minLon, geomBounds.minLon)
    bounds.maxLon = Math.max(bounds.maxLon, geomBounds.maxLon)
    bounds.minLat = Math.min(bounds.minLat, geomBounds.minLat)
    bounds.maxLat = Math.max(bounds.maxLat, geomBounds.maxLat)

    return {
      id,
      name,
      rawName,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      path: geometryPath(feature.geometry),
    }
  })

  const viewBox = `${bounds.minLon} ${-bounds.maxLat} ${bounds.maxLon - bounds.minLon} ${
    bounds.maxLat - bounds.minLat
  }`

  return { districts, viewBox }
}

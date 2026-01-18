<script>
  import { onDestroy, onMount, tick } from 'svelte'
  import districtGeo from './assets/bangkok-districts.json'
  import {
    fetchDailyAqi,
    fetchDailyAqiSeries,
    fetchPrecomputedMapSeries,
    getPollutantMeta,
    isPrecomputedYear,
  } from './lib/aqi.js'
  import { buildDistrictData } from './lib/geo.js'

  const { districts: rawDistricts, viewBox: mapViewBox } =
    buildDistrictData(districtGeo)
  const DISTRICTS = [...rawDistricts].sort((a, b) => a.name.localeCompare(b.name))

  const pollutantMeta = getPollutantMeta()
  const currentYear = new Date().getFullYear()
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2]
  const MONTH_NAMES = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]

  const defaultDistrict =
    DISTRICTS.find((district) => district.rawName.toLowerCase() === 'pathumwan') ||
    DISTRICTS.find((district) => district.name.toLowerCase() === 'pathum wan') ||
    DISTRICTS[0]

  let selectedDistrictId = defaultDistrict.id
  let selectedYear = yearOptions[0]
  let selectedDistrict = defaultDistrict
  let calendar = []
  let dailyData = {}
  let hoveredDay = null
  let pinnedDay = null
  let activeDay = null
  let hoveredAnchor = null
  let pinnedAnchor = null
  let activeAnchor = null
  let tooltipEl = null
  let tooltipPosition = { top: 0, left: 0, placement: 'top' }
  let loading = false
  let error = ''
  let monthSummaries = []
  let showNumbers = true
  let mapView = 'daily'
  let mapDate = ''
  let mapMonth = ''
  let mapSeries = {}
  let mapLoading = false
  let mapError = ''
  let mapHover = null
  let mapTooltip = { x: 0, y: 0 }
  let mapWrapEl = null
  let lastMapDate = ''
  let lastMapMonth = ''
  let showDatePicker = false
  let showMonthPicker = false
  let mapDatePickerEl = null
  let mapMonthPickerEl = null
  let mapPickerYear = new Date().getFullYear()
  let mapPickerMonth = new Date().getMonth()
  let mapMonthPickerYear = new Date().getFullYear()
  let datePickerCells = []
  let monthPickerCells = []

  const dataCache = new Map()
  let latestRequest = 0
  let lastKey = ''
  let mapLastYear = null
  let mapLatestRequest = 0

  const formatDateKey = (date) => {
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  const formatDisplayDate = (date) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)

  const parseDateKey = (dateKey) => {
    if (!dateKey) return null
    const [year, month, day] = dateKey.split('-').map(Number)
    if (!year || !month || !day) return null
    return new Date(year, month - 1, day)
  }

  const formatDateLabel = (dateKey) => {
    const date = parseDateKey(dateKey)
    return date ? formatDisplayDate(date) : 'Pick a date'
  }

  const formatMonthLabel = (monthKey) => {
    if (!monthKey) return 'Pick a month'
    const [year, month] = monthKey.split('-').map(Number)
    if (!year || !month) return 'Pick a month'
    return `${MONTH_NAMES[month - 1]} ${year}`
  }

  const getMonthKey = (year, monthIndex) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}`

  const isMonthInRange = (year, monthIndex) => {
    const key = getMonthKey(year, monthIndex)
    return key >= minMapMonth && key <= maxMapMonth
  }

  const isYearInRange = (year) => {
    const firstKey = `${year}-01`
    const lastKey = `${year}-12`
    return !(lastKey < minMapMonth || firstKey > maxMapMonth)
  }

  const getDayIndex = (date) => (date.getDay() + 6) % 7

  const buildCalendar = (year) =>
    MONTH_NAMES.map((name, monthIndex) => {
      const firstDay = new Date(year, monthIndex, 1)
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
      const startOffset = getDayIndex(firstDay)
      const cells = []

      for (let i = 0; i < 42; i += 1) {
        const dayNumber = i - startOffset + 1
        if (dayNumber > 0 && dayNumber <= daysInMonth) {
          const date = new Date(year, monthIndex, dayNumber)
          cells.push({
            date,
            dateKey: formatDateKey(date),
          })
        } else {
          cells.push(null)
        }
      }
      return { name, monthIndex, cells }
    })

  $: selectedDistrict = DISTRICTS.find(
    (district) => district.id === selectedDistrictId
  )
  $: calendar = buildCalendar(Number(selectedYear))
  $: if (selectedDistrict && selectedYear) {
    const key = `${selectedDistrict.id}-${selectedYear}`
    if (key !== lastKey) {
      lastKey = key
      hoveredDay = null
      pinnedDay = null
      hoveredAnchor = null
      pinnedAnchor = null
      loadData(selectedDistrict, selectedYear, key)
    }
  }

  const loadData = async (district, year, key) => {
    const cached = dataCache.get(key)
    if (cached) {
      dailyData = cached
      error = ''
      loading = false
      return
    }

    loading = true
    error = ''
    const requestId = (latestRequest += 1)

    try {
      const data = await fetchDailyAqi({
        latitude: district.latitude,
        longitude: district.longitude,
        year: Number(year),
        cacheKey: key,
        districtId: district.id,
      })

      if (requestId !== latestRequest) return
      dataCache.set(key, data)
      dailyData = data
    } catch (err) {
      if (requestId !== latestRequest) return
      error = err?.message || 'Unable to load AQI data.'
      dailyData = {}
    } finally {
      if (requestId === latestRequest) {
        loading = false
      }
    }
  }

  const getBand = (aqi) => {
    if (!Number.isFinite(aqi)) return 'missing'
    if (aqi <= 50) return 'good'
    if (aqi <= 100) return 'moderate'
    if (aqi <= 150) return 'usg'
    if (aqi <= 200) return 'unhealthy'
    if (aqi <= 300) return 'very-unhealthy'
    return 'hazardous'
  }

  const formatStat = (value) =>
    Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : 'N/A'

  const formatAqi = (value) => (Number.isFinite(value) ? Math.round(value) : 'N/A')

  const minMapYear = Math.min(...yearOptions)
  const maxMapDate = formatDateKey(new Date())
  const minMapDate = `${minMapYear}-01-01`
  const minMapMonth = `${minMapYear}-01`
  const maxMapMonth = maxMapDate.slice(0, 7)

  if (!mapDate) {
    mapDate = maxMapDate
    mapMonth = maxMapMonth
  }

  const buildDatePickerCells = (year, monthIndex, selectedDate) => {
    const firstDay = new Date(year, monthIndex, 1)
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
    const startOffset = getDayIndex(firstDay)
    const cells = []

    for (let i = 0; i < 42; i += 1) {
      const dayNumber = i - startOffset + 1
      if (dayNumber > 0 && dayNumber <= daysInMonth) {
        const date = new Date(year, monthIndex, dayNumber)
        const dateKey = formatDateKey(date)
        cells.push({
          label: dayNumber,
          dateKey,
          disabled: dateKey < minMapDate || dateKey > maxMapDate,
          selected: dateKey === selectedDate,
          today: dateKey === maxMapDate,
        })
      } else {
        cells.push(null)
      }
    }

    return cells
  }

  const buildMonthPickerCells = (year, selectedMonth) =>
    MONTH_NAMES.map((name, monthIndex) => {
      const key = getMonthKey(year, monthIndex)
      return {
        label: name,
        key,
        disabled: key < minMapMonth || key > maxMapMonth,
        selected: key === selectedMonth,
      }
    })

  const toggleDatePicker = () => {
    showDatePicker = !showDatePicker
    if (showDatePicker) {
      showMonthPicker = false
      const date = parseDateKey(mapDate) || new Date()
      mapPickerYear = date.getFullYear()
      mapPickerMonth = date.getMonth()
    }
  }

  const toggleMonthPicker = () => {
    showMonthPicker = !showMonthPicker
    if (showMonthPicker) {
      showDatePicker = false
      const baseDate = parseDateKey(`${mapMonth}-01`) || new Date()
      mapMonthPickerYear = baseDate.getFullYear()
    }
  }

  const selectMapDate = (dateKey) => {
    if (!dateKey) return
    mapDate = dateKey
    showDatePicker = false
  }

  const selectMapMonth = (monthKey) => {
    if (!monthKey) return
    mapMonth = monthKey
    showMonthPicker = false
  }

  const selectToday = () => {
    mapDate = maxMapDate
    const date = parseDateKey(mapDate)
    if (date) {
      mapPickerYear = date.getFullYear()
      mapPickerMonth = date.getMonth()
    }
    showDatePicker = false
  }

  const shiftDatePickerMonth = (delta) => {
    const nextDate = new Date(mapPickerYear, mapPickerMonth + delta, 1)
    if (!isMonthInRange(nextDate.getFullYear(), nextDate.getMonth())) return
    mapPickerYear = nextDate.getFullYear()
    mapPickerMonth = nextDate.getMonth()
  }

  const canShiftDatePickerMonth = (delta) => {
    const nextDate = new Date(mapPickerYear, mapPickerMonth + delta, 1)
    return isMonthInRange(nextDate.getFullYear(), nextDate.getMonth())
  }

  const shiftMonthPickerYear = (delta) => {
    const nextYear = mapMonthPickerYear + delta
    if (!isYearInRange(nextYear)) return
    mapMonthPickerYear = nextYear
  }

  const canShiftMonthPickerYear = (delta) =>
    isYearInRange(mapMonthPickerYear + delta)

  const buildDayPayload = (day) => ({ ...day, data: dailyData[day.dateKey] })

  const setHoveredDay = (day, event) => {
    if (pinnedDay) return
    hoveredDay = buildDayPayload(day)
    hoveredAnchor = event.currentTarget
  }

  const clearHoveredDay = () => {
    hoveredDay = null
    hoveredAnchor = null
  }

  const togglePinnedDay = (day, event) => {
    const payload = buildDayPayload(day)
    pinnedDay = pinnedDay?.dateKey === payload.dateKey ? null : payload
    pinnedAnchor = pinnedDay ? event.currentTarget : null
  }

  const clearPinnedDay = () => {
    pinnedDay = null
    pinnedAnchor = null
  }

  const isPinnedDay = (day) => pinnedDay?.dateKey === day.dateKey

  const getTone = (aqi) => {
    if (!Number.isFinite(aqi)) return 'neutral'
    if (aqi <= 50) return 'good'
    if (aqi <= 100) return 'moderate'
    if (aqi <= 150) return 'usg'
    return 'unhealthy'
  }

  const SUMMARY_BANDS = [
    { id: 'good', label: '0-50' },
    { id: 'moderate', label: '51-100' },
    { id: 'usg', label: '101-150' },
    { id: 'unhealthy', label: '151-200' },
    { id: 'very-unhealthy', label: '201-300' },
    { id: 'hazardous', label: '301+' },
  ]

  const getMonthSummary = (month, data) => {
    const summary = Object.fromEntries(
      SUMMARY_BANDS.map((band) => [band.id, 0])
    )

    month.cells.forEach((day) => {
      if (!day) return
      const aqi = data[day.dateKey]?.aqi
      if (!Number.isFinite(aqi) || aqi === 0) return
      const band = getBand(aqi)
      if (summary[band] !== undefined) {
        summary[band] += 1
      }
    })

    return summary
  }

  const buildSummaryParts = (summary) => {
    const total = SUMMARY_BANDS.reduce(
      (sum, band) => sum + (summary[band.id] || 0),
      0
    )
    let offset = 0

    const parts = SUMMARY_BANDS.map((band) => {
      const count = summary[band.id] || 0
      const width = total ? (count / total) * 100 : 0
      const percent = total ? Math.round(width) : 0
      const center = Math.min(96, Math.max(4, offset + width / 2))
      offset += width
      return { ...band, count, width, percent, center, showLabel: false }
    })

    const minLabelWidth = 8
    const visibleLabels = parts.filter(
      (part) => part.percent > 0 && part.width >= minLabelWidth
    )
    if (visibleLabels.length) {
      visibleLabels.forEach((part) => {
        part.showLabel = true
      })
    } else {
      const largest = parts.reduce(
        (winner, part) => (part.width > winner.width ? part : winner),
        parts[0]
      )
      if (largest.percent > 0) {
        largest.showLabel = true
      }
    }

    return parts
  }

  const getDayIndexFromKey = (dateKey) => {
    const [year, month, day] = dateKey.split('-').map(Number)
    if (!year || !month || !day) return -1
    const utcDate = Date.UTC(year, month - 1, day)
    const utcStart = Date.UTC(year, 0, 1)
    return Math.floor((utcDate - utcStart) / (24 * 60 * 60 * 1000))
  }

  const getMonthIndexFromKey = (monthKey) => {
    const [year, month] = monthKey.split('-').map(Number)
    if (!year || !month) return -1
    return month - 1
  }

  const getMapAqi = (seriesMap, districtId, view, dateKey, monthKey) => {
    const series = seriesMap?.[districtId]
    if (!series) return null
    if (view === 'daily') {
      const index = getDayIndexFromKey(dateKey)
      return index >= 0 ? series.days?.[index] ?? null : null
    }
    const monthIndex = getMonthIndexFromKey(monthKey)
    return monthIndex >= 0 ? series.monthly?.[monthIndex] ?? null : null
  }

  const setMapHover = (district, event) => {
    mapHover = {
      id: district.id,
      name: district.name,
      aqi: getMapAqi(mapSeries, district.id, mapView, mapDate, mapMonth),
    }
    updateMapTooltip(event)
  }

  const setMapView = (view) => {
    if (view === mapView) return
    showDatePicker = false
    showMonthPicker = false
    if (view === 'monthly' && mapDate) {
      mapMonth = mapDate.slice(0, 7)
    }
    if (view === 'daily' && mapMonth) {
      mapDate = `${mapMonth}-01`
    }
    mapView = view
  }

  const updateMapTooltip = (event) => {
    if (!mapWrapEl) return
    const rect = mapWrapEl.getBoundingClientRect()
    const clientX = event?.clientX ?? rect.left + rect.width / 2
    const clientY = event?.clientY ?? rect.top + rect.height / 2
    mapTooltip = {
      x: Math.min(rect.width - 12, Math.max(12, clientX - rect.left)),
      y: Math.min(rect.height - 12, Math.max(12, clientY - rect.top)),
    }
  }

  const clearMapHover = () => {
    mapHover = null
  }

  const hasMapDataForDay = (seriesMap, dateKey) => {
    const index = getDayIndexFromKey(dateKey)
    if (index < 0) return false
    return Object.values(seriesMap).some((series) =>
      Number.isFinite(series?.days?.[index])
    )
  }

  const hasMapDataForMonth = (seriesMap, monthKey) => {
    const index = getMonthIndexFromKey(monthKey)
    if (index < 0) return false
    return Object.values(seriesMap).some((series) =>
      Number.isFinite(series?.monthly?.[index])
    )
  }

  const findLatestMapDay = (seriesMap, year) => {
    const daysInYear = Math.round(
      (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / (24 * 60 * 60 * 1000)
    )
    for (let i = daysInYear - 1; i >= 0; i -= 1) {
      for (const series of Object.values(seriesMap)) {
        if (Number.isFinite(series?.days?.[i])) {
          return new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10)
        }
      }
    }
    return null
  }

  const findLatestMapMonth = (seriesMap, year) => {
    for (let i = 11; i >= 0; i -= 1) {
      for (const series of Object.values(seriesMap)) {
        if (Number.isFinite(series?.monthly?.[i])) {
          return `${year}-${String(i + 1).padStart(2, '0')}`
        }
      }
    }
    return null
  }

  const updateTooltipPosition = async () => {
    if (!activeAnchor || !activeDay) return
    await tick()
    if (!tooltipEl || !activeAnchor) return
    const anchorRect = activeAnchor.getBoundingClientRect()
    const tooltipRect = tooltipEl.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const gap = 12
    const padding = 12

    const spaceAbove = anchorRect.top - gap - padding
    const spaceBelow = viewportHeight - anchorRect.bottom - gap - padding
    const placement =
      spaceAbove >= tooltipRect.height || spaceAbove >= spaceBelow ? 'top' : 'bottom'
    const top = placement === 'top' ? anchorRect.top - gap : anchorRect.bottom + gap

    const halfWidth = tooltipRect.width / 2
    let left = anchorRect.left + anchorRect.width / 2
    left = Math.max(padding + halfWidth, Math.min(left, viewportWidth - padding - halfWidth))

    tooltipPosition = { top, left, placement }
  }

  let tooltipRaf = 0
  const scheduleTooltipPosition = () => {
    if (tooltipRaf) return
    tooltipRaf = requestAnimationFrame(() => {
      tooltipRaf = 0
      updateTooltipPosition()
    })
  }

  $: datePickerCells = buildDatePickerCells(mapPickerYear, mapPickerMonth, mapDate)
  $: monthPickerCells = buildMonthPickerCells(mapMonthPickerYear, mapMonth)
  $: monthSummaries = calendar.map((month) => getMonthSummary(month, dailyData))
  $: activeDay = pinnedDay || hoveredDay
  $: activeAnchor = pinnedAnchor || hoveredAnchor
  $: if (activeDay && activeAnchor) {
    scheduleTooltipPosition()
  }

  $: if (mapView === 'daily' && mapDate && mapDate !== lastMapDate) {
    lastMapDate = mapDate
    const nextYear = Number(mapDate.slice(0, 4))
    if (Number.isFinite(nextYear) && nextYear !== selectedYear) {
      selectedYear = nextYear
    }
  }

  $: if (mapView === 'monthly' && mapMonth && mapMonth !== lastMapMonth) {
    lastMapMonth = mapMonth
    const nextYear = Number(mapMonth.slice(0, 4))
    if (Number.isFinite(nextYear) && nextYear !== selectedYear) {
      selectedYear = nextYear
    }
  }

  $: if (mapHover) {
    const nextAqi = getMapAqi(mapSeries, mapHover.id, mapView, mapDate, mapMonth)
    if (nextAqi !== mapHover.aqi) {
      mapHover = { ...mapHover, aqi: nextAqi }
    }
  }

  $: {
    const mapYear = Number(
      (mapView === 'daily' ? mapDate : mapMonth).split('-')[0]
    )
    if (mapYear && mapYear !== mapLastYear) {
      mapLastYear = mapYear
      loadMapData(mapYear)
    }
  }

  const loadMapDataLive = async (year, requestId) => {
    const results = {}
    const queue = [...DISTRICTS]
    const concurrency = 4
    const errors = []

    mapSeries = {}

    const worker = async () => {
      while (queue.length) {
        const district = queue.shift()
        try {
          const series = await fetchDailyAqiSeries({
            latitude: district.latitude,
            longitude: district.longitude,
            year,
            cacheKey: `${district.id}-${year}`,
            districtId: district.id,
          })
          if (requestId !== mapLatestRequest) return
          results[district.id] = series
          mapSeries = { ...results }
        } catch (err) {
          errors.push(err)
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker))
    if (requestId !== mapLatestRequest) return { results: null, errors }
    return { results, errors }
  }

  const applyMapFallbacks = (results, year) => {
    if (!results) return
    if (mapView === 'daily' && mapDate && !hasMapDataForDay(results, mapDate)) {
      const fallback = findLatestMapDay(results, year)
      if (fallback) {
        mapDate = fallback
      }
    }
    if (mapView === 'monthly' && mapMonth && !hasMapDataForMonth(results, mapMonth)) {
      const fallback = findLatestMapMonth(results, year)
      if (fallback) {
        mapMonth = fallback
      }
    }
  }

  const loadMapData = async (year) => {
    mapLoading = true
    mapError = ''
    const requestId = (mapLatestRequest += 1)

    if (isPrecomputedYear(year)) {
      try {
        const seriesMap = await fetchPrecomputedMapSeries(year)
        if (requestId !== mapLatestRequest) return
        mapSeries = seriesMap
        applyMapFallbacks(seriesMap, year)
        mapLoading = false
        return
      } catch (error) {
        // Fall back to live fetch if precomputed map data is unavailable.
      }
    }

    const { results, errors } = await loadMapDataLive(year, requestId)
    if (requestId !== mapLatestRequest) return
    if (results) {
      mapSeries = { ...results }
      applyMapFallbacks(results, year)
    }
    mapLoading = false
    if (errors?.length) {
      mapError = 'Unable to load AQI data for all districts.'
    }
  }

  onMount(() => {
    const handleScroll = () => scheduleTooltipPosition()
    const handleResize = () => scheduleTooltipPosition()
    const handlePointerDown = (event) => {
      if (showDatePicker && mapDatePickerEl && !mapDatePickerEl.contains(event.target)) {
        showDatePicker = false
      }
      if (showMonthPicker && mapMonthPickerEl && !mapMonthPickerEl.contains(event.target)) {
        showMonthPicker = false
      }
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  })

  onDestroy(() => {
    if (tooltipRaf) {
      cancelAnimationFrame(tooltipRaf)
    }
  })
</script>

<main class="page">
  <header class="hero">
    <div>
      <p class="eyebrow">Bangkok AQI Atlas</p>
      <h1>Bangkok Air Quality Calendar</h1>
      <p class="lead">
        Daily AQI derived from open air-quality data.
      </p>
      <p class="equation">
        Calculated using the
        <a
          class="aqi-link"
          href="https://www.airnow.gov/sites/default/files/2020-05/aqi-technical-assistance-document-sept2018.pdf"
          target="_blank"
          rel="noreferrer"
        >
          US AQI method
        </a>.
      </p>
    </div>
  </header>

  <section class="map-panel">
    <div class="map-header">
      <div>
        <h2>Bangkok AQI Map</h2>
        <p class="subtle">
          Hover a district to view AQI. Click to load its daily calendar below.
        </p>
      </div>
      <div class="map-controls">
        <div class="segmented" role="group" aria-label="Map view">
          <button
            type="button"
            class="segment"
            data-active={mapView === 'daily'}
            on:click={() => setMapView('daily')}
          >
            Daily
          </button>
          <button
            type="button"
            class="segment"
            data-active={mapView === 'monthly'}
            on:click={() => setMapView('monthly')}
          >
            Monthly
          </button>
        </div>
        {#if mapView === 'daily'}
          <label class="control control-compact picker" bind:this={mapDatePickerEl}>
            <span>Date</span>
            <button
              type="button"
              class="picker-trigger"
              aria-haspopup="dialog"
              aria-expanded={showDatePicker}
              on:click={toggleDatePicker}
            >
              <span>{formatDateLabel(mapDate)}</span>
              <span class="picker-caret" aria-hidden="true">v</span>
            </button>
            {#if showDatePicker}
              <div class="picker-panel" role="dialog">
                <div class="picker-header">
                  <button
                    type="button"
                    class="picker-nav"
                    on:click={() => shiftDatePickerMonth(-1)}
                    disabled={!canShiftDatePickerMonth(-1)}
                    aria-label="Previous month"
                  >
                    <span aria-hidden="true">&lt;</span>
                  </button>
                  <span class="picker-title">
                    {MONTH_NAMES[mapPickerMonth]} {mapPickerYear}
                  </span>
                  <button
                    type="button"
                    class="picker-nav"
                    on:click={() => shiftDatePickerMonth(1)}
                    disabled={!canShiftDatePickerMonth(1)}
                    aria-label="Next month"
                  >
                    <span aria-hidden="true">&gt;</span>
                  </button>
                </div>
                <div class="picker-weekdays" aria-hidden="true">
                  <span>M</span>
                  <span>Tu</span>
                  <span>W</span>
                  <span>Th</span>
                  <span>F</span>
                  <span>Sa</span>
                  <span>Su</span>
                </div>
                <div class="picker-grid">
                  {#each datePickerCells as cell}
                    {#if cell}
                      <button
                        type="button"
                        class="picker-day"
                        data-selected={cell.selected}
                        data-today={cell.today}
                        data-disabled={cell.disabled}
                        disabled={cell.disabled}
                        on:click={() => selectMapDate(cell.dateKey)}
                      >
                        {cell.label}
                      </button>
                    {:else}
                      <span class="picker-day placeholder" aria-hidden="true"></span>
                    {/if}
                  {/each}
                </div>
                <div class="picker-footer">
                  <button type="button" class="picker-today" on:click={selectToday}>
                    Today
                  </button>
                </div>
              </div>
            {/if}
          </label>
        {:else}
          <label class="control control-compact picker" bind:this={mapMonthPickerEl}>
            <span>Month</span>
            <button
              type="button"
              class="picker-trigger"
              aria-haspopup="dialog"
              aria-expanded={showMonthPicker}
              on:click={toggleMonthPicker}
            >
              <span>{formatMonthLabel(mapMonth)}</span>
              <span class="picker-caret" aria-hidden="true">v</span>
            </button>
            {#if showMonthPicker}
              <div class="picker-panel" role="dialog">
                <div class="picker-header">
                  <button
                    type="button"
                    class="picker-nav"
                    on:click={() => shiftMonthPickerYear(-1)}
                    disabled={!canShiftMonthPickerYear(-1)}
                    aria-label="Previous year"
                  >
                    <span aria-hidden="true">&lt;</span>
                  </button>
                  <span class="picker-title">{mapMonthPickerYear}</span>
                  <button
                    type="button"
                    class="picker-nav"
                    on:click={() => shiftMonthPickerYear(1)}
                    disabled={!canShiftMonthPickerYear(1)}
                    aria-label="Next year"
                  >
                    <span aria-hidden="true">&gt;</span>
                  </button>
                </div>
                <div class="picker-months">
                  {#each monthPickerCells as cell}
                    <button
                      type="button"
                      class="picker-month"
                      data-selected={cell.selected}
                      data-disabled={cell.disabled}
                      disabled={cell.disabled}
                      on:click={() => selectMapMonth(cell.key)}
                    >
                      {cell.label}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </label>
        {/if}
        <div class="map-chip">{selectedDistrict?.name}</div>
      </div>
    </div>
    {#if mapError}
      <div class="status error">{mapError}</div>
    {:else if mapLoading}
      <div class="status loading">Loading district AQI...</div>
    {/if}
    <div class="map-wrap" bind:this={mapWrapEl}>
      <svg
        class="district-map"
        viewBox={mapViewBox}
        role="group"
        aria-label="Bangkok district map"
        preserveAspectRatio="xMidYMid meet"
      >
        {#each DISTRICTS as district}
          <path
            d={district.path}
            class="district-shape"
            data-band={getBand(getMapAqi(mapSeries, district.id, mapView, mapDate, mapMonth))}
            data-selected={district.id === selectedDistrictId}
            tabindex="0"
            role="button"
            aria-label={district.name}
            on:click={() => (selectedDistrictId = district.id)}
            on:mouseenter={(event) => setMapHover(district, event)}
            on:mousemove={updateMapTooltip}
            on:mouseleave={clearMapHover}
            on:focus={() => setMapHover(district, null)}
            on:blur={clearMapHover}
            on:keydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                selectedDistrictId = district.id
              }
            }}
          >
            <title>{district.name}</title>
          </path>
        {/each}
      </svg>
      {#if mapHover}
        <div
          class="map-tooltip"
          style={`left: ${mapTooltip.x}px; top: ${mapTooltip.y}px;`}
        >
          <span class="map-tooltip-name">{mapHover.name}</span>
          {#if mapHover.aqi != null}
            <span class="map-tooltip-aqi" data-band={getBand(mapHover.aqi)}>
              AQI {formatAqi(mapHover.aqi)}
            </span>
          {:else}
            <span class="map-tooltip-aqi muted">No data</span>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <section class="controls-panel">
    <div class="controls">
      <label class="control">
        <span>District</span>
        <select bind:value={selectedDistrictId}>
          {#each DISTRICTS as district}
            <option value={district.id}>{district.name}</option>
          {/each}
        </select>
      </label>
      <label class="control">
        <span>Year</span>
        <select bind:value={selectedYear}>
          {#each yearOptions as year}
            <option value={year}>{year}</option>
          {/each}
        </select>
      </label>
    </div>
  </section>

  <section class="panel">
    <div class="panel-header">
      <div>
        <h2>{selectedDistrict?.name} - {selectedYear}</h2>
        <p class="subtle">Calendar heatmap of daily AQI.</p>
      </div>
      <div class="legend">
        <span>Legend</span>
        <div class="legend-items">
          <div class="legend-item" data-band="good">0-50</div>
          <div class="legend-item" data-band="moderate">51-100</div>
          <div class="legend-item" data-band="usg">101-150</div>
          <div class="legend-item" data-band="unhealthy">151-200</div>
          <div class="legend-item" data-band="very-unhealthy">201-300</div>
          <div class="legend-item" data-band="hazardous">301+</div>
        </div>
      </div>
      <label class="toggle toggle-compact">
        <input type="checkbox" bind:checked={showNumbers} />
        <span class="toggle-track" aria-hidden="true">
          <span class="toggle-thumb"></span>
        </span>
        <span class="toggle-label">Show numbers</span>
      </label>
    </div>

    {#if error}
      <div class="status error">{error}</div>
    {:else if loading}
      <div class="status loading">Loading daily AQI...</div>
    {/if}

    <div class="calendar-shell">
      <p class="calendar-hint">
        Hover or tap a day to preview details. Click to pin the tooltip.
      </p>
      <div class="calendar-grid">
        {#each calendar as month, index}
          {@const summary = monthSummaries[index] || {}}
          {@const summaryParts = buildSummaryParts(summary)}
          <div class="month-card">
            <div class="month-header">
              <div class="month-name">{month.name}</div>
              <div class="month-summary">
                <span class="summary-label">Summary</span>
                <div class="summary-bar" role="img" aria-label="AQI distribution">
                  {#each summaryParts as band}
                    <span
                      class="summary-segment"
                      data-band={band.id}
                      data-tooltip={`${band.percent}%`}
                      style={`width: ${band.width.toFixed(1)}%`}
                      title={`${band.label} days (${band.percent}%)`}
                      aria-hidden="true"
                    ></span>
                  {/each}
                </div>
                <div class="summary-percentages">
                  {#each summaryParts as band}
                    {#if band.showLabel}
                      <span
                        class="summary-percent"
                        data-band={band.id}
                        style={`left: ${band.center.toFixed(2)}%`}
                      >
                        {band.percent}%
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            </div>
            <div class="month-weekdays" aria-hidden="true">
              <span class="weekday">M</span>
              <span class="weekday">Tu</span>
              <span class="weekday">W</span>
              <span class="weekday">Th</span>
              <span class="weekday">F</span>
              <span class="weekday">Sa</span>
              <span class="weekday">Su</span>
            </div>
            <div class="month-grid">
              {#each month.cells as day}
                {#if day}
                  {#if dailyData[day.dateKey]?.aqi != null}
                    <button
                      class="cell"
                      data-band={getBand(dailyData[day.dateKey].aqi)}
                      data-selected={isPinnedDay(day)}
                      aria-pressed={isPinnedDay(day)}
                      on:mouseenter={(event) => setHoveredDay(day, event)}
                      on:mouseleave={clearHoveredDay}
                      on:focus={(event) => setHoveredDay(day, event)}
                      on:blur={clearHoveredDay}
                      on:click={(event) => togglePinnedDay(day, event)}
                      aria-label={`${formatDisplayDate(day.date)} AQI ${dailyData[day.dateKey].aqi}`}
                    >
                      {#if showNumbers}
                        {dailyData[day.dateKey].aqi}
                      {/if}
                    </button>
                  {:else}
                    <button
                      class="cell"
                      data-band="missing"
                      data-selected={isPinnedDay(day)}
                      aria-pressed={isPinnedDay(day)}
                      on:mouseenter={(event) => setHoveredDay(day, event)}
                      on:mouseleave={clearHoveredDay}
                      on:focus={(event) => setHoveredDay(day, event)}
                      on:blur={clearHoveredDay}
                      on:click={(event) => togglePinnedDay(day, event)}
                      aria-label={`${formatDisplayDate(day.date)} No data`}
                    ></button>
                  {/if}
                {:else}
                  <div class="cell placeholder" aria-hidden="true"></div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if activeDay}
      <div
        class="day-tooltip"
        bind:this={tooltipEl}
        style={`top: ${tooltipPosition.top}px; left: ${tooltipPosition.left}px;`}
        data-placement={tooltipPosition.placement}
        data-pinned={pinnedDay ? 'true' : 'false'}
        role="tooltip"
      >
        <div class="tooltip-header">
          <div class="tooltip-title">
            <span class="detail-date">{formatDisplayDate(activeDay.date)}</span>
            {#if pinnedDay}
              <span class="tooltip-pin">Pinned</span>
            {/if}
          </div>
          <div class="detail-meta">
            {#if activeDay.data?.aqi != null}
              <span class="detail-aqi" data-band={getBand(activeDay.data.aqi)}>
                AQI {activeDay.data.aqi}
              </span>
            {:else}
              <span class="detail-aqi muted">No data</span>
            {/if}
            {#if pinnedDay}
              <button class="detail-clear" type="button" on:click={clearPinnedDay}>
                Close
              </button>
            {/if}
          </div>
        </div>
        {#if activeDay.data?.aqiStats}
          <div class="aqi-range">
            <span data-band={getBand(activeDay.data.aqiStats.avg)}>
              <small>Avg</small>
              <strong>{formatAqi(activeDay.data.aqiStats.avg)}</strong>
            </span>
            <span data-band={getBand(activeDay.data.aqiStats.min)}>
              <small>Min</small>
              <strong>{formatAqi(activeDay.data.aqiStats.min)}</strong>
            </span>
            <span data-band={getBand(activeDay.data.aqiStats.max)}>
              <small>Max</small>
              <strong>{formatAqi(activeDay.data.aqiStats.max)}</strong>
            </span>
          </div>
        {/if}
        <div class="tooltip-body">
          <div class="pollutants">
            {#each pollutantMeta as pollutant}
              {@const pollutantData = activeDay.data?.pollutants?.[pollutant.id]}
              <div class="pollutant" data-tone={getTone(pollutantData?.aqi)}>
                <div class="pollutant-head">
                  <span class="pollutant-label">{pollutant.label}</span>
                  <span class="pollutant-unit">{pollutant.unit}</span>
                </div>
                <div class="pollutant-stats">
                  <span>
                    <strong>{formatStat(pollutantData?.avg)}</strong>
                    <small>avg</small>
                  </span>
                  <span>
                    <strong>{formatStat(pollutantData?.min)}</strong>
                    <small>min</small>
                  </span>
                  <span>
                    <strong>{formatStat(pollutantData?.max)}</strong>
                    <small>max</small>
                  </span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </section>

  <footer class="footnote">
    <p>
      Gray squares indicate fewer than 10 hourly measurements. AQI uses US EPA
      breakpoints applied to daily averages.
    </p>
    <p class="source">Source: Open-Meteo Air Quality API.</p>
  </footer>
</main>

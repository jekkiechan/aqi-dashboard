<script>
  import { onDestroy, onMount, tick } from 'svelte'
  import districtGeo from './assets/bangkok-districts.json'
  import { fetchDailyAqi, getPollutantMeta } from './lib/aqi.js'
  import { buildDistrictData } from './lib/geo.js'

  const { districts: rawDistricts, viewBox: mapViewBox } =
    buildDistrictData(districtGeo)
  const DISTRICTS = [...rawDistricts].sort((a, b) => a.name.localeCompare(b.name))

  const pollutantMeta = getPollutantMeta()
  const currentYear = new Date().getFullYear()
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2]

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

  const dataCache = new Map()
  let latestRequest = 0
  let lastKey = ''

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

  const getDayIndex = (date) => (date.getDay() + 6) % 7

  const buildCalendar = (year) => {
    const monthNames = [
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

    return monthNames.map((name, monthIndex) => {
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
  }

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

    return SUMMARY_BANDS.map((band) => {
      const count = summary[band.id] || 0
      const width = total ? (count / total) * 100 : 0
      const percent = total ? Math.round(width) : 0
      const center = Math.min(96, Math.max(4, offset + width / 2))
      offset += width
      return { ...band, count, width, percent, center }
    })
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

  $: monthSummaries = calendar.map((month) => getMonthSummary(month, dailyData))
  $: activeDay = pinnedDay || hoveredDay
  $: activeAnchor = pinnedAnchor || hoveredAnchor
  $: if (activeDay && activeAnchor) {
    scheduleTooltipPosition()
  }

  onMount(() => {
    const handleScroll = () => scheduleTooltipPosition()
    const handleResize = () => scheduleTooltipPosition()
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
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
  </header>

  <section class="map-panel">
    <div class="map-header">
      <div>
        <h2>Bangkok Districts</h2>
        <p class="subtle">
          Click a district to load its daily AQI calendar.
        </p>
      </div>
      <div class="map-chip">{selectedDistrict?.name}</div>
    </div>
    <div class="map-wrap">
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
            data-selected={district.id === selectedDistrictId}
            tabindex="0"
            role="button"
            aria-label={district.name}
            on:click={() => (selectedDistrictId = district.id)}
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
                      style={`width: ${band.width.toFixed(1)}%`}
                      aria-hidden="true"
                    ></span>
                  {/each}
                </div>
                <div class="summary-percentages">
                  {#each summaryParts as band}
                    {#if band.percent > 0}
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

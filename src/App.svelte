<script>
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
    let totalDays = 0

    month.cells.forEach((day) => {
      if (!day) return
      const aqi = data[day.dateKey]?.aqi
      if (!Number.isFinite(aqi) || aqi === 0) return
      const band = getBand(aqi)
      if (summary[band] !== undefined) {
        summary[band] += 1
        totalDays += 1
      }
    })

    const bands = SUMMARY_BANDS.map((band) => {
      const count = summary[band.id] || 0
      const percent = totalDays ? (count / totalDays) * 100 : 0
      return { ...band, count, percent }
    })

    return { totalDays, bands }
  }

  $: monthSummaries = calendar.map((month) => getMonthSummary(month, dailyData))
</script>

<main class="page">
  <header class="hero">
    <div>
      <p class="eyebrow">Bangkok AQI Atlas</p>
      <h1>Bangkok Air Quality Calendar</h1>
      <p class="lead">
        Daily US AQI derived from open air-quality data. Hover a day to inspect
        pollutant averages.
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
      <div class="calendar-grid">
        {#each calendar as month, index}
          {@const summary = monthSummaries[index] || { totalDays: 0, bands: [] }}
          <div class="month-card">
            <div class="month-header">
              <div class="month-name">{month.name}</div>
              <div class="month-summary">
                <span class="summary-label">Summary</span>
                <div
                  class="month-summary-bar"
                  role="img"
                  aria-label={`Monthly AQI band breakdown for ${month.name}`}
                >
                  {#if summary.totalDays}
                    {#each summary.bands as band}
                      <span
                        class="summary-segment"
                        data-band={band.id}
                        style={`flex-basis: ${band.percent}%; width: ${band.percent}%;`}
                        title={`${band.label}: ${band.percent.toFixed(0)}% (${band.count} days)`}
                        aria-label={`${band.label}: ${band.percent.toFixed(0)}% (${band.count} days)`}
                      ></span>
                    {/each}
                  {:else}
                    <span
                      class="summary-segment is-empty"
                      title="No days with AQI data"
                      aria-label="No days with AQI data"
                    ></span>
                  {/if}
                </div>
              </div>
            </div>
            <div class="month-grid">
              {#each month.cells as day}
                {#if day}
                  {#if dailyData[day.dateKey]?.aqi != null}
                    <button
                      class="cell"
                      data-band={getBand(dailyData[day.dateKey].aqi)}
                      on:mouseenter={() =>
                        (hoveredDay = { ...day, data: dailyData[day.dateKey] })}
                      on:mouseleave={() => (hoveredDay = null)}
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
                      on:mouseenter={() =>
                        (hoveredDay = { ...day, data: dailyData[day.dateKey] })}
                      on:mouseleave={() => (hoveredDay = null)}
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

    <div class="detail">
      {#if hoveredDay}
        <div class="detail-header">
          <span class="detail-date">{formatDisplayDate(hoveredDay.date)}</span>
          {#if hoveredDay.data?.aqi != null}
            <span class="detail-aqi" data-tone={getTone(hoveredDay.data.aqi)}>
              AQI {hoveredDay.data.aqi}
            </span>
          {:else}
            <span class="detail-aqi muted">No data</span>
          {/if}
        </div>
        <div class="pollutants">
          {#each pollutantMeta as pollutant}
            {@const pollutantData = hoveredDay.data?.pollutants?.[pollutant.id]}
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
      {:else}
        <div class="detail-empty">
          <p>Hover a day to see AQI plus avg/min/max pollutant data.</p>
        </div>
      {/if}
    </div>
  </section>

  <footer class="footnote">
    <p>
      Gray squares indicate fewer than 10 hourly measurements. AQI uses US EPA
      breakpoints applied to daily averages.
    </p>
    <p class="source">Source: Open-Meteo Air Quality API.</p>
  </footer>
</main>

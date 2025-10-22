class LiveChart {
    constructor(ctx, label, colorVariableName) {
        this.colorVariableName = colorVariableName;
        
        const computedStyle = getComputedStyle(document.body);
        const initialLineColor = computedStyle.getPropertyValue(this.colorVariableName);
        const initialTextColor = computedStyle.getPropertyValue('--chart-text-color');
        const initialGridColor = computedStyle.getPropertyValue('--chart-grid-color');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: label,
                    data: [],
                    borderColor: initialLineColor,
                    backgroundColor: initialLineColor + '30',
                    fill: true,
                    cubicInterpolationMode: 'monotone',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: 10 },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'minute', tooltipFormat: 'PPpp', displayFormats: { minute: 'h:mm a' } },
                        ticks: { color: initialTextColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                        grid: { color: initialGridColor }
                    },
                    y: {
                        ticks: { color: initialTextColor },
                        grid: { color: initialGridColor }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                elements: { point: { radius: 0, hoverRadius: 5 }, line: { borderWidth: 2.5 } }
            }
        });
    }

    setData(data, unit) {
        this.chart.options.scales.x.time.unit = unit;
        this.chart.options.scales.x.min = undefined;
        this.chart.options.scales.x.max = undefined;
        this.chart.data.datasets[0].data = data;
        this.chart.update();
    }
    
    setLiveData(data, timeWindowMinutes = 10) {
        const now = new Date();
        const startTime = new Date(now.getTime() - timeWindowMinutes * 60 * 1000);
        this.chart.options.scales.x.time.unit = 'minute';
        this.chart.options.scales.x.min = startTime;
        this.chart.options.scales.x.max = now;
        this.chart.data.datasets[0].data = data;
        this.chart.update();
    }

    addDataPoint(point) {
        const dataset = this.chart.data.datasets[0].data;
        dataset.push(point);
        const now = new Date();
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        this.chart.options.scales.x.min = tenMinutesAgo;
        this.chart.options.scales.x.max = now;
        this.chart.update('quiet');
    }

    updateTheme() {
        const computedStyle = getComputedStyle(document.body);
        const newColor = computedStyle.getPropertyValue(this.colorVariableName);
        const textColor = computedStyle.getPropertyValue('--chart-text-color');
        const gridColor = computedStyle.getPropertyValue('--chart-grid-color');
        this.chart.options.scales.x.ticks.color = textColor;
        this.chart.options.scales.y.ticks.color = textColor;
        this.chart.options.scales.x.grid.color = gridColor;
        this.chart.options.scales.y.grid.color = gridColor;
        this.chart.data.datasets[0].borderColor = newColor;
        this.chart.data.datasets[0].backgroundColor = newColor + '30';
        this.chart.update();
    }
}


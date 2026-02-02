/**
 * Fetch Weather Data
 *
 * Uses PowerShell wttr.in to get weather data for a location.
 * Default: Kos, Greece (configurable)
 */

// Imports removed

export interface WeatherData {
  location: string;
  tempC: string;
  tempF: string;
  condition: string;
  precip: string;
  highC: string;
  lowC: string;
  highF: string;
  lowF: string;
  windDir: string;
  windSpeed: string;
  humidity: string;
  cloudcover: string;
  advice: string;
}

/**
 * Fetch weather data from wttr.in
 */

export async function fetchWeather(location: string = 'Kos,Greece'): Promise<WeatherData | null> {
  try {
    const url = `https://wttr.in/${location}?format=j1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Wget/1.21.1", // wttr.in sometimes prefers simpler UAs
        "Accept": "*/*"
      },
      signal: AbortSignal.timeout(25000) // Increased from 15s to 25s
    });

    if (!response.ok) {
      throw new Error(`Weather fetch failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    const current = data.current_condition[0];
    const nearest = data.nearest_area[0];
    const weather = data.weather[0];

    // Generate advice based on condition
    const condition = current.weatherDesc[0].value.toLowerCase();
    let advice = '';
    if (condition.includes('sun') || condition.includes('clear')) {
      advice = 'Great weather! Consider outdoor activities.';
    } else if (condition.includes('rain')) {
      advice = 'Don\'t forget an umbrella.';
    } else if (condition.includes('cloud')) {
      advice = 'Overcast skies, good weather for coding.';
    } else if (condition.includes('snow')) {
      advice = 'Stay warm and cozy!';
    } else if (parseInt(current.precipMM) > 50) {
      advice = 'Heavy rain expected, best to stay indoors.';
    } else {
      advice = `It's ${condition} outside.`;
    }

    return {
      location: nearest.areaName[0].value,
      tempC: current.temp_C,
      tempF: current.temp_F,
      condition: current.weatherDesc[0].value,
      precip: current.precipMM,
      highC: weather.maxtempC,
      lowC: weather.mintempC,
      highF: weather.maxtempF,
      lowF: weather.mintempF,
      windDir: current.winddir16Point,
      windSpeed: `${current.windspeedKmph} km/h`,
      humidity: `${current.humidity}%`,
      cloudcover: `${current.cloudcover}%`,
      advice,
    };
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return null;
  }
}

/**
 * Format weather data for Telegram message
 */
export function formatWeatherMessage(weather: WeatherData): string {
  return `🌤️ Weather in ${weather.location}

Current: ${weather.tempC}°C (${weather.tempF}°F) - ${weather.condition}
High/Low: ${weather.highC}°C / ${weather.lowC}°C (${weather.highF}°F / ${weather.lowF}°F)

Details:
• Precipitation: ${weather.precip}%
• Wind: ${weather.windDir} ${weather.windSpeed}
• Humidity: ${weather.humidity}
• Cloud Cover: ${weather.cloudcover}

💡 ${weather.advice}`;
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const location = process.argv[2] || 'Kos,Greece';
  const weather = await fetchWeather(location);

  if (!weather) {
    console.error('Failed to fetch weather data');
    process.exit(1);
  }

  console.log(formatWeatherMessage(weather));
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('fetch-weather.ts') ||
  process.argv[1].endsWith('fetch-weather') ||
  process.argv[1].includes('fetch-weather.ts')
);

if (isMain) {
  main().catch(console.error);
}

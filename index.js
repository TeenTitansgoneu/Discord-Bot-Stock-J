const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActivityType,
} = require('discord.js');

// node-fetch als dynamischen Import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

require('dotenv').config();

// Env-Variablen
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Discord Client initialisieren
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Slash Command Definition
const commands = [
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Show current Grow a Garden stock and weather status'),
].map(cmd => cmd.toJSON());

// REST API Client für Command-Registration
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Emojis für verschiedene Kategorien
const emojis = {
  seeds: { Carrot: '🥕', Daffodil: '🌼', Strawberry: '🍓', Tomato: '🍅', Blueberry: '🫐' },
  eggs: { Common: '🥚', Rare: '🐣', Epic: '🐤', Legendary: '🐥' },
  gear: { WateringCan: '💧', Shovel: '🪣', Hoe: '🪓', Gloves: '🧤' },
  weather: { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', Stormy: '⛈️', Snowy: '❄️', Windy: '🌬️', Foggy: '🌫️' },
};

let lastStockData = null;
let lastWeatherData = null;

// Registrierung der Slash Commands
(async () => {
  try {
    console.log('📦 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();

// Event: Bot bereit
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);

  // Status & Aktivität setzen
  client.user.setPresence({
    status: 'dnd', // online, idle, dnd, invisible
    activities: [
      {
        name: 'Grow a Garden 🌱',
        type: ActivityType.Playing, // z.B. Playing, Watching, Listening, Streaming
      },
    ],
  });
  initializeData()
    .then(() => scheduleNextCheck());
});

// Event: Interaktion mit Slash Command
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stock') {
    await interaction.deferReply();

    try {
      const [stockData, weatherData] = await Promise.all([
        fetchData('stock'),
        fetchData('weather'),
      ]);

      const stockEmbed = buildStockEmbed(stockData);
      await interaction.editReply({ embeds: [stockEmbed] });

    } catch (error) {
      console.error('❌ Error handling /stock command:', error);
      await interaction.editReply('⚠️ Unable to fetch data right now. Please try again later.');
    }
  }
});

// Hilfsfunktion: API-Daten holen
async function fetchData(type) {
  const url = `https://growagarden.gg/api/${type}`;
  const response = await fetch(url);
  return response.json();
}

// Initiale Daten laden, damit keine unnötigen Nachrichten gesendet werden
async function initializeData() {
  try {
    const [stockData, weatherData] = await Promise.all([fetchData('stock'), fetchData('weather')]);
    lastStockData = stockData;
    lastWeatherData = weatherData.weather;
    console.log('✅ Initial data loaded.');
  } catch (error) {
    console.error('❌ Error during initial data fetch:', error);
  }
}

// Alle 5 Minuten plus 30 Sekunden auf Updates prüfen
function scheduleNextCheck() {
  const now = new Date();
  const nextFiveMin = new Date(now);

  nextFiveMin.setMilliseconds(0);
  nextFiveMin.setSeconds(0);
  nextFiveMin.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);
  nextFiveMin.setSeconds(nextFiveMin.getSeconds() + 30);

  const delay = nextFiveMin.getTime() - now.getTime();

  console.log(`⏳ Next check in ${Math.round(delay / 1000)} seconds at ${nextFiveMin.toLocaleTimeString()}`);

  setTimeout(async () => {
    await checkForUpdates();
    scheduleNextCheck();
  }, delay);
}

// Prüfe auf Änderungen bei Lagerbestand und Wetter
async function checkForUpdates() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');

    const [stockData, weatherData] = await Promise.all([fetchData('stock'), fetchData('weather')]);

    if (!isEqual(lastStockData, stockData)) {
      await channel.send({ embeds: [buildStockEmbed(stockData)] });
      lastStockData = stockData;
      console.log('📢 Stock updated, message sent.');
    } else {
      console.log('No stock changes.');
    }

    if (!isEqual(lastWeatherData, weatherData.weather)) {
      await sendWeatherEmbeds(channel, weatherData.weather);
      lastWeatherData = weatherData.weather;
      console.log('🌦️ Weather updated, message sent.');
    } else {
      console.log('No weather changes.');
    }
  } catch (error) {
    console.error('❌ Error during update check:', error);
  }
}

// Wetter-Embed(s) senden (in nur einer Nachricht)
async function sendWeatherEmbeds(channel, weather) {
  let weatherDescriptions = [];

  if (Array.isArray(weather)) {
    for (const w of weather) {
      const emoji = emojis.weather[w] || '🌤️';
      weatherDescriptions.push(`${emoji} **${w}**`);
    }
  } else if (typeof weather === 'object') {
    for (const key in weather) {
      if (weather[key]) {
        const emoji = emojis.weather[key] || '🌤️';
        weatherDescriptions.push(`${emoji} **${key}**`);
      }
    }
  } else {
    const emoji = emojis.weather[weather] || '🌤️';
    weatherDescriptions.push(`${emoji} **${weather}**`);
  }

  const embed = new EmbedBuilder()
    .setTitle('☁️ Weather Update')
    .setDescription(weatherDescriptions.join('\n'))
    .setColor('#87CEEB')
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

// Lagerbestand Embed erstellen (übersichtlich)
function buildStockEmbed(stockData) {
  const embed = new EmbedBuilder()
    .setTitle('🌾 Grow a Garden — Current Stock')
    .setColor('#2ecc71')
    .setFooter({ text: 'Updated every 5 minutes' })
    .setTimestamp();

  // Seeds
  if (Array.isArray(stockData.seedsStock)) {
    const seedsText = stockData.seedsStock
      .map(item => `${emojis.seeds[item.name] || '🌱'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🌱 Seeds', value: seedsText, inline: true });
  }

  // Eggs
  if (Array.isArray(stockData.eggStock)) {
    const eggsText = stockData.eggStock
      .map(item => `${emojis.eggs[item.name] || '🥚'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🥚 Eggs', value: eggsText, inline: true });
  }

  // Gear
  if (Array.isArray(stockData.gearStock)) {
    const gearText = stockData.gearStock
      .map(item => `${emojis.gear[item.name] || '🛠️'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🛠️ Gear', value: gearText, inline: true });
  }

  return embed;
}

// Einfache tiefgehende Objekt-Vergleichsfunktion
function isEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

// Login
client.login(TOKEN);

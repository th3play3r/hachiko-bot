require("dotenv").config();

const fs = require("fs");
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  ActivityType,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

// =========================
// HTTP-сервер для Render
// =========================

const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("Hachiko is alive");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`);
  });

// =========================
// Файл с сохранением данных
// =========================

const DATA_FILE = "./users.json";

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "{}");
      return new Map();
    }

    const file = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(file);

    return new Map(Object.entries(data));
  } catch (error) {
    console.error("❌ Ошибка загрузки users.json:", error);
    return new Map();
  }
}

function saveUsers() {
  try {
    const data = Object.fromEntries(users);

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("❌ Ошибка сохранения users.json:", error);
  }
}

const users = loadUsers();

// =========================
// Discord-клиент
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// =========================
// Вспомогательные функции
// =========================

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      xp: 0,
      voiceSeconds: 0,
      joinedAt: null,
      lastMessageXp: 0,
    });
  }

  const user = users.get(userId);

  // Защита от старых или повреждённых данных
  user.xp = Number(user.xp) || 0;
  user.voiceSeconds = Number(user.voiceSeconds) || 0;
  user.joinedAt = user.joinedAt || null;
  user.lastMessageXp = Number(user.lastMessageXp) || 0;

  return user;
}

function getLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function getRequiredXp(level) {
  return Math.pow(level, 2) * 100;
}

function formatTime(seconds) {
  seconds = Math.floor(seconds);

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const result = [];

  if (hours > 0) {
    result.push(`${hours} ч.`);
  }

  if (minutes > 0) {
    result.push(`${minutes} мин.`);
  }

  if (secs > 0 || result.length === 0) {
    result.push(`${secs} сек.`);
  }

  return result.join(" ");
}

function getVoiceTime(userData) {
  let total = Number(userData.voiceSeconds) || 0;

  if (userData.joinedAt) {
    total += Math.floor((Date.now() - userData.joinedAt) / 1000);
  }

  return total;
}

function addXp(member, amount) {
  const user = getUser(member.id);

  const oldLevel = getLevel(user.xp);

  user.xp += amount;

  const newLevel = getLevel(user.xp);

  saveUsers();

  if (newLevel > oldLevel) {
    const channel = member.guild.systemChannel;

    if (channel) {
      channel
        .send(
          `🎉 ${member} достиг ${newLevel} уровня!`
        )
        .catch(() => {});
    }
  }
}

function isInVoice(member) {
  return Boolean(member.voice && member.voice.channel);
}

// =========================
// Запуск бота
// =========================

client.once("clientReady", () => {
  console.log(`🐕 Hachiko запущен: ${client.user.tag}`);

  client.user.setActivity("за голосовыми каналами", {
    type: ActivityType.Watching,
  });
});

// =========================
// Сообщения и команды
// =========================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const member = message.member;

  if (member) {
    const user = getUser(member.id);
    const now = Date.now();

    // XP за сообщение, максимум один раз в минуту
    if (now - user.lastMessageXp >= 60_000) {
      user.lastMessageXp = now;

      addXp(member, 10);
    }
  }

  const args = message.content.trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // =========================
  // !ping
  // =========================

  if (command === "!ping") {
    return message.reply(`🏓 Pong! Задержка: ${client.ws.ping} мс`);
  }

  // =========================
  // !woof
  // =========================

  if (command === "!woof") {
    return message.reply("🐕 Гав-гав!");
  }

  // =========================
  // !help
  // =========================

  if (command === "!help") {
    return message.reply(
      [
        "**🐕 Команды Hachiko:**",
        "",
        "`!ping` — проверить задержку",
        "`!woof` — гавкнуть",
        "`!rank` — твой уровень и XP",
        "`!voicetime` — время в голосовых каналах",
        "`!topvoice` — топ по времени в войсе",
        "`!uptime` — время работы бота",
        "`!server` — информация о сервере",
        "`!where` — где ты находишься",
        "`!stay` — зайти в твой голосовой канал",
        "`!leave` — выйти из голосового канала",
      ].join("\n")
    );
  }

  // =========================
  // !rank
  // =========================

  if (command === "!rank") {
    const user = getUser(message.author.id);

    const level = getLevel(user.xp);
    const nextLevelXp = getRequiredXp(level);
    const voiceTime = getVoiceTime(user);

    return message.reply(
      [
        `📊 **Статистика ${message.author.username}**`,
        `⭐ Уровень: **${level}**`,
        `✨ XP: **${user.xp}/${nextLevelXp}**`,
        `🎧 Время в войсе: **${formatTime(voiceTime)}**`,
      ].join("\n")
    );
  }

  // =========================
  // !voicetime
  // =========================

  if (command === "!voicetime") {
    const target =
      message.mentions.members.first() || message.member;

    const user = getUser(target.id);
    const voiceTime = getVoiceTime(user);

    return message.reply(
      `🎧 ${target.user.username} провёл в войсе **${formatTime(
        voiceTime
      )}**`
    );
  }

  // =========================
  // !topvoice
  // =========================

  if (command === "!topvoice") {
    const sorted = [...users.entries()]
      .map(([userId, data]) => ({
        userId,
        seconds: getVoiceTime(data),
      }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    if (sorted.length === 0) {
      return message.reply("Пока никто не накопил время в войсе.");
    }

    const lines = [];

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];

      let name = `Пользователь ${item.userId}`;

      try {
        const member = await message.guild.members.fetch(item.userId);
        name = member.user.username;
      } catch {
        // Пользователь мог выйти с сервера
      }

      lines.push(
        `**${i + 1}.** ${name} — ${formatTime(item.seconds)}`
      );
    }

    return message.reply(
      `🏆 **Топ по времени в войсе:**\n${lines.join("\n")}`
    );
  }

  // =========================
  // !uptime
  // =========================

  if (command === "!uptime") {
    const seconds = Math.floor(process.uptime());

    return message.reply(
      `⏱️ Бот работает: **${formatTime(seconds)}**`
    );
  }

  // =========================
  // !server
  // =========================

  if (command === "!server") {
    return message.reply(
      [
        `🏠 Сервер: **${message.guild.name}**`,
        `👥 Участников: **${message.guild.memberCount}**`,
        `🆔 ID: \`${message.guild.id}\``,
      ].join("\n")
    );
  }

  // =========================
  // !where
  // =========================

  if (command === "!where") {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.reply("❌ Ты сейчас не находишься в войсе.");
    }

    return message.reply(
      `🎧 Ты находишься в канале **${voiceChannel.name}**`
    );
  }

  // =========================
  // !stay
  // =========================

  if (command === "!stay") {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.reply(
        "❌ Сначала зайди в голосовой канал."
      );
    }

    const oldConnection = getVoiceConnection(message.guild.id);

    if (oldConnection) {
      oldConnection.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        30_000
      );

      return message.reply(
        `🐕 Я зашёл в канал **${voiceChannel.name}**`
      );
    } catch (error) {
      console.error("Ошибка подключения к войсу:", error);

      connection.destroy();

      return message.reply(
        "❌ Не удалось подключиться к голосовому каналу."
      );
    }
  }

  // =========================
  // !leave
  // =========================

  if (command === "!leave") {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      return message.reply("❌ Я сейчас не нахожусь в войсе.");
    }

    connection.destroy();

    return message.reply("👋 Я вышел из голосового канала.");
  }
});

// =========================
// Отслеживание входа/выхода из войса
// =========================

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  const user = getUser(member.id);

  const wasInVoice = Boolean(oldState.channelId);
  const isNowInVoice = Boolean(newState.channelId);

  // Пользователь зашёл в войс
  if (!wasInVoice && isNowInVoice) {
    user.joinedAt = Date.now();

    saveUsers();

    console.log(
      `🎧 ${member.user.username} зашёл в войс`
    );

    return;
  }

  // Пользователь вышел из войса
  if (wasInVoice && !isNowInVoice) {
    if (user.joinedAt) {
      const seconds = Math.floor(
        (Date.now() - user.joinedAt) / 1000
      );

      user.voiceSeconds += seconds;
      user.xp += Math.floor(seconds / 60);

      user.joinedAt = null;

      saveUsers();

      console.log(
        `👋 ${member.user.username} вышел из войса. Добавлено: ${formatTime(
          seconds
        )}`
      );
    }

    return;
  }

  // Пользователь перешёл из одного войса в другой
  if (
    wasInVoice &&
    isNowInVoice &&
    oldState.channelId !== newState.channelId
  ) {
    if (user.joinedAt) {
      const seconds = Math.floor(
        (Date.now() - user.joinedAt) / 1000
      );

      user.voiceSeconds += seconds;
      user.xp += Math.floor(seconds / 60);
    }

    user.joinedAt = Date.now();

    saveUsers();

    console.log(
      `🔄 ${member.user.username} перешёл в другой войс`
    );
  }
});

// =========================
// Начисление времени каждую минуту
// =========================

setInterval(() => {
  let changed = false;

  for (const [userId, data] of users.entries()) {
    if (!data.joinedAt) continue;

    const seconds = Math.floor(
      (Date.now() - data.joinedAt) / 1000
    );

    if (seconds >= 60) {
      data.voiceSeconds += seconds;
      data.xp += Math.floor(seconds / 60);
      data.joinedAt = Date.now();

      changed = true;
    }
  }

  if (changed) {
    saveUsers();

    console.log("💾 Время в войсе сохранено.");
  }
}, 60_000);

// =========================
// Автосохранение каждые 5 минут
// =========================

setInterval(() => {
  saveUsers();
  console.log("💾 Данные пользователей сохранены.");
}, 5 * 60_000);

// =========================
// Вход в Discord
// =========================

if (!process.env.TOKEN) {
  console.error("❌ В .env или Render не найден TOKEN");
  process.exit(1);
}

client.login(process.env.TOKEN);

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");

const {
  Client,
  GatewayIntentBits,
  ActivityType,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");

// =========================
// HTTP-сервер для Render
// =========================

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
  });

  res.end("Hachiko is alive 🐕");
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`);
});

// =========================
// GitHub настройки
// =========================

const DATA_FILE = path.join(__dirname, "users.json");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

let githubSaveTimer = null;
let githubSaveInProgress = false;
let githubSaveAgain = false;

// =========================
// Загрузка пользователей
// =========================

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "{}", "utf8");

      console.log("📁 users.json не найден. Создан новый.");

      return new Map();
    }

    const file = fs.readFileSync(DATA_FILE, "utf8").trim();

    if (!file) {
      console.log("⚠️ users.json пустой. Создаём новую базу.");

      fs.writeFileSync(DATA_FILE, "{}", "utf8");

      return new Map();
    }

    const data = JSON.parse(file);

    console.log(
      `📂 Загружено пользователей: ${Object.keys(data).length}`
    );

    return new Map(Object.entries(data));
  } catch (error) {
    console.error(
      "❌ Ошибка загрузки users.json:",
      error.message
    );

    return new Map();
  }
}

// =========================
// Локальное сохранение
// =========================

function saveUsers() {
  try {
    const data = Object.fromEntries(users);

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    console.log("💾 users.json сохранён локально.");

    scheduleGitHubSave();
  } catch (error) {
    console.error(
      "❌ Ошибка локального сохранения users.json:",
      error.message
    );
  }
}

// =========================
// Планирование GitHub-сохранения
// =========================

function scheduleGitHubSave() {
  if (
    !GITHUB_TOKEN ||
    !GITHUB_OWNER ||
    !GITHUB_REPO
  ) {
    return;
  }

  if (githubSaveTimer) {
    clearTimeout(githubSaveTimer);
  }

  githubSaveTimer = setTimeout(() => {
    saveUsersToGitHub();
  }, 5000);
}

// =========================
// Сохранение users.json в GitHub
// =========================

async function saveUsersToGitHub() {
  if (githubSaveInProgress) {
    githubSaveAgain = true;
    return;
  }

  githubSaveInProgress = true;

  try {
    const filePath = "users.json";

    const rawData = fs.readFileSync(
      DATA_FILE,
      "utf8"
    );

    const encodedContent =
      Buffer.from(rawData).toString("base64");

    const apiUrl =
      `https://api.github.com/repos/` +
      `${GITHUB_OWNER}/` +
      `${GITHUB_REPO}/contents/` +
      `${filePath}`;

    // Получаем SHA существующего файла
    const getResponse = await fetch(
      `${apiUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      {
        method: "GET",

        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,

          Accept:
            "application/vnd.github+json",

          "X-GitHub-Api-Version":
            "2022-11-28",

          "User-Agent":
            "Hachiko-Bot",
        },
      }
    );

    let sha = null;

    if (getResponse.ok) {
      const fileInfo =
        await getResponse.json();

      sha = fileInfo.sha;
    } else if (getResponse.status !== 404) {
      const errorText =
        await getResponse.text();

      throw new Error(
        `GitHub GET ${getResponse.status}: ${errorText}`
      );
    }

    // Отправляем файл в GitHub
    const putResponse = await fetch(
      apiUrl,
      {
        method: "PUT",

        headers: {
          Authorization:
            `Bearer ${GITHUB_TOKEN}`,

          Accept:
            "application/vnd.github+json",

          "Content-Type":
            "application/json",

          "X-GitHub-Api-Version":
            "2022-11-28",

          "User-Agent":
            "Hachiko-Bot",
        },

        body: JSON.stringify({
          message: "Update users.json",

          content: encodedContent,

          branch: GITHUB_BRANCH,

          ...(sha ? { sha } : {}),
        }),
      }
    );

    if (!putResponse.ok) {
      const errorText =
        await putResponse.text();

      throw new Error(
        `GitHub PUT ${putResponse.status}: ${errorText}`
      );
    }

    console.log(
      "☁️ users.json успешно сохранён в GitHub!"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка сохранения в GitHub:",
      error.message
    );
  } finally {
    githubSaveInProgress = false;

    if (githubSaveAgain) {
      githubSaveAgain = false;
      scheduleGitHubSave();
    }
  }
}

// =========================
// Пользователи
// =========================

const users = loadUsers();

// =========================
// Получение пользователя
// =========================

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      xp: 0,
      voiceSeconds: 0,
      joinedAt: null,
      lastMessageXp: 0,
      lastVoiceXp: 0,
    });

    saveUsers();
  }

  const user = users.get(userId);

  // Защита от старых/сломанных данных
  user.xp = Number(user.xp) || 0;
  user.voiceSeconds = Number(user.voiceSeconds) || 0;
  user.lastMessageXp = Number(user.lastMessageXp) || 0;
  user.lastVoiceXp = Number(user.lastVoiceXp) || 0;

  return user;
}

// =========================
// Уровни
// =========================

function getLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function getRequiredXp(level) {
  return level * level * 100;
}

// =========================
// Формат времени
// =========================

function formatTime(seconds) {
  seconds = Math.floor(seconds);

  const hours = Math.floor(seconds / 3600);

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

  const secs = seconds % 60;

  return `${hours}ч ${minutes}м ${secs}с`;
}

// =========================
// Получение времени в войсе
// =========================

function getVoiceTime(user) {
  let seconds = Number(user.voiceSeconds) || 0;

  if (user.joinedAt) {
    seconds += Math.floor(
      (Date.now() - Number(user.joinedAt)) / 1000
    );
  }

  return seconds;
}

// =========================
// Добавление XP
// =========================

function addXp(member, amount) {
  const user = getUser(member.id);

  const oldXp = user.xp;
  const oldLevel = getLevel(oldXp);

  user.xp += amount;

  const newLevel = getLevel(user.xp);

  saveUsers();

  console.log(
    `⭐ ${member.user.username}: +${amount} XP | Всего: ${user.xp}`
  );

  if (newLevel > oldLevel) {
    console.log(
      `🎉 ${member.user.username} достиг ${newLevel} уровня!`
    );

    if (member.guild.systemChannel) {
      member.guild.systemChannel
        .send(
          `🎉 ${member} достиг **${newLevel} уровня**!`
        )
        .catch(() => {});
    }
  }
}

// =========================
// XP за нахождение в войсе
// =========================

function updateVoiceXp() {
  const now = Date.now();

  let changed = false;

  for (const [userId, user] of users) {
    if (!user.joinedAt) {
      continue;
    }

    const elapsedSeconds = Math.floor(
      (now - Number(user.joinedAt)) / 1000
    );

    if (elapsedSeconds < 60) {
      continue;
    }

    const minutesPassed = Math.floor(
      elapsedSeconds / 60
    );

    const minutesRewarded =
      Number(user.lastVoiceXp) || 0;

    const newMinutes =
      minutesPassed - minutesRewarded;

    if (newMinutes <= 0) {
      continue;
    }

    const oldXp = user.xp;

    user.xp += newMinutes;

    user.lastVoiceXp = minutesPassed;

    changed = true;

    const oldLevel = getLevel(oldXp);
    const newLevel = getLevel(user.xp);

    for (const guild of client.guilds.cache.values()) {
      const member =
        guild.members.cache.get(userId);

      if (!member) {
        continue;
      }

      console.log(
        `🎧 ${member.user.username}: +${newMinutes} XP за войс`
      );

      console.log(
        `⭐ Всего XP: ${user.xp}`
      );

      if (
        newLevel > oldLevel &&
        guild.systemChannel
      ) {
        guild.systemChannel
          .send(
            `🎉 ${member} достиг **${newLevel} уровня**!`
          )
          .catch(() => {});
      }

      break;
    }
  }

  if (changed) {
    saveUsers();
  }
}

// Проверяем войс каждую секунду
setInterval(updateVoiceXp, 1000);

// =========================
// Клиент Discord
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
// Гавканье в войсе
// =========================

async function barkInVoice(message) {
  const voiceChannel =
    message.member?.voice?.channel;

  if (!voiceChannel) {
    await message.reply(
      "❌ Ты должен находиться в голосовом канале."
    );

    return;
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator:
        voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();

    const barkNumber =
      Math.floor(Math.random() * 5) + 1;

    const barkFile = path.join(
      __dirname,
      `bark${barkNumber}.mp3`
    );

    if (!fs.existsSync(barkFile)) {
      await message.reply(
        `❌ Файл ${`bark${barkNumber}.mp3`} не найден.`
      );

      return;
    }

    const resource =
      createAudioResource(barkFile);

    connection.subscribe(player);

    player.play(resource);

    console.log(
      `🐕 Гав! ${message.author.username}`
    );

    player.on(
      AudioPlayerStatus.Idle,
      () => {
        try {
          connection.destroy();
        } catch {}
      }
    );

    player.on(
      "error",
      (error) => {
        console.error(
          "❌ Ошибка аудиоплеера:",
          error.message
        );

        try {
          connection.destroy();
        } catch {}
      }
    );
  } catch (error) {
    console.error(
      "❌ Ошибка подключения к войсу:",
      error
    );

    await message.reply(
      "❌ Не получилось подключиться к голосовому каналу."
    );
  }
}

// =========================
// Восстановление голосовых сессий
// =========================

function restoreVoiceSessions() {
  let changed = false;

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) {
        continue;
      }

      for (const member of channel.members.values()) {
        if (member.user.bot) {
          continue;
        }

        const user = getUser(member.id);

        if (!user.joinedAt) {
          user.joinedAt = Date.now();
          user.lastVoiceXp = 0;

          changed = true;

          console.log(
            `🎧 Восстановлен войс: ${member.user.username}`
          );
        }
      }
    }
  }

  if (changed) {
    saveUsers();
  }
}

// =========================
// Бот запущен
// =========================

client.once("ready", () => {
  console.log("");
  console.log("================================");
  console.log("🐕 Hachiko запущен!");
  console.log(`🤖 ${client.user.tag}`);
  console.log(`🌐 Серверов: ${client.guilds.cache.size}`);
  console.log("================================");
  console.log("");

  restoreVoiceSessions();

  client.user.setActivity(
    "!help | Hachiko 🐕",
    {
      type: ActivityType.Watching,
    }
  );

  // Если GitHub настроен
  if (
    GITHUB_TOKEN &&
    GITHUB_OWNER &&
    GITHUB_REPO
  ) {
    console.log(
      `☁️ GitHub сохранение включено: ${GITHUB_OWNER}/${GITHUB_REPO}`
    );
  } else {
    console.log(
      "⚠️ GitHub сохранение НЕ настроено."
    );
  }
});

// =========================
// Сообщения
// =========================

client.on(
  "messageCreate",
  async (message) => {
    if (message.author.bot) {
      return;
    }

    const user = getUser(message.author.id);

    // =========================
    // XP за сообщение
    // =========================

    const now = Date.now();

    if (
      now - Number(user.lastMessageXp) >=
      60 * 1000
    ) {
      user.lastMessageXp = now;

      addXp(message.member, 10);
    }

    // =========================
    // Команда
    // =========================

    if (!message.content.startsWith("!")) {
      return;
    }

    const args =
      message.content
        .trim()
        .split(/\s+/);

    const command =
      args[0].toLowerCase();

    // =========================
    // !ping
    // =========================

    if (command === "!ping") {
      await message.reply(
        `🏓 Pong! ${client.ws.ping}ms`
      );

      return;
    }

    // =========================
    // !woof
    // =========================

    if (command === "!woof") {
      await message.reply("🐕 Гав-гав!");

      return;
    }

    // =========================
    // !gaf / !гав
    // =========================

    if (
      command === "!gaf" ||
      command === "!гав"
    ) {
      await barkInVoice(message);

      return;
    }

    // =========================
    // !help
    // =========================

    if (command === "!help") {
      await message.reply(
        [
          "🐕 **Команды Hachiko:**",
          "",
          "`!ping` — проверить задержку",
          "`!woof` — гавкнуть в чате",
          "`!gaf` — случайный лай в войсе",
          "`!гав` — случайный лай в войсе",
          "`!rank` — твой уровень и XP",
          "`!voicetime` — время в войсе",
          "`!topvoice` — топ по времени в войсе",
          "`!uptime` — время работы бота",
          "`!server` — информация о сервере",
          "`!where` — где находится бот",
          "`!stay` — бот остаётся в войсе",
          "`!leave` — бот выходит из войса",
        ].join("\n")
      );

      return;
    }

    // =========================
    // !rank
    // =========================

    if (command === "!rank") {
      const level = getLevel(user.xp);

      const nextLevelXp =
        getRequiredXp(level);

      const currentLevelXp =
        getRequiredXp(level - 1);

      const xpInLevel =
        user.xp - currentLevelXp;

      const xpNeeded =
        nextLevelXp - currentLevelXp;

      await message.reply(
        [
          `🐕 **${message.author.username}**`,
          "",
          `⭐ Уровень: **${level}**`,
          `✨ XP: **${user.xp}**`,
          `📈 До следующего уровня: **${Math.max(
            0,
            nextLevelXp - user.xp
          )} XP**`,
          `📊 Прогресс: **${xpInLevel}/${xpNeeded}**`,
        ].join("\n")
      );

      return;
    }

    // =========================
    // !voicetime
    // =========================

    if (command === "!voicetime") {
      const seconds =
        getVoiceTime(user);

      await message.reply(
        `🎧 Ты провёл в войсе: **${formatTime(
          seconds
        )}**`
      );

      return;
    }

    // =========================
    // !topvoice
    // =========================

    if (command === "!topvoice") {
      const top = [...users.entries()]
        .map(([id, data]) => ({
          id,
          seconds:
            getVoiceTime(data),
        }))
        .sort(
          (a, b) =>
            b.seconds - a.seconds
        )
        .slice(0, 10);

      if (top.length === 0) {
        await message.reply(
          "📊 Пока никто не проводил время в войсе."
        );

        return;
      }

      const lines = [];

      for (let i = 0; i < top.length; i++) {
        const item = top[i];

        let member = null;

        for (const guild of client.guilds.cache.values()) {
          member =
            guild.members.cache.get(item.id);

          if (member) {
            break;
          }
        }

        const name =
          member?.user?.username ||
          `User ${item.id}`;

        lines.push(
          `**${i + 1}.** ${name} — ${formatTime(
            item.seconds
          )}`
        );
      }

      await message.reply(
        `🏆 **Топ по времени в войсе:**\n\n${lines.join(
          "\n"
        )}`
      );

      return;
    }

    // =========================
    // !uptime
    // =========================

    if (command === "!uptime") {
      await message.reply(
        `⏱️ Бот работает: **${formatTime(
          process.uptime()
        )}**`
      );

      return;
    }

    // =========================
    // !server
    // =========================

    if (command === "!server") {
      const guild = message.guild;

      if (!guild) {
        return;
      }

      await message.reply(
        [
          `🏠 **${guild.name}**`,
          "",
          `👥 Участников: **${guild.memberCount}**`,
          `💬 Каналов: **${guild.channels.cache.size}**`,
          `👑 Владелец: <@${guild.ownerId}>`,
        ].join("\n")
      );

      return;
    }

    // =========================
    // !where
    // =========================

    if (command === "!where") {
      const guilds =
        client.guilds.cache;

      if (guilds.size === 0) {
        await message.reply(
          "❌ Бот сейчас не находится ни на одном сервере."
        );

        return;
      }

      const names =
        guilds.map(
          (guild) =>
            `• **${guild.name}**`
        );

      await message.reply(
        `🌍 Я нахожусь на серверах:\n\n${names.join(
          "\n"
        )}`
      );

      return;
    }

    // =========================
    // !stay
    // =========================

    if (command === "!stay") {
      const voiceChannel =
        message.member?.voice?.channel;

      if (!voiceChannel) {
        await message.reply(
          "❌ Сначала зайди в голосовой канал."
        );

        return;
      }

      try {
        joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator:
            voiceChannel.guild.voiceAdapterCreator,
        });

        await message.reply(
          `🐕 Остаюсь в **${voiceChannel.name}**.`
        );
      } catch (error) {
        console.error(error);

        await message.reply(
          "❌ Не получилось зайти в войс."
        );
      }

      return;
    }

    // =========================
    // !leave
    // =========================

    if (command === "!leave") {
      const guild = message.guild;

      if (!guild) {
        return;
      }

      const connection =
        guild.voiceStates.cache.find(
          (state) =>
            state.member?.user?.id ===
            client.user.id
        );

      if (!connection) {
        await message.reply(
          "🐕 Я сейчас не нахожусь в войсе."
        );

        return;
      }

      try {
        const voiceConnection =
          connection.channel;

        if (voiceConnection) {
          await message.reply(
            `🐕 Выхожу из **${voiceConnection.name}**.`
          );
        }

        // Ищем активное соединение
        const guildAdapter =
          guild.voiceStates.cache;

        for (
          const state of guildAdapter.values()
        ) {
          if (
            state.member?.user?.id ===
            client.user.id
          ) {
            try {
              state.disconnect();
            } catch {}
          }
        }
      } catch (error) {
        console.error(error);

        await message.reply(
          "❌ Не получилось выйти из войса."
        );
      }

      return;
    }
  }
);

// =========================
// Отслеживание войса
// =========================

client.on(
  "voiceStateUpdate",
  (oldState, newState) => {
    const member =
      newState.member || oldState.member;

    if (!member || member.user.bot) {
      return;
    }

    const user =
      getUser(member.id);

    // =========================
    // Зашёл в войс
    // =========================

    if (
      !oldState.channelId &&
      newState.channelId
    ) {
      user.joinedAt = Date.now();

      user.lastVoiceXp = 0;

      saveUsers();

      console.log(
        `🎧 ${member.user.username} зашёл в войс.`
      );

      return;
    }

    // =========================
    // Вышел из войса
    // =========================

    if (
      oldState.channelId &&
      !newState.channelId
    ) {
      if (user.joinedAt) {
        const sessionSeconds =
          Math.floor(
            (Date.now() -
              Number(user.joinedAt)) /
              1000
          );

        user.voiceSeconds +=
          sessionSeconds;
      }

      user.joinedAt = null;

      user.lastVoiceXp = 0;

      saveUsers();

      console.log(
        `🎧 ${member.user.username} вышел из войса.`
      );

      return;
    }

    // =========================
    // Перешёл между каналами
    // =========================

    if (
      oldState.channelId &&
      newState.channelId &&
      oldState.channelId !==
        newState.channelId
    ) {
      console.log(
        `🔄 ${member.user.username} перешёл в другой войс.`
      );
    }
  }
);

// =========================
// Graceful shutdown
// =========================

async function shutdown(signal) {
  console.log(
    `🛑 Получен сигнал ${signal}. Сохраняем данные...`
  );

  saveUsers();

  // Даём GitHub немного времени сохранить файл
  if (
    GITHUB_TOKEN &&
    GITHUB_OWNER &&
    GITHUB_REPO
  ) {
    try {
      await saveUsersToGitHub();
    } catch {}
  }

  try {
    client.destroy();
  } catch {}

  try {
    server.close();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

// =========================
// Запуск
// =========================

if (!process.env.TOKEN) {
  console.error(
    "❌ TOKEN не найден в переменных окружения."
  );

  process.exit(1);
}

client.login(process.env.TOKEN);

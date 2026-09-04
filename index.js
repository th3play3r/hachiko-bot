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
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
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
// Сохранение пользователей
// =========================

const DATA_FILE = path.join(__dirname, "users.json");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

let githubSaveTimer = null;
let githubSaveInProgress = false;
let githubSaveAgain = false;

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "{}", "utf8");
      return new Map();
    }

    const file = fs.readFileSync(DATA_FILE, "utf8").trim();

    // Пустой файл считаем пустой базой
    if (!file) {
      console.log("⚠️ users.json пустой. Создаём новую базу.");
      fs.writeFileSync(DATA_FILE, "{}", "utf8");
      return new Map();
    }

    const data = JSON.parse(file);

    return new Map(Object.entries(data));
  } catch (error) {
    console.error(
      "❌ Ошибка загрузки users.json:",
      error
    );

    // Если JSON повреждён, не даём боту упасть
    try {
      fs.writeFileSync(
        DATA_FILE,
        "{}",
        "utf8"
      );
    } catch {}

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

    console.log("💾 users.json сохранён локально.");

    // Не делаем GitHub commit каждую секунду.
    // Ждём 5 секунд после последнего изменения.
    scheduleGitHubSave();

  } catch (error) {
    console.error(
      "❌ Ошибка локального сохранения users.json:",
      error
    );
  }
}

function scheduleGitHubSave() {
  if (
    !GITHUB_TOKEN ||
    !GITHUB_OWNER ||
    !GITHUB_REPO
  ) {
    console.log(
      "⚠️ GitHub сохранение отключено: нет GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO"
    );

    return;
  }

  if (githubSaveTimer) {
    clearTimeout(githubSaveTimer);
  }

  githubSaveTimer = setTimeout(() => {
    saveUsersToGitHub();
  }, 5000);
}

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

    // Сначала узнаём SHA текущего файла
    const getResponse = await fetch(
      `${apiUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${GITHUB_TOKEN}`,

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

    // Загружаем новый users.json
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
          message:
            "Update users.json",

          content:
            encodedContent,

          branch:
            GITHUB_BRANCH,

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
      "❌ Ошибка сохранения users.json в GitHub:",
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
// Пользователь
// =========================

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      xp: 0,

      // Общее время в войсе
      voiceSeconds: 0,

      // Время начала текущей голосовой сессии
      joinedAt: null,

      // Последний раз, когда выдавался XP за сообщение
      lastMessageXp: 0,

      // Сколько минут уже оплачено XP
      // в текущей голосовой сессии
      lastVoiceXp: 0,
    });
  }

  const user = users.get(userId);

  // Защита от старых users.json
  user.xp = Number(user.xp) || 0;

  user.voiceSeconds =
    Number(user.voiceSeconds) || 0;

  user.joinedAt = user.joinedAt
    ? Number(user.joinedAt)
    : null;

  user.lastMessageXp =
    Number(user.lastMessageXp) || 0;

  user.lastVoiceXp =
    Number(user.lastVoiceXp) || 0;

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
// Форматирование времени
// =========================

function formatTime(seconds) {
  seconds = Math.floor(seconds);

  const hours = Math.floor(seconds / 3600);

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

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

// =========================
// Время пользователя в войсе
// =========================

function getVoiceTime(userData) {
  let total =
    Number(userData.voiceSeconds) || 0;

  // Если человек сейчас в войсе,
  // добавляем текущую незавершённую сессию
  if (userData.joinedAt) {
    total += Math.floor(
      (Date.now() -
        Number(userData.joinedAt)) /
        1000
    );
  }

  return total;
}

// =========================
// Добавление XP
// =========================

function addXp(member, amount) {
  const user = getUser(member.id);

  const oldLevel = getLevel(user.xp);

  user.xp += Number(amount) || 0;

  const newLevel = getLevel(user.xp);

  saveUsers();

  console.log(
    `✨ ${member.user.username} получил ${amount} XP. Всего: ${user.xp}`
  );

  // Повышение уровня
  if (
    newLevel > oldLevel &&
    member.guild.systemChannel
  ) {
    member.guild.systemChannel
      .send(
        `🎉 ${member} достиг **${newLevel} уровня**!`
      )
      .catch(() => {});
  }
}

// =========================
// XP за нахождение в войсе
// =========================
//
// Каждые 60 секунд:
// +1 XP
//
// Затико не обязан находиться в войсе.
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

    // +1 XP за каждую минуту
    user.xp += newMinutes;

    user.lastVoiceXp = minutesPassed;

    changed = true;

    // Ищем пользователя на сервере
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

      const oldLevel = getLevel(oldXp);
      const newLevel = getLevel(user.xp);

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

// =========================
// Запускаем проверку XP
// =========================
//
// Проверяем каждую секунду.
//
// Сам XP всё равно выдаётся
// только за полные минуты.
// =========================

setInterval(() => {
  updateVoiceXp();
}, 1000);

// =========================
// 5 случайных лаев
// =========================

async function barkInVoice(message) {
  const voiceChannel =
    message.member.voice.channel;

  if (!voiceChannel) {
    return message.reply(
      "❌ Сначала зайди в голосовой канал."
    );
  }

  let connection =
    getVoiceConnection(
      message.guild.id
    );

  if (!connection) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,

      guildId: message.guild.id,

      adapterCreator:
        voiceChannel.guild
          .voiceAdapterCreator,

      selfDeaf: false,
      selfMute: false,
    });

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        30_000
      );
    } catch (error) {
      console.error(
        "❌ Ошибка подключения к войсу:",
        error
      );

      connection.destroy();

      return message.reply(
        "❌ Не получилось подключиться к голосовому каналу."
      );
    }
  }

  const barkFiles = [
    "bark1.mp3",
    "bark2.mp3",
    "bark3.mp3",
    "bark4.mp3",
    "bark5.mp3",
  ];

  const randomBark =
    barkFiles[
      Math.floor(
        Math.random() * barkFiles.length
      )
    ];

  const barkPath = path.join(
    __dirname,
    randomBark
  );

  if (!fs.existsSync(barkPath)) {
    return message.reply(
      `❌ Не найден файл \`${randomBark}\`.`
    );
  }

  const player =
    createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Play,
      },
    });

  const resource =
    createAudioResource(
      barkPath
    );

  connection.subscribe(player);

  player.play(resource);

  await message.reply(
    `🐕 Хатико гавкнул: \`${randomBark}\``
  );

  player.on(
    AudioPlayerStatus.Idle,
    () => {
      player.stop();
    }
  );

  player.on(
    "error",
    (error) => {
      console.error(
        "❌ Ошибка воспроизведения:",
        error
      );
    }
  );
}

// =========================
// Восстановление голосовых сессий
// =========================

function restoreVoiceSessions() {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) {
        continue;
      }

      for (const member of channel.members.values()) {
        if (member.user.bot) {
          continue;
        }

        const data =
          getUser(member.id);

        // Если бот перезапустился,
        // а пользователь всё ещё в войсе
        if (!data.joinedAt) {
          data.joinedAt = Date.now();

          // Новая сессия
          data.lastVoiceXp = 0;

          saveUsers();

          console.log(
            `🔄 Восстановлена голосовая сессия: ${member.user.tag}`
          );
        }
      }
    }
  }
}

// =========================
// Запуск Discord
// =========================

client.once(
  "clientReady",
  () => {
    console.log(
      `🐕 Hachiko запущен: ${client.user.tag}`
    );

    // Проверяем, кто уже находится в войсе
    restoreVoiceSessions();

    client.user.setActivity(
      "за голосовыми каналами",
      {
        type: ActivityType.Watching,
      }
    );
  }
);

// =========================
// Команды + XP за сообщения
// =========================

client.on(
  "messageCreate",
  async (message) => {
    // Не выдаём XP ботам
    if (message.author.bot) {
      return;
    }

    const member =
      message.member;

    // =========================
    // XP за сообщения
    // =========================

    if (member) {
      const user =
        getUser(member.id);

      const now = Date.now();

      // 10 XP раз в минуту
      if (
        now -
          user.lastMessageXp >=
        60_000
      ) {
        user.lastMessageXp = now;

        addXp(member, 10);
      }
    }

    // =========================
    // Команда
    // =========================

    const content =
      message.content.trim();

    if (!content) {
      return;
    }

    const args =
      content.split(/\s+/);

    const command =
      args
        .shift()
        .toLowerCase();

    // =========================
    // !ping
    // =========================

    if (command === "!ping") {
      return message.reply(
        `🏓 Pong! Задержка: ${client.ws.ping} мс`
      );
    }

    // =========================
    // !woof
    // =========================

    if (command === "!woof") {
      return message.reply(
        "🐕 Гав-гав!"
      );
    }

    // =========================
    // !gaf / !гав
    // =========================

    if (
      command === "!gaf" ||
      command === "!гав"
    ) {
      return barkInVoice(message);
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
          "`!woof` — гавкнуть в чате",
          "`!gaf` — случайный лай в войсе",
          "`!rank` — твой уровень и XP",
          "`!voicetime` — время в войсе",
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
      const user =
        getUser(
          message.author.id
        );

      const level =
        getLevel(user.xp);

      const nextLevelXp =
        getRequiredXp(level);

      const voiceTime =
        getVoiceTime(user);

      return message.reply(
        [
          `📊 **Статистика ${message.author.username}**`,
          "",
          `⭐ Уровень: **${level}**`,
          `✨ XP: **${user.xp}/${nextLevelXp}**`,
          `🎧 Время в войсе: **${formatTime(
            voiceTime
          )}**`,
        ].join("\n")
      );
    }

    // =========================
    // !voicetime
    // =========================

    if (
      command === "!voicetime"
    ) {
      const target =
        message.mentions.members.first() ||
        message.member;

      const user =
        getUser(target.id);

      const voiceTime =
        getVoiceTime(user);

      return message.reply(
        `🎧 ${target.user.username} провёл в войсе **${formatTime(
          voiceTime
        )}**`
      );
    }

    // =========================
    // !topvoice
    // =========================

    if (
      command === "!topvoice"
    ) {
      const sorted =
        [...users.entries()]
          .map(
            ([userId, data]) => ({
              userId,

              seconds:
                getVoiceTime(data),
            })
          )
          .sort(
            (a, b) =>
              b.seconds -
              a.seconds
          )
          .slice(0, 10);

      if (
        sorted.length === 0
      ) {
        return message.reply(
          "Пока никто не накопил время в войсе."
        );
      }

      const lines = [];

      for (
        let i = 0;
        i < sorted.length;
        i++
      ) {
        const item =
          sorted[i];

        let name =
          `Пользователь ${item.userId}`;

        try {
          const member =
            await message.guild.members.fetch(
              item.userId
            );

          name =
            member.user.username;
        } catch {
          // Пользователь мог покинуть сервер
        }

        lines.push(
          `**${i + 1}.** ${name} — ${formatTime(
            item.seconds
          )}`
        );
      }

      return message.reply(
        `🏆 **Топ по времени в войсе:**\n${lines.join(
          "\n"
        )}`
      );
    }

    // =========================
    // !uptime
    // =========================

    if (
      command === "!uptime"
    ) {
      return message.reply(
        `⏱️ Бот работает: **${formatTime(
          Math.floor(
            process.uptime()
          )
        )}**`
      );
    }

    // =========================
    // !server
    // =========================

    if (
      command === "!server"
    ) {
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

    if (
      command === "!where"
    ) {
      const voiceChannel =
        message.member.voice.channel;

      if (!voiceChannel) {
        return message.reply(
          "❌ Ты сейчас не находишься в войсе."
        );
      }

      return message.reply(
        `🎧 Ты находишься в канале **${voiceChannel.name}**`
      );
    }

    // =========================
    // !stay
    // =========================

    if (
      command === "!stay"
    ) {
      const voiceChannel =
        message.member.voice.channel;

      if (!voiceChannel) {
        return message.reply(
          "❌ Сначала зайди в голосовой канал."
        );
      }

      const oldConnection =
        getVoiceConnection(
          message.guild.id
        );

      if (oldConnection) {
        oldConnection.destroy();
      }

      const connection =
        joinVoiceChannel({
          channelId:
            voiceChannel.id,

          guildId:
            message.guild.id,

          adapterCreator:
            voiceChannel.guild
              .voiceAdapterCreator,

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
        console.error(
          "❌ Ошибка подключения:",
          error
        );

        connection.destroy();

        return message.reply(
          "❌ Не удалось подключиться к голосовому каналу."
        );
      }
    }

    // =========================
    // !leave
    // =========================

    if (
      command === "!leave"
    ) {
      const connection =
        getVoiceConnection(
          message.guild.id
        );

      if (!connection) {
        return message.reply(
          "❌ Я сейчас не нахожусь в войсе."
        );
      }

      connection.destroy();

      return message.reply(
        "👋 Я вышел из голосового канала."
      );
    }
  }
);

// =========================
// Отслеживание голосовых каналов
// =========================
//
// Бот НЕ должен находиться в войсе.
// Discord сообщает ему:
// кто вошёл,
// кто вышел,
// кто перешёл в другой канал.
// =========================

client.on(
  "voiceStateUpdate",
  (oldState, newState) => {
    const member =
      newState.member ||
      oldState.member;

    if (
      !member ||
      member.user.bot
    ) {
      return;
    }

    const user =
      getUser(member.id);

    const wasInVoice =
      Boolean(oldState.channelId);

    const isNowInVoice =
      Boolean(newState.channelId);

    // =========================
    // Пользователь вошёл в войс
    // =========================

    if (
      !wasInVoice &&
      isNowInVoice
    ) {
      user.joinedAt =
        Date.now();

      // Начинаем новую сессию
      user.lastVoiceXp = 0;

      saveUsers();

      console.log(
        `🎧 ${member.user.username} зашёл в войс`
      );

      return;
    }

    // =========================
    // Пользователь вышел из войса
    // =========================

    if (
      wasInVoice &&
      !isNowInVoice
    ) {
      if (user.joinedAt) {
        const seconds =
          Math.floor(
            (Date.now() -
              Number(
                user.joinedAt
              )) /
              1000
          );

        const safeSeconds =
          Math.max(
            0,
            seconds
          );

        // Сохраняем общее время
        user.voiceSeconds +=
          safeSeconds;

        console.log(
          `👋 ${member.user.username} вышел из войса`
        );

        console.log(
          `🎧 Добавлено времени: ${safeSeconds} сек.`
        );

        console.log(
          `✨ XP за войс уже начислялся автоматически`
        );

        // Закрываем сессию
        user.joinedAt =
          null;

        user.lastVoiceXp =
          0;

        saveUsers();
      }

      return;
    }

    // =========================
    // Переход между каналами
    // =========================

    if (
      wasInVoice &&
      isNowInVoice &&
      oldState.channelId !==
        newState.channelId
    ) {
      console.log(
        `🔄 ${member.user.username} перешёл в другой голосовой канал`
      );

      // Время НЕ сбрасываем.
      //
      // Пользователь продолжает
      // одну и ту же голосовую сессию.

      saveUsers();

      return;
    }
  }
);

// =========================
// Авторизация
// =========================

if (!process.env.TOKEN) {
  console.error(
    "❌ TOKEN не найден."
  );

  process.exit(1);
}

client.login(
  process.env.TOKEN
);

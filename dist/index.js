// src/env.js
var ENV_VALUE_TYPE = {
  API_KEY: "string"
};
var ENV = {
  // OpenAI API Key
  API_KEY: null,
  // OpenAI model name
  CHAT_MODEL: "gpt-3.5-turbo",
  // Allowed Telegram Token, split with comma
  TELEGRAM_AVAILABLE_TOKENS: [],
  // Allowed Bot name for Telegram Token, split with comma
  TELEGRAM_BOT_NAME: [],
  // Allow all users
  I_AM_A_GENEROUS_PERSON: false,
  // Whitelist
  CHAT_WHITE_LIST: [],
  // Group whitelist
  CHAT_GROUP_WHITE_LIST: [],
  // Group chat bot
  GROUP_CHAT_BOT_ENABLE: true,
  // Enable: everyone in the group has his own session. Disable: one session for one group.
  GROUP_CHAT_BOT_SHARE_MODE: false,
  // Trim message to avoid 4096 char limit
  AUTO_TRIM_HISTORY: true,
  MAX_HISTORY_LENGTH: 20,
  DEBUG_MODE: false,
  // Current version
  BUILD_TIMESTAMP: 1678341846,
  // Current commit id
  BUILD_VERSION: "ac529da",
  // Global init message
  SYSTEM_INIT_MESSAGE: "You are a helpful assistant."
};
var CONST = {
  PASSWORD_KEY: "chat_history_password",
  GROUP_TYPES: ["group", "supergroup"]
};
var DATABASE = null;
function initEnv(env) {
  DATABASE = env.DATABASE;
  for (const key in ENV) {
    if (env[key]) {
      switch (ENV_VALUE_TYPE[key] || typeof ENV[key]) {
        case "number":
          ENV[key] = parseInt(env[key]) || ENV[key];
          break;
        case "boolean":
          ENV[key] = (env[key] || "false") === "true";
          break;
        case "string":
          ENV[key] = env[key];
          break;
        case "object":
          if (Array.isArray(ENV[key])) {
            ENV[key] = env[key].split(",");
          } else {
            try {
              ENV[key] = JSON.parse(env[key]);
            } catch (e) {
              console.error(e);
            }
          }
          break;
        default:
          ENV[key] = env[key];
          break;
      }
    }
  }
  {
    if (env.TELEGRAM_TOKEN && !ENV.TELEGRAM_AVAILABLE_TOKENS.includes(env.TELEGRAM_TOKEN)) {
      if (env.BOT_NAME && ENV.TELEGRAM_AVAILABLE_TOKENS.length === ENV.TELEGRAM_BOT_NAME.length) {
        ENV.TELEGRAM_BOT_NAME.push(env.BOT_NAME);
      }
      ENV.TELEGRAM_AVAILABLE_TOKENS.push(env.TELEGRAM_TOKEN);
    }
  }
}

// src/utils.js
function randomString(length) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = length; i > 0; --i)
    result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}
async function historyPassword() {
  let password = await DATABASE.get(CONST.PASSWORD_KEY);
  if (password === null) {
    password = randomString(32);
    await DATABASE.put(CONST.PASSWORD_KEY, password);
  }
  return password;
}
function renderHTML(body) {
  return `
<html>  
  <head>
    <title>ChatGPT-Telegram-Workers</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="ChatGPT-Telegram-Workers">
    <meta name="author" content="TBXark">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        font-size: 1rem;
        font-weight: 400;
        line-height: 1.5;
        color: #212529;
        text-align: left;
        background-color: #fff;
      }
      h1 {
        margin-top: 0;
        margin-bottom: 0.5rem;
      }
      p {
        margin-top: 0;
        margin-bottom: 1rem;
      }
      a {
        color: #007bff;
        text-decoration: none;
        background-color: transparent;
      }
      a:hover {
        color: #0056b3;
        text-decoration: underline;
      }
      strong {
        font-weight: bolder;
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>
  `;
}
async function retry(fn, maxAttemptCount, retryInterval = 100) {
  for (let i = 0; i < maxAttemptCount; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxAttemptCount - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }
}
function errorToString(e) {
  return JSON.stringify({
    message: e.message,
    stack: e.stack
  });
}

// src/context.js
var USER_CONFIG = {
  SYSTEM_INIT_MESSAGE: ENV.SYSTEM_INIT_MESSAGE,
  OPENAI_API_EXTRA_PARAMS: {}
};
var CURRENT_CHAT_CONTEXT = {
  chat_id: null,
  reply_to_message_id: null,
  // if it is group msg, it should be msg id, otherwise null
  parse_mode: "Markdown"
};
var SHARE_CONTEXT = {
  currentBotId: null,
  currentBotToken: null,
  currentBotName: null,
  chatHistoryKey: null,
  // history:chat_id:bot_id:(from_id)
  configStoreKey: null,
  // user_config:chat_id:bot_id:(from_id)
  groupAdminKey: null,
  // group_admin:group_id
  usageKey: null,
  // usage:bot_id
  chatType: null,
  // chat type: private/group/supergroup, from message.chat.type
  chatId: null,
  // chat id, private type: chatid, group/supergroup type: group id
  speakerId: null
  // chat id
};
async function initUserConfig(id) {
  return retry(async function() {
    const userConfig = await DATABASE.get(SHARE_CONTEXT.configStoreKey).then(
      (res) => JSON.parse(res) || {}
    );
    for (const key in userConfig) {
      if (USER_CONFIG.hasOwnProperty(key) && typeof USER_CONFIG[key] === typeof userConfig[key]) {
        USER_CONFIG[key] = userConfig[key];
      }
    }
  }, 3, 500);
}

// src/telegram.js
async function sendMessageToTelegram(message, token, context) {
  const resp = await fetch(
    `https://api.telegram.org/bot${token || SHARE_CONTEXT.currentBotToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...context || CURRENT_CHAT_CONTEXT,
        text: message
      })
    }
  );
  const json = await resp.json();
  if (!resp.ok) {
    return sendMessageToTelegramFallback(json, message, token, context);
  }
  return new Response(JSON.stringify(json), {
    status: 200,
    statusText: resp.statusText,
    headers: resp.headers
  });
}
async function sendMessageToTelegramFallback(json, message, token, context) {
  if (json.description === "Bad Request: replied message not found") {
    delete context.reply_to_message_id;
    return sendMessageToTelegram(message, token, context);
  }
  return new Response(JSON.stringify(json), { status: 200 });
}
async function sendChatActionToTelegram(action, token) {
  return await fetch(
    `https://api.telegram.org/bot${token || SHARE_CONTEXT.currentBotToken}/sendChatAction`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: CURRENT_CHAT_CONTEXT.chat_id,
        action
      })
    }
  ).then((res) => res.json());
}
async function bindTelegramWebHook(token, url) {
  return await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url
      })
    }
  ).then((res) => res.json());
}
async function getChatRole(id) {
  let groupAdmin;
  try {
    groupAdmin = await DATABASE.get(SHARE_CONTEXT.groupAdminKey).then(
      (res) => JSON.parse(res)
    );
  } catch (e) {
    console.error(e);
    return e.message;
  }
  if (!groupAdmin || !Array.isArray(groupAdmin) || groupAdmin.length === 0) {
    const administers = await getChatAdminister(CURRENT_CHAT_CONTEXT.chat_id);
    if (administers == null) {
      return null;
    }
    groupAdmin = administers;
    await DATABASE.put(
      SHARE_CONTEXT.groupAdminKey,
      JSON.stringify(groupAdmin),
      { expiration: parseInt(Date.now() / 1e3) + 120 }
    );
  }
  for (let i = 0; i < groupAdmin.length; i++) {
    const user = groupAdmin[i];
    if (user.user.id === id) {
      return user.status;
    }
  }
  return "member";
}
async function getChatAdminister(chatId, token) {
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${token || SHARE_CONTEXT.currentBotToken}/getChatAdministrators`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ chat_id: chatId })
      }
    ).then((res) => res.json());
    if (resp.ok) {
      return resp.result;
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}
async function getBot(token) {
  const resp = await fetch(
    `https://api.telegram.org/bot${token}/getMe`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    }
  ).then((res) => res.json());
  if (resp.ok) {
    return {
      ok: true,
      info: {
        name: resp.result.first_name,
        bot_name: resp.result.username,
        can_join_groups: resp.result.can_join_groups,
        can_read_all_group_messages: resp.result.can_read_all_group_messages
      }
    };
  } else {
    return resp;
  }
}

// src/openai.js
async function sendMessageToChatGPT(message, history) {
  try {
    const body = {
      model: ENV.CHAT_MODEL,
      ...USER_CONFIG.OPENAI_API_EXTRA_PARAMS,
      messages: [...history || [], { role: "user", content: message }]
    };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ENV.API_KEY}`
      },
      body: JSON.stringify(body)
    }).then((res) => res.json());
    if (resp.error?.message) {
      return `OpenAI API error
> ${resp.error.message}}`;
    }
    setTimeout(() => updateBotUsage(resp.usage), 0);
    return resp.choices[0].message.content;
  } catch (e) {
    console.error(e);
    return `I have no idea how to answer
> ${e.message}}`;
  }
}
async function updateBotUsage(usage) {
  let dbValue = await DATABASE.get(SHARE_CONTEXT.usageKey).then((res) => JSON.parse(res));
  if (!dbValue) {
    dbValue = {
      tokens: {
        total: 0,
        chats: {}
      }
    };
  }
  dbValue.tokens.total += usage.total_tokens;
  if (!dbValue.tokens.chats[SHARE_CONTEXT.chatId]) {
    dbValue.tokens.chats[SHARE_CONTEXT.chatId] = usage.total_tokens;
  } else {
    dbValue.tokens.chats[SHARE_CONTEXT.chatId] += usage.total_tokens;
  }
  await DATABASE.put(SHARE_CONTEXT.usageKey, JSON.stringify(dbValue));
}

// src/command.js
function defaultGroupAuthCheck() {
  if (CONST.GROUP_TYPES.includes(SHARE_CONTEXT.chatType)) {
    return ["administrator", "creator"];
  }
  return false;
}
function shareModeGroupAuthCheck() {
  if (CONST.GROUP_TYPES.includes(SHARE_CONTEXT.chatType)) {
    if (!ENV.GROUP_CHAT_BOT_SHARE_MODE) {
      return false;
    }
    return ["administrator", "creator"];
  }
  return false;
}
var commandHandlers = {
  "/help": {
    help: "Get help",
    scopes: ["all_private_chats", "all_chat_administrators"],
    fn: commandGetHelp
  },
  "/new": {
    help: "Start a new conversation",
    scopes: ["all_private_chats", "all_group_chats", "all_chat_administrators"],
    fn: commandCreateNewChatContext,
    needAuth: shareModeGroupAuthCheck
  },
  "/start": {
    help: "Get your id and start a new conversation",
    scopes: ["all_private_chats", "all_chat_administrators"],
    fn: commandCreateNewChatContext,
    needAuth: defaultGroupAuthCheck
  },
  "/version": {
    help: "Check update",
    scopes: ["all_private_chats", "all_chat_administrators"],
    fn: commandFetchUpdate,
    needAuth: defaultGroupAuthCheck
  },
  "/setenv": {
    help: "Set user configuration, the command is /setenv KEY=VALUE",
    scopes: [],
    fn: commandUpdateUserConfig,
    needAuth: shareModeGroupAuthCheck
  },
  "/usage": {
    help: "Get usage",
    scopes: ["all_private_chats", "all_chat_administrators"],
    fn: commandUsage,
    needAuth: defaultGroupAuthCheck
  },
  "/system": {
    help: "Check system info",
    scopes: ["all_private_chats", "all_chat_administrators"],
    fn: commandSystem,
    needAuth: defaultGroupAuthCheck
  }
};
async function commandGetHelp(message, command, subcommand) {
  const helpMsg = "The following commands are supported:\n" + Object.keys(commandHandlers).map((key) => `${key}: ${commandHandlers[key].help}`).join("\n");
  return sendMessageToTelegram(helpMsg);
}
async function commandCreateNewChatContext(message, command, subcommand) {
  try {
    await DATABASE.delete(SHARE_CONTEXT.chatHistoryKey);
    if (command === "/new") {
      return sendMessageToTelegram("A new conversation has started");
    } else {
      if (SHARE_CONTEXT.chatType === "private") {
        return sendMessageToTelegram(
          `A new conversation has started, your id: (${CURRENT_CHAT_CONTEXT.chat_id})`
        );
      } else {
        return sendMessageToTelegram(
          `A new conversation has started, group id: (${CURRENT_CHAT_CONTEXT.chat_id})`
        );
      }
    }
  } catch (e) {
    return sendMessageToTelegram(`ERROR: ${e.message}`);
  }
}
async function commandUpdateUserConfig(message, command, subcommand) {
  const kv = subcommand.indexOf("=");
  if (kv === -1) {
    return sendMessageToTelegram(
      "Configuration error: the format is: /setenv KEY=VALUE"
    );
  }
  const key = subcommand.slice(0, kv);
  const value = subcommand.slice(kv + 1);
  try {
    switch (typeof USER_CONFIG[key]) {
      case "number":
        USER_CONFIG[key] = Number(value);
        break;
      case "boolean":
        USER_CONFIG[key] = value === "true";
        break;
      case "string":
        USER_CONFIG[key] = value;
        break;
      case "object":
        const object = JSON.parse(value);
        if (typeof object === "object") {
          USER_CONFIG[key] = object;
          break;
        }
        return sendMessageToTelegram("Unsupported configuration item or data type error");
      default:
        return sendMessageToTelegram("Unsupported configuration item or data type error");
    }
    await DATABASE.put(
      SHARE_CONTEXT.configStoreKey,
      JSON.stringify(USER_CONFIG)
    );
    return sendMessageToTelegram("Configuration updated");
  } catch (e) {
    return sendMessageToTelegram(`Configuration format error: ${e.message}`);
  }
}
async function commandFetchUpdate(message, command, subcommand) {
  const config = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0"
    }
  };
  const ts = "https://raw.githubusercontent.com/TBXark/ChatGPT-Telegram-Workers/master/dist/timestamp";
  const sha = "https://api.github.com/repos/TBXark/ChatGPT-Telegram-Workers/commits/master";
  const shaValue = await fetch(sha, config).then((res) => res.json()).then((res) => res.sha.slice(0, 7));
  const tsValue = await fetch(ts, config).then((res) => res.text()).then((res) => Number(res.trim()));
  const current = {
    ts: ENV.BUILD_TIMESTAMP,
    sha: ENV.BUILD_VERSION
  };
  const online = {
    ts: tsValue,
    sha: shaValue
  };
  if (current.ts < online.ts) {
    return sendMessageToTelegram(
      `New version found. Current version: ${JSON.stringify(current)}. Latest version: ${JSON.stringify(online)}`
    );
  } else {
    return sendMessageToTelegram(`Using the latest version: ${JSON.stringify(current)}`);
  }
}
async function commandUsage() {
  const usage = await DATABASE.get(SHARE_CONTEXT.usageKey).then((res) => JSON.parse(res));
  let text = "\u{1F4CA} Current usage:\n\n";
  text += "Tokens:\n";
  if (usage?.tokens) {
    const { tokens } = usage;
    const sortedChats = Object.keys(tokens.chats || {}).sort((a, b) => tokens.chats[b] - tokens.chats[a]);
    let i = 0;
    text += `- Total usage: ${tokens.total || 0} tokens
- Usage for chats:`;
    for (const chatId of sortedChats) {
      if (i === 30) {
        text += "\n  ...";
        break;
      }
      i++;
      text += `
  - ${chatId}: ${tokens.chats[chatId]} tokens`;
    }
    if (!i) {
      text += "0 tokens";
    }
  } else {
    text += "- No usage";
  }
  return sendMessageToTelegram(text);
}
async function commandSystem(message) {
  let msg = `System info:
`;
  msg += "Current chat model:" + ENV.CHAT_MODEL + "\n";
  return sendMessageToTelegram(msg);
}
async function handleCommandMessage(message) {
  for (const key in commandHandlers) {
    if (message.text === key || message.text.startsWith(key + " ")) {
      const command = commandHandlers[key];
      try {
        if (command.needAuth) {
          const roleList = command.needAuth();
          if (roleList) {
            const chatRole = await getChatRole(SHARE_CONTEXT.speakerId);
            if (chatRole === null) {
              return sendMessageToTelegram("Authentication failed");
            }
            if (!roleList.includes(chatRole)) {
              return sendMessageToTelegram(`No access. ${roleList.join(",")} needed, current role: ${chatRole}`);
            }
          }
        }
      } catch (e) {
        return sendMessageToTelegram(`Authentication error:` + e.message);
      }
      const subcommand = message.text.substring(key.length).trim();
      try {
        return await command.fn(message, key, subcommand);
      } catch (e) {
        return sendMessageToTelegram(`Command execution error: ${e.message}`);
      }
    }
  }
  return null;
}
async function bindCommandForTelegram(token) {
  const scopeCommandMap = {};
  for (const key in commandHandlers) {
    if (commandHandlers.hasOwnProperty(key) && commandHandlers[key].scopes) {
      for (const scope of commandHandlers[key].scopes) {
        if (!scopeCommandMap[scope]) {
          scopeCommandMap[scope] = [];
        }
        scopeCommandMap[scope].push(key);
      }
    }
  }
  const result = {};
  for (const scope in scopeCommandMap) {
    result[scope] = await fetch(
      `https://api.telegram.org/bot${token}/setMyCommands`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          commands: scopeCommandMap[scope].map((command) => ({
            command,
            description: commandHandlers[command].help
          })),
          scope: {
            type: scope
          }
        })
      }
    ).then((res) => res.json());
  }
  return { ok: true, result };
}
function commandsHelp() {
  return Object.keys(commandHandlers).map((key) => {
    const command = commandHandlers[key];
    return {
      command: key,
      description: command.help
    };
  });
}

// src/message.js
var MAX_TOKEN_LENGTH = 2048;
async function msgInitTelegramToken(message, request) {
  try {
    const { pathname } = new URL(request.url);
    const token = pathname.match(
      /^\/telegram\/(\d+:[A-Za-z0-9_-]{35})\/webhook/
    )[1];
    const telegramIndex = ENV.TELEGRAM_AVAILABLE_TOKENS.indexOf(token);
    if (telegramIndex === -1) {
      throw new Error("Token not found");
    }
    SHARE_CONTEXT.currentBotToken = token;
    SHARE_CONTEXT.currentBotId = token.split(":")[0];
    SHARE_CONTEXT.usageKey = `usage:${SHARE_CONTEXT.currentBotId}`;
    if (ENV.TELEGRAM_BOT_NAME.length > telegramIndex) {
      SHARE_CONTEXT.currentBotName = ENV.TELEGRAM_BOT_NAME[telegramIndex];
    }
  } catch (e) {
    return new Response(
      e.message,
      { status: 200 }
    );
  }
}
async function msgInitChatContext(message) {
  const id = message?.chat?.id;
  if (id === void 0 || id === null) {
    return new Response("ID NOT FOUND", { status: 200 });
  }
  let historyKey = `history:${id}`;
  let configStoreKey = `user_config:${id}`;
  let groupAdminKey = null;
  await initUserConfig(id);
  CURRENT_CHAT_CONTEXT.chat_id = id;
  if (SHARE_CONTEXT.currentBotId) {
    historyKey += `:${SHARE_CONTEXT.currentBotId}`;
    configStoreKey += `:${SHARE_CONTEXT.currentBotId}`;
  }
  if (CONST.GROUP_TYPES.includes(message.chat?.type)) {
    CURRENT_CHAT_CONTEXT.reply_to_message_id = message.message_id;
    if (!ENV.GROUP_CHAT_BOT_SHARE_MODE && message.from.id) {
      historyKey += `:${message.from.id}`;
      configStoreKey += `:${message.from.id}`;
    }
    groupAdminKey = `group_admin:${id}`;
  }
  SHARE_CONTEXT.chatHistoryKey = historyKey;
  SHARE_CONTEXT.configStoreKey = configStoreKey;
  SHARE_CONTEXT.groupAdminKey = groupAdminKey;
  SHARE_CONTEXT.chatType = message.chat?.type;
  SHARE_CONTEXT.chatId = message.chat.id;
  SHARE_CONTEXT.speakerId = message.from.id || message.chat.id;
  return null;
}
async function msgSaveLastMessage(message) {
  if (ENV.DEBUG_MODE) {
    const lastMessageKey = `last_message:${SHARE_CONTEXT.chatHistoryKey}`;
    await DATABASE.put(lastMessageKey, JSON.stringify(message));
  }
  return null;
}
async function msgCheckEnvIsReady(message) {
  if (!ENV.API_KEY) {
    return sendMessageToTelegram("OpenAI API Key not set");
  }
  if (!DATABASE) {
    return sendMessageToTelegram("DATABASE not set");
  }
  return null;
}
async function msgFilterWhiteList(message) {
  if (ENV.I_AM_A_GENEROUS_PERSON) {
    return null;
  }
  if (SHARE_CONTEXT.chatType === "private") {
    if (!ENV.CHAT_WHITE_LIST.includes(`${CURRENT_CHAT_CONTEXT.chat_id}`)) {
      return sendMessageToTelegram(
        `You have no access. Please add your id (${CURRENT_CHAT_CONTEXT.chat_id}) to the whitelist.`
      );
    }
    return null;
  } else if (CONST.GROUP_TYPES.includes(SHARE_CONTEXT.chatType)) {
    if (!ENV.GROUP_CHAT_BOT_ENABLE) {
      return new Response("ID SUPPORT", { status: 200 });
    }
    if (!ENV.CHAT_GROUP_WHITE_LIST.includes(`${CURRENT_CHAT_CONTEXT.chat_id}`)) {
      return sendMessageToTelegram(
        `This group has no access. Please add the group id(${CURRENT_CHAT_CONTEXT.chat_id}) to the whitelist.`
      );
    }
    return null;
  }
  return sendMessageToTelegram(
    `The chat type (${SHARE_CONTEXT.chatType}) is not supported`
  );
}
async function msgFilterNonTextMessage(message) {
  if (!message.text) {
    return sendMessageToTelegram("Non-text messages are not supported.");
  }
  return null;
}
async function msgHandleGroupMessage(message) {
  if (!message.text) {
    return new Response("NON TEXT MESSAGE", { status: 200 });
  }
  const botName = SHARE_CONTEXT.currentBotName;
  if (botName) {
    let mentioned = false;
    if (message.reply_to_message) {
      if (message.reply_to_message.from.username === botName) {
        mentioned = true;
      }
    }
    if (message.entities) {
      let content = "";
      let offset = 0;
      message.entities.forEach((entity) => {
        switch (entity.type) {
          case "bot_command":
            if (!mentioned) {
              const mention = message.text.substring(
                entity.offset,
                entity.offset + entity.length
              );
              if (mention.endsWith(botName)) {
                mentioned = true;
              }
              const cmd = mention.replaceAll("@" + botName, "").replaceAll(botName).trim();
              content += cmd;
              offset = entity.offset + entity.length;
            }
            break;
          case "mention":
          case "text_mention":
            if (!mentioned) {
              const mention = message.text.substring(
                entity.offset,
                entity.offset + entity.length
              );
              if (mention === botName || mention === "@" + botName) {
                mentioned = true;
              }
            }
            content += message.text.substring(offset, entity.offset);
            offset = entity.offset + entity.length;
            break;
        }
      });
      content += message.text.substring(offset, message.text.length);
      message.text = content.trim();
    }
    if (!mentioned) {
      return new Response("NOT MENTIONED", { status: 200 });
    } else {
      return null;
    }
  }
  return new Response("NOT SET BOTNAME", { status: 200 });
  ;
}
async function msgHandleCommand(message) {
  return await handleCommandMessage(message);
}
async function msgChatWithOpenAI(message) {
  try {
    sendChatActionToTelegram("typing").then(console.log).catch(console.error);
    const historyKey = SHARE_CONTEXT.chatHistoryKey;
    const { real: history, fake: fakeHistory } = await loadHistory(historyKey);
    const answer = await sendMessageToChatGPT(message.text, fakeHistory || history);
    history.push({ role: "user", content: message.text || "" });
    history.push({ role: "assistant", content: answer });
    await DATABASE.put(historyKey, JSON.stringify(history));
    return sendMessageToTelegram(answer);
  } catch (e) {
    return sendMessageToTelegram(`ERROR:CHAT: ${e.message}`);
  }
}
async function processMessageByChatType(message) {
  const handlerMap = {
    "private": [
      msgFilterWhiteList,
      msgFilterNonTextMessage,
      msgHandleCommand
    ],
    "group": [
      msgHandleGroupMessage,
      msgFilterWhiteList,
      msgHandleCommand
    ],
    "supergroup": [
      msgHandleGroupMessage,
      msgFilterWhiteList,
      msgHandleCommand
    ]
  };
  if (!handlerMap.hasOwnProperty(SHARE_CONTEXT.chatType)) {
    return sendMessageToTelegram(
      `Type (${SHARE_CONTEXT.chatType}) not supported`
    );
  }
  const handlers = handlerMap[SHARE_CONTEXT.chatType];
  for (const handler of handlers) {
    try {
      const result = await handler(message);
      if (result && result instanceof Response) {
        return result;
      }
    } catch (e) {
      console.error(e);
      return sendMessageToTelegram(
        `Error happened when processing chat type: (${SHARE_CONTEXT.chatType})`
      );
    }
  }
  return null;
}
async function loadHistory(key) {
  const initMessage = { role: "system", content: USER_CONFIG.SYSTEM_INIT_MESSAGE };
  let history = [];
  try {
    history = await DATABASE.get(key).then((res) => JSON.parse(res));
  } catch (e) {
    console.error(e);
  }
  if (!history || !Array.isArray(history) || history.length === 0) {
    history = [];
  }
  if (ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH > 0) {
    if (history.length > ENV.MAX_HISTORY_LENGTH) {
      history = history.splice(history.length - ENV.MAX_HISTORY_LENGTH);
    }
    let tokenLength = Array.from(initMessage.content).length;
    for (let i = history.length - 1; i >= 0; i--) {
      const historyItem = history[i];
      let length = 0;
      if (historyItem.content) {
        length = Array.from(historyItem.content).length;
      } else {
        historyItem.content = "";
      }
      tokenLength += length;
      if (tokenLength > MAX_TOKEN_LENGTH) {
        history = history.splice(i + 1);
        break;
      }
    }
  }
  switch (history.length > 0 ? history[0].role : "") {
    case "assistant":
    case "system":
      history[0] = initMessage;
      break;
    default:
      history.unshift(initMessage);
  }
  return { real: history };
}
async function handleMessage(request) {
  const { message } = await request.json();
  const handlers = [
    msgInitTelegramToken,
    msgInitChatContext,
    msgSaveLastMessage,
    msgCheckEnvIsReady,
    processMessageByChatType,
    msgChatWithOpenAI
  ];
  for (const handler of handlers) {
    try {
      const result = await handler(message, request);
      if (result && result instanceof Response) {
        return result;
      }
    } catch (e) {
      return new Response(errorToString(e), { status: 200 });
    }
  }
  return null;
}

// src/router.js
var helpLink = "https://github.com/TBXark/ChatGPT-Telegram-Workers/blob/master/DEPLOY.md";
var issueLink = "https://github.com/TBXark/ChatGPT-Telegram-Workers/issues";
var initLink = "./init";
var footer = `
<br/>
<p>For more information, please visit <a href="${helpLink}">${helpLink}</a></p>
<p>If you have any questions, please visit <a href="${issueLink}">${issueLink}</a></p>
`;
async function bindWebHookAction(request) {
  const result = [];
  const domain = new URL(request.url).host;
  for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
    const url = `https://${domain}/telegram/${token.trim()}/webhook`;
    const id = token.split(":")[0];
    result[id] = {
      webhook: await bindTelegramWebHook(token, url).catch((e) => errorToString(e)),
      command: await bindCommandForTelegram(token).catch((e) => errorToString(e))
    };
  }
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <h2>${domain}</h2>
    ${Object.keys(result).map((id) => `
        <br/>
        <h4>Bot ID: ${id}</h4>
        <p style="color: ${result[id].webhook.ok ? "green" : "red"}">Webhook: ${JSON.stringify(result[id].webhook)}</p>
        <p style="color: ${result[id].command.ok ? "green" : "red"}">Command: ${JSON.stringify(result[id].command)}</p>
        `).join("")}
      ${footer}
    `);
  return new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } });
}
async function loadChatHistory(request) {
  const password = await historyPassword();
  const { pathname } = new URL(request.url);
  const historyKey = pathname.match(/^\/telegram\/(.+)\/history/)[1];
  const params = new URL(request.url).searchParams;
  const passwordParam = params.get("password");
  if (passwordParam !== password) {
    return new Response("Password Error", { status: 401 });
  }
  const history = await DATABASE.get(historyKey).then((res) => JSON.parse(res));
  const HTML = renderHTML(`
        <div id="history" style="width: 100%; height: 100%; overflow: auto; padding: 10px;">
            ${history.map((item) => `
                <div style="margin-bottom: 10px;">
                    <hp style="font-size: 16px; color: #999; margin-bottom: 5px;">${item.role}:</hp>
                    <p style="font-size: 12px; color: #333;">${item.content}</p>
                </div>
            `).join("")}
        </div>
  `);
  return new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } });
}
async function telegramWebhookAction(request) {
  const resp = await handleMessage(request);
  return resp || new Response("NOT HANDLED", { status: 200 });
}
async function defaultIndexAction() {
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <p>Deployed Successfully!</p>
    <p>You must <strong><a href="${initLink}"> >>>>> click here <<<<< </a></strong> to bind the webhook.</p>
    <br/>
    <p>After binding the webhook, you can use the following commands to control the bot:</p>
    ${commandsHelp().map((item) => `<p><strong>${item.command}</strong> - ${item.description}</p>`).join("")}
    <br/>
    <p>You can get bot information by visiting the following URL:</p>
    <p><strong>/telegram/:token/bot</strong> - Get bot information</p>
    ${footer}
  `);
  return new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } });
}
async function loadBotInfo() {
  const result = [];
  for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
    const id = token.split(":")[0];
    result[id] = await getBot(token);
  }
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <h4>Environment About Bot</h4>
    <p><strong>GROUP_CHAT_BOT_ENABLE:</strong> ${ENV.GROUP_CHAT_BOT_ENABLE}</p>
    <p><strong>GROUP_CHAT_BOT_SHARE_MODE:</strong> ${ENV.GROUP_CHAT_BOT_SHARE_MODE}</p>
    <p><strong>TELEGRAM_BOT_NAME:</strong> ${ENV.TELEGRAM_BOT_NAME.join(",")}</p>
    ${Object.keys(result).map((id) => `
            <br/>
            <h4>Bot ID: ${id}</h4>
            <p style="color: ${result[id].ok ? "green" : "red"}">${JSON.stringify(result[id])}</p>
            `).join("")}
    ${footer}
  `);
  return new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } });
}
async function handleRequest(request) {
  const { pathname } = new URL(request.url);
  if (pathname === `/`) {
    return defaultIndexAction();
  }
  if (pathname.startsWith(`/init`)) {
    return bindWebHookAction(request);
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/history`)) {
    return loadChatHistory(request);
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/webhook`)) {
    return telegramWebhookAction(request);
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/bot`)) {
    return loadBotInfo(request);
  }
  return null;
}

// main.js
var main_default = {
  async fetch(request, env) {
    try {
      initEnv(env);
      const resp = await handleRequest(request);
      return resp || new Response("NOTFOUND", { status: 404 });
    } catch (e) {
      console.error(e);
      return new Response(errorToString(e), { status: 200 });
    }
  }
};
export {
  main_default as default
};

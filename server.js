require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');


const app = express();
app.use(cors());
app.use(express.json());

// Serve static files to prevent "Cannot GET /"
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const JWT_SECRET = "supersecretkey";

// Store data in-memory since no DB configuration was found
const users = [];
const allChats = {};

// ================= AUTH ENDPOINTS =================
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  const id = Date.now().toString();
  users.push({ id, username, password });
  allChats[id] = [{ id: Date.now().toString(), title: "New Chat", isPinned: false, messages: [] }]; // initial chat
  res.json({ success: true, message: "User registered" });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ msg: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, name: user.username, picture: user.picture });
});

app.post('/google-login', (req, res) => {
  const { email, name, picture } = req.body;
  let user = users.find(u => u.email === email);
  if (!user) {
    user = { id: Date.now().toString(), email, username: name, picture };
    users.push(user);
    allChats[user.id] = [{ id: Date.now().toString(), title: "New Chat", isPinned: false, messages: [] }];
  } else if (picture) {
    user.picture = picture;
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, name: user.username, picture: user.picture });
});

// ================= MIDDLEWARE =================
const authenticate = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ msg: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ msg: "Invalid token" });
  }
};

// ================= CHAT ENDPOINTS =================
app.get('/get-chats', authenticate, (req, res) => {
  const userChats = allChats[req.user.id] || [];
  // Sort pinned chats to the top, and by newest first
  const sortedChats = [...userChats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return Number(b.id) - Number(a.id);
  });
  res.json({ chats: sortedChats });
});

app.post('/new-chat', authenticate, (req, res) => {
  if (!allChats[req.user.id]) allChats[req.user.id] = [];
  const newId = Date.now().toString();
  allChats[req.user.id].unshift({ id: newId, title: "New Chat", isPinned: false, messages: [] });
  res.json({ success: true, id: newId });
});

app.delete('/delete-chat/:id', authenticate, (req, res) => {
  if (!allChats[req.user.id]) return res.status(404).json({ msg: "Not found" });
  allChats[req.user.id] = allChats[req.user.id].filter(c => String(c.id) !== String(req.params.id));
  res.json({ success: true });
});

app.post('/pin-chat/:id', authenticate, (req, res) => {
  if (!allChats[req.user.id]) return res.status(404).json({ msg: "Not found" });
  const chat = allChats[req.user.id].find(c => String(c.id) === String(req.params.id));
  if (chat) {
    chat.isPinned = !chat.isPinned;
  }
  res.json({ success: true });
});



app.post('/chat', authenticate, async (req, res) => {
  const { message, chatId } = req.body;
  const userId = req.user.id;

  if (!allChats[userId]) {
    const id = Date.now().toString();
    allChats[userId] = [{ id, title: "New Chat", isPinned: false, messages: [] }];
  }

  let chat = allChats[userId].find(c => String(c.id) === String(chatId));
  if (!chat) {
    if (allChats[userId].length > 0) {
      chat = allChats[userId][0];
    } else {
      const newId = Date.now().toString();
      chat = { id: newId, title: "New Chat", isPinned: false, messages: [] };
      allChats[userId].unshift(chat);
    }
  }

  if (chat.title === "New Chat" && message) {
    chat.title = message.length > 25 ? message.substring(0, 25) + "..." : message;
  }

  let msgContent = message || "";

  if (msgContent) {
    chat.messages.push({ role: "user", content: msgContent });
  }
  let botReply = "Hello! I am a bot responding from the local server.";

  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (GROQ_API_KEY) {
      const msgsForLLM = chat.messages.map(m => ({ role: m.role, content: m.content }));

      // Inject system prompt for image generation
      msgsForLLM.unshift({
        role: "system",
        content: "You are a helpful AI assistant. IMPORTANT: If the user asks you to generate, create, or draw an image, you MUST respond ONLY with a markdown image tag using this exact format: ![Generated Image](https://image.pollinations.ai/prompt/{detailed_prompt}?width=1024&height=1024&nologo=true). Replace {detailed_prompt} with a highly detailed, URL-encoded visual description of the requested image. YOU MUST ALWAYS append photography keywords to the prompt to ensure it looks like a real photo, such as 'raw photo, ultra-realistic photography, DSLR, 35mm lens, f/1.8, Kodak Portra 400, candid photography, natural lighting'. DO NOT output any other text before or after."
      });

      const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
        model: "llama-3.1-8b-instant",
        messages: msgsForLLM
      }, {
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}` }
      });
      botReply = groqRes.data.choices[0].message.content;
    }
  } catch (err) {
    console.error("LLM Error:", err.response ? err.response.data : err.message);
    botReply = "Error talking to Groq API. " + err.message;
  }

  chat.messages.push({ role: "assistant", content: botReply });
  res.json({ reply: botReply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://127.0.0.1:${PORT}`);
});
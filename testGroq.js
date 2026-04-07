require('dotenv').config();
const axios = require('axios');

async function testGroq() {
    try {
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: "hello" }]
        }, {
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}` }
        });
        console.log("Success:", groqRes.data.choices[0].message.content);
    } catch (e) {
        console.error("Failed:", e.response ? e.response.data : e.message);
    }
}
testGroq();

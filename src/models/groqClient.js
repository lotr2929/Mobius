// Groq client for cloud AI
export function createGroq(apiKey) {
  return {
    name: 'groq',
    displayName: 'Groq (Cloud)',
    async ask({ text }) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: text }],
            stream: false
          })
        });
        
        if (!response.ok) {
          throw new Error(`Groq error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        throw new Error(`Groq API error: ${error.message}`);
      }
    }
  };
}

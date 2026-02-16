// Ollama client for local AI models
export function createOllama() {
  return {
    name: 'local',
    displayName: 'Local Ollama',
    async ask({ text }) {
      try {
        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen',
            prompt: text,
            stream: false
          })
        });
        
        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.response;
      } catch (error) {
        if (error.message.includes('ECONNREFUSED')) {
          throw new Error('Ollama is not running. Please start Ollama first.');
        }
        throw error;
      }
    }
  };
}
